# GlassCortex Build-Package Script --- Build Machine Side
# Phase 67 Batch 3
#
# Use case: build machine (has git + npm + network) packages; server (no git/npm/build) extracts and deploys directly
#
# Usage:
#   # Run from project root:
#   .\deploy\build-package.ps1
#
#   # Specify output dir and version label:
#   .\deploy\build-package.ps1 -OutputDir C:\temp -Version "20260713"
#
#   # Re-pack only (skip rebuild):
#   .\deploy\build-package.ps1 -SkipBuild -SkipModel
#
# Output: glasscortex-deploy-<version>.zip
#   Extracted structure becomes the C:\apps\glasscortex\ target layout
#
# Package contents:
#   +-- src/ api/ tests/ docs/ deploy/   # source (no .git)
#   +-- frontend/.next/standalone/        # Next.js pre-built output
#   +-- wheels/                           # Python wheel offline packages
#   +-- models/huggingface/               # Embedding model offline cache
#   +-- requirements-lock.txt             # Python dependency lock file
#   +-- .env.example / pyproject.toml     # Config files
#   +-- CLAUDE.md / README.md / Makefile  # Project docs

param(
    [string]$AppRoot = "",
    [string]$OutputDir = "",
    [string]$Version = "",
    [string]$TargetPlatform = "auto",
    [switch]$SkipBuild = $false,
    [switch]$SkipModel = $false,
    [switch]$SkipWheels = $false,
    [switch]$Patch = $false
)

$ErrorActionPreference = "Stop"
$startTime = Get-Date

# Patch mode: incremental update (skip wheels + model, flat zip)
$PATCH_MODE = $Patch.IsPresent

# --- Path resolution ---
if (!$AppRoot) {
    $AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
}
if (!$OutputDir) {
    $OutputDir = Join-Path $AppRoot "deploy-package"
}
if (!$Version) {
    $Version = Get-Date -Format "yyyyMMdd"
}

$packageName = "glasscortex-deploy-$Version"
$stagingDir = Join-Path $OutputDir $packageName
$zipPath = Join-Path $OutputDir "$packageName.zip"

Write-Host @"
========================================
 GlassCortex Build Package
 Phase 67 Batch 3
========================================
  Source:    $AppRoot
  Staging:   $stagingDir
  Output:    $zipPath
  Version:   $Version
  Platform:  $TargetPlatform
  Time:      $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
========================================
"@ -ForegroundColor Cyan

# =======================================================
# Step 1: Prepare staging directory
# =======================================================

Write-Host "`n[1/7] Preparing staging directory..." -ForegroundColor Cyan

if (Test-Path $stagingDir) {
    Write-Host "  Removing old staging..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $stagingDir
}
New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null

# =======================================================
# Step 2: Copy source (ignore build artifacts + VCS)
# =======================================================

Write-Host "`n[2/7] Copying source files..." -ForegroundColor Cyan

Push-Location $AppRoot

# Exclusion pattern: git repo, venv, node_modules, build artifacts, runtime data, Python cache
$excludeDirs = @(
    ".git",
    "venv",
    ".venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "data",
    "logs",
    "backups",
    "deploy-package",
    ".next"           # Frontend build output handled separately (see Step 5), skip here during source copy
)

# Copy source directories
$sourceDirs = @("src", "api", "tests", "docs", "deploy")
foreach ($dir in $sourceDirs) {
    if (Test-Path $dir) {
        $dest = Join-Path $stagingDir $dir
        Write-Host "  Copying $dir/ ..." -ForegroundColor DarkGray
        Copy-Item -Recurse -Force -Path $dir -Destination $dest
    }
}

# Copy frontend dir (exclude node_modules + .next; build output handled separately)
if (Test-Path "frontend") {
    Write-Host "  Copying frontend/ (excluding node_modules, .next)..." -ForegroundColor DarkGray
    $frontendDest = Join-Path $stagingDir "frontend"
    New-Item -ItemType Directory -Force -Path $frontendDest | Out-Null

    Get-ChildItem -Path "frontend" -Force | Where-Object {
        $_.Name -notin @("node_modules", ".next")
    } | ForEach-Object {
        Copy-Item -Recurse -Force -Path $_.FullName -Destination (Join-Path $frontendDest $_.Name)
    }
}

# Copy root-level files
$rootFiles = @(
    ".env.example",
    ".gitignore",
    "CLAUDE.md",
    "README.md",
    "Makefile",
    "pyproject.toml",
    "requirements.in",
    "requirements-lock.txt"
)
foreach ($file in $rootFiles) {
    if (Test-Path $file) {
        Write-Host "  Copying $file" -ForegroundColor DarkGray
        Copy-Item -Force -Path $file -Destination (Join-Path $stagingDir $file)
    }
}

# Create empty dirs (needed at runtime)
New-Item -ItemType Directory -Force -Path (Join-Path $stagingDir "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stagingDir "logs") | Out-Null

# Phase 67 Batch 24: Generate START_HERE.txt at package root
# This is the FIRST file users see when unzipping.
# It prevents the common mistake of manually running uvicorn before venv exists.
$startHerePath = Join-Path $stagingDir "START_HERE.txt"
@"
============================================================
  STOP! READ THIS FIRST --- GlassCortex Deployment Package
============================================================

  DO NOT manually run python, uvicorn, or node commands!

  The venv\ directory is NOT included in this zip
  (Python venvs are not portable across machines).

  Instead, open an Admin PowerShell and run:

      .\deploy\deploy.ps1

  This script will AUTO-DETECT that this is a package
  deployment and will:

    1. Create Python venv + install all dependencies
    2. Set up the embedding model cache
    3. Use the pre-built Next.js frontend
    4. Register Windows Services (if NSSM is installed)

  Full instructions: deploy\README.md

  Common mistake:
    > python -m uvicorn api.main:app
    -> "No module named uvicorn" or "python not found"
    -> This is EXPECTED: venv does not exist yet.
    -> Run .\deploy\deploy.ps1 first!

  Integrity check (optional):
    .\deploy\check-package.ps1

============================================================
"@ | Set-Content -Path $startHerePath -Encoding UTF8
Write-Host "  Generated START_HERE.txt (entry guard)" -ForegroundColor DarkGray

Pop-Location
Write-Host "  Source copy complete" -ForegroundColor Green

# =======================================================
# Step 3: Download Python wheels (offline packages)
# =======================================================

if (!$SkipWheels) {
    Write-Host "`n[3/7] Downloading Python wheels..." -ForegroundColor Cyan

    Push-Location $AppRoot
    $wheelsDir = Join-Path $stagingDir "wheels"
    New-Item -ItemType Directory -Force -Path $wheelsDir | Out-Null

    # Check Python availability
    $pythonCmd = $null
    if (Test-Path (Join-Path $AppRoot "venv\Scripts\python.exe")) {
        $pythonCmd = Join-Path $AppRoot "venv\Scripts\python.exe"
    } elseif (Test-Path (Join-Path $AppRoot "venv\bin\python3")) {
        $pythonCmd = Join-Path $AppRoot "venv\bin\python3"
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        $pythonCmd = (Get-Command python).Source
    } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
        $pythonCmd = (Get-Command python3).Source
    } else {
        Write-Error "Python not found --- set up venv first (make setup) or ensure python is in PATH"
    }
    Write-Host "  Python: $pythonCmd" -ForegroundColor DarkGray

    if ($TargetPlatform -eq "auto") {
        # Same-platform: download current platform wheels directly
        Write-Host "  Platform: auto (current platform) --- downloading native wheels" -ForegroundColor Yellow

        & $pythonCmd -m pip download -r requirements-lock.txt --dest "$wheelsDir" 2>&1 | ForEach-Object {
            if ($_ -match "Successfully downloaded|Collecting|Saved") {
                Write-Host "    $_" -ForegroundColor DarkGray
            }
        }

        if ($LASTEXITCODE -ne 0) {
            Write-Error "pip download failed --- check network and requirements-lock.txt"
        }
    } else {
        # Cross-platform: specify target platform
        Write-Host "  Platform: $TargetPlatform --- cross-platform wheel download" -ForegroundColor Yellow
        Write-Host "    (native packages without pre-built wheels will need VC++ Build Tools on server)" -ForegroundColor Yellow

        # Try only-binary first; fall back to source packages
        & $pythonCmd -m pip download -r requirements-lock.txt --dest "$wheelsDir" `
            --platform $TargetPlatform --python-version 3.14 `
            --only-binary=:all: 2>&1 | ForEach-Object {
            if ($_ -match "ERROR|Successfully downloaded|Collecting|Saved") {
                Write-Host "    $_" -ForegroundColor DarkGray
            }
        }

        if ($LASTEXITCODE -ne 0) {
            Write-Warning "  Some packages lack pre-built wheels for $TargetPlatform --- downloading source packages as fallback"
            & $pythonCmd -m pip download -r requirements-lock.txt --dest "$wheelsDir" `
                --platform $TargetPlatform --python-version 3.14 2>&1 | ForEach-Object {
                if ($_ -match "Successfully downloaded|Collecting|Saved") {
                    Write-Host "    $_" -ForegroundColor DarkGray
                }
            }
        }
    }

    $wheelCount = (Get-ChildItem -Path $wheelsDir -Filter "*.whl" -File).Count
    $tarCount = (Get-ChildItem -Path $wheelsDir -Filter "*.tar.gz" -File).Count
    Write-Host "  Downloaded: $wheelCount wheels, $tarCount source packages -> $(Join-Path $stagingDir 'wheels')" -ForegroundColor Green

    Pop-Location
} else {
    Write-Host "`n[3/7] Skipping wheels download (--SkipWheels)" -ForegroundColor Yellow
}

# =======================================================
# Step 4: Download embedding model (offline model cache)
# =======================================================

if (!$SkipModel) {
    Write-Host "`n[4/7] Downloading embedding model..." -ForegroundColor Cyan

    Push-Location $AppRoot
    $modelsDir = Join-Path $stagingDir "models"
    $hfCacheDir = Join-Path $modelsDir "huggingface"
    New-Item -ItemType Directory -Force -Path $hfCacheDir | Out-Null

    Write-Host "  Triggering model download (all-MiniLM-L6-v2, ~90MB)..." -ForegroundColor Yellow

    # Use project venv Python to trigger download
    $downloadScript = @"
import os, shutil
os.environ["HF_HOME"] = r"$hfCacheDir"
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
print(f'Model loaded: {model}')
print(f'Cache dir: {os.environ["HF_HOME"]}')
"@

    $downloadScript | & $pythonCmd - 2>&1 | ForEach-Object {
        if ($_ -match "Model loaded|Cache dir|Downloading|Fetching|progress") {
            Write-Host "    $_" -ForegroundColor DarkGray
        }
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "  Model download had issues --- server may need to download on first run."
        Write-Warning "  If server is offline, re-run with network and without --SkipModel."
    } else {
        Write-Host "  Model cached at: $hfCacheDir" -ForegroundColor Green
    }

    Pop-Location
} else {
    Write-Host "`n[4/7] Skipping model download (--SkipModel)" -ForegroundColor Yellow
}

# =======================================================
# Step 5: Frontend build (Next.js standalone)
# =======================================================

if (!$SkipBuild) {
    Write-Host "`n[5/7] Building frontend (Next.js standalone)..." -ForegroundColor Cyan

    Push-Location (Join-Path $AppRoot "frontend")

    # Check Node.js
    $nodeVersion = & node --version 2>$null
    if (!$nodeVersion) {
        Write-Error "Node.js not found --- install from https://nodejs.org/"
    }
    Write-Host "  Node.js $nodeVersion" -ForegroundColor Green

    # npm install
    if (!(Test-Path "node_modules")) {
        Write-Host "  Installing npm dependencies..." -ForegroundColor Yellow
        npm ci
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm ci failed --- check network and package-lock.json"
        }
    } else {
        Write-Host "  node_modules exists, skipping npm ci" -ForegroundColor DarkGray
    }

    # Build
    Write-Host "  Running next build (standalone mode)..." -ForegroundColor Yellow
    $env:NODE_ENV = "production"
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Frontend build failed --- check output above"
    }

    # --- Copy standalone output to staging ---
    $standaloneDir = ".next\standalone"
    if (!(Test-Path $standaloneDir)) {
        Write-Error "Standalone output not found at $standaloneDir --- check next.config.ts output setting"
    }

    $stagingStandaloneDir = Join-Path $stagingDir "frontend\.next\standalone"
    New-Item -ItemType Directory -Force -Path $stagingStandaloneDir | Out-Null

    # Copy standalone directory
    Write-Host "  Copying standalone output to staging..." -ForegroundColor Yellow
    Copy-Item -Recurse -Force "$standaloneDir\*" $stagingStandaloneDir

    # Copy static/ to standalone/.next/static/ (Next.js 16 standalone reads from ./.next/static)
    if (Test-Path ".next\static") {
        Write-Host "  Copying .next/static/ to standalone/.next/static/..." -ForegroundColor DarkGray
        $stagingStandaloneNextStatic = Join-Path $stagingStandaloneDir ".next\static"
        New-Item -ItemType Directory -Force -Path $stagingStandaloneNextStatic | Out-Null
        Copy-Item -Recurse -Force ".next\static\*" $stagingStandaloneNextStatic
    }

    # Copy public/ to standalone/public/ (Next.js 16 standalone reads from ./public)
    if (Test-Path "public") {
        Write-Host "  Copying public/ to standalone/public/..." -ForegroundColor DarkGray
        $stagingPublic = Join-Path $stagingStandaloneDir "public"
        New-Item -ItemType Directory -Force -Path $stagingPublic | Out-Null
        Copy-Item -Recurse -Force "public\*" $stagingPublic
    }

    Pop-Location
    Write-Host "  Frontend build complete" -ForegroundColor Green
} else {
    Write-Host "`n[5/7] Skipping build (--SkipBuild)" -ForegroundColor Yellow
}

# =======================================================
# Step 6: Create zip
# =======================================================

Write-Host "`n[6/7] Creating deployment zip..." -ForegroundColor Cyan

Push-Location $OutputDir

# Remove old zip (if exists)
if (Test-Path $zipPath) {
    Write-Host "  Removing old zip..." -ForegroundColor DarkGray
    Remove-Item -Force $zipPath
}

# Use Compress-Archive (PowerShell 5+ built-in)
# Patch mode: flat zip (no parent directory) -- extract directly into AppRoot
# Full mode: parent directory wrapper -- extract to C:\apps\, then rename
Write-Host "  Compressing $packageName -> $packageName.zip ..." -ForegroundColor Yellow

if ($PATCH_MODE) {
    # Flat zip: cd into staging dir, zip everything directly
    Push-Location $stagingDir
    Compress-Archive -Path ".\*" -DestinationPath $zipPath -CompressionLevel Optimal
    Pop-Location
} else {
    # Wrapped zip: parent directory preserved
    Push-Location $OutputDir
    Compress-Archive -Path ".\$packageName" -DestinationPath $zipPath -CompressionLevel Optimal
    Pop-Location
}

if (!(Test-Path $zipPath)) {
    Write-Error "Zip creation failed --- $zipPath not found"
}

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "  Zip created: $zipPath ($zipSize MB)" -ForegroundColor Green

Pop-Location

# =======================================================
# Step 7: Clean staging + output summary
# =======================================================

Write-Host "`n[7/7] Cleaning up staging directory..." -ForegroundColor Cyan
Remove-Item -Recurse -Force $stagingDir
Write-Host "  Staging removed" -ForegroundColor Green

# --- Done ---
$elapsed = (Get-Date) - $startTime

Write-Host @"

========================================
 Build Package Complete
========================================
  Duration: $($elapsed.TotalSeconds.ToString('0.0'))s
  Output:   $zipPath
  Size:     $zipSize MB
========================================

Next Steps:
$(
if ($PATCH_MODE) {
@"  [PATCH MODE] Incremental update --- flat zip, extract directly into AppRoot:
  1. Copy $packageName.zip to target Windows Server
  2. On Server (Admin PowerShell):
     Expand-Archive -Force -Path C:\temp\$packageName.zip -DestinationPath C:\apps\glasscortex\
     C:\apps\glasscortex\deploy\deploy.ps1 -SkipClone -SkipBuild
  (No parent directory in zip --- files land directly in AppRoot, overwriting existing)
"@
} else {
@"  1. Copy $packageName.zip to target Windows Server (USB / SMB / SFTP)
  2. On Server (Admin PowerShell):
     Expand-Archive -Path C:\temp\$packageName.zip -DestinationPath C:\apps\
     Rename-Item C:\apps\$packageName C:\apps\glasscortex
     C:\apps\glasscortex\deploy\deploy.ps1 -SkipClone -SkipBuild
  3. Configure Nginx per deploy\README.md S2.2
"@
}
)

"@ -ForegroundColor Cyan
