# GlassCortex One-Click Deployment Script --- Windows Server
# Phase 67 Batch 1 - Batch 3 (offline package support)
#
# Three deployment modes (auto-detected by script):
#   Mode 1 --- Git Clone:     deploy.ps1 -GitUrl "https://..."           (has git + network)
#   Mode 2 --- Existing code:  deploy.ps1 -SkipClone                      (manually copied source)
#   Mode 3 --- Packaged:       deploy.ps1                                  (extract from build-package.ps1 output)
#                              Auto-detect: no .git dir + has wheels/ -> enable offline pip + pre-cached model
#
# Usage (Admin PowerShell):
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
#   .\deploy\deploy.ps1 -GitUrl "https://github.com/your-org/glasscortex.git"
#
# This script:
#   1. Clone / verify source (skipped in package mode)
#   2. Create Python venv + install deps (package mode: offline wheels/)
#   3. Model cache detection (package mode: pre-cached models/huggingface/)
#   4. npm install + next build (standalone) (skipped in package mode)
#   5. Invoke install-services.ps1 to register Windows Services
#   6. Nginx setup guide

param(
    [string]$GitUrl = "",
    [string]$AppRoot = "C:\apps\glasscortex",
    [string]$Branch = "master",
    [switch]$SkipClone = $false,
    [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Stop"
$startTime = Get-Date

# --- Package mode auto-detection ---
# Condition: no .git dir (not a clone) -> auto-enable SkipClone + SkipBuild
#       has wheels/ -> subsequent steps use offline pip; has models/huggingface/ -> pre-cached model
$isPackageMode = $false
if (!(Test-Path "$AppRoot\.git")) {
    $isPackageMode = $true
    if (!$SkipClone) {
        $SkipClone = $true
    }
    if (!$SkipBuild) {
        $SkipBuild = $true
    }
}

$modeLabel = if ($isPackageMode) { "Package (offline)" } else { "Git (online)" }

Write-Host @"
========================================
 GlassCortex Production Deployment
 Phase 67 Batch 1 - Batch 3
========================================
  Target:    $AppRoot
  Branch:    $Branch
  Mode:      $modeLabel
  Time:      $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
========================================
"@ -ForegroundColor Cyan

if ($isPackageMode) {
    Write-Host "  [Package Mode] No .git detected --- auto-enabling SkipClone + SkipBuild" -ForegroundColor Green
    if (Test-Path "$AppRoot\wheels") {
        Write-Host "                  wheels/ detected --- will use offline pip install" -ForegroundColor Green
    } else {
        Write-Warning "                  wheels/ NOT found --- pip install requires internet"
    }
    if (Test-Path "$AppRoot\models\huggingface") {
        Write-Host "                  models/huggingface/ detected --- will use pre-cached model" -ForegroundColor Green
    } else {
        Write-Warning "                  models/huggingface/ NOT found --- model download on first run"
    }
}

# =======================================================
# Step 1: Get source code
# =======================================================

if ($SkipClone) {
    # Auto-detect AppRoot when SkipClone: use script parent dir if default path missing
    if (!(Test-Path $AppRoot)) {
        $detectedRoot = Split-Path $PSScriptRoot -Parent
        Write-Host "[*] Default AppRoot ($AppRoot) not found, using script location: $detectedRoot" -ForegroundColor Yellow
        $AppRoot = $detectedRoot
    }
    Write-Host "[1/6] Skipping clone (--SkipClone)" -ForegroundColor Yellow
} else {
    Write-Host "`n[1/6] Cloning repository..." -ForegroundColor Cyan
    if ($GitUrl) {
        if (Test-Path $AppRoot) {
            Write-Host "  Pulling latest changes..." -ForegroundColor Yellow
            Push-Location $AppRoot
            git checkout $Branch
            git pull origin $Branch
            Pop-Location
        } else {
            git clone $GitUrl $AppRoot --branch $Branch
        }
    } else {
        Write-Warning "No -GitUrl provided, assuming code is already at $AppRoot"
    }
}

if (!(Test-Path $AppRoot)) {
    throw "App root not found: $AppRoot"
}

# =======================================================
# Step 1.5: Directory/config bootstrap (data + logs + .env)
# =======================================================

Write-Host "`n[1.5/6] Bootstrapping directories + config..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$AppRoot\data" | Out-Null
New-Item -ItemType Directory -Force -Path "$AppRoot\logs" | Out-Null
Write-Host "  data\ + logs\ ensured" -ForegroundColor Green

$envPath = "$AppRoot\.env"
if (Test-Path $envPath) {
    Write-Host "  .env exists" -ForegroundColor Green
} elseif (Test-Path "$AppRoot\.env.example") {
    Copy-Item "$AppRoot\.env.example" "$AppRoot\.env"
    Write-Warning "  .env not found - copied from .env.example. EDIT $AppRoot\.env to fill API keys before starting services!"
} else {
    Write-Warning "  Neither .env nor .env.example found - services will fail without API keys."
}

# =======================================================
# Step 2: Python environment
# =======================================================

Write-Host "`n[2/6] Setting up Python environment..." -ForegroundColor Cyan

Push-Location $AppRoot

# Create venv (if missing)
if (!(Test-Path "$AppRoot\venv\Scripts\python.exe")) {
    Write-Host "  Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

# Activate venv + install deps
$env:PYTHONPATH = $AppRoot
$pip = "$AppRoot\venv\Scripts\pip.exe"
& $pip install --upgrade pip -q

# Detect package mode (has pre-downloaded wheels/ dir)
$reqFile = "$AppRoot\requirements-win.txt"
if (!(Test-Path $reqFile)) {
    Write-Host "  Generating requirements-win.txt (filtering Linux-only uvloop)..." -ForegroundColor Yellow
    Get-Content "$AppRoot\requirements-lock.txt" | Where-Object { $_ -notmatch "uvloop" } | Set-Content $reqFile
}
Write-Host "  Using: $(Split-Path $reqFile -Leaf)" -ForegroundColor Green

$wheelsDir = "$AppRoot\wheels"
if (Test-Path $wheelsDir) {
    Write-Host "  [Offline Package Mode] Installing from wheels/ (no PyPI access needed)..." -ForegroundColor Yellow
    & $pip install --no-index --find-links="$wheelsDir" -r $reqFile
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "  Offline install from wheels/ failed --- falling back to online pip install"
        & $pip install -r $reqFile
    }
} else {
    Write-Host "  Installing Python dependencies (online)..." -ForegroundColor Yellow
    & $pip install -r $reqFile
}

# Verify critical dependency
Write-Host "  Verifying usearch..." -NoNewline
& "$AppRoot\venv\Scripts\python.exe" -c "from usearch.compiled import Index; print('OK')"

Pop-Location

# =======================================================
# Step 3: Model download (optional --- auto-download on first run)
# =======================================================

Write-Host "`n[3/6] Checking embedding model..." -ForegroundColor Cyan

# Check for pre-cached model from package mode (models/huggingface/)
$pkgModelDir = "$AppRoot\models\huggingface"
if (Test-Path $pkgModelDir) {
    Write-Host "  [Offline Package Mode] Pre-cached model found: $pkgModelDir" -ForegroundColor Green
    Write-Host "  HF_HOME will be set to this path at service runtime (see install-services.ps1)"
} else {
    # Otherwise check default HF cache
    $hfCache = "$env:USERPROFILE\.cache\huggingface"
    if (Test-Path $hfCache) {
        Write-Host "  HF cache exists: $hfCache" -ForegroundColor Green
    } else {
        Write-Host "  Model will be downloaded on first run." -ForegroundColor Yellow
        Write-Host "  For offline servers, pre-download with: " -ForegroundColor Yellow
        Write-Host "    python -c `"from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')`""
    }
}

# =======================================================
# Step 4: Frontend build
# =======================================================

Write-Host "`n[4/6] Building frontend..." -ForegroundColor Cyan

if ($SkipBuild) {
    Write-Host "  Skipping frontend build (--SkipBuild)" -ForegroundColor Yellow
} elseif (Test-Path "$AppRoot\frontend\package.json") {
    Push-Location "$AppRoot\frontend"

    # Check Node.js
    $nodeVersion = & node --version 2>$null
    if (!$nodeVersion) {
        Pop-Location
        throw "Node.js not found --- install from https://nodejs.org/ or use -SkipBuild"
    }
    Write-Host "  Node.js $nodeVersion" -ForegroundColor Green

    # npm install (standalone build needs full devDeps; node_modules can be cleaned post-build)
    if (!(Test-Path "node_modules")) {
        Write-Host "  Installing npm dependencies (including devDeps for build)..." -ForegroundColor Yellow
        npm ci
    }

    # Build (standalone)
    Write-Host "  Running next build (standalone)..." -ForegroundColor Yellow
    $env:NODE_ENV = "production"
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        throw "Frontend build failed --- check output above"
    }

    # Verify standalone output
    $standaloneDir = ".next\standalone"
    if (Test-Path $standaloneDir) {
        Write-Host "  Standalone output: $(Resolve-Path $standaloneDir)" -ForegroundColor Green
    } else {
        Pop-Location
        throw "Standalone output not found --- check next.config.ts output setting"
    }

    # Copy static dir to standalone (Next.js standalone mode requires manual handling)
    # Ref: https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
    $staticDir = ".next\static"
    $standaloneStaticDir = "$standaloneDir\.next\static"
    if (Test-Path $staticDir) {
        Write-Host "  Copying static assets to standalone..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path (Split-Path $standaloneStaticDir) | Out-Null
        Copy-Item -Recurse -Force $staticDir $standaloneStaticDir
    }

    # Copy public/ to standalone
    $publicStandaloneDir = "$standaloneDir\public"
    if (Test-Path "public") {
        Write-Host "  Copying public/ to standalone..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path $publicStandaloneDir | Out-Null
        Copy-Item -Recurse -Force "public\*" $publicStandaloneDir
    }

    Pop-Location
} else {
    Write-Host "  Skipping frontend build (no frontend/package.json found)" -ForegroundColor Yellow
}

# =======================================================
# Step 5: Register Windows Services
# =======================================================

$servicesRegistered = $false
Write-Host "`n[5/6] Registering Windows Services..." -ForegroundColor Cyan
$installScript = "$AppRoot\deploy\install-services.ps1"
if (Test-Path $installScript) {
    & $installScript -AppRoot $AppRoot
    $svcExitCode = $LASTEXITCODE
    if ($svcExitCode -eq 2) {
        # NSSM not found - not an error, just skip smoke test
        $servicesRegistered = $false
    } elseif ($svcExitCode -ne 0) {
        Write-Warning "install-services.ps1 reported errors (exit code: $svcExitCode)"
        $servicesRegistered = $false
    } else {
        $servicesRegistered = $true
    }
} else {
    Write-Warning "install-services.ps1 not found --- please register services manually"
}

# =======================================================
# Step 6: Health check (smoke test)
# =======================================================

if ($servicesRegistered) {
    Write-Host "`n[6/6] Smoke test --- waiting for services to be healthy..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5

    $apiHealthy = $false
    $webHealthy = $false
    for ($i = 1; $i -le 12; $i++) {
        try {
            $api = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($api.StatusCode -eq 200) { $apiHealthy = $true }
        } catch { }
        try {
            $web = Invoke-WebRequest -Uri "http://127.0.0.1:3000/" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($web.StatusCode -eq 200) { $webHealthy = $true }
        } catch { }
        if ($apiHealthy -and $webHealthy) { break }
        Write-Host "  Retry $i/12 (API=$apiHealthy Web=$webHealthy)..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 5
    }

    if ($apiHealthy) {
        Write-Host "  API   /health  -> 200 OK" -ForegroundColor Green
    } else {
        Write-Warning "  API   /health  -> not responding after 60s --- check $AppRoot\logs\GlassCortexAPI-stderr.log"
    }
    if ($webHealthy) {
        Write-Host "  Web   /        -> 200 OK" -ForegroundColor Green
    } else {
        Write-Warning "  Web   /        -> not responding after 60s --- check $AppRoot\logs\GlassCortexWeb-stderr.log"
    }
} else {
    Write-Host "`n[6/6] Smoke test skipped (no services registered)" -ForegroundColor Yellow
    Write-Host "  Start API manually:" -ForegroundColor Yellow
    Write-Host "    $AppRoot\venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000" -ForegroundColor Yellow
    Write-Host "  Or install NSSM and re-run: .\deploy\install-services.ps1 -AppRoot $AppRoot" -ForegroundColor Yellow
}

# =======================================================
# Done
# =======================================================

$elapsed = (Get-Date) - $startTime
Write-Host @"

========================================
 Deployment Complete
========================================
  Duration: $($elapsed.TotalSeconds.ToString('0.0'))s
  App Root: $AppRoot
  API:      http://127.0.0.1:8000 (uvicorn)
  Web:      http://127.0.0.1:3000 (node .next\standalone\server.js)
  Nginx:    http://localhost       (after setup)
========================================

Next Steps:
  1. Install Nginx: download from https://nginx.org/en/download.html
                    unzip to C:\apps\nginx\ (see deploy\README.md S1.3)
  2. Copy config:   copy deploy\nginx.conf C:\apps\nginx\conf\nginx.conf
  3. Start Nginx:   cd C:\apps\nginx; .\nginx.exe      (first-time launch)
                    (optional: register as NSSM service --- see README S2.2)
  4. Verify:        Invoke-WebRequest http://localhost -UseBasicParsing

Service Management:
  nssm status GlassCortexAPI
  nssm restart GlassCortexAPI
  nssm stop GlassCortexWeb

Troubleshooting:
  - Logs: C:\apps\glasscortex\logs\
  - Nginx logs: C:\apps\nginx\logs\
  - Check ports: netstat -an | findstr "8000 3000 80"
"@ -ForegroundColor Cyan
