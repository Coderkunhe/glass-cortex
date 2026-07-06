"""管线追踪端点——列举、过滤、计数、清理 Trace 记录。

Trace 由引擎持久化到 pipeline_trace 表，此处作为只读可观测性端点暴露。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from api.dependencies import EnginesDep
from api.schemas import (
    DeleteTracesRequest,
    DeleteTracesResponse,
    TraceCountResponse,
    TraceItem,
)

router = APIRouter(prefix="/traces", tags=["traces"])


@router.get("", response_model=list[TraceItem])
def list_traces(
    engines: Any = EnginesDep,
    session_id: str | None = Query(None, description="Filter by session ID"),
    limit: int = Query(50, ge=1, le=500),
) -> list[TraceItem]:
    """列出管线追踪记录，按时间倒序。"""
    store, *_ = engines
    rows = store.get_traces(session_id=session_id, limit=limit)
    return [_row_to_trace_item(r) for r in rows]


@router.get("/by-step", response_model=list[TraceItem])
def list_traces_by_step(
    engines: Any = EnginesDep,
    step_name: str = Query(..., min_length=1, description="Filter by step name"),
    limit: int = Query(200, ge=1, le=500),
) -> list[TraceItem]:
    """按步骤名过滤管线追踪记录。"""
    store, *_ = engines
    rows = store.get_traces_by_step(step_name=step_name, limit=limit)
    return [_row_to_trace_item(r) for r in rows]


@router.get("/count", response_model=TraceCountResponse)
def trace_count(
    engines: Any = EnginesDep,
    session_id: str | None = Query(None),
) -> TraceCountResponse:
    """统计管线追踪记录数，可选按会话过滤。"""
    store, *_ = engines
    return TraceCountResponse(
        count=store.get_trace_count(session_id=session_id),
        session_id=session_id,
    )


@router.post("/delete-old", response_model=DeleteTracesResponse)
def delete_old_traces(
    body: DeleteTracesRequest,
    engines: Any = EnginesDep,
) -> DeleteTracesResponse:
    """删除最旧的追踪记录，最多保留 retention_limit 条。"""
    store, *_ = engines
    deleted = store.delete_old_traces(body.retention_limit)
    return DeleteTracesResponse(deleted=deleted, retention_limit=body.retention_limit)


def _row_to_trace_item(row: dict[str, object]) -> TraceItem:
    """将存储的追踪行（含 metrics_json）转换为 TraceItem API 模型。"""
    metrics: dict[str, object] = {}
    raw_metrics = row.get("metrics")
    if isinstance(raw_metrics, str):
        import json

        try:
            metrics = json.loads(raw_metrics)
        except json.JSONDecodeError, TypeError:
            pass
    elif isinstance(raw_metrics, dict):
        metrics = raw_metrics

    return TraceItem(
        id=int(str(row.get("id", 0))),
        session_id=str(row.get("session_id", "")),
        step_name=str(row.get("step_name", "")),
        elapsed_ms=float(str(row.get("elapsed_ms", 0))),
        status=str(row.get("status", "ok")),
        metrics=metrics,
        created_at=float(str(row.get("created_at", 0))),
    )
