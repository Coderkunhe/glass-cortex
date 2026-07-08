"""会话管理端点——重置/清空、会话身份、定向遗忘。

Batch 162：一键重置流程的后端支撑——调用 bootstrap 层的
wipe_profile_data() + init_engines() 完成数据清空与引擎重建。

Phase 66 B21：POST /session/forget 定向遗忘——按 session_id
级联删除 episodes + facts + FAISS 向量，实现"清除对话→记忆遗忘"链路。
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from api.dependencies import EnginesDep, SettingsDep
from api.schemas import SessionForgetRequest, SessionForgetResponse, WipeResponse
from src.bootstrap import EngineBundle
from src.logging import get_logger

router = APIRouter(prefix="/session", tags=["session"])
logger = get_logger(__name__)


@router.post("/forget", response_model=SessionForgetResponse)
def forget_session(
    request: Request,
    body: SessionForgetRequest,
    engines: EngineBundle = EnginesDep,
) -> SessionForgetResponse:
    """按 session_id 定向遗忘——级联删除与该会话关联的全部记忆数据。

    调用 ForgettingEngine.forget_session() 完成：
    1. SQL 层级联删除（episodes → facts → recall_log → confidence_log）
    2. FAISS 向量索引清理
    3. 返回删除统计回执

    遗忘后，与该 session 关联的标签（subject-relation 聚合）会自动回退——
    因为标签由 facts 实时 GROUP BY 派生，facts 删除后标签自然消失。
    """
    forgetting = engines.forgetting
    result = forgetting.forget_session(body.session_id)

    logger.info(
        "会话遗忘完成: session_id=%s episodes=%s facts=%s faiss=%s",
        body.session_id,
        result["episodes_deleted"],
        result["facts_deleted"],
        result["faiss_vectors_removed"],
    )

    return SessionForgetResponse(
        episodes_deleted=int(result["episodes_deleted"]),  # type: ignore[call-overload]  # int() overload expects str|bytes|SupportsInt; dict value is Any
        facts_deleted=int(result["facts_deleted"]),  # type: ignore[call-overload]  # int() overload expects str|bytes|SupportsInt; dict value is Any
        faiss_vectors_removed=int(result["faiss_vectors_removed"]),  # type: ignore[call-overload]  # int() overload expects str|bytes|SupportsInt; dict value is Any
        session_id=str(result["session_id"]),
    )


@router.post("/reset", response_model=WipeResponse)
def reset_session(
    request: Request,
    engines: EngineBundle = EnginesDep,
    settings: object = SettingsDep,
) -> WipeResponse:
    """一键清空：删除当前 profile 的全部数据文件并重新初始化引擎。

    流程：关闭已有 store 连接 → 删除 SQLite DB + FAISS 索引
    → 调用 init_engines() 重建空数据存储 → 更新 app.state 中的引擎引用。
    TokenLedger 随 init_engines() 自然重建（全新实例，计数归零）。
    """
    from src.bootstrap import init_engines, wipe_profile_data

    store = engines.store

    # 关闭已有 store 连接（wipe_profile_data 会删除文件）
    if store is not None:
        store.close()

    # 清空数据文件（SQLite + FAISS）
    wipe_profile_data(settings)  # type: ignore[arg-type]  # config.settings is Settings; mypy loses type through module-level re-export

    # 重建引擎（空数据库 + 空索引 + 全新 TokenLedger）
    new_engines = init_engines()

    # 更新 app.state——后续请求使用全新引擎
    request.app.state.engines = new_engines

    logger.info("会话重置完成: profile=%s", getattr(settings, "user_profile", "default"))

    return WipeResponse(
        status="wiped",
        profile=str(getattr(settings, "user_profile", "default")),
        detail="所有数据已清空，引擎已重新初始化。Token 计数器归零，数据库与索引重建完成。",
    )
