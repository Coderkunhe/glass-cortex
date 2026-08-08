# GlassCortex Windows Service 注册脚本 — NSSM
# Phase 67 Batch 1 · Batch 3 (model pre-cache support)
#
# 前置条件：
#   1. NSSM 已下载到 C:\apps\nssm\nssm.exe
#      https://nssm.cc/download
#   2. 项目已部署到 C:\apps\glasscortex
#   3. Python venv 已创建（C:\apps\glasscortex\venv）
#   4. Next.js standalone build 已构建（npm run build）
#
# 打包部署模式：
#   若 C:\apps\glasscortex\models\huggingface\ 存在（build-package.ps1 产物），
#   自动配置 HF_HOME + TRANSFORMERS_CACHE + 离线模式环境变量，
#   服务启动时直接从本地加载嵌入模型，无需联网。
#
# 用法（管理员 PowerShell）：
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
#   .\deploy\install-services.ps1

param(
    [string]$AppRoot = "C:\apps\glasscortex",
    [string]$NssmPath = "C:\apps\nssm\nssm.exe",
    [string]$NodePath = "C:\Program Files\nodejs\node.exe",
    [string]$PythonPath = "$AppRoot\venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
$nssm = $NssmPath

Write-Host "=== GlassCortex Windows Service Registration ===" -ForegroundColor Cyan

# ── 环境预检 ──
if (!(Test-Path $nssm)) {
    Write-Warning "NSSM not found at $nssm --- skipping Windows Service registration"
    Write-Warning "  To enable: download NSSM from https://nssm.cc/download"
    Write-Warning "  Or run with: -NssmPath 'C:\path\to\nssm.exe'"
    exit 0
}
if (!(Test-Path $PythonPath)) {
    throw "Python venv not found at $PythonPath --- run deploy.ps1 first"
}
$standaloneServer = "$AppRoot\frontend\.next\standalone\server.js"
$hasFrontend = Test-Path $standaloneServer
if (!$hasFrontend) {
    Write-Warning "Next.js standalone build not found --- skipping GlassCortexWeb service registration"
    Write-Warning "  To build frontend: cd $AppRoot\frontend && npm run build (requires Node.js)"
}

# ── 辅助函数 ──
function Install-Service {
    param(
        [string]$Name,
        [string]$DisplayName,
        [string]$Path,
        [string]$Args,
        [string]$Dir,
        [hashtable]$EnvVars = @{}
    )

    Write-Host "  Installing $Name..." -NoNewline
    & $nssm install $Name $Path $Args 2>&1 | Out-Null
    & $nssm set $Name AppDirectory $Dir
    & $nssm set $Name DisplayName $DisplayName
    & $nssm set $Name Start SERVICE_AUTO_START
    & $nssm set $Name AppStdout "$AppRoot\logs\$Name-stdout.log"
    & $nssm set $Name AppStderr "$AppRoot\logs\$Name-stderr.log"
    & $nssm set $Name AppRotateFiles 1
    & $nssm set $Name AppRotateOnline 1
    & $nssm set $Name AppRotateBytes 10485760  # 10MB rotation

    if ($EnvVars.Count -gt 0) {
        $envStr = ($EnvVars.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
        & $nssm set $Name AppEnvironmentExtra $envStr
    }
    Write-Host " OK" -ForegroundColor Green
}

# ── 日志目录 ──
New-Item -ItemType Directory -Force -Path "$AppRoot\logs" | Out-Null

# ── 先停旧服务（如果存在） ──
foreach ($svc in @("GlassCortexAPI", "GlassCortexWeb")) {
    $status = (Get-Service -Name $svc -ErrorAction SilentlyContinue).Status
    if ($status -eq "Running") {
        Write-Host "  Stopping $svc..." -NoNewline
        & $nssm stop $svc 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        Write-Host " OK" -ForegroundColor Yellow
    }
}

# ── 1. GlassCortex API (FastAPI + uvicorn) ──
# 检测预缓存模型路径（build-package.ps1 产物）
$apiEnvVars = @{
    "PYTHONPATH" = $AppRoot
    "PYTHONUNBUFFERED" = "1"
}
$pkgModelDir = "$AppRoot\models\huggingface"
if (Test-Path $pkgModelDir) {
    Write-Host "  Pre-cached model detected --- configuring HF_HOME + offline mode" -ForegroundColor Green
    $apiEnvVars["HF_HOME"] = $pkgModelDir
    $apiEnvVars["TRANSFORMERS_CACHE"] = $pkgModelDir
    $apiEnvVars["TRANSFORMERS_OFFLINE"] = "1"
    $apiEnvVars["HF_HUB_OFFLINE"] = "1"
}

Install-Service `
    -Name "GlassCortexAPI" `
    -DisplayName "GlassCortex API (FastAPI)" `
    -Path $PythonPath `
    -Args "-m uvicorn api.main:app --host 127.0.0.1 --port 8000 --workers 1" `
    -Dir $AppRoot `
    -EnvVars $apiEnvVars

# ── 2. GlassCortex Web (Next.js standalone) ──
# 使用 Next.js standalone 产物直接运行 server.js，不依赖 node_modules 或 next 二进制
# Ref: https://nextjs.org/docs/pages/api-reference/config/next-config-js/output#automatically-copying-traced-files
if ($hasFrontend) {
    Install-Service `
        -Name "GlassCortexWeb" `
        -DisplayName "GlassCortex Web (Next.js standalone)" `
        -Path $NodePath `
        -Args "$AppRoot\frontend\.next\standalone\server.js" `
        -Dir "$AppRoot\frontend\.next\standalone" `
        -EnvVars @{
            "PORT" = "3000"
            "HOSTNAME" = "127.0.0.1"
            "NODE_ENV" = "production"
        }
}

# ── 启动服务 ──
Write-Host "`nStarting services..." -ForegroundColor Cyan
& $nssm start GlassCortexAPI 2>&1 | Out-Null
if ($hasFrontend) {
    & $nssm start GlassCortexWeb 2>&1 | Out-Null
}
Start-Sleep -Seconds 3

# ── 验证 ──
Write-Host "`n=== Service Status ===" -ForegroundColor Cyan
$servicesToCheck = @("GlassCortexAPI")
if ($hasFrontend) { $servicesToCheck += "GlassCortexWeb" }
foreach ($svc in $servicesToCheck) {
    $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if ($s) {
        $color = if ($s.Status -eq "Running") { "Green" } else { "Red" }
        Write-Host "  $svc : $($s.Status)" -ForegroundColor $color
    } else {
        Write-Host "  $svc : NOT FOUND" -ForegroundColor Red
    }
}

Write-Host "`n=== Next Steps ===" -ForegroundColor Cyan
Write-Host "  1. Install Nginx: download https://nginx.org/en/download.html, unzip to C:\apps\nginx\"
Write-Host "  2. Copy deploy\nginx.conf -> C:\apps\nginx\conf\nginx.conf"
Write-Host "  3. Start Nginx: cd C:\apps\nginx; .\nginx.exe   (first-time launch)"
Write-Host "     (optional: register as NSSM service --- see deploy\README.md S2.2)"
Write-Host "  4. Visit: http://localhost"
Write-Host "`n  Service management:" -ForegroundColor Yellow
Write-Host "    Stop:    nssm stop GlassCortexAPI"
Write-Host "    Restart: nssm restart GlassCortexAPI"
Write-Host "    Remove:  nssm remove GlassCortexAPI confirm"
