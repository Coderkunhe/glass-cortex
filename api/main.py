"""GlassCortex FastAPI 应用入口——将现有 Python 引擎包装为 REST API。

Phase 28 M1：纯 HTTP ↔ 引擎桥接层，所有业务逻辑在 src/ 中。

启动方式：make api  或  uvicorn api.main:app --reload
"""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from api.routers import (
    chat,
    context,
    health,
    lab,
    logs,
    memory,
    metrics,
    planner,
    profiles,
    session,
    traces,
)
from api.schemas import ErrorCode, ErrorResponse, RootResponse

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator


# ── OpenAPI 文档描述 ────────────────────────────────────

DESCRIPTION = """
## GlassCortex REST API

Cognitive layer transparency for AI robots — memory formation, context engineering,
token accounting, and intent planning exposed as REST endpoints.

### Architecture

Every endpoint wraps the **same Python engine** that powers the Next.js frontend and CLI.
The engine is initialized once at startup via `init_engines()` and shared across all
requests through FastAPI dependency injection.

### Profiles

Use the `X-Profile` header to select a user profile (default: `"default"`).
Each profile has isolated database and FAISS index files under `data/{profile}/`.
"""


# ── Lifespan——引擎生命周期 ─────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """启动时初始化引擎，关闭时断开数据库连接。"""
    # 确保项目根目录在 sys.path 中（uvicorn 通过 make api 在项目根目录启动）
    project_root = Path(__file__).resolve().parent.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    from src.bootstrap import init_engines, load_dotenv
    from src.config import settings
    from src.logging import setup_logging

    load_dotenv()  # 从 .env 文件加载环境变量

    setup_logging(settings.profile_data_dir, settings.log_level, settings.user_profile)

    engines = init_engines()
    store, *_rest = engines

    app.state.engines = engines
    app.state.settings = settings
    app.state.store = store  # 便捷访问器

    yield  # ── 应用在此运行 ──

    # 关闭时断开数据库
    try:
        store.close()
    except OSError as exc:
        import logging

        logging.getLogger("glasscortex.api").warning(
            "Failed to close memory store during shutdown: %s", exc
        )


# ── 应用创建 ────────────────────────────────────────────────────

app = FastAPI(
    title="GlassCortex API",
    description=DESCRIPTION,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)


# ── 跨域配置 ────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 异常处理器 ───────────────────────────────────────────────


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """将纯字符串的 HTTPException 包装为统一的 ErrorResponse 信封。

    以结构化 dict 作为 detail 的 HTTPException（如 ChatError）直接透传——
    端点有意自行构造错误响应格式。
    """
    if isinstance(exc.detail, dict):
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.detail,
        )
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error="http_error",
            detail=str(exc.detail),
            error_code="HTTP_ERROR",
        ).model_dump(),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Pydantic 校验失败时返回 422，附带字段级错误详情。"""
    field_errors: list[dict[str, object]] = []
    for error in exc.errors():
        loc = ".".join(str(p) for p in error.get("loc", []))
        field_errors.append(
            {
                "field": loc,
                "message": error.get("msg", ""),
                "type": error.get("type", ""),
            }
        )
    return JSONResponse(
        status_code=422,
        content={
            "error": "validation_error",
            "error_code": ErrorCode.VALIDATION_ERROR,
            "detail": "Request validation failed",
            "field_errors": field_errors,
        },
    )


@app.middleware("http")
async def catch_all_exceptions(request: Request, call_next: Any) -> Any:
    """全局异常捕获中间件——记录真实错误日志，返回脱敏的 500 响应。

    使用中间件而非 @app.exception_handler(Exception) 的原因是：
    同步端点（在线程池中运行）抛出的异常不会被 Starlette 的异常处理器捕获。
    中间件在 ASGI 层包装，能拦截所有异常。
    """
    import logging

    try:
        return await call_next(request)
    except Exception as exc:
        logger = logging.getLogger("glasscortex.api")
        logger.exception("Unhandled exception: %s", exc)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error="internal_server_error",
                error_code=ErrorCode.INTERNAL_ERROR,
                detail="An unexpected error occurred",
            ).model_dump(),
        )


# ── 根路由 ────────────────────────────────────────────────────────────


@app.get("/", response_model=RootResponse)
def root() -> RootResponse:
    """服务身份——存活检查。"""
    return RootResponse()


# ── 路由注册 ─────────────────────────────────────────────────────────

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(memory.router)
app.include_router(profiles.router)
app.include_router(metrics.router)
app.include_router(traces.router)
app.include_router(context.router)
app.include_router(planner.router)
app.include_router(session.router)
app.include_router(logs.router)
app.include_router(lab.router)
