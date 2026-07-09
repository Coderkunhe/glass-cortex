"""Lab 实验与分析端点——缓存统计、嵌入可视化、衰减分布、知识图谱、A/B 实验、策略人格、成本瀑布。

所有 GET 端点均为只读可观测性视图，零副作用。
POST /experiment-run 会创建临时隔离数据目录运行实验管线。
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, cast

import numpy as np
from fastapi import APIRouter, HTTPException

from api.dependencies import EnginesDep
from api.schemas import (
    CacheEntriesResponse,
    CacheEntryItem,
    CacheStats,
    CacheStatsResponse,
    CostWaterfallResponse,
    CostWaterfallStep,
    DecayBin,
    DecayDistributionResponse,
    EmbeddingCoord,
    EmbeddingCoordsResponse,
    ExperimentDiffSchema,
    ExperimentPreset,
    ExperimentPresetsResponse,
    ExperimentResultSchema,
    ExperimentRunRequest,
    ExperimentRunResponse,
    GraphEdge,
    GraphNode,
    KnowledgeGraphResponse,
    StrategyPersona,
    StrategyPersonasResponse,
)

router = APIRouter(prefix="/lab", tags=["lab"])


# ── Helpers ───────────────────────────────────────────────────────────────


def _call_point_label(cp: str) -> str:
    """Map internal call_point names to Chinese display labels (B95 E3)."""
    labels: dict[str, str] = {
        "chat": "聊天 LLM",
        "fact_extraction": "事实抽取",
        "compression": "消息压缩",
        "cache_hit": "缓存命中",
        "compression_savings": "压缩节省",
        "reflection": "反思",
        "classify": "意图分类",
    }
    return labels.get(cp, cp)


def _compute_summary(records: list[object]) -> dict[str, dict[str, int]]:
    """Build a summary dict from a list of TokenUsage records (B95 E4 prep).

    Extracted from TokenLedger.summary() so time-filtered records
    can reuse the same grouping logic without touching private state.
    """
    groups: dict[str, dict[str, int]] = {}
    for r in records:
        cp: str = getattr(r, "call_point", "unknown")
        pt: int = getattr(r, "prompt_tokens", 0)
        ct: int = getattr(r, "completion_tokens", 0)
        if cp not in groups:
            groups[cp] = {
                "count": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            }
        g = groups[cp]
        g["count"] += 1
        g["prompt_tokens"] += pt
        g["completion_tokens"] += ct
        g["total_tokens"] += pt + ct

    total = {
        "count": sum(g["count"] for g in groups.values()),
        "prompt_tokens": sum(g["prompt_tokens"] for g in groups.values()),
        "completion_tokens": sum(g["completion_tokens"] for g in groups.values()),
        "total_tokens": sum(g["total_tokens"] for g in groups.values()),
    }
    groups["total"] = total
    return groups


def _build_call_point_response(
    raw: dict[str, dict[str, int]],
    gross_llm: int,
    cache_savings: int,
    compression_savings: int,
    net: int,
) -> CostWaterfallResponse:
    """Build per-call_point waterfall response (B95 E3)."""
    color_palette = [
        "#6366f1",  # indigo-500
        "#22c55e",  # green-500
        "#f59e0b",  # amber-500
        "#ef4444",  # red-500
        "#8b5cf6",  # violet-500
        "#06b6d4",  # cyan-500
        "#ec4899",  # pink-500
    ]

    steps: list[CostWaterfallStep] = []
    color_idx = 0
    for cp_name, group in raw.items():
        if cp_name in ("total",):
            continue
        if group["total_tokens"] == 0:
            continue
        steps.append(
            CostWaterfallStep(
                label=_call_point_label(cp_name),
                tokens=group["total_tokens"],
                kind="call_point",
                color=color_palette[color_idx % len(color_palette)],
            )
        )
        color_idx += 1

    # Net total at bottom
    steps.append(
        CostWaterfallStep(
            label="净消耗",
            tokens=net,
            kind="net",
            color="#0f172a",
        )
    )

    return CostWaterfallResponse(
        steps=steps,
        gross_tokens=gross_llm,
        cache_savings=cache_savings,
        compression_savings=compression_savings,
        net_tokens=net,
    )


# ── 辅助函数 ──────────────────────────────────────────────────────────


def _cache_stats(hits: int, misses: int, size: int) -> CacheStats:
    """从原始计数器计算缓存统计，safe 除零。"""
    total = hits + misses
    hit_rate = (hits / total * 100) if total > 0 else 0.0
    return CacheStats(
        hits=hits,
        misses=misses,
        size=size,
        total_requests=total,
        hit_rate_pct=round(hit_rate, 1),
    )


# ── 端点 ───────────────────────────────────────────────────────────────


@router.get("/cache-stats", response_model=CacheStatsResponse)
def cache_stats(engines: Any = EnginesDep) -> CacheStatsResponse:
    """返回嵌入缓存和事实缓存的命中率统计。"""
    from src.embed import get_embedding_cache

    _store, _idx, _recall, _forget, chat, _ledger, _planner = engines

    emb = get_embedding_cache()
    embedding_stats = _cache_stats(emb.hits, emb.misses, emb.size)

    fact_extractor = chat.fact_extractor
    fact_stats: CacheStats | None = None
    if fact_extractor is not None:
        fc = fact_extractor.cache
        fact_stats = _cache_stats(fc.hits, fc.misses, fc.size)

    return CacheStatsResponse(embedding=embedding_stats, fact=fact_stats)


_VALID_CACHE_TYPES = {"embedding", "fact", "response"}


@router.get("/cache-entries", response_model=CacheEntriesResponse)
def cache_entries(
    engines: Any = EnginesDep,
    cache_type: str = "embedding",
    limit: int = 50,
) -> CacheEntriesResponse:
    """返回指定缓存的实际条目内容。

    ``cache_type`` 可选 ``embedding`` / ``fact`` / ``response``。
    ``limit`` 控制最大返回条数（1-200），默认 50。
    """
    from src.cache.semantic_cache import get_response_cache
    from src.embed import get_embedding_cache

    if cache_type not in _VALID_CACHE_TYPES:
        valid = sorted(_VALID_CACHE_TYPES)
        raise HTTPException(
            status_code=400,
            detail=f"Invalid cache_type: {cache_type!r}. Must be one of {valid}",
        )

    limit = max(1, min(limit, 200))
    _store, _idx, _recall, _forget, chat, _ledger, _planner = engines

    if cache_type == "embedding":
        emb = get_embedding_cache()
        entries_raw = emb.list_entries(limit)
        stats = _cache_stats(emb.hits, emb.misses, emb.size)
    elif cache_type == "fact":
        fact_extractor = chat.fact_extractor
        if fact_extractor is None:
            # 语义修正：FactExtractor 未加载 → 空缓存，不是 404。
            # 前端 DataState 的 empty state 会展示"该缓存当前为空"提示。
            return CacheEntriesResponse(
                cache_type="fact",
                entries=[],
                total_entries=0,
                hits=0,
                misses=0,
                hit_rate_pct=0.0,
            )
        fc = fact_extractor.cache
        entries_raw = fc.list_entries(limit)
        stats = _cache_stats(fc.hits, fc.misses, fc.size)
    else:  # response
        resp_cache = get_response_cache()
        entries_raw = resp_cache.list_entries(limit)
        stats = _cache_stats(resp_cache.hits, resp_cache.misses, resp_cache.size)

    entries = [
        CacheEntryItem(
            key=str(e.get("key", "")),
            preview=str(e.get("preview", "")),
            tokens_est=int(e.get("tokens_est", 0)),  # type: ignore[call-overload]  # int() overload expects str|bytes|SupportsInt; dict.get default is int 0
            kind=str(e.get("kind", cache_type)),
        )
        for e in entries_raw
    ]

    return CacheEntriesResponse(
        cache_type=cache_type,
        entries=entries,
        total_entries=stats.size,
        hits=stats.hits,
        misses=stats.misses,
        hit_rate_pct=stats.hit_rate_pct,
    )


@router.get("/embedding-coords", response_model=EmbeddingCoordsResponse)
def embedding_coords(
    engines: Any = EnginesDep,
    max_vectors: int = 500,
) -> EmbeddingCoordsResponse:
    """对所有存储向量做 PCA 降维，返回 3D 坐标用于可视化。

    max_vectors 限制采样数量（1-2000），默认 500。
    """
    from src.visualize.embedding_viz import pca_reduce

    _store, idx, _recall, _forget, _chat, _ledger, _planner = engines

    max_vectors = max(1, min(max_vectors, 2000))
    n_total = idx.index.size
    if n_total == 0:
        return EmbeddingCoordsResponse(coords=[], total_vectors=0, pca_variance_explained=[])

    # 采样：均匀间隔 + 不超过 max_vectors
    step = max(1, n_total // max_vectors)
    sampled_ids = list(range(0, n_total, step))[:max_vectors]
    vectors = [idx.reconstruct(fid) for fid in sampled_ids]
    vec_array = np.array(vectors, dtype=np.float32)

    # 获取标签（通过 SQLite 关联 faiss_id → content）
    # 先构建 faiss_id → (content, kind) 映射
    episodes = _store.get_all_episodes()
    facts = _store.get_all_facts()
    id_to_meta: dict[int, dict[str, str]] = {}
    for ep in episodes:
        fid = ep.get("faiss_id")
        if fid is not None:
            content = str(ep.get("content", ""))
            id_to_meta[int(fid)] = {
                "label": content[:60],
                "kind": "episode",
                "color": "#4f6ef7",
            }
    for f in facts:
        fid = f.get("faiss_id")
        if fid is not None:
            content = str(f.get("content", ""))
            id_to_meta[int(fid)] = {
                "label": content[:60],
                "kind": "fact",
                "color": "#e53e3e",
            }

    # PCA 降维（需要至少 n_components+1 个样本才稳定）
    n_comp = min(3, len(vec_array) - 1) if len(vec_array) > 1 else len(vec_array)
    if n_comp < 1:
        return EmbeddingCoordsResponse(coords=[], total_vectors=n_total, pca_variance_explained=[])

    result = pca_reduce(vec_array, n_components=n_comp, return_variance=True)
    if isinstance(result, tuple):
        coords_3d, variance = result
    else:
        coords_3d, variance = result, []
    coords: list[EmbeddingCoord] = []
    for i, fid in enumerate(sampled_ids):
        meta = id_to_meta.get(fid, {"label": f"id:{fid}", "kind": "unknown", "color": "#718096"})
        coords.append(
            EmbeddingCoord(
                id=fid,
                x=round(float(coords_3d[i, 0]), 4),
                y=round(float(coords_3d[i, 1]), 4),
                z=round(float(coords_3d[i, 2]), 4) if coords_3d.shape[1] > 2 else 0.0,
                label=meta["label"],
                kind=meta["kind"],
                color=meta["color"],
            )
        )

    return EmbeddingCoordsResponse(
        coords=coords,
        total_vectors=n_total,
        pca_variance_explained=[round(float(v), 4) for v in variance],
    )


@router.get("/memory-decay-distribution", response_model=DecayDistributionResponse)
def memory_decay_distribution(
    engines: Any = EnginesDep,
) -> DecayDistributionResponse:
    """返回所有 memory episode 的强度 Ebbinghaus 分布。

    将强度 [0, 1] 分为 10 个桶，用于绘制衰减直方图。
    """
    _store, _idx, _recall, forget, _chat, _ledger, _planner = engines

    episodes = _store.get_all_episodes()
    if not episodes:
        return DecayDistributionResponse(bins=[], total_episodes=0, decay_lambda=0.1)

    # 计算当前强度
    strengths: list[float] = []
    from src.config import settings

    decay_lambda = settings.default_decay_lambda
    for ep in episodes:
        try:
            s = forget.current_strength(ep)
            strengths.append(s)
        except Exception:
            strengths.append(0.0)

    # 10 个桶：[0, 0.1), [0.1, 0.2), ..., [0.9, 1.0]
    bins: list[DecayBin] = []
    for i in range(10):
        lo = i * 0.1
        hi = lo + 0.1
        in_bin = [s for s in strengths if lo <= s < hi]
        # 最后一个桶包含 1.0
        if i == 9:
            in_bin = [s for s in strengths if lo <= s <= 1.0]
        avg = float(np.mean(in_bin)) if in_bin else 0.0
        bins.append(
            DecayBin(
                bin_label=f"{lo:.1f}-{hi:.1f}",
                count=len(in_bin),
                avg_strength=round(avg, 4),
            )
        )

    return DecayDistributionResponse(
        bins=bins,
        total_episodes=len(episodes),
        decay_lambda=decay_lambda,
    )


@router.get("/knowledge-graph", response_model=KnowledgeGraphResponse)
def knowledge_graph(
    engines: Any = EnginesDep,
) -> KnowledgeGraphResponse:
    """从 Fact 层构建知识图谱——节点（subject/object）+ 边（relation）。

    对所有 fact 做实体归一化去重，节点大小由关联 fact 数量决定。
    """
    _store, _idx, _recall, _forget, _chat, _ledger, _planner = engines

    facts = _store.get_all_facts()
    if not facts:
        return KnowledgeGraphResponse(nodes=[], edges=[], total_facts=0)

    # 聚合节点和边
    node_weights: dict[str, int] = {}
    node_groups: dict[str, str] = {}
    edges: list[GraphEdge] = []

    for f in facts:
        subject = str(f.get("subject") or "").strip()
        relation = str(f.get("relation") or "").strip()
        obj = str(f.get("object") or "").strip()
        confidence = float(f.get("confidence", 0.5))

        # 实体归一化（空值用占位符）
        subj_key = subject if subject else f"_(entity)_{f.get('id')}"
        obj_key = obj if obj else f"_(entity)_{f.get('id')}"

        # 节点权重（去重计数）
        node_weights[subj_key] = node_weights.get(subj_key, 0) + 1
        node_weights[obj_key] = node_weights.get(obj_key, 0) + 1
        node_groups[subj_key] = "subject"
        node_groups[obj_key] = "object"

        edges.append(
            GraphEdge(
                source=subj_key,
                target=obj_key,
                label=relation if relation else "关联",
                confidence=round(confidence, 3),
            )
        )

    # 转为节点列表
    nodes: list[GraphNode] = []
    for node_id, weight in node_weights.items():
        # label 优先用 subject/object 值，截断显示
        label = node_id if not node_id.startswith("_(") else node_id[:40]
        nodes.append(
            GraphNode(
                id=node_id,
                label=label[:60],
                group=node_groups.get(node_id, "unknown"),
                weight=weight,
            )
        )

    return KnowledgeGraphResponse(nodes=nodes, edges=edges, total_facts=len(facts))


# ── A/B 实验 ─────────────────────────────────────────────────────────────


@router.get("/experiment-presets", response_model=ExperimentPresetsResponse)
def experiment_presets() -> ExperimentPresetsResponse:
    """返回所有可用的 A/B 实验预设——预定义的参数对比方案。

    零引擎依赖，纯数据端点。
    """
    from src.experiment import EXPERIMENT_PRESETS

    descriptions: dict[str, str] = {
        "recall_top_k_3_vs_7": "对比 top_k 参数对召回数量和质量的影响——保守 vs 激进",
        "boost_0.1_vs_0.5": "对比召回强度增强系数对记忆巩固速度的影响——慢增强 vs 快增强",
        "threshold_0.05_vs_0.3": "对比召回相关性阈值对结果精度的影响——宽松 vs 严格",
        "search_k_10_vs_40": "对比 FAISS 搜索广度对召回多样性的影响——近邻 vs 远邻",
    }

    presets: list[ExperimentPreset] = []
    for preset_id, preset_data in EXPERIMENT_PRESETS.items():
        presets.append(
            ExperimentPreset(
                id=preset_id,
                label_a=str(preset_data["label_a"]),
                label_b=str(preset_data["label_b"]),
                settings_a=cast(dict[str, object], preset_data["settings_a"]),
                settings_b=cast(dict[str, object], preset_data["settings_b"]),
                description=descriptions.get(
                    preset_id,
                    f"对比 {preset_data['label_a']} vs {preset_data['label_b']}",
                ),
            )
        )

    return ExperimentPresetsResponse(presets=presets)


@router.post("/experiment-run", response_model=ExperimentRunResponse)
def experiment_run(
    body: ExperimentRunRequest,
    engines: Any = EnginesDep,
) -> ExperimentRunResponse:
    """运行 A/B 实验——同一输入在两套 Settings 下各跑一次完整管线。

    支持 preset_id 引用预设，或自定义 settings_a/settings_b。
    实验在隔离临时目录中运行，互不污染。
    """
    from src.experiment import (
        EXPERIMENT_PRESETS,
        ExperimentRunner,
        _build_settings,
        compare_results,
    )

    # 解析参数：preset 优先，自定义覆盖
    settings_a_dict: dict[str, object]
    settings_b_dict: dict[str, object]
    if body.preset_id:
        preset = EXPERIMENT_PRESETS.get(body.preset_id)
        if preset is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Unknown preset: {body.preset_id}. "
                    f"Available: {list(EXPERIMENT_PRESETS.keys())}"
                ),
            )
        settings_a_dict = cast(dict[str, object], preset["settings_a"])
        settings_b_dict = cast(dict[str, object], preset["settings_b"])
        label_a = body.label_a or str(preset["label_a"])
        label_b = body.label_b or str(preset["label_b"])
    else:
        if not body.settings_a or not body.settings_b:
            raise HTTPException(
                status_code=400,
                detail="Must provide preset_id or both settings_a and settings_b",
            )
        settings_a_dict = {str(k): v for k, v in body.settings_a.items()}
        settings_b_dict = {str(k): v for k, v in body.settings_b.items()}
        label_a = body.label_a or "A"
        label_b = body.label_b or "B"

    settings_a = _build_settings(settings_a_dict)
    settings_b = _build_settings(settings_b_dict)

    t0 = time.monotonic()
    runner = ExperimentRunner()
    try:
        result_a, result_b = runner.run(
            user_input=body.user_input,
            settings_a=settings_a,
            settings_b=settings_b,
            label_a=label_a,
            label_b=label_b,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Experiment run failed: {exc}",
        ) from exc

    elapsed_ms = (time.monotonic() - t0) * 1000

    diffs = compare_results(result_a, result_b)

    # 将 dataclass 转为 Pydantic schema
    def _result_to_schema(r: Any) -> ExperimentResultSchema:
        return ExperimentResultSchema(
            label=r.label,
            settings=_settings_to_dict(r.settings),
            recalled_count=r.recalled_count,
            response_text=r.response_text,
            response_length=r.response_length,
            chat_prompt_tokens=r.chat_prompt_tokens,
            chat_completion_tokens=r.chat_completion_tokens,
            chat_total_tokens=r.chat_total_tokens,
            fact_prompt_tokens=r.fact_prompt_tokens,
            fact_completion_tokens=r.fact_completion_tokens,
            fact_total_tokens=r.fact_total_tokens,
            facts_extracted=r.facts_extracted,
            fact_contents=r.fact_contents,
            db_path=r.db_path,
        )

    diff_schemas = [
        ExperimentDiffSchema(
            dimension=d.dimension,
            label_a=d.label_a,
            label_b=d.label_b,
            value_a=d.value_a,
            value_b=d.value_b,
            delta=d.delta,
            direction=d.direction,
            detail=d.detail,
        )
        for d in diffs
    ]

    return ExperimentRunResponse(
        result_a=_result_to_schema(result_a),
        result_b=_result_to_schema(result_b),
        diffs=diff_schemas,
        elapsed_ms=round(elapsed_ms, 1),
    )


def _settings_to_dict(settings: Any) -> dict[str, object]:
    """将 Settings 实例转为可 JSON 序列化的 dict。"""
    result: dict[str, object] = {}
    for key, value in vars(settings).items():
        if isinstance(value, (str, int, float, bool, type(None))):
            result[key] = value
        elif isinstance(value, Path):
            result[key] = str(value)
        else:
            result[key] = str(value)
    return result


# ── 策略人格 ─────────────────────────────────────────────────────────────


@router.get("/strategy-personas", response_model=StrategyPersonasResponse)
def strategy_personas() -> StrategyPersonasResponse:
    """返回三种上下文溢出策略的人格描述——守门员/策展人/口述史家。

    零引擎依赖，纯数据端点。
    """
    from src.context.overflow_sim import STRATEGY_PERSONAS

    personas: list[StrategyPersona] = []
    for persona_id, persona_data in STRATEGY_PERSONAS.items():
        personas.append(
            StrategyPersona(
                id=persona_id,
                name=str(persona_data["name"]),
                subtitle=str(persona_data["subtitle"]),
                icon=str(persona_data["icon"]),
                description=str(persona_data["description"]),
                color=str(persona_data["color"]),
            )
        )

    return StrategyPersonasResponse(personas=personas)


@router.get("/cost-waterfall", response_model=CostWaterfallResponse)
def cost_waterfall(
    engines: Any = EnginesDep,
    by: str | None = None,
    since: float | None = None,
    until: float | None = None,
) -> CostWaterfallResponse:
    """返回 Token 消耗瀑布流——从原始 LLM 调用总额到净消耗的逐步拆解。

    数据来源于内存中的 TokenLedger（会话级别），服务器重启后清空。
    瀑布结构：LLM 调用总额 → 扣除缓存节省 → 扣除压缩节省 → 净消耗。

    Query params:
    - by: "call_point" 切换为按调用点分组视图（B95 E3）
    - since / until: epoch 秒时间范围过滤（B96 E4 prep，后端已就绪）
    """
    _store, _idx, _recall, _forget, _chat, ledger, _planner = engines

    # E4 prep: 时间范围过滤（前端尚未接入，后端先就绪）
    if since is not None or until is not None:
        filtered = [
            r
            for r in ledger._records
            if (since is None or r.timestamp >= since) and (until is None or r.timestamp <= until)
        ]
        raw = _compute_summary(filtered)
    else:
        raw = ledger.summary()

    total = raw.get("total", {})
    gross_llm = total.get("total_tokens", 0)
    cache_savings = raw.get("cache_hit", {}).get("prompt_tokens", 0)
    compression_savings = raw.get("compression_savings", {}).get("prompt_tokens", 0)
    net = gross_llm - cache_savings - compression_savings

    # E3: 按调用点分组视图
    if by == "call_point":
        return _build_call_point_response(raw, gross_llm, cache_savings, compression_savings, net)

    # 默认：瀑布流视图
    steps: list[CostWaterfallStep] = []

    steps.append(
        CostWaterfallStep(
            label="LLM 调用总额",
            tokens=gross_llm,
            kind="gross",
            color="#6366f1",  # indigo-500
        )
    )

    if cache_savings > 0:
        steps.append(
            CostWaterfallStep(
                label="缓存命中节省",
                tokens=cache_savings,
                kind="savings",
                color="#22c55e",  # green-500
            )
        )

    if compression_savings > 0:
        steps.append(
            CostWaterfallStep(
                label="消息压缩节省",
                tokens=compression_savings,
                kind="savings",
                color="#f59e0b",  # amber-500
            )
        )

    steps.append(
        CostWaterfallStep(
            label="净消耗",
            tokens=net,
            kind="net",
            color="#0f172a",  # slate-900
        )
    )

    return CostWaterfallResponse(
        steps=steps,
        gross_tokens=gross_llm,
        cache_savings=cache_savings,
        compression_savings=compression_savings,
        net_tokens=net,
    )
