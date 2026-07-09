# GlassCortex 一键部署脚本 — Windows Server
# Phase 67 Batch 1
#
# 用法（管理员 PowerShell）：
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
#   .\deploy\deploy.ps1 -GitUrl "https://github.com/your-org/glasscortex.git"
#
# 或手动 clone 后从项目目录运行：
#   .\deploy\deploy.ps1 -SkipClone
#
# 此脚本：
#   1. Clone / 确认源码
#   2. 创建 Python venv + 安装依赖
#   3. npm install + next build (standalone)
#   4. 调用 install-services.ps1 注册 Windows Service
#   5. 引导 Nginx 安装

param(
    [string]$GitUrl = "",
    [string]$AppRoot = "C:\apps\glasscortex",
    [string]$Branch = "master",
    [switch]$SkipClone = $false,
    [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Stop"
$startTime = Get-Date

Write-Host @"
========================================
 GlassCortex Production Deployment
 Phase 67 Batch 1
========================================
  Target: $AppRoot
  Branch: $Branch
  Time:   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
========================================
"@ -ForegroundColor Cyan

# ═══════════════════════════════════════════════════════
# Step 1: 获取源码
# ═══════════════════════════════════════════════════════

if (-not $SkipClone) {
    Write-Host "`n[1/5] Cloning repository..." -ForegroundColor Cyan
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
} else {
    Write-Host "[1/5] Skipping clone (--SkipClone)" -ForegroundColor Yellow
}

if (-not (Test-Path $AppRoot)) {
    Write-Error "App root not found: $AppRoot"
}

# ═══════════════════════════════════════════════════════
# Step 2: Python 环境
# ═══════════════════════════════════════════════════════

Write-Host "`n[2/5] Setting up Python environment..." -ForegroundColor Cyan

Push-Location $AppRoot

# 创建 venv（如果不存在）
if (-not (Test-Path "$AppRoot\venv\Scripts\python.exe")) {
    Write-Host "  Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

# 激活 venv + 安装依赖
$env:PYTHONPATH = $AppRoot
$pip = "$AppRoot\venv\Scripts\pip.exe"
Write-Host "  Installing Python dependencies..." -ForegroundColor Yellow
& $pip install --upgrade pip -q
& $pip install -r requirements-lock.txt

# 验证关键依赖
Write-Host "  Verifying usearch..." -NoNewline
& "$AppRoot\venv\Scripts\python.exe" -c "from usearch.compiled import Index; print('OK')"

Pop-Location

# ═══════════════════════════════════════════════════════
# Step 3: 模型下载（可选——首次运行自动下载）
# ═══════════════════════════════════════════════════════

Write-Host "`n[3/5] Checking embedding model..." -ForegroundColor Cyan
$hfCache = "$env:USERPROFILE\.cache\huggingface"
if (Test-Path $hfCache) {
    Write-Host "  HF cache exists: $hfCache" -ForegroundColor Green
} else {
    Write-Host "  Model will be downloaded on first run." -ForegroundColor Yellow
    Write-Host "  For offline servers, pre-download with: " -ForegroundColor Yellow
    Write-Host "    python -c `"from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')`""
}

# ═══════════════════════════════════════════════════════
# Step 4: 前端构建
# ═══════════════════════════════════════════════════════

Write-Host "`n[4/5] Building frontend..." -ForegroundColor Cyan
Push-Location "$AppRoot\frontend"

# 检查 Node.js
$nodeVersion = & node --version 2>$null
if (-not $nodeVersion) {
    Write-Error "Node.js not found — install from https://nodejs.org/"
}
Write-Host "  Node.js $nodeVersion" -ForegroundColor Green

# npm install
if (-not (Test-Path "node_modules")) {
    Write-Host "  Installing npm dependencies..." -ForegroundColor Yellow
    npm ci --production
}

# Build (standalone)
Write-Host "  Running next build (standalone)..." -ForegroundColor Yellow
$env:NODE_ENV = "production"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Frontend build failed — check output above"
}

# 验证 standalone 产物
$standaloneDir = ".next\standalone"
if (Test-Path $standaloneDir) {
    Write-Host "  Standalone output: $(Resolve-Path $standaloneDir)" -ForegroundColor Green
} else {
    Write-Error "Standalone output not found — check next.config.ts output setting"
}

# 拷贝 static 目录到 standalone（Next.js standalone 模式需要手动处理）
# Ref: https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
$staticDir = ".next\static"
$standaloneStaticDir = "$standaloneDir\frontend\.next\static"
if (Test-Path $staticDir) {
    Write-Host "  Copying static assets to standalone..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path (Split-Path $standaloneStaticDir) | Out-Null
    Copy-Item -Recurse -Force $staticDir $standaloneStaticDir
}

# 拷贝 public/ 到 standalone
$publicStandaloneDir = "$standaloneDir\frontend\public"
if (Test-Path "public") {
    Write-Host "  Copying public/ to standalone..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $publicStandaloneDir | Out-Null
    Copy-Item -Recurse -Force "public\*" $publicStandaloneDir
}

Pop-Location

# ═══════════════════════════════════════════════════════
# Step 5: 注册 Windows Service
# ═══════════════════════════════════════════════════════

Write-Host "`n[5/5] Registering Windows Services..." -ForegroundColor Cyan
$installScript = "$AppRoot\deploy\install-services.ps1"
if (Test-Path $installScript) {
    & $installScript -AppRoot $AppRoot
} else {
    Write-Warning "install-services.ps1 not found — please register services manually"
}

# ═══════════════════════════════════════════════════════
# 完成
# ═══════════════════════════════════════════════════════

$elapsed = (Get-Date) - $startTime
Write-Host @"

========================================
 Deployment Complete
========================================
  Duration: $($elapsed.TotalSeconds.ToString('0.0'))s
  App Root: $AppRoot
  API:      http://127.0.0.1:8000 (uvicorn)
  Web:      http://127.0.0.1:3000 (next start)
  Nginx:    http://localhost       (after setup)
========================================

Next Steps:
  1. Install Nginx: winget install nginx  或 手动下载
  2. Copy config:  copy deploy\nginx.conf C:\apps\nginx\conf\nginx.conf
  3. Start Nginx:  net start nginx
  4. Verify:       浏览器打开 http://localhost

Service Management:
  nssm status GlassCortexAPI
  nssm restart GlassCortexAPI
  nssm stop GlassCortexWeb

Troubleshooting:
  - Logs: C:\apps\glasscortex\logs\
  - Nginx logs: C:\apps\nginx\logs\
  - Check ports: netstat -an | findstr "8000 3000 80"
"@ -ForegroundColor Cyan
