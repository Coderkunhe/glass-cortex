"""记忆端点——读取 episode/事实、触发召回/遗忘。"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from api.dependencies import EnginesDep
from api.schemas import (
    DecayDelta,
    DecayRequest,
    DecayResponse,
    EpisodeRecallItem,
    FactConfidenceUpdateRequest,
    FactConfidenceUpdateResponse,
    FactRecallItem,
    RecallItem,
    RecallRequest,
    RecallResponse,
    TagDetailResponse,
    TierDistributionResponse,
)

router = APIRouter(prefix="/memory", tags=["memory"])


@router.get("/episodes")
def list_episodes(
    engines: Any = EnginesDep,
    limit: int = Query(50, ge=1, le=500, description="Max episodes to return"),
    since: float | None = Query(None, description="Unix timestamp — only episodes after this time"),
) -> list[dict[str, Any]]:
    """返回所有 episode，按时间倒序。可选 Unix 时间戳过滤。"""
    store, *_rest = engines

    if since is not None:
        episodes = store.get_episodes_since(since)
    else:
        episodes = store.get_all_episodes()

    return [dict(e) for e in episodes[:limit]]


@router.get("/facts")
def list_facts(
    engines: Any = EnginesDep,
    limit: int = Query(50, ge=1, le=500, description="Max facts to return"),
    subject: str | None = Query(None, description="Filter by fact subject"),
) -> list[dict[str, Any]]:
    """返回所有事实，按时间倒序。可选按主体过滤。"""
    store, *_rest = engines

    if subject is not None:
        facts = store.get_facts_by_subject(subject)
    else:
        facts = store.get_all_facts()

    return [dict(f) for f in facts[:limit]]


@router.get("/tag-summary")
def tag_summary(
    engines: Any = EnginesDep,
    limit: int = Query(8, ge=1, le=50, description="Max tag groups to return"),
) -> list[dict[str, Any]]:
    """返回标签云数据——按 (subject, relation) 聚合事实标签，含置信度和统计量。"""
    store, *_rest = engines
    tags = store.get_predicate_tag_summary(limit=limit)
    return [dict(t) for t in tags]


@router.get("/tag-detail", response_model=TagDetailResponse)
def tag_detail(
    engines: Any = EnginesDep,
    subject: str = Query(..., min_length=1, description="事实主体，如 '用户'"),
    relation: str = Query(..., min_length=1, description="事实关系，如 '喜欢'"),
) -> TagDetailResponse:
    """返回标签的完整来源追溯——关联事实 + 原始对话 + 置信度变更日志。

    用于标签云中点击单个标签后展示的抽屉面板。
    """
    store, *_rest = engines
    result = store.get_tag_detail(subject, relation)
    return TagDetailResponse(**result)


@router.get("/tiers", response_model=TierDistributionResponse)
def get_tiers(engines: Any = EnginesDep) -> TierDistributionResponse:
    """返回记忆分级分布——hot/warm/cold 三层统计 + 每层 episode 摘要。

    使用 TierClassifier 实时重算所有 episode 的热力评分和分级。
    当 tier_enabled=False 时返回全空分布（前端据此隐藏过滤 UI）。
    """
    from src.config import settings as app_settings
    from src.memory.tier import TierClassifier

    store, *_rest = engines

    # 未启用分级 → 返回空结果
    if not app_settings.tier_enabled:
        return TierDistributionResponse(
            distribution={"hot": 0, "warm": 0, "cold": 0},
            episodes_by_tier={"hot": [], "warm": [], "cold": []},
            config={"tier_enabled": False},
            tier_enabled=False,
        )

    episodes = store.get_all_episodes()
    classifier = TierClassifier(app_settings)
    results = classifier.classify_batch(episodes)

    distribution_raw = classifier.get_tier_distribution(results)
    distribution: dict[str, int] = {k.value: v for k, v in distribution_raw.items()}

    episodes_by_tier: dict[str, list[int]] = {"hot": [], "warm": [], "cold": []}
    for r in results:
        episodes_by_tier[r.tier.value].append(r.episode_id)

    config: dict[str, object] = {
        "tier_enabled": app_settings.tier_enabled,
        "tier_hot_threshold": app_settings.tier_hot_threshold,
        "tier_warm_threshold": app_settings.tier_warm_threshold,
        "tier_recency_weight": app_settings.tier_recency_weight,
        "tier_access_weight": app_settings.tier_access_weight,
        "tier_importance_weight": app_settings.tier_importance_weight,
    }

    return TierDistributionResponse(
        distribution=distribution,
        episodes_by_tier=episodes_by_tier,
        config=config,
        tier_enabled=True,
    )


@router.post("/recall", response_model=RecallResponse)
def recall_memories(
    body: RecallRequest,
    engines: Any = EnginesDep,
) -> RecallResponse:
    """语义记忆召回——查找与查询相关的记忆。"""
    _store, _idx, recall, _forget, _chat, _ledger, _planner = engines

    try:
        items = recall.recall(
            query=body.query,
            top_k=body.top_k,
            threshold=body.threshold,
            strengthen=body.strengthen,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Recall failed: {exc}") from exc

    _recall_items: list[RecallItem] = []
    for item in items:
        if item.get("_row_type") == "fact":
            _recall_items.append(FactRecallItem.model_validate(item))
        else:
            _recall_items.append(EpisodeRecallItem.model_validate(item))
    return RecallResponse(
        query=body.query,
        items=_recall_items,
        count=len(_recall_items),
    )


@router.post("/decay", response_model=DecayResponse)
def trigger_decay(
    body: DecayRequest = DecayRequest(),  # type: ignore[call-arg]  # noqa: B008
    engines: Any = EnginesDep,
) -> DecayResponse:
    """触发全局艾宾浩斯遗忘衰减——对所有 episode 执行一次衰减。

    可选覆盖本次衰减的 lambda 参数，返回 (episode_id, old_strength, new_strength) 变化列表。
    """
    _store, _idx, _recall, forget, *_rest = engines
    deltas_raw = forget.decay_all(lambda_override=body.lambda_override)
    deltas = [
        DecayDelta(id=eid, old_strength=old, new_strength=new) for eid, old, new in deltas_raw
    ]
    return DecayResponse(items_decayed=len(deltas), deltas=deltas)


@router.post(
    "/facts/{fact_id}/confidence",
    response_model=FactConfidenceUpdateResponse,
)
def update_fact_confidence(
    fact_id: int,
    body: FactConfidenceUpdateRequest,
    engines: Any = EnginesDep,
) -> FactConfidenceUpdateResponse:
    """用户纠正或加星事实——调整置信度并记录变更日志。

    delta > 0 = 加星（用户确认），delta < 0 = 纠正（用户认为有误）。
    变更前/后置信度自动记录到 fact_confidence_log 审计表。
    """
    store, *_rest = engines

    # 更新置信度（store 层完成读→写→读闭环，返回 None 表示 fact 不存在）
    result = store.update_fact_confidence(fact_id, body.delta)
    if result is None:
        raise HTTPException(status_code=404, detail=f"事实 {fact_id} 不存在")

    confidence_before, confidence_after = result

    # 记录审计日志
    logged_at = time.time()
    store.log_fact_confidence(
        fact_id,
        confidence_before=confidence_before,
        confidence_after=confidence_after,
        reason=body.reason,
    )

    return FactConfidenceUpdateResponse(
        fact_id=fact_id,
        confidence_before=confidence_before,
        confidence_after=confidence_after,
        reason=body.reason,
        logged_at=logged_at,
    )
