"""GET /health——系统健康检查端点。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from api.dependencies import EnginesDep, SettingsDep
from api.schemas import HealthComponent, HealthResponse

router = APIRouter(tags=["health"])

# ── 各组件恢复提示模板 ─────────────────────────────

_RECOVERY_HINTS: dict[str, dict[str, str]] = {
    "database": {
        "error": (
            "SQLite DB file is corrupted. Delete the profile directory "
            "后通过 POST /profiles/{name} 重建。"
        ),
        "warn": "",
    },
    "faiss_index": {
        "error": ("FAISS index file corrupted. Delete index.faiss 并重启服务器。"),
        "warn": (
            "索引尚未创建——新 Profile 的正常状态。 It will be built on the first chat message."
        ),
    },
    "llm_api": {
        "error": "LLM API 不可达。请检查网络和 API 基础 URL。",
        "warn": "API key not set. Add it to .env to enable chat.",
    },
    "disk_space": {
        "error": "磁盘空间严重不足。请立即释放空间。",
        "warn": "磁盘空间偏低。请删除不用的 Profile 或旧 Trace 记录。",
    },
    "embedding_model": {
        "error": "Embedding 模型加载失败。请检查网络和模型可用性。",
        "warn": "Embedding 模型不可用。记忆召回功能将无法工作。",
    },
}


@router.get("/health", response_model=HealthResponse)
def health_check(
    engines: Any = EnginesDep,
    settings: Any = SettingsDep,
) -> HealthResponse:
    """运行五组件健康检查。

    返回各组件的状态（ok/warn/error）、延迟和详情：
    数据库、FAISS 索引、LLM API、磁盘空间、嵌入模型。

    When components are unhealthy, recovery_suggestions provides
    actionable hints for the operator.
    """
    from src.embed import embed as embed_fn
    from src.health import check_health

    store, idx, _recall, _forget, chat, _ledger, _planner = engines

    raw = check_health(store, idx, chat, settings, embed_fn=embed_fn)

    components = {
        name: HealthComponent(
            status=str(info["status"]),
            latency_ms=float(info["latency_ms"]),
            detail=str(info["detail"]),
        )
        for name, info in raw.items()
    }

    # ── 总体状态 ──
    statuses = [c.status for c in components.values()]
    if "error" in statuses:
        overall = "error"
    elif "warn" in statuses:
        overall = "warn"
    else:
        overall = "ok"

    # ── 恢复建议 ──
    suggestions: list[dict[str, str]] = []
    for name, comp in components.items():
        if comp.status in ("error", "warn"):
            hints = _RECOVERY_HINTS.get(name, {})
            hint = hints.get(comp.status, "")
            if hint:
                suggestions.append({"component": name, "status": comp.status, "hint": hint})

    return HealthResponse(
        components=components,
        overall_status=overall,
        recovery_suggestions=suggestions,
    )
