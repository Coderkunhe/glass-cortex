# GlassCortex Windows Service 注册脚本 — NSSM
# Phase 67 Batch 1
#
# 前置条件：
#   1. NSSM 已下载到 C:\apps\nssm\nssm.exe
#      https://nssm.cc/download
#   2. 项目已部署到 C:\apps\glasscortex
#   3. Python venv 已创建（C:\apps\glasscortex\venv）
#   4. Next.js 已构建（npm run build）
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

Write-Host "=== GlassCortex Windows Service 注册 ===" -ForegroundColor Cyan

# ── 环境预检 ──
if (-not (Test-Path $nssm)) {
    Write-Error "NSSM not found at $nssm — download from https://nssm.cc/download"
}
if (-not (Test-Path $PythonPath)) {
    Write-Error "Python venv not found at $PythonPath — run deploy.ps1 first"
}
$standaloneServer = "$AppRoot\frontend\.next\standalone\frontend\server.js"
if (-not (Test-Path $standaloneServer)) {
    Write-Error "Next.js standalone build not found at $standaloneServer — run: cd $AppRoot\frontend && npm run build"
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
Install-Service `
    -Name "GlassCortexAPI" `
    -DisplayName "GlassCortex API (FastAPI)" `
    -Path $PythonPath `
    -Args "-m uvicorn api.main:app --host 127.0.0.1 --port 8000 --workers 1" `
    -Dir $AppRoot `
    -EnvVars @{
        "PYTHONPATH" = $AppRoot
        "PYTHONUNBUFFERED" = "1"
    }

# ── 2. GlassCortex Web (Next.js standalone) ──
# 使用 Next.js standalone 产物直接运行 server.js，不依赖 node_modules 或 next 二进制
# Ref: https://nextjs.org/docs/pages/api-reference/config/next-config-js/output#automatically-copying-traced-files
Install-Service `
    -Name "GlassCortexWeb" `
    -DisplayName "GlassCortex Web (Next.js standalone)" `
    -Path $NodePath `
    -Args "$AppRoot\frontend\.next\standalone\frontend\server.js" `
    -Dir "$AppRoot\frontend\.next\standalone\frontend" `
    -EnvVars @{
        "PORT" = "3000"
        "HOSTNAME" = "127.0.0.1"
        "NODE_ENV" = "production"
    }

# ── 启动服务 ──
Write-Host "`nStarting services..." -ForegroundColor Cyan
& $nssm start GlassCortexAPI 2>&1 | Out-Null
& $nssm start GlassCortexWeb 2>&1 | Out-Null
Start-Sleep -Seconds 3

# ── 验证 ──
Write-Host "`n=== Service Status ===" -ForegroundColor Cyan
foreach ($svc in @("GlassCortexAPI", "GlassCortexWeb")) {
    $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if ($s) {
        $color = if ($s.Status -eq "Running") { "Green" } else { "Red" }
        Write-Host "  $svc : $($s.Status)" -ForegroundColor $color
    } else {
        Write-Host "  $svc : NOT FOUND" -ForegroundColor Red
    }
}

Write-Host "`n=== Next Steps ===" -ForegroundColor Cyan
Write-Host "  1. Install Nginx: https://nginx.org/en/docs/windows.html"
Write-Host "  2. Copy deploy\nginx.conf → C:\apps\nginx\conf\nginx.conf"
Write-Host "  3. Start Nginx: net start nginx"
Write-Host "  4. Visit: http://localhost"
Write-Host "`n  Service management:" -ForegroundColor Yellow
Write-Host "    Stop:    nssm stop GlassCortexAPI"
Write-Host "    Restart: nssm restart GlassCortexAPI"
Write-Host "    Remove:  nssm remove GlassCortexAPI confirm"
