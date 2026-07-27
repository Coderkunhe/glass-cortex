"""POST /chat——主对话端点。

包装完整 GlassCortex 管线：意图分类 → 记忆召回 → LLM 生成 → 事实抽取 → 持久存储。
"""

from __future__ import annotations

import json
import logging
from collections.abc import Generator
from typing import Any, cast

from fastapi import APIRouter, HTTPException
from starlette.responses import StreamingResponse

from api.dependencies import EnginesDep
from api.schemas import (
    ApiTrace,
    ChatError,
    ChatRequest,
    ChatResponse,
    ColdStartProfile,
    ContextMeta,
    EpisodeRecallItem,
    FactRecallItem,
    IntentResult,
    RecallItem,
    RoutingInfo,
)

router = APIRouter(prefix="/chat", tags=["chat"])


def _route_recall_item(item: dict[str, object]) -> RecallItem:
    """按 _row_type 将松散 dict 路由到 EpisodeRecallItem 或 FactRecallItem。

    缓存命中路径的 item 来自 JSON 反序列化（_row_type 已被旧 RecallItem 丢弃），
    退回到字段存在性启发式：有 confidence 且无 importance → fact，否则 → episode。
    """
    if item.get("_row_type") == "fact":
        return FactRecallItem.model_validate(item)
    if "_row_type" not in item and "confidence" in item and "importance" not in item:
        return FactRecallItem.model_validate(item)
    return EpisodeRecallItem.model_validate(item)


@router.post("", response_model=ChatResponse, responses={503: {"model": ChatError}})
def chat(
    body: ChatRequest,
    engines: Any = EnginesDep,
) -> ChatResponse | StreamingResponse:
    """发送用户消息并获取 AI 回复。

    完整管线：
    1. 意图分类（Planner）
    2. 语义记忆召回（RecallEngine）
    3. LLM 生成 + 事实抽取 + 记忆存储（ChatEngine）
    """
    store, idx, recall, _forget, chat_engine, _ledger, planner = engines

    # ── 步骤 0：语义响应缓存检查（Phase 62）──
    from src.config import settings as _cfg

    _semantic_cache = None
    cached_resp = None
    if _cfg.response_cache_enabled:
        from src.cache.semantic_cache import get_response_cache

        _semantic_cache = get_response_cache()
        _semantic_cache.set_ledger(_ledger)
        cached_resp, cache_score = _semantic_cache.check(body.user_input)
        if cached_resp is not None:
            return ChatResponse(
                response_text=cached_resp.response_text,
                episode_id=-1,  # 哨兵：缓存命中无新 episode
                intent=IntentResult(**cached_resp.intent) if cached_resp.intent else None,  # type: ignore[arg-type]  # cached JSON→Pydantic model; mypy can't verify dict keys match model fields
                context_meta=ContextMeta(**cached_resp.context_meta),  # type: ignore[arg-type]  # cached JSON→Pydantic model; mypy can't verify dict keys match model fields
                api_trace=ApiTrace(**cached_resp.api_trace),  # type: ignore[arg-type]  # cached JSON→Pydantic model; mypy can't verify dict keys match model fields
                recall_items=[_route_recall_item(item) for item in cached_resp.recall_items],
                system_prompt=cached_resp.system_prompt,
                routing=RoutingInfo(**cached_resp.routing) if cached_resp.routing else None,  # type: ignore[arg-type]  # cached JSON→Pydantic model; mypy can't verify dict keys match model fields
                cold_start_profile=(
                    ColdStartProfile(**cached_resp.cold_start_profile)  # type: ignore[arg-type]  # cached JSON→Pydantic model; mypy can't verify dict keys match model fields
                    if cached_resp.cold_start_profile
                    else None
                ),
                from_cache=True,
                cache_hit_score=round(cache_score, 4),
            )

    # ── 步骤 1：意图分类 ──
    intent_result: IntentResult | None = None
    planner_trace: dict[str, Any] = {}
    try:
        intent_data, planner_trace = planner.classify_intent(body.user_input)
        intent_result = IntentResult(
            category=intent_data.category,
            confidence=intent_data.confidence,
            rationale=intent_data.rationale,
        )
        # 预存意图分类 JSON + 完整 trace，稍后注入 api_trace 供前端深度抽屉展示
        parsed_result_json = intent_result.model_dump_json(indent=2, ensure_ascii=False)
    except Exception as exc:
        # 意图分类为尽力而为——失败不阻塞后续管线
        logging.getLogger("glasscortex.api.chat").warning(
            "Intent classification failed, continuing pipeline: %s", exc
        )

    # ── 分层重均衡：机会主义周期触发（Phase 54 Batch 4）──
    from src.config import settings as _tier_cfg  # noqa: PLC0415

    if _tier_cfg.tier_enabled:
        from src.memory.tier import TierRebalancer  # noqa: PLC0415

        TierRebalancer(store).rebalance_if_stale()

    # ── 记忆固化：保护 + 慢降温（Phase 56 — B1 冷却 + B2 用进+豁免）──
    if _tier_cfg.consolidation_enabled:
        from src.memory.consolidate import ConsolidationCore  # noqa: PLC0415

        ConsolidationCore(store).consolidate_if_stale()

    # ── 步骤 2：语义召回 ──
    try:
        recalled: list[dict[str, Any]] = recall.recall(
            query=body.user_input,
            top_k=body.recall_top_k,
            threshold=body.recall_threshold,
            strengthen=True,
            mmr_lambda=body.recall_mmr_lambda,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Recall failed: {exc}") from exc

    # ── 步骤 2.5：上下文预算检查 + 自动降级（Phase 63）──
    from src.config import settings as _budget_cfg  # noqa: PLC0415

    degradation_plan: Any = None
    _degradation_trace: dict[str, Any] = {}
    if _budget_cfg.budget_enabled and intent_result is not None:
        from src.context.budget import (  # noqa: PLC0415
            AutoDegradationEngine,
            classify_and_allocate,
            should_skip_step,
        )
        from src.context.overflow_sim import estimate_tokens  # noqa: PLC0415

        # ── 分类查询 + 分配四区预算 ──
        qc, budget = classify_and_allocate(
            intent=intent_result.category,
            message_length=len(body.user_input),
            history_length=0,  # 当前 API 层无会话历史轮数，默认 0
            window_size=body.context_window_size,
        )

        # ── 估算召回条目 token ──
        recall_tokens = sum(estimate_tokens(str(item.get("content", ""))) for item in recalled)
        warm_count = sum(1 for item in recalled if item.get("tier") == "warm")

        # ── 评估降级计划 ──
        engine = AutoDegradationEngine()
        degradation_plan = engine.evaluate(
            budget=budget,
            estimated_recall_tokens=recall_tokens,
            recall_count=len(recalled),
            warm_count=warm_count,
        )

        # ── 门控：过滤温层摘要 ──
        if should_skip_step("warm_summaries", degradation_plan):
            recalled = [item for item in recalled if item.get("tier") != "warm"]

        # ── 门控：缩减召回数量 ──
        if degradation_plan.reduce_recall_to is not None:
            recalled = recalled[: degradation_plan.reduce_recall_to]

        _degradation_trace = {
            "query_class": qc.value,
            "budget_zones": budget,
            "estimated_recall_tokens": recall_tokens,
            "degradation_level": degradation_plan.level.value,
            "degradation_reason": degradation_plan.reason,
        }
        logger = logging.getLogger("glasscortex.api.chat")
        logger.info(
            "预算降级评估完成",
            extra={"component": "chat", "degradation": _degradation_trace},
        )

    # ── 步骤 3：LLM 生成 + 事实抽取 + 存储 ──
    # 模型路由：intent → complexity → model（仅当路由开启且用户未显式指定模型时生效）
    selected_model = body.model
    routing_info: RoutingInfo | None = None
    from src.config import settings as _route_cfg  # noqa: PLC0415

    if _route_cfg.routing_enabled and selected_model is None and intent_result is not None:
        from src.chat.model_router import ModelRouter  # noqa: PLC0415

        router = ModelRouter()
        decision = router.decide(intent_result.category)
        selected_model = decision.model
        routing_info = RoutingInfo(
            model=decision.model,
            reason=decision.reason,
            intent_category=decision.intent_category,
            complexity=decision.complexity,
            fallback_model=decision.fallback_model,
            fallback_triggered=False,
            attempts=1,
        )

    # ── 流式分支：SSE 逐 token 返回 ──
    if body.stream and cached_resp is None:
        # 预计算流结束后需要的元数据（不依赖 response_text）
        recall_items = [_route_recall_item(dict(item)) for item in recalled]
        cold_start_profile = _compute_cold_start_profile(store)

        pre_meta: dict[str, object] = {
            "intent": intent_result.model_dump() if intent_result else None,
            "recall_items": [item.model_dump() for item in recall_items],
            "routing": routing_info.model_dump() if routing_info else None,
            "cold_start_profile": (cold_start_profile.model_dump() if cold_start_profile else None),
        }
        if _degradation_trace:
            pre_meta["degradation"] = _degradation_trace

        def _sse_generator() -> Generator[str, None, None]:
            """将 ChatEngine.generate_stream() 的事件转为 SSE 格式。"""
            stream_events = chat_engine.generate_stream(
                user_input=body.user_input,
                recalled=recalled,
                context_window_size=body.context_window_size,
                context_overflow_strategy=body.context_overflow_strategy,
                model=selected_model,
                temperature=body.temperature,
                max_tokens=body.max_tokens,
                two_stage=False,
            )

            for event in stream_events:
                evt_type = event.get("type")
                if evt_type == "token":
                    token_payload = json.dumps({"delta": event["delta"]}, ensure_ascii=False)
                    yield f"event: token\ndata: {token_payload}\n\n"
                elif evt_type == "done":
                    response_text = str(event.get("response_text", ""))
                    # 存储回复（<50ms，不阻塞流感知）
                    try:
                        eid = chat_engine.store_response(
                            response_text,
                            session_id=body.session_id or None,
                        )
                    except Exception:
                        eid = -1  # 存储失败不阻断流

                    # 组装完整 done payload
                    done_payload: dict[str, object] = {
                        "response_text": response_text,
                        "episode_id": eid,
                        "context_meta": event.get("context_meta", {}),
                        "api_trace": event.get("api_trace", {}),
                    }
                    # 合并预计算元数据（degradation 注入 api_trace 与非流式路径对齐）
                    for key in (
                        "intent",
                        "recall_items",
                        "routing",
                        "cold_start_profile",
                    ):
                        if key in pre_meta:
                            done_payload[key] = pre_meta[key]
                    # L5: degradation 必须嵌套在 api_trace 内——
                    # ProcessDrawer.tsx 从 trace['degradation'] 读取
                    if "degradation" in pre_meta:
                        api_trace_dict = cast(dict[str, object], done_payload["api_trace"])
                        api_trace_dict["degradation"] = pre_meta["degradation"]

                    yield (f"event: done\ndata: {json.dumps(done_payload, ensure_ascii=False)}\n\n")
                elif evt_type == "error":
                    err_payload = json.dumps(
                        {
                            "error": "llm_unavailable",
                            "detail": str(event.get("detail", "")),
                        },
                        ensure_ascii=False,
                    )
                    yield f"event: error\ndata: {err_payload}\n\n"

        return StreamingResponse(
            _sse_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # nginx 禁用缓冲
            },
        )

    try:
        # 降级门控：事实抽取是否跳过
        from src.context.budget import should_skip_step as _gate_step  # noqa: PLC0415

        _skip_fact = (
            _gate_step("fact_extraction", degradation_plan)
            if degradation_plan is not None
            else False
        )
        response_text, episode_id, context_meta, api_trace = chat_engine.generate_and_store(
            user_input=body.user_input,
            recalled=recalled,
            context_window_size=body.context_window_size,
            context_overflow_strategy=body.context_overflow_strategy,
            model=selected_model,
            temperature=body.temperature,
            max_tokens=body.max_tokens,
            skip_fact_extraction=_skip_fact,
            session_id=body.session_id or None,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=ChatError(
                error="llm_unavailable",
                detail=str(exc),
                response_text="",
                recovery_hint="请在 .env 中设置 LLM API Key 并检查网络连接",
            ).model_dump(),
        ) from exc

    recall_items = [_route_recall_item(dict(item)) for item in recalled]

    # ── 冷启动检测 (q2.19)：系统对自身「记忆成熟度」的自我感知 ──
    cold_start_profile = _compute_cold_start_profile(store)

    # ── Token breakdown 组装：将本轮的 token 消耗按调用点归因 ──
    # Lazy import 以便测试时 patch src.config.settings 生效
    from src.config import settings  # noqa: PLC0415

    token_breakdown: dict[str, Any] = {
        "chat": {
            "prompt_tokens": api_trace.get("prompt_tokens", 0),
            "completion_tokens": api_trace.get("completion_tokens", 0),
        },
        "pricing": {
            "input_per_1m": settings.llm_input_price_per_1m,
            "output_per_1m": settings.llm_output_price_per_1m,
        },
    }
    # 意图分类 token（来自 planner trace，不经 ledger）
    if planner_trace.get("token_usage"):
        token_breakdown["intent"] = planner_trace["token_usage"]
    # 事实抽取 token（来自 context_meta，经 FactExtractor 填充）
    fact_trace = context_meta.get("fact_extraction_trace")
    if fact_trace and isinstance(fact_trace, dict):
        token_breakdown["fact_extraction"] = {
            "prompt_tokens": fact_trace.get("prompt_tokens", 0),
            "completion_tokens": fact_trace.get("completion_tokens", 0),
        }
    api_trace["token_breakdown"] = token_breakdown

    # 路由决策注入 api_trace（向后兼容——前端可从顶层 routing 字段或 api_trace 获取）
    if routing_info is not None:
        api_trace["routing_decision"] = routing_info.model_dump()

    # 降级决策注入 api_trace（Phase 63 —— 供前端上下文 Lab 展示预算可视化）
    if _degradation_trace:
        api_trace["degradation"] = _degradation_trace

    # 将意图分类完整链路注入 api_trace，供前端深度抽屉展示
    if intent_result:
        api_trace["parsed_result"] = parsed_result_json
        api_trace["planner_system_prompt"] = planner_trace.get("system_prompt", "")
        api_trace["planner_raw_response"] = planner_trace.get("raw_response", "")
        if planner_trace.get("token_usage"):
            api_trace["planner_token_usage"] = planner_trace["token_usage"]
        if planner_trace.get("parse_error"):
            api_trace["planner_parse_error"] = planner_trace["parse_error"]

    # ── 步骤 1.5：历史计划检索（记忆引导规划）──
    plan_history: object | None = None
    if _route_cfg.plan_history_enabled and store is not None:
        try:
            from src.planner.plan_history import PlanHistoryRetriever  # noqa: PLC0415

            retriever = PlanHistoryRetriever(store)
            plan_cat_pre = intent_result.category if intent_result else "提问"
            plan_history = retriever.retrieve(body.user_input, plan_cat_pre)
        except Exception as exc:
            logging.getLogger("glasscortex.api.chat").warning(
                "Plan history retrieval failed, continuing pipeline: %s", exc
            )

    # ── 步骤 4：L2 任务规划（PlanGenerator）──
    # PlanGenerator 内部检查 settings.plan_generation_enabled 开关
    plan_result = None  # 初始化以支持 UnboundLocalError 安全
    try:
        plan_cat = intent_result.category if intent_result else "提问"
        plan_result, plan_trace = planner.generate_plan(
            body.user_input, plan_cat, plan_history=plan_history
        )
        # 仅计划非空时注入 trace（禁用或失败时 subtasks 为空列表）
        if plan_result.subtasks:
            api_trace["plan_subtasks"] = plan_result.subtasks
            api_trace["plan_dag_edges"] = [[src, tgt] for src, tgt in plan_result.dag_edges]
            api_trace["plan_rationale"] = plan_result.rationale
            api_trace["plan_confidence"] = plan_result.confidence
            if plan_trace.get("token_usage"):
                api_trace["plan_token_usage"] = plan_trace["token_usage"]
            if plan_trace.get("parse_error"):
                api_trace["plan_parse_error"] = plan_trace["parse_error"]
    except Exception as exc:
        # L2 规划为尽力而为——失败不阻塞聊天管线
        logging.getLogger("glasscortex.api.chat").warning(
            "Plan generation failed, continuing pipeline: %s", exc
        )

    # ── 步骤 4.5：Plan 持久化（若开关开启）──
    # settings 已在上方 Token breakdown 段导入，此处复用同一引用
    if plan_result is not None and settings.plan_storage_enabled and plan_result.subtasks:
        try:
            plan_run_id = store.insert_plan(
                session_id=body.session_id or "default",
                user_msg=body.user_input,
                intent_category=plan_cat,
                plan_result=plan_result,
            )
            api_trace["plan_run_id"] = plan_run_id
        except Exception as exc:
            logging.getLogger("glasscortex.api.chat").warning(
                "Plan storage failed, continuing pipeline: %s", exc
            )

    response = ChatResponse(
        response_text=response_text,
        episode_id=episode_id,
        intent=intent_result,
        context_meta=ContextMeta(**context_meta),
        api_trace=ApiTrace(**api_trace),
        recall_items=recall_items,
        system_prompt=context_meta.get("system_prompt") if body.include_system_prompt else None,
        routing=routing_info,
        cold_start_profile=cold_start_profile,
        from_cache=False,
        cache_hit_score=None,
    )

    # ── 步骤 5：存储到语义响应缓存（Phase 62）──
    if _cfg.response_cache_enabled and _semantic_cache is not None:
        try:
            _semantic_cache.store(
                body.user_input,
                {
                    "response_text": response_text,
                    "episode_id": episode_id,
                    "context_meta": context_meta,
                    "api_trace": api_trace,
                    "recall_items": [item.model_dump() for item in recall_items],
                    "intent": intent_result.model_dump() if intent_result else None,
                    "system_prompt": (
                        context_meta.get("system_prompt") if body.include_system_prompt else None
                    ),
                    "routing": routing_info.model_dump() if routing_info else None,
                    "cold_start_profile": (
                        cold_start_profile.model_dump() if cold_start_profile else None
                    ),
                },
            )
        except Exception as exc:
            logging.getLogger("glasscortex.api.chat").warning(
                "Semantic cache store failed: %s", exc
            )

    return response


def _compute_cold_start_profile(store: Any) -> ColdStartProfile | None:
    """检测记忆系统冷启动状态并生成自感知画像（q2.19）。

    四个阶段：
    - cold (0-10 条):   系统几乎不了解用户，回应纯靠 LLM 知识
    - warming (10-50):   已有初步记忆，部分查询能命中
    - near_hot (50-200): 多数查询有记忆加持，画像趋于稳定
    - hot (200+):        记忆系统成熟，召回精准，画像饱满

    返回 None 表示 store 不可用（冷启动检测非致命——不阻塞聊天管线）。
    """
    try:
        count: int = store.get_total_episode_count()
        if not isinstance(count, int):
            return None

        if count <= 10:
            phase = "cold"
            phase_label = "极冷"
            hint = "我是全新账号——还没关于你的任何记忆，回复完全基于通用知识"
        elif count <= 50:
            phase = "warming"
            phase_label = "温启动"
            hint = f"已积累 {count} 条对话片段——开始形成初步画像，部分查询能命中记忆"
        elif count <= 200:
            phase = "near_hot"
            phase_label = "接近热"
            hint = f"已积累 {count} 条对话片段——记忆覆盖多个话题，画像趋于稳定"
        else:
            phase = "hot"
            phase_label = "热"
            hint = f"已积累 {count} 条对话片段——记忆系统成熟，召回精准，个性化明显"

        progression_pct = min(count / 200 * 100, 100.0)

        return ColdStartProfile(
            episode_count=count,
            phase=phase,
            phase_label=phase_label,
            progression_pct=round(progression_pct, 1),
            hint=hint,
        )
    except Exception:
        return None
