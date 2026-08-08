# GlassCortex Deployment Package Integrity Self-Check
# Phase 67 Batch 24 --- Entry guard: validate package structure before deploy
#
# Usage:
#   .\deploy\check-package.ps1                  # Check from package root
#   .\deploy\check-package.ps1 -AppRoot C:\apps\glasscortex
#
# Exit codes:
#   0 = all checks passed, ready to deploy
#   1 = critical files missing, cannot proceed
#   2 = warnings only (venv not created yet, etc.) --- run deploy.ps1 to fix
#
# This script is ALL ASCII for PS 5.1 compatibility.
# Phase 67 Batch 22: BOM + all-ASCII + CRLF triple guard.

param(
    [string]$AppRoot = ""
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path $PSScriptRoot -Parent

if (!$AppRoot) {
    $AppRoot = $scriptDir
}

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host " GlassCortex Package Integrity Self-Check" -ForegroundColor Cyan
Write-Host " Phase 67 Batch 24" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  AppRoot: $AppRoot" -ForegroundColor DarkGray
Write-Host ""

$errors = @()
$warnings = @()
$passes = @()

# ---- Helper functions ----

function Check-Pass($msg) {
    Write-Host "  [PASS] $msg" -ForegroundColor Green
    $script:passes += $msg
}

function Check-Warn($msg) {
    Write-Host "  [WARN] $msg" -ForegroundColor Yellow
    $script:warnings += $msg
}

function Check-Fail($msg) {
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
    $script:errors += $msg
}

# ============================================
# 1. Directory structure
# ============================================

Write-Host "--- Directory Structure ---" -ForegroundColor Cyan

$requiredDirs = @(
    @{Path="src"; Desc="Python source"},
    @{Path="api"; Desc="FastAPI application"},
    @{Path="frontend"; Desc="Next.js frontend"},
    @{Path="deploy"; Desc="Deployment scripts"}
)

$optionalDirs = @(
    @{Path="tools"; Desc="Check tools (check_docs.py etc.)"},
    @{Path="tests"; Desc="Test suite"},
    @{Path="docs"; Desc="Documentation"},
    @{Path="wheels"; Desc="Python offline wheels"},
    @{Path="models\huggingface"; Desc="Pre-cached embedding model"},
    @{Path="data"; Desc="Runtime data directory"},
    @{Path="logs"; Desc="Runtime log directory"}
)

foreach ($d in $requiredDirs) {
    $fullPath = Join-Path $AppRoot $d.Path
    if (Test-Path $fullPath -PathType Container) {
        Check-Pass "$($d.Path)/ exists -- $($d.Desc)"
    } else {
        Check-Fail "$($d.Path)/ MISSING -- $($d.Desc)"
    }
}

foreach ($d in $optionalDirs) {
    $fullPath = Join-Path $AppRoot $d.Path
    if (Test-Path $fullPath -PathType Container) {
        Check-Pass "$($d.Path)/ exists -- $($d.Desc)"
    }
}

# ============================================
# 2. Critical files
# ============================================

Write-Host ""
Write-Host "--- Critical Files ---" -ForegroundColor Cyan

$requiredFiles = @(
    @{Path="requirements-lock.txt"; Desc="Python dependency lock file"},
    @{Path="pyproject.toml"; Desc="Project metadata"},
    @{Path="api\main.py"; Desc="FastAPI entry point"},
    @{Path="deploy\deploy.ps1"; Desc="One-click deploy script"},
    @{Path="deploy\install-services.ps1"; Desc="NSSM service registration"}
)

$envFiles = @(
    @{Path=".env"; Desc="Runtime config (with API keys)"},
    @{Path=".env.example"; Desc="Config template"}
)

foreach ($f in $requiredFiles) {
    $fullPath = Join-Path $AppRoot $f.Path
    if (Test-Path $fullPath -PathType Leaf) {
        Check-Pass "$($f.Path) -- $($f.Desc)"
    } else {
        Check-Fail "$($f.Path) MISSING -- $($f.Desc)"
    }
}

$hasEnv = $false
foreach ($f in $envFiles) {
    $fullPath = Join-Path $AppRoot $f.Path
    if (Test-Path $fullPath -PathType Leaf) {
        if ($f.Path -eq ".env") { $hasEnv = $true }
        Check-Pass "$($f.Path) exists"
    } else {
        if ($f.Path -eq ".env") {
            Check-Warn ".env not found -- will be created from .env.example by deploy.ps1"
        } else {
            Check-Warn ".env.example not found -- deploy.ps1 will warn about API keys"
        }
    }
}

# ============================================
# 3. Python venv status
# ============================================

Write-Host ""
Write-Host "--- Python Environment ---" -ForegroundColor Cyan

$pythonExe = Join-Path $AppRoot "venv\Scripts\python.exe"
$pipExe = Join-Path $AppRoot "venv\Scripts\pip.exe"

if (Test-Path $pythonExe) {
    Check-Pass "venv\Scripts\python.exe exists"
    # Try to get version
    $pyVer = & $pythonExe --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "           $pyVer" -ForegroundColor DarkGray
    }
} else {
    Check-Warn "venv NOT created yet -- run deploy.ps1 to create it"
    Write-Host "           deploy.ps1 Step 2 will: python -m venv venv + pip install" -ForegroundColor DarkGray
}

# Check if usearch is importable (critical compiled dep)
if (Test-Path $pythonExe) {
    $usearchOk = & $pythonExe -c "from usearch.compiled import Index; print('OK')" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Check-Pass "usearch importable (critical compiled dependency)"
    } else {
        Check-Warn "usearch not importable -- pip install may be incomplete"
    }
}

# Check wheels/ directory (offline package mode indicator)
$wheelsDir = Join-Path $AppRoot "wheels"
if (Test-Path $wheelsDir) {
    $wheelCount = (Get-ChildItem -Path $wheelsDir -Filter "*.whl" -File -ErrorAction SilentlyContinue).Count
    if ($wheelCount -gt 0) {
        Check-Pass "wheels/ has $wheelCount .whl files -- offline install ready"
    } else {
        Check-Warn "wheels/ exists but no .whl files found"
    }
}

# ============================================
# 4. Frontend build status
# ============================================

Write-Host ""
Write-Host "--- Frontend Build ---" -ForegroundColor Cyan

$standaloneServer = Join-Path $AppRoot "frontend\.next\standalone\server.js"
$nodeModules = Join-Path $AppRoot "frontend\node_modules"
$packageJson = Join-Path $AppRoot "frontend\package.json"

if (Test-Path $standaloneServer) {
    Check-Pass "frontend\.next\standalone\server.js exists -- standalone build ready"
    # Check static assets
    $staticDir = Join-Path $AppRoot "frontend\.next\standalone\.next\static"
    if (Test-Path $staticDir) {
        Check-Pass ".next/static/ present in standalone"
    } else {
        Check-Warn ".next/static/ missing from standalone -- CSS/JS may 404"
    }
} else {
    if (Test-Path $packageJson) {
        Check-Warn "Standalone build NOT found -- run deploy.ps1 (or npm run build) to build frontend"
        Write-Host "           deploy.ps1 Step 4 will: npm ci + npm run build" -ForegroundColor DarkGray
    } else {
        Check-Warn "frontend/package.json not found -- frontend may be excluded from this package"
    }
}

# ============================================
# 5. Model cache status
# ============================================

Write-Host ""
Write-Host "--- Embedding Model Cache ---" -ForegroundColor Cyan

$pkgModelDir = Join-Path $AppRoot "models\huggingface"
$hfCache = Join-Path $env:USERPROFILE ".cache\huggingface"

if (Test-Path $pkgModelDir) {
    # Check if model files actually exist (not just empty dir)
    $modelFiles = Get-ChildItem -Path $pkgModelDir -Recurse -File -ErrorAction SilentlyContinue
    if ($modelFiles.Count -gt 0) {
        Check-Pass "models/huggingface/ cached ($($modelFiles.Count) files) -- offline model ready"
    } else {
        Check-Warn "models/huggingface/ exists but empty -- model will download on first run"
    }
} elseif (Test-Path $hfCache) {
    Check-Pass "HF cache exists at $hfCache -- model already downloaded"
} else {
    Check-Warn "Model not cached -- will download on first API startup (~90MB)"
    Write-Host "           For offline servers, pre-download on a networked machine first" -ForegroundColor DarkGray
}

# ============================================
# 6. Deploy script readiness
# ============================================

Write-Host ""
Write-Host "--- Deploy Script Readiness ---" -ForegroundColor Cyan

$deployScript = Join-Path $AppRoot "deploy\deploy.ps1"
if (Test-Path $deployScript) {
    Check-Pass "deploy.ps1 found"

    # Check if running as Admin (required for service registration)
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
    if ($isAdmin) {
        Check-Pass "Running as Administrator"
    } else {
        Check-Warn "NOT running as Administrator -- service registration (Step 5) will fail"
        Write-Host "           Re-run this check from an Admin PowerShell window" -ForegroundColor DarkGray
    }

    # Check execution policy
    $execPolicy = Get-ExecutionPolicy -Scope Process -ErrorAction SilentlyContinue
    if ($execPolicy -eq "RemoteSigned" -or $execPolicy -eq "Unrestricted" -or $execPolicy -eq "Bypass") {
        Check-Pass "Execution policy: $execPolicy"
    } else {
        Check-Warn "Execution policy is '$execPolicy' -- deploy.ps1 may be blocked"
        Write-Host "           Run: Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process" -ForegroundColor DarkGray
    }
} else {
    Check-Fail "deploy.ps1 NOT found -- this is not a valid deployment package"
}

# ============================================
# Summary
# ============================================

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host " Self-Check Summary" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  PASS:   $($passes.Count)" -ForegroundColor Green
Write-Host "  WARN:   $($warnings.Count)" -ForegroundColor Yellow
Write-Host "  FAIL:   $($errors.Count)" -ForegroundColor Red
Write-Host "===========================================" -ForegroundColor Cyan

# Print actionable next steps based on results
Write-Host ""
if ($errors.Count -gt 0) {
    Write-Host "CRITICAL: $($errors.Count) check(s) failed." -ForegroundColor Red
    Write-Host "  The deployment package appears incomplete or corrupted." -ForegroundColor Red
    Write-Host "  Action: Re-extract the zip or re-run build-package.ps1 on the build machine." -ForegroundColor Red
    Write-Host ""
    exit 1
}

if ($warnings.Count -gt 0) {
    Write-Host "WARNINGS found but no critical errors." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  NEXT STEP: Run the deploy script to fix these warnings:" -ForegroundColor Cyan
    Write-Host "    .\deploy\deploy.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "  This will:" -ForegroundColor Cyan
    Write-Host "    - Create Python venv + install dependencies" -ForegroundColor DarkGray
    Write-Host "    - Build frontend (Next.js standalone)" -ForegroundColor DarkGray
    Write-Host "    - Register Windows Services (if NSSM is installed)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  IMPORTANT: DO NOT manually run python/uvicorn/node directly." -ForegroundColor Yellow
    Write-Host "  The venv does not exist yet. Always use deploy.ps1 as the entry point." -ForegroundColor Yellow
    Write-Host ""
    exit 2
}

# All green
Write-Host "All checks passed. The deployment package is intact and ready." -ForegroundColor Green
Write-Host ""
Write-Host "  If services are not yet running:" -ForegroundColor Cyan
Write-Host "    .\deploy\install-services.ps1 -AppRoot $AppRoot" -ForegroundColor White
Write-Host ""
Write-Host "  If you need to re-create the venv:" -ForegroundColor Cyan
Write-Host "    .\deploy\deploy.ps1 -SkipClone -SkipBuild" -ForegroundColor White
Write-Host ""
exit 0
