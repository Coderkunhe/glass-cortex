"""上下文工程实验端点——溢出模拟与策略对比。

纯计算端点：无引擎依赖、无副作用，所有输入数据来自请求体。
适合在不运行完整聊天管线的情况下对上下文窗口溢出行为做推演分析。
"""

from __future__ import annotations

from fastapi import APIRouter

from api.schemas import (
    CompareStrategiesRequest,
    CompareStrategiesResponse,
    OverflowSimResponse,
    SimulateOverflowRequest,
)

router = APIRouter(prefix="/context", tags=["context"])


@router.post("/simulate-overflow", response_model=OverflowSimResponse)
def simulate_overflow(body: SimulateOverflowRequest) -> OverflowSimResponse:
    """对单个策略执行溢出模拟推演。"""
    from src.context.overflow_sim import simulate_overflow as _sim

    result = _sim(
        recalled=body.recalled,
        strategy=body.strategy,
        window_size=body.window_size,
        user_input=body.user_input,
        base_tokens_override=body.base_tokens_override,
    )
    return OverflowSimResponse(
        strategy=str(result.strategy),
        window_size=result.window_size,
        base_tokens=result.base_tokens,
        user_tokens=result.user_tokens,
        memories_before=result.memories_before,
        memories_token_before=result.memories_token_before,
        memories_after=result.memories_after,
        memories_token_after=result.memories_token_after,
        dropped_count=result.dropped_count,
        dropped_items=result.dropped_items,
        kept_items=result.kept_items,
        overflow_triggered=result.overflow_triggered,
        total_estimated_tokens=result.total_estimated_tokens,
        usage_pct=result.usage_pct,
        wasted_tokens=result.wasted_tokens,
        available_tokens=result.available_tokens,
        summary_line=result.summary_line,
        strategy_label=result.strategy_label,
    )


@router.post("/compare-strategies", response_model=CompareStrategiesResponse)
def compare_strategies(body: CompareStrategiesRequest) -> CompareStrategiesResponse:
    """并排对比三种溢出策略。"""
    from src.context.overflow_sim import OverflowSimResult
    from src.context.overflow_sim import compare_strategies as _cmp

    results = _cmp(
        recalled=body.recalled,
        window_size=body.window_size,
        user_input=body.user_input,
        base_tokens_override=body.base_tokens_override,
    )

    def _to_response(r: OverflowSimResult) -> OverflowSimResponse:
        return OverflowSimResponse(
            strategy=str(r.strategy),
            window_size=r.window_size,
            base_tokens=r.base_tokens,
            user_tokens=r.user_tokens,
            memories_before=r.memories_before,
            memories_token_before=r.memories_token_before,
            memories_after=r.memories_after,
            memories_token_after=r.memories_token_after,
            dropped_count=r.dropped_count,
            dropped_items=r.dropped_items,
            kept_items=r.kept_items,
            overflow_triggered=r.overflow_triggered,
            total_estimated_tokens=r.total_estimated_tokens,
            usage_pct=r.usage_pct,
            wasted_tokens=r.wasted_tokens,
            available_tokens=r.available_tokens,
            summary_line=r.summary_line,
            strategy_label=r.strategy_label,
        )

    return CompareStrategiesResponse(
        truncate=_to_response(results["truncate"]),
        prioritize=_to_response(results["prioritize"]),
        summarize=_to_response(results["summarize"]),
    )
