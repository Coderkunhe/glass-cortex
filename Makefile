.PHONY: help setup clean check check-safety check-comments check-docs check-contracts check-theme check-visual check-visual-update contract-snapshot hooks lint lint-fix type test api frontend-setup frontend-dev frontend-test frontend-lint frontend-check frontend-build

# ── 命令列表（默认目标）────────────────────────────────────────
help:
	@echo "可用命令："
	@echo "  make setup     创建 venv + 安装依赖 + pre-commit（新人第一步）"
	@echo "  make clean     删除 venv 和所有缓存（回到 clone 状态）"
	@echo "  make check     lint + type + test（Python 质量门禁，提交前必须过）"
	@echo "  make check-all Python check + 前端 check + 浏览器运行时（全栈统一门禁）"
	@echo "  make check-theme 浏览器运行时门禁（Playwright console error 扫描）"
	@echo "  make check-visual  视觉回归测试（截图对比基线）"
	@echo "  make check-visual-update  更新视觉回归基线"
	@echo "  make check-shared-modules  共享模块治理 — 消费者统计 + Risk Assessment 覆盖扫描"
	@echo "  make check-safety  文件行数 + CSS 变更 UI 验证提醒（pre-commit 自动跑）"
	@echo "  make lint      仅 ruff 检查"
	@echo "  make lint-fix  ruff 自动修复"
	@echo "  make type      仅 mypy 类型检查"
	@echo "  make test      仅 pytest"
	@echo "  make check-comments  规范性注释检查（协作纪律 17，ruff pydocstyle）"
	@echo "  make check-docs  文档完整性 + 需求验证覆盖 + L2/L3/L4/L5 检查"
	@echo "  make check-contracts  L3 契约签名变更影响分析"
	@echo "  make contract-snapshot  更新契约签名快照基线"
	@echo "  make dev        一键启动 API + 前端（开发模式）"
	@echo "  make api        启动 FastAPI REST API (Phase 28 M1)"
	@echo "  make hooks     安装 pre-commit hook"
	@echo "  make frontend-setup  安装前端 npm 依赖"
	@echo "  make frontend-dev    启动 Next.js 开发服务器"
	@echo "  make frontend-test   运行前端测试"
	@echo "  make frontend-lint   运行 ESLint"
	@echo "  make frontend-check  lint + test（前端门禁）"
	@echo "  make frontend-build  生产构建"

# ── 环境初始化：新人 clone 后第一步 ────────────────────────────
setup:
	python3 -m venv venv
	./venv/bin/pip install --upgrade pip
	./venv/bin/pip install -r requirements-lock.txt
	./venv/bin/pre-commit install
	@echo "→ 安装 post-commit hook（会话级 Batch 计数）"
	@cp tools/post-commit.sh ../.git/hooks/post-commit && chmod +x ../.git/hooks/post-commit
	@echo "✅ 环境就绪，运行 make check 验证"

# ── 清理：回到 clone 状态 ─────────────────────────────────────
clean:
	rm -rf venv .mypy_cache .pytest_cache .ruff_cache

# ── 重置 Batch 计数器 ─────────────────────────────────────
reset-batch-counter:
	@rm -f ../.git/batch-counter && echo "✅ Batch 计数器已重置"

# ── 提交流程 ──────────────────────────────────────────────
# 见 LRN-2026-061: frontend-lint + check-theme 在 pre-commit stash 沙箱中
# 修改文件后会与同仓库其他项目 (Synapse) 的 unstaged 变更冲突。
# SKIP 的前提是先独立验证这两个 hook 通过。
commit:
	@echo "🔒 预检：Python 门禁..."
	@$(MAKE) -s check || (echo "❌ make check 失败，拒接提交" && exit 1)
	@echo "🔒 预检：文档门禁..."
	@$(MAKE) -s check-docs || (echo "❌ make check-docs 失败，拒绝提交" && exit 1)
	@echo "🔒 预检：浏览器门禁..."
	@$(MAKE) -s check-theme || (echo "❌ check-theme 失败，拒绝提交" && exit 1)
	@echo "🔒 预检：前端 ESLint..."
	@$(MAKE) -s frontend-lint || (echo "❌ frontend-lint 失败，拒绝提交" && exit 1)
	@echo "✅ 全部预检通过，执行提交（跳过产生 stash 冲突的 hook）..."
	@SKIP=frontend-lint,check-theme git commit -e

commit-msg:
	@SKIP=frontend-lint,check-theme git commit -m "$(msg)"

# ── 质量门禁：lint + type + test ──────────────────────────────
check: lint type test
	@echo "✅ make check 全绿"

lint:
	./venv/bin/ruff check .
	./venv/bin/ruff format --check .

lint-fix:
	./venv/bin/ruff check --fix .
	./venv/bin/ruff format .

type:
	./venv/bin/mypy .

test:
	HF_HUB_OFFLINE=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 ./venv/bin/pytest --tb=short

# ── 文档检查（Python 脚本，详见 tools/check_docs.py）─────────
check-docs:
	@PYTHONPATH=. ./venv/bin/python tools/check_docs.py

# 静默模式 — 只输出摘要行（✅/❌/⚠️），用于 Pre-flight 减少上下文污染
check-docs-quiet:
	@PYTHONPATH=. ./venv/bin/python tools/check_docs.py 2>&1 | grep -E '✅|❌|⚠️|💡' || true
	@echo "💡 完整输出: make check-docs"

# ── FastAPI REST API (Phase 28 M1) ──────────────────────────────
api:
	PYTHONPATH=. HF_HUB_OFFLINE=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 ./venv/bin/uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

# ── 规范性注释检查（协作纪律 17）──────────────────────────────────
check-comments:
	@echo "=== D100/D104 模块级 docstring ==="
	@./venv/bin/ruff check --select D100,D104 api/ 2>&1; rc=$$?; \
	if [ $$rc -ne 0 ]; then \
		echo "  ❌ api/ 模块级 docstring 缺失 — 基线不退，立即修复"; \
		exit 1; \
	else \
		echo "  ✅ api/ 模块级 docstring 全覆盖"; \
	fi
	@./venv/bin/ruff check --select D100,D104 src/ 2>&1; rc=$$?; \
	if [ $$rc -ne 0 ]; then \
		echo "  ❌ src/ 模块级 docstring 缺失 — 基线不退，立即修复"; \
		exit 1; \
	else \
		echo "  ✅ src/ 模块级 docstring 全覆盖"; \
	fi
	@echo ""
	@echo "=== D103 公开函数 docstring ==="
	@./venv/bin/ruff check --select D103 api/ 2>&1; rc=$$?; \
	if [ $$rc -ne 0 ]; then \
		echo "  ❌ api/ 公开函数缺 docstring — 基线不退"; \
		exit 1; \
	else \
		echo "  ✅ api/ 公开函数 docstring 全覆盖"; \
	fi
	@./venv/bin/ruff check --select D103 src/ 2>&1; rc=$$?; \
	if [ $$rc -ne 0 ]; then \
		echo "  ❌ src/ 公开函数缺 docstring — 基线不退"; \
		exit 1; \
	else \
		echo "  ✅ src/ 公开函数 docstring 全覆盖"; \
	fi
	@echo ""
	@echo "=== D101 公开类 docstring ==="
	@./venv/bin/ruff check --select D101 api/ 2>&1; rc=$$?; \
	if [ $$rc -ne 0 ]; then \
		echo "  ❌ api/ 公开类缺 docstring — 基线不退"; \
		exit 1; \
	else \
		echo "  ✅ api/ 公开类 docstring 全覆盖"; \
	fi
	@./venv/bin/ruff check --select D101 src/ 2>&1; rc=$$?; \
	if [ $$rc -ne 0 ]; then \
		echo "  ❌ src/ 公开类缺 docstring — 基线不退"; \
		exit 1; \
	else \
		echo "  ✅ src/ 公开类 docstring 全覆盖"; \
	fi
	@echo ""
	@echo "✅ check-comments 完成"

# ── L3 契约检查 ──────────────────────────────────────
check-safety:
	@PYTHONPATH=. ./venv/bin/python tools/check_safety.py

check-theme:
	@PYTHONPATH=. ./venv/bin/python tools/check_theme.py
	@echo "✅ check-theme 完成"

check-visual:
	@PYTHONPATH=. ./venv/bin/python tools/check_visual.py
	@echo "✅ check-visual 完成"

check-visual-update:
	@PYTHONPATH=. ./venv/bin/python tools/check_visual.py --update
	@echo "✅ check-visual-update 完成"

check-coordination:
	@PYTHONPATH=. ./venv/bin/python tools/check_coordination.py
	@echo "✅ check-coordination 完成"

check-coordination-json:
	@PYTHONPATH=. ./venv/bin/python tools/check_coordination.py --json --no-screenshots
	@echo "✅ check-coordination-json 完成"

check-shared-modules:
	@echo "=== L2f Shared Module Governance — 消费者统计 + Risk Assessment 覆盖 ==="
	@PYTHONPATH=. ./venv/bin/python tools/check_shared_modules.py
	@echo "✅ check-shared-modules 完成"

check-contracts:
	@echo "=== L3 契约完整性 — 接口签名变更影响分析 ==="
	@PYTHONPATH=. ./venv/bin/python tools/check_contracts.py check

# ── 一键启动：API + 前端（Phase 1000 Batch 14）────────────────
dev:
	@echo "🚀 GlassCortex 开发模式 — API (8000) + 前端 (3000)"
	@trap 'kill 0' EXIT; \
	PYTHONPATH=. HF_HUB_OFFLINE=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
		./venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000 & \
	sleep 2; \
	echo "✅ API http://localhost:8000"; \
	echo "🌐 前端 http://localhost:3000"; \
	cd frontend && npm run dev

# ── Next.js 前端 (M2) ──────────────────────────────────────────
frontend-setup:
	cd frontend && npm install
	@echo "✅ frontend/ 依赖安装完成"

frontend-dev:
	cd frontend && npm run dev

frontend-test:
	cd frontend && npm test

frontend-lint:
	cd frontend && npm run lint

frontend-type:
	cd frontend && npx tsc --noEmit
	@echo "✅ frontend-type (tsc --noEmit) 零 error"

frontend-check: frontend-type frontend-lint frontend-test
	@echo "✅ frontend-check 全绿"

# ── 全栈统一门禁 ──────────────────────────────────────────────
check-all: check frontend-type frontend-lint check-theme check-visual check-shared-modules
	@echo "✅ check-all 全绿 (Python + 前端 type + lint + 浏览器运行时 + 视觉回归 + Shared Module Governance)"
	@echo "💡 运行 make frontend-test 执行前端测试"


# ── CI 门禁（本地一键全栈）──────────────────────────────────────
# 当前仓库在 Gitee、单人开发，SaaS CI 边际收益低。
# make ci 作为主方案：跨平台可移植、离线可用、迁库零成本。
# 双平台 CI 配置文件（.github/workflows/ + .gitee/workflows/）
# 已编写备用，迁库开源后即启用。详见 docs/ci-cd.md。
ci: check check-all
	@echo "✅ CI 全栈门禁通过 (lint + type + test + 前端 + 浏览器运行时)"

frontend-build:
	cd frontend && npm run build

contract-snapshot:
	@PYTHONPATH=. ./venv/bin/python tools/check_contracts.py snapshot
	@echo "✅ .contract-snapshot.json 已更新（记得 commit）"

# ── 安装 git hooks ────────────────────────────────────────
hooks:
