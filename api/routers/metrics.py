"""指标端点——Token 计量、管线步骤耗时与压缩统计。

Token/Steps 端点数据来源于内存中的 TokenLedger（服务器重启后清空）；
Compression 端点聚合 ledger 与 pipeline_trace 双数据源。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from api.dependencies import EnginesDep
from api.schemas import CompressionStatsResponse, StepSummary, TokenSummary

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/tokens", response_model=TokenSummary)
def token_metrics(engines: Any = EnginesDep) -> TokenSummary:
    """按调用点返回 Token 用量汇总。

    数据来源于内存中的 TokenLedger（会话级别），服务器重启后清空。
    """
    _store, _idx, _recall, _forget, _chat, ledger, _planner = engines
    raw = ledger.summary()

    # summary() 返回格式: {"chat_engine": {prompt_tokens, completion_tokens, total_tokens},
    #                    "planner": {...}, ..., "total": {...}}
    by_call_point = {k: v for k, v in raw.items() if k != "total"}
    grand_total = raw.get("total", {})
    return TokenSummary(
        by_call_point=by_call_point,
        total_prompt_tokens=grand_total.get("prompt_tokens", 0),
        total_completion_tokens=grand_total.get("completion_tokens", 0),
        total_tokens=grand_total.get("total_tokens", 0),
    )


@router.get("/steps", response_model=StepSummary)
def step_metrics(engines: Any = EnginesDep) -> StepSummary:
    """按步骤返回管线耗时汇总。

    数据来源于内存中的 TokenLedger（会话级别），服务器重启后清空。
    """
    _store, _idx, _recall, _forget, _chat, ledger, _planner = engines
    raw = ledger.step_summary()
    return StepSummary(steps=raw)


@router.get("/compression", response_model=CompressionStatsResponse)
def compression_metrics(engines: Any = EnginesDep) -> CompressionStatsResponse:
    """返回压缩 token 节省统计，聚合 ledger（当前会话）与 pipeline_trace（历史持久化）。"""
    store, _idx, _recall, _forget, _chat, ledger, _planner = engines

    # Ledger 数据（当前会话）
    raw = ledger.summary()
    comp = raw.get("compression", {})
    savings = raw.get("compression_savings", {})

    # Pipeline trace 历史数据
    hist_traces = store.get_traces_by_step("compression", limit=1000)
    historical_count = len(hist_traces)

    return CompressionStatsResponse(
        session_compression_count=comp.get("count", 0),
        session_tokens_saved=savings.get("prompt_tokens", 0),
        session_prompt_tokens=comp.get("prompt_tokens", 0),
        session_completion_tokens=comp.get("completion_tokens", 0),
        historical_compression_count=historical_count,
    )
