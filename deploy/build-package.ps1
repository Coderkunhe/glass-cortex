# GlassCortex 构建打包脚本 — 构建机侧
# Phase 67 Batch 3
#
# 适用场景：构建机（有 git + npm + 网络）打包，服务器（免 git/免 npm/免编译）直接解压部署
#
# 用法：
#   # 从项目根目录运行
#   .\deploy\build-package.ps1
#
#   # 指定输出目录和版本标签
#   .\deploy\build-package.ps1 -OutputDir C:\temp -Version "20260713"
#
#   # 仅重新打包（不重新构建）
#   .\deploy\build-package.ps1 -SkipBuild -SkipModel
#
# 产物：glasscortex-deploy-<version>.zip
#   解压后目录结构即 C:\apps\glasscortex\ 的目标布局
#
# 产物内容：
#   ├── src/ api/ tests/ docs/ deploy/   # 源码（不含 .git）
#   ├── frontend/.next/standalone/        # Next.js 已构建产物
#   ├── wheels/                           # Python wheel 离线包
#   ├── models/huggingface/               # 嵌入模型离线缓存
#   ├── requirements-lock.txt             # Python 依赖锁文件
#   ├── .env.example / pyproject.toml     # 配置文件
#   └── CLAUDE.md / README.md / Makefile  # 项目文档

param(
    [string]$AppRoot = "",
    [string]$OutputDir = "",
    [string]$Version = "",
    [string]$TargetPlatform = "auto",
    [switch]$SkipBuild = $false,
    [switch]$SkipModel = $false,
    [switch]$SkipWheels = $false
)

$ErrorActionPreference = "Stop"
$startTime = Get-Date

# ── 路径解析 ──
if (-not $AppRoot) {
    $AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
}
if (-not $OutputDir) {
    $OutputDir = Join-Path $AppRoot "deploy-package"
}
if (-not $Version) {
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

# ═══════════════════════════════════════════════════════
# Step 1: 准备 staging 目录
# ═══════════════════════════════════════════════════════

Write-Host "`n[1/7] Preparing staging directory..." -ForegroundColor Cyan

if (Test-Path $stagingDir) {
    Write-Host "  Removing old staging..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $stagingDir
}
New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null

# ═══════════════════════════════════════════════════════
# Step 2: 拷贝源码（忽略构建产物 + VCS）
# ═══════════════════════════════════════════════════════

Write-Host "`n[2/7] Copying source files..." -ForegroundColor Cyan

Push-Location $AppRoot

# 排除模式：git 仓库、虚拟环境、node_modules、构建产物、运行时数据、Python 缓存
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
    ".next"           # 前端构建产物单独处理（见 Step 5），此处跳过源码复制
)

# 拷贝源码目录
$sourceDirs = @("src", "api", "tests", "docs", "deploy")
foreach ($dir in $sourceDirs) {
    if (Test-Path $dir) {
        $dest = Join-Path $stagingDir $dir
        Write-Host "  Copying $dir/ ..." -ForegroundColor DarkGray
        Copy-Item -Recurse -Force -Path $dir -Destination $dest
    }
}

# 拷贝前端目录（但排除 node_modules + .next，构建产物单独处理）
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

# 拷贝根目录文件
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

# 创建空目录（运行时需要）
New-Item -ItemType Directory -Force -Path (Join-Path $stagingDir "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stagingDir "logs") | Out-Null

Pop-Location
Write-Host "  Source copy complete" -ForegroundColor Green

# ═══════════════════════════════════════════════════════
# Step 3: 下载 Python wheels（离线安装包）
# ═══════════════════════════════════════════════════════

if (-not $SkipWheels) {
    Write-Host "`n[3/7] Downloading Python wheels..." -ForegroundColor Cyan

    Push-Location $AppRoot
    $wheelsDir = Join-Path $stagingDir "wheels"
    New-Item -ItemType Directory -Force -Path $wheelsDir | Out-Null

    # 检查 Python 可用性
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
        # 同平台打包：直接下载当前平台 wheel
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
        # 交叉平台打包：指定目标平台
        Write-Host "  Platform: $TargetPlatform --- cross-platform wheel download" -ForegroundColor Yellow
        Write-Host "    (native packages without pre-built wheels will need VC++ Build Tools on server)" -ForegroundColor Yellow

        # 先尝试 only-binary，失败则下载源码包作为兜底
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

# ═══════════════════════════════════════════════════════
# Step 4: 下载嵌入模型（离线模型缓存）
# ═══════════════════════════════════════════════════════

if (-not $SkipModel) {
    Write-Host "`n[4/7] Downloading embedding model..." -ForegroundColor Cyan

    Push-Location $AppRoot
    $modelsDir = Join-Path $stagingDir "models"
    $hfCacheDir = Join-Path $modelsDir "huggingface"
    New-Item -ItemType Directory -Force -Path $hfCacheDir | Out-Null

    Write-Host "  Triggering model download (all-MiniLM-L6-v2, ~90MB)..." -ForegroundColor Yellow

    # 使用项目 venv 中的 Python 触发下载
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

# ═══════════════════════════════════════════════════════
# Step 5: 前端构建（Next.js standalone）
# ═══════════════════════════════════════════════════════

if (-not $SkipBuild) {
    Write-Host "`n[5/7] Building frontend (Next.js standalone)..." -ForegroundColor Cyan

    Push-Location (Join-Path $AppRoot "frontend")

    # 检查 Node.js
    $nodeVersion = & node --version 2>$null
    if (-not $nodeVersion) {
        Write-Error "Node.js not found --- install from https://nodejs.org/"
    }
    Write-Host "  Node.js $nodeVersion" -ForegroundColor Green

    # npm install
    if (-not (Test-Path "node_modules")) {
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

    # ── 拷贝 standalone 产物到 staging ──
    $standaloneDir = ".next\standalone"
    if (-not (Test-Path $standaloneDir)) {
        Write-Error "Standalone output not found at $standaloneDir --- check next.config.ts output setting"
    }

    $stagingStandaloneDir = Join-Path $stagingDir "frontend\.next\standalone"
    New-Item -ItemType Directory -Force -Path $stagingStandaloneDir | Out-Null

    # 拷贝 standalone 目录
    Write-Host "  Copying standalone output to staging..." -ForegroundColor Yellow
    Copy-Item -Recurse -Force "$standaloneDir\*" $stagingStandaloneDir

    # 拷贝 static/ 到 standalone/.next/static/（Next.js 16 standalone 从 ./.next/static 读取）
    if (Test-Path ".next\static") {
        Write-Host "  Copying .next/static/ to standalone/.next/static/..." -ForegroundColor DarkGray
        $stagingStandaloneNextStatic = Join-Path $stagingStandaloneDir ".next\static"
        New-Item -ItemType Directory -Force -Path $stagingStandaloneNextStatic | Out-Null
        Copy-Item -Recurse -Force ".next\static\*" $stagingStandaloneNextStatic
    }

    # 拷贝 public/ 到 standalone/public/（Next.js 16 standalone 从 ./public 读取）
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

# ═══════════════════════════════════════════════════════
# Step 6: 创建 zip
# ═══════════════════════════════════════════════════════

Write-Host "`n[6/7] Creating deployment zip..." -ForegroundColor Cyan

Push-Location $OutputDir

# 删除旧 zip（如果存在）
if (Test-Path $zipPath) {
    Write-Host "  Removing old zip..." -ForegroundColor DarkGray
    Remove-Item -Force $zipPath
}

# 使用 Compress-Archive（PowerShell 5+ 内置）
# 注意：Compress-Archive 需要在父目录下运行以保证 zip 内路径从 packageName/ 开始
Write-Host "  Compressing $packageName -> $packageName.zip ..." -ForegroundColor Yellow
Compress-Archive -Path ".\$packageName\*" -DestinationPath $zipPath -CompressionLevel Optimal

if (-not (Test-Path $zipPath)) {
    Write-Error "Zip creation failed --- $zipPath not found"
}

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "  Zip created: $zipPath ($zipSize MB)" -ForegroundColor Green

Pop-Location

# ═══════════════════════════════════════════════════════
# Step 7: 清理 staging + 输出摘要
# ═══════════════════════════════════════════════════════

Write-Host "`n[7/7] Cleaning up staging directory..." -ForegroundColor Cyan
Remove-Item -Recurse -Force $stagingDir
Write-Host "  Staging removed" -ForegroundColor Green

# ── 完成 ──
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
  1. Copy $packageName.zip to target Windows Server (USB / SMB / SFTP)
  2. On Server (Admin PowerShell):
     Expand-Archive -Path C:\temp\$packageName.zip -DestinationPath C:\apps\
     Rename-Item C:\apps\$packageName C:\apps\glasscortex
     C:\apps\glasscortex\deploy\deploy.ps1 -SkipClone -SkipBuild
  3. Configure Nginx per deploy\README.md S2.2

"@ -ForegroundColor Cyan
