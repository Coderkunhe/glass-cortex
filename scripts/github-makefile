.PHONY: help setup clean check lint lint-fix type test api dev \
        frontend-setup frontend-dev frontend-test frontend-lint frontend-type frontend-check frontend-build \
        check-all hooks ship

# ── 命令列表 ────────────────────────────────────────────────────
help:
	@echo "可用命令："
	@echo "  make setup     创建 venv + 安装依赖（新人第一步）"
	@echo "  make clean     删除 venv 和所有缓存"
	@echo "  make check     lint + type + test（Python 质量门禁）"
	@echo "  make check-all Python check + 前端 check（全栈门禁）"
	@echo "  make lint      仅 ruff 检查"
	@echo "  make lint-fix  ruff 自动修复"
	@echo "  make type      仅 mypy 类型检查"
	@echo "  make test      仅 pytest"
	@echo "  make dev        一键启动 API + 前端（开发模式）"
	@echo "  make api        启动 FastAPI REST API"
	@echo "  make hooks     安装 pre-commit hook"
	@echo "  make frontend-setup  安装前端 npm 依赖"
	@echo "  make frontend-dev    启动 Next.js 开发服务器"
	@echo "  make frontend-test   运行前端测试"
	@echo "  make frontend-lint   运行 ESLint"
	@echo "  make frontend-check  type + lint + test（前端门禁）"
	@echo "  make frontend-build  生产构建"
	@echo "  make ship      全栈门禁 → 推送（公开版，不含镜像脚本）"

# ── 环境初始化 ─────────────────────────────────────────────────
setup:
	python3 -m venv venv
	./venv/bin/pip install --upgrade pip
	./venv/bin/pip install -r requirements-lock.txt
	@if [ -f .pre-commit-config.yaml ]; then \
		./venv/bin/pre-commit install; \
		echo "✅ pre-commit 已安装"; \
	else \
		echo "💡 无 .pre-commit-config.yaml，跳过 hooks"; \
	fi
	@echo "✅ 环境就绪，运行 make check 验证"

# ── 清理 ───────────────────────────────────────────────────────
clean:
	rm -rf venv .mypy_cache .pytest_cache .ruff_cache

# ── 质量门禁 ────────────────────────────────────────────────────
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

# ── FastAPI REST API ─────────────────────────────────────────────
api:
	PYTHONPATH=. HF_HUB_OFFLINE=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 ./venv/bin/uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

# ── 一键启动 ────────────────────────────────────────────────────
dev:
	@echo "🚀 GlassCortex 开发模式 — API (8000) + 前端 (3000)"
	@trap 'kill 0' EXIT; \
	PYTHONPATH=. HF_HUB_OFFLINE=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
		./venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000 & \
	sleep 2; \
	echo "✅ API http://localhost:8000"; \
	echo "🌐 前端 http://localhost:3000"; \
	cd frontend && npm run dev

# ── Next.js 前端 ──────────────────────────────────────────────────
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

frontend-build:
	cd frontend && npm run build

# ── 全栈门禁 ────────────────────────────────────────────────────
check-all: check frontend-check
	@echo "✅ check-all 全绿 (Python + 前端)"

# ── 公开版跳过的门禁（tools/ 已剥离）──────────────────────────────
check-theme:
	@echo "⏭️  check-theme skipped (tools not available in public mirror)"

check-visual:
	@echo "⏭️  check-visual skipped (tools not available in public mirror)"

# ── 推送（公开版，不含镜像脚本）──────────────────────────────────
ship: check-all
	git push origin HEAD
	@echo "✅ ship 完成"

# ── 安装 git hooks ────────────────────────────────────────────
hooks:
	@if [ -f .pre-commit-config.yaml ]; then \
		./venv/bin/pre-commit install; \
		echo "✅ pre-commit hook 已安装"; \
	else \
		echo "💡 无 .pre-commit-config.yaml，请运行 make setup"; \
	fi
