#!/usr/bin/env bash
# GlassCortex 构建打包脚本 — macOS/Linux 构建机侧
# Phase 67 Batch 3 · Batch 18 (standalone flatten + exclusion fix)
#
# 适用场景：macOS/Linux 构建机（有 git + npm + 网络）打包，
#           目标 Windows Server（免 git / 免 npm / 免编译）直接解压部署
#
# 用法：
#   chmod +x deploy/build-package.sh
#   ./deploy/build-package.sh
#
#   # 指定输出目录和版本标签
#   ./deploy/build-package.sh -o /tmp -v 20260713
#
#   # 仅重新打包（不重新构建）
#   ./deploy/build-package.sh --skip-build --skip-model
#
# 产物：glasscortex-deploy-<version>.zip
#   解压后目录结构即 C:\apps\glasscortex\ 的目标布局

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# 缓存在项目父目录，避免 /tmp 重启丢失
CACHE_DIR="$PROJECT_ROOT/../.glasscortex-mirror-cache.git"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# ── 参数解析 ──
APP_ROOT=""
OUTPUT_DIR=""
VERSION=""
SKIP_BUILD=false
SKIP_MODEL=false
SKIP_WHEELS=false
PY_VER="3.14"
PATCH_MODE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -o|--output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        -v|--version)    VERSION="$2"; shift 2 ;;
        --skip-build)    SKIP_BUILD=true; shift ;;
        --skip-model)    SKIP_MODEL=true; shift ;;
	        --py-ver)        PY_VER="$2"; shift 2 ;;
        --skip-wheels)   SKIP_WHEELS=true; shift ;;
        --patch)         PATCH_MODE=true; shift ;;
        -h|--help)
            echo "Usage: $0 [-o <output-dir>] [-v <version>] [--py-ver 3.12|3.14] [--patch] [--skip-build] [--skip-model] [--skip-wheels]"
            echo ""
            echo "Cross-platform build packaging for Windows Server deployment."
            echo "  --patch  Incremental update: only src/ api/ frontend standalone + config files"
            echo "           (skips tests docs models wheels — server already has deps installed)"
            echo "Run from project root or pass the path as first positional argument."
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── 路径解析 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -z "$APP_ROOT" ]]; then
    APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$APP_ROOT/deploy-package"
fi
if [[ -z "$VERSION" ]]; then
    VERSION="$(date +%Y%m%d)"
fi

# --patch: 增量更新模式，只打包运行时文件（免依赖免模型）
if [[ "$PATCH_MODE" == true ]]; then
    SKIP_WHEELS=true
    SKIP_MODEL=true
fi

PACKAGE_NAME="glasscortex-deploy-$VERSION"
STAGING_DIR="$OUTPUT_DIR/$PACKAGE_NAME"
ZIP_PATH="$OUTPUT_DIR/$PACKAGE_NAME.zip"
START_TIME=$(date +%s)

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

banner() {
    echo -e "${CYAN}$1${NC}"
}
ok() {
    echo -e "  ${GREEN}$1${NC}"
}
warn() {
    echo -e "  ${YELLOW}⚠ WARNING: $1${NC}"
}
info() {
    echo -e "  ${GRAY}$1${NC}"
}
die() {
    echo -e "  ${RED}✗ ERROR: $1${NC}" >&2
    exit 1
}

echo ""
banner "========================================"
banner " GlassCortex Build Package"
banner " Phase 67 Batch 3"
banner "========================================"
banner "  Source:    $APP_ROOT"
banner "  Staging:   $STAGING_DIR"
banner "  Output:    $ZIP_PATH"
banner "  Version:   $VERSION"
banner "  Platform:  macOS/Linux → Windows Server (cross)"
banner "  Time:      $(date '+%Y-%m-%d %H:%M:%S')"
  banner "  Python:    $PY_VER"
  banner "  Mode:      $(if [[ "$PATCH_MODE" == true ]]; then echo "Patch (incremental)"; else echo "Full"; fi)"
banner "========================================"
echo ""

# ═══════════════════════════════════════════════════════
# Step 1: 准备 staging 目录
# ═══════════════════════════════════════════════════════

echo -e "${CYAN}[1/7] Preparing staging directory...${NC}"

if [[ -d "$STAGING_DIR" ]]; then
    info "Removing old staging..."
    rm -rf "$STAGING_DIR"
fi
mkdir -p "$STAGING_DIR"

# ═══════════════════════════════════════════════════════
# Step 2: 拷贝源码（忽略构建产物 + VCS）
# ═══════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}[2/7] Copying source files...${NC}"

cd "$APP_ROOT"

# 排除目录列表
EXCLUDE_DIRS=(".git" "venv" ".venv" "node_modules" "__pycache__" \
    ".pytest_cache" ".mypy_cache" ".ruff_cache" "data" "logs" \
    "backups" "deploy-package")

# 构建 rsync exclude 参数
RSYNC_EXCLUDES=()
for d in "${EXCLUDE_DIRS[@]}"; do
    RSYNC_EXCLUDES+=(--exclude="$d")
done
# 单独排除 .next（前端构建产物 Step 5 专门处理）
RSYNC_EXCLUDES+=(--exclude=".next")

# 源码目录
if [[ "$PATCH_MODE" == true ]]; then
	    SOURCE_DIRS=("src" "api" "deploy")  # 增量模式：跳过 tests/ docs/
	else
	    SOURCE_DIRS=("src" "api" "tests" "docs" "deploy")
	fi
for dir in "${SOURCE_DIRS[@]}"; do
    if [[ -d "$dir" ]]; then
        info "Copying $dir/ ..."
        mkdir -p "$STAGING_DIR/$dir"
        rsync -a "${RSYNC_EXCLUDES[@]}" "$dir/" "$STAGING_DIR/$dir/" 2>/dev/null || \
            cp -R "$dir/" "$STAGING_DIR/$dir/"  # fallback: no rsync
    fi
done

# 前端目录（排除 node_modules + .next，构建产物 Step 5 处理）
if [[ -d "frontend" ]]; then
    info "Copying frontend/ (excluding node_modules, .next)..."
    mkdir -p "$STAGING_DIR/frontend"
    FRONTEND_EXCLUDES=()
    for d in "node_modules" ".next" ".env.local" ".env.production" "tsconfig.tsbuildinfo" "test-results" "data" ".claude" "Bn"; do
        FRONTEND_EXCLUDES+=(--exclude="$d")
    done
    rsync -a "${FRONTEND_EXCLUDES[@]}" frontend/ "$STAGING_DIR/frontend/" 2>/dev/null || {
        # fallback: copy everything then remove exclusions
        cp -R frontend/ "$STAGING_DIR/frontend/"
        rm -rf "$STAGING_DIR/frontend/node_modules" "$STAGING_DIR/frontend/.next" "$STAGING_DIR/frontend/test-results" "$STAGING_DIR/frontend/data" "$STAGING_DIR/frontend/.claude" "$STAGING_DIR/frontend/Bn" 2>/dev/null || true
    }
fi

# 根目录文件
ROOT_FILES=(".env.example" ".gitignore" "CLAUDE.md" "README.md" "Makefile" \
    "pyproject.toml" "requirements.in" "requirements-lock.txt")
for f in "${ROOT_FILES[@]}"; do
    if [[ -f "$f" ]]; then
        info "Copying $f"
        cp "$f" "$STAGING_DIR/$f"
    fi
done

# 创建空目录（运行时需要）
mkdir -p "$STAGING_DIR/data"
mkdir -p "$STAGING_DIR/logs"


	# 生成 Windows 专用 requirements（不含 Linux-only uvloop）
	grep -v "uvloop" "$STAGING_DIR/requirements-lock.txt" > "$STAGING_DIR/requirements-win.txt"
	info "Generated requirements-win.txt (excludes Linux-only uvloop)"

ok "Source copy complete"

# ═══════════════════════════════════════════════════════
# Step 3: 下载 Python wheels（交叉平台 → Windows）
# ═══════════════════════════════════════════════════════

if [[ "$SKIP_WHEELS" == false ]]; then
    echo ""
    echo -e "${CYAN}[3/7] Downloading Python wheels (cross-platform → win_amd64)...${NC}"

    WHEELS_DIR="$STAGING_DIR/wheels"
    mkdir -p "$WHEELS_DIR"

    # 找 Python
    PYTHON_CMD=""
    if [[ -x "$APP_ROOT/venv/bin/python3" ]]; then
        PYTHON_CMD="$APP_ROOT/venv/bin/python3"
    elif command -v python3 &>/dev/null; then
        PYTHON_CMD="$(command -v python3)"
    elif command -v python &>/dev/null; then
        PYTHON_CMD="$(command -v python)"
    else
        die "Python not found — create venv first (make setup) or ensure python3 is in PATH"
    fi
    info "Python: $PYTHON_CMD ($($PYTHON_CMD --version 2>&1))"

    info "Cross-downloading wheels for win_amd64 / Python $PY_VER..."
	    info "  (uses --no-deps: lockfile already lists all transitive deps)"


	    # ── 构建 Windows 专用 requirements 文件 ──
	    # uvloop 是 Linux/macOS only（uvicorn[standard] 的传递依赖），
	    # 在 Windows 上 sys_platform 会自动排除。但 pip download --platform
	    # 不改变 sys_platform 标记解析，导致跨平台下载时 uvloop 阻断全量解析。
	    # 解决：--no-deps 逐包下载（锁文件已是完整传递依赖列表，无需再解析）
	    WIN_REQ_FILE="$WORKDIR/requirements-win.txt"
	    grep -v "uvloop" "$APP_ROOT/requirements-lock.txt" > "$WIN_REQ_FILE"
	    info "Filtered uvloop from Windows requirements (Linux/macOS only)"

	    $PYTHON_CMD -m pip download \
	        --no-deps \
	        -r "$WIN_REQ_FILE" \
	        --dest "$WHEELS_DIR" \
	        --platform win_amd64 \
	        --python-version $PY_VER \
	        --only-binary=:all: \
	        2>&1 | while IFS= read -r line; do
	            if echo "$line" | grep -qE "ERROR|Successfully downloaded|Saved|Could not find"; then
	                echo -e "  ${GRAY}$line${NC}"
	            fi
	        done

	    WHEEL_COUNT=$(find "$WHEELS_DIR" -name "*.whl" -type f 2>/dev/null | wc -l | tr -d " ")
	    TAR_COUNT=$(find "$WHEELS_DIR" -name "*.tar.gz" -type f 2>/dev/null | wc -l | tr -d " ")
	    ok "Downloaded: ${WHEEL_COUNT} wheels, ${TAR_COUNT} source packages → $WHEELS_DIR"

	    if [[ "$TAR_COUNT" -gt 0 ]]; then
	        warn "Source packages (.tar.gz) detected — target Windows Server will need VC++ Build Tools to compile these"
	    fi
else
    echo ""
    echo -e "${YELLOW}[3/7] Skipping wheels download (--skip-wheels)${NC}"
fi

# ═══════════════════════════════════════════════════════
# Step 4: 下载嵌入模型（离线模型缓存）
# ═══════════════════════════════════════════════════════

if [[ "$SKIP_MODEL" == false ]]; then
    echo ""
    echo -e "${CYAN}[4/7] Downloading embedding model (all-MiniLM-L6-v2, ~90MB)...${NC}"

    MODELS_DIR="$STAGING_DIR/models"
    HF_CACHE_DIR="$MODELS_DIR/huggingface"
    mkdir -p "$HF_CACHE_DIR"

    info "Triggering model download..."
    set +e
    HF_HOME="$HF_CACHE_DIR" $PYTHON_CMD -c "
import os
os.environ['HF_HOME'] = '$HF_CACHE_DIR'
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
print(f'Model loaded: {model}')
print(f'Cache dir: {os.environ[\"HF_HOME\"]}')
" 2>&1 | while IFS= read -r line; do
        if echo "$line" | grep -qE "Model loaded|Cache dir|Downloading|Fetching|progress"; then
            echo -e "  ${GRAY}$line${NC}"
        fi
    done

    MODEL_EXIT=$?
    set -e
    if [[ $MODEL_EXIT -ne 0 ]]; then
        warn "Model download had issues — server may need to download on first run."
        warn "If server is offline, re-run with network and without --skip-model."
    else
        ok "Model cached at: $HF_CACHE_DIR"
    fi
else
    echo ""
    echo -e "${YELLOW}[4/7] Skipping model download (--skip-model)${NC}"
fi

# ═══════════════════════════════════════════════════════
# Step 5: 前端构建（Next.js standalone）
# ═══════════════════════════════════════════════════════

if [[ "$SKIP_BUILD" == false ]]; then
    echo ""
    echo -e "${CYAN}[5/7] Building frontend (Next.js standalone)...${NC}"

    cd "$APP_ROOT/frontend"

    # 检查 Node.js
    if ! command -v node &>/dev/null; then
        die "Node.js not found — install from https://nodejs.org/"
    fi
    NODE_VERSION=$(node --version)
    ok "Node.js $NODE_VERSION"

    # npm install
    if [[ ! -d "node_modules" ]]; then
        info "Installing npm dependencies..."
        npm ci || die "npm ci failed — check network and package-lock.json"
    else
        info "node_modules exists, skipping npm ci"
    fi

    # Build
    info "Running next build (standalone mode)..."
    NODE_ENV=production npm run build || die "Frontend build failed — check output above"

    # ── 拷贝 standalone 产物到 staging ──
    STANDALONE_DIR=".next/standalone"
    if [[ ! -d "$STANDALONE_DIR" ]]; then
        die "Standalone output not found at $STANDALONE_DIR — check next.config.ts output setting"
    fi

    STAGING_STANDALONE_DIR="$STAGING_DIR/frontend/.next/standalone"
    mkdir -p "$STAGING_STANDALONE_DIR"

    info "Copying standalone output to staging..."
    shopt -s dotglob   # * 不匹配 .next 隐藏目录，dotglob 开启后完整拷贝
    cp -R "$STANDALONE_DIR"/frontend/* "$STAGING_STANDALONE_DIR/"
    shopt -u dotglob

    # 拷贝 static/ 到 standalone/.next/static/ (Next.js 16 standalone 从 ./.next/static 读取)
    if [[ -d ".next/static" ]]; then
        info "Copying .next/static/ to standalone/.next/static/..."
        mkdir -p "$STAGING_STANDALONE_DIR/.next/static"
        cp -R ".next/static/"* "$STAGING_STANDALONE_DIR/.next/static/"
    fi

    # 拷贝 public/ 到 standalone/public/ (Next.js 16 standalone 从 ./public 读取)
    if [[ -d "public" ]]; then
        info "Copying public/ to standalone/public/..."
        STAGING_PUBLIC="$STAGING_STANDALONE_DIR/public"
        mkdir -p "$STAGING_PUBLIC"
        cp -R public/* "$STAGING_PUBLIC/" 2>/dev/null || true
    fi

    cd "$APP_ROOT"
    ok "Frontend build complete"
else
    echo ""
    echo -e "${YELLOW}[5/7] Skipping build (--skip-build)${NC}"
fi

# ═══════════════════════════════════════════════════════
# Step 6: 创建 zip
# ═══════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}[6/7] Creating deployment zip...${NC}"

cd "$OUTPUT_DIR"

# 删除旧 zip
if [[ -f "$ZIP_PATH" ]]; then
    info "Removing old zip..."
    rm -f "$ZIP_PATH"
fi

info "Compressing $PACKAGE_NAME → $PACKAGE_NAME.zip ..."
# macOS: COPYFILE_DISABLE 阻止资源 fork 文件 (__MACOSX/ ._* ) 进入 zip
if [[ "$(uname)" == "Darwin" ]]; then
    COPYFILE_DISABLE=1 zip -rq "$ZIP_PATH" "$PACKAGE_NAME"
else
    zip -rq "$ZIP_PATH" "$PACKAGE_NAME"
fi

if [[ ! -f "$ZIP_PATH" ]]; then
    die "Zip creation failed — $ZIP_PATH not found"
fi

# macOS: stat 格式不同
if [[ "$(uname)" == "Darwin" ]]; then
    ZIP_SIZE=$(stat -f%z "$ZIP_PATH")
else
    ZIP_SIZE=$(stat --format=%s "$ZIP_PATH")
fi
ZIP_SIZE_MB=$(echo "scale=1; $ZIP_SIZE / 1048576" | bc 2>/dev/null || python3 -c "print(f'{$ZIP_SIZE / 1048576:.1f}')")
ok "Zip created: $ZIP_PATH (${ZIP_SIZE_MB} MB)"

# ═══════════════════════════════════════════════════════
# Step 7: 清理 staging + 输出摘要
# ═══════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}[7/7] Cleaning up staging directory...${NC}"
rm -rf "$STAGING_DIR"
ok "Staging removed"

# ── 完成 ──
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
banner "========================================"
banner " Build Package Complete"
banner "========================================"
banner "  Duration: ${ELAPSED}s"
banner "  Output:   $ZIP_PATH"
banner "  Size:     ${ZIP_SIZE_MB} MB"
banner "========================================"
echo ""

echo -e "${CYAN}Next Steps:${NC}"
echo "  1. Copy $PACKAGE_NAME.zip to target Windows Server (USB / SMB / SFTP)"
echo "  2. On Server (Admin PowerShell):"
echo "     Expand-Archive -Path C:\\temp\\$PACKAGE_NAME.zip -DestinationPath C:\\apps\\"
echo "     Rename-Item C:\\apps\\$PACKAGE_NAME C:\\apps\\glasscortex"
echo "     C:\\apps\\glasscortex\\deploy\\deploy.ps1 -SkipClone -SkipBuild"
echo "  3. Configure Nginx per deploy\\README.md §2.2"
echo ""
