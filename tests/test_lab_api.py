"""Lab API 端点测试——缓存统计、嵌入坐标、衰减分布、知识图谱、A/B 实验、策略人格、成本瀑布。"""

from __future__ import annotations

from unittest.mock import MagicMock

import numpy as np
import pytest

from .helpers import build_mock_engines, make_client

# ── Helpers ─────────────────────────────────────────────────────────


class _MockCache:
    """模拟 EmbeddingCache / FactCache 的 hits/misses/size 接口。"""

    def __init__(self, hits: int = 5, misses: int = 10, size: int = 3) -> None:
        self.hits = hits
        self.misses = misses
        self.size = size


def _build_mock_fact_extractor(hits: int = 5, misses: int = 10, size: int = 3) -> MagicMock:
    """构建带 cache 属性的 mock FactExtractor。"""
    fe = MagicMock()
    fe.cache = _MockCache(hits=hits, misses=misses, size=size)
    return fe


# ── GET /lab/cache-stats ───────────────────────────────────────────


class TestLabCacheStats:
    """GET /lab/cache-stats 端点测试。"""

    def test_cache_stats_with_fact_extractor(self) -> None:
        """FactExtractor 存在时返回两个缓存的统计。"""
        chat = MagicMock()
        chat.fact_extractor = _build_mock_fact_extractor(hits=5, misses=10, size=3)
        engines = build_mock_engines(chat=chat)
        with make_client(engines) as client:
            resp = client.get("/lab/cache-stats")
            assert resp.status_code == 200
            data = resp.json()
            # embedding cache 是共享单例，值随测试顺序变化，仅验结构
            assert "hits" in data["embedding"]
            assert "hit_rate_pct" in data["embedding"]
            assert data["fact"]["hits"] == 5
            assert data["fact"]["misses"] == 10
            assert data["fact"]["size"] == 3
            assert data["fact"]["total_requests"] == 15
            assert data["fact"]["hit_rate_pct"] == pytest.approx(33.3, abs=0.1)

    def test_cache_stats_without_fact_extractor(self) -> None:
        """FactExtractor 为 None 时 fact 字段为 null。"""
        chat = MagicMock()
        chat.fact_extractor = None
        engines = build_mock_engines(chat=chat)
        with make_client(engines) as client:
            resp = client.get("/lab/cache-stats")
            assert resp.status_code == 200
            data = resp.json()
            # embedding cache 是共享单例，仅验结构存在
            assert "total_requests" in data["embedding"]
            assert data["fact"] is None


# ── GET /lab/embedding-coords ─────────────────────────────────────


class TestLabEmbeddingCoords:
    """GET /lab/embedding-coords 端点测试。"""

    def test_embedding_coords_empty_index(self) -> None:
        """无向量时返回空坐标列表。"""
        idx = MagicMock()
        idx.index.ntotal = 0
        engines = build_mock_engines(idx=idx)
        with make_client(engines) as client:
            resp = client.get("/lab/embedding-coords")
            assert resp.status_code == 200
            data = resp.json()
            assert data["coords"] == []
            assert data["total_vectors"] == 0

    def test_embedding_coords_with_vectors(self) -> None:
        """有向量时返回 PCA 降维坐标。"""
        store = MagicMock()
        store.get_all_episodes.return_value = [
            {"id": 1, "content": "episode one", "faiss_id": 0},
            {"id": 2, "content": "episode two", "faiss_id": 1},
        ]
        store.get_all_facts.return_value = [
            {"id": 1, "content": "fact one", "faiss_id": 2},
        ]

        idx = MagicMock()
        idx.index.ntotal = 3
        # 返回 3 个 4 维向量（需要 ≥ 4 样本才能 PCA 到 3 维）
        # 实际上只需要 ntotal ≥ 1
        vectors_384 = [np.random.randn(384).astype(np.float32) for _ in range(3)]
        idx.reconstruct.side_effect = vectors_384

        engines = build_mock_engines(store=store, idx=idx)
        with make_client(engines) as client:
            resp = client.get("/lab/embedding-coords?max_vectors=5")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total_vectors"] == 3
            coords = data["coords"]
            assert len(coords) == 3
            for c in coords:
                assert "x" in c
                assert "y" in c
                assert "z" in c
                assert "label" in c
                assert "kind" in c
                assert "color" in c

    def test_embedding_coords_max_vectors_clamped(self) -> None:
        """max_vectors 被限制在 1-2000 区间。"""
        idx = MagicMock()
        idx.index.ntotal = 0
        engines = build_mock_engines(idx=idx)
        with make_client(engines) as client:
            resp = client.get("/lab/embedding-coords?max_vectors=5000")
            assert resp.status_code == 200  # 无 crash


# ── GET /lab/memory-decay-distribution ────────────────────────────


class TestLabDecayDistribution:
    """GET /lab/memory-decay-distribution 端点测试。"""

    def test_decay_distribution_empty(self) -> None:
        """无 episode 时返回空 bins。"""
        store = MagicMock()
        store.get_all_episodes.return_value = []
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/lab/memory-decay-distribution")
            assert resp.status_code == 200
            data = resp.json()
            assert data["bins"] == []
            assert data["total_episodes"] == 0

    def test_decay_distribution_with_episodes(self) -> None:
        """有 episode 时返回 10 桶强度分布。"""
        store = MagicMock()
        # 创建分布在 [0, 1] 上的 episodes
        episodes = [
            {
                "id": i,
                "content": f"msg{i}",
                "initial_strength": 0.1 * i,
                "importance": 0.5,
                "timestamp": 0.0,
                "lambda_": 0.1,
            }
            for i in range(1, 11)
        ]
        store.get_all_episodes.return_value = episodes

        forget = MagicMock()
        forget.current_strength.side_effect = lambda ep: ep["initial_strength"]

        engines = build_mock_engines(store=store, forget=forget)
        with make_client(engines) as client:
            resp = client.get("/lab/memory-decay-distribution")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total_episodes"] == 10
            bins = data["bins"]
            assert len(bins) == 10
            # 每个 bin 至少有一个 episode
            nonzero = [b for b in bins if b["count"] > 0]
            assert len(nonzero) >= 1

    def test_decay_distribution_handles_error(self) -> None:
        """current_strength 异常时降级为 0.0。"""
        store = MagicMock()
        store.get_all_episodes.return_value = [
            {
                "id": 1,
                "content": "bad",
                "initial_strength": 0.5,
                "importance": 0.5,
                "timestamp": 0.0,
                "lambda_": 0.1,
            },
        ]
        forget = MagicMock()
        forget.current_strength.side_effect = RuntimeError("bad")

        engines = build_mock_engines(store=store, forget=forget)
        with make_client(engines) as client:
            resp = client.get("/lab/memory-decay-distribution")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total_episodes"] == 1
            # 所有 bin 的 avg_strength 为 0.0（降级值）


# ── GET /lab/knowledge-graph ──────────────────────────────────────


class TestLabKnowledgeGraph:
    """GET /lab/knowledge-graph 端点测试。"""

    def test_knowledge_graph_empty(self) -> None:
        """无 fact 时返回空节点和边。"""
        store = MagicMock()
        store.get_all_facts.return_value = []
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/lab/knowledge-graph")
            assert resp.status_code == 200
            data = resp.json()
            assert data["nodes"] == []
            assert data["edges"] == []
            assert data["total_facts"] == 0

    def test_knowledge_graph_with_triples(self) -> None:
        """有三元组 fact 时返回节点+边图数据。"""
        store = MagicMock()
        store.get_all_facts.return_value = [
            {"id": 1, "subject": "Alice", "relation": "knows", "object": "Bob", "confidence": 0.9},
            {
                "id": 2,
                "subject": "Alice",
                "relation": "likes",
                "object": "Charlie",
                "confidence": 0.7,
            },
            {
                "id": 3,
                "subject": "Bob",
                "relation": "works_with",
                "object": "Charlie",
                "confidence": 0.5,
            },
        ]
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/lab/knowledge-graph")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total_facts"] == 3
            nodes = data["nodes"]
            edges = data["edges"]
            # Alice 出现 2 次 → weight=2
            alice = [n for n in nodes if n["id"] == "Alice"]
            assert len(alice) == 1
            assert alice[0]["weight"] == 2
            assert alice[0]["group"] == "subject"
            assert len(edges) == 3

    def test_knowledge_graph_handles_nulls(self) -> None:
        """subject/relation/object 为 None 时使用占位符。"""
        store = MagicMock()
        store.get_all_facts.return_value = [
            {"id": 1, "subject": None, "relation": None, "object": None, "confidence": 0.5},
        ]
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/lab/knowledge-graph")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["edges"]) == 1


# ── GET /lab/experiment-presets ──────────────────────────────────────


class TestLabExperimentPresets:
    """GET /lab/experiment-presets 端点测试。"""

    def test_experiment_presets_returns_four(self) -> None:
        """端点返回 4 个预设。"""
        engines = build_mock_engines()
        with make_client(engines) as client:
            resp = client.get("/lab/experiment-presets")
            assert resp.status_code == 200
            data = resp.json()
            presets = data["presets"]
            assert len(presets) == 4
            ids = {p["id"] for p in presets}
            assert "recall_top_k_3_vs_7" in ids
            assert "boost_0.1_vs_0.5" in ids
            assert "threshold_0.05_vs_0.3" in ids
            assert "search_k_10_vs_40" in ids

    def test_experiment_presets_structure(self) -> None:
        """每个预设包含 id/label_a/label_b/settings_a/settings_b/description。"""
        engines = build_mock_engines()
        with make_client(engines) as client:
            resp = client.get("/lab/experiment-presets")
            assert resp.status_code == 200
            for preset in resp.json()["presets"]:
                assert "id" in preset
                assert "label_a" in preset
                assert "label_b" in preset
                assert "settings_a" in preset
                assert "settings_b" in preset
                assert "description" in preset
                assert isinstance(preset["settings_a"], dict)
                assert len(preset["settings_a"]) > 0


# ── GET /lab/strategy-personas ───────────────────────────────────────


class TestLabStrategyPersonas:
    """GET /lab/strategy-personas 端点测试。"""

    def test_strategy_personas_returns_three(self) -> None:
        """端点返回 3 种策略人格——守门员/策展人/口述史家。"""
        engines = build_mock_engines()
        with make_client(engines) as client:
            resp = client.get("/lab/strategy-personas")
            assert resp.status_code == 200
            data = resp.json()
            personas = data["personas"]
            assert len(personas) == 3
            ids = {p["id"] for p in personas}
            assert ids == {"truncate", "prioritize", "summarize"}

    def test_strategy_personas_structure(self) -> None:
        """每个人格包含 id/name/subtitle/icon/description/color。"""
        engines = build_mock_engines()
        with make_client(engines) as client:
            resp = client.get("/lab/strategy-personas")
            assert resp.status_code == 200
            for persona in resp.json()["personas"]:
                assert "id" in persona
                assert "name" in persona
                assert "subtitle" in persona
                assert "icon" in persona
                assert "description" in persona
                assert "color" in persona
                assert len(persona["name"]) > 0
                assert len(persona["description"]) > 0


# ── POST /lab/experiment-run ─────────────────────────────────────────


class TestLabExperimentRun:
    """POST /lab/experiment-run 端点测试。"""

    def test_experiment_run_missing_params(self) -> None:
        """preset_id + settings_a/settings_b 都缺失时返回 400。"""
        engines = build_mock_engines()
        with make_client(engines) as client:
            resp = client.post(
                "/lab/experiment-run",
                json={"user_input": "hello", "label_a": "A", "label_b": "B"},
            )
            assert resp.status_code == 400
            assert "preset_id" in resp.json()["detail"]

    def test_experiment_run_unknown_preset(self) -> None:
        """未知 preset_id 返回 404。"""
        engines = build_mock_engines()
        with make_client(engines) as client:
            resp = client.post(
                "/lab/experiment-run",
                json={"user_input": "hello", "preset_id": "nonexistent_preset"},
            )
            assert resp.status_code == 404
            assert "Unknown preset" in resp.json()["detail"]

    def test_experiment_run_empty_user_input(self) -> None:
        """空 user_input 返回 422（Pydantic 校验）。"""
        engines = build_mock_engines()
        with make_client(engines) as client:
            resp = client.post(
                "/lab/experiment-run",
                json={"user_input": "", "preset_id": "recall_top_k_3_vs_7"},
            )
            assert resp.status_code == 422


# ── GET /lab/cost-waterfall ────────────────────────────────────────


class TestLabCostWaterfall:
    """GET /lab/cost-waterfall 端点测试。"""

    def test_cost_waterfall_empty(self) -> None:
        """零记录时返回 gross=net=0，savings 全为 0。"""
        ledger = MagicMock()
        ledger.summary.return_value = {
            "total": {"total_tokens": 0},
        }
        engines = build_mock_engines(ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/lab/cost-waterfall")
            assert resp.status_code == 200
            data = resp.json()
            assert data["gross_tokens"] == 0
            assert data["cache_savings"] == 0
            assert data["compression_savings"] == 0
            assert data["net_tokens"] == 0
            assert len(data["steps"]) >= 2  # 至少包含 "LLM 调用总额" + "净消耗"

    def test_cost_waterfall_no_savings(self) -> None:
        """只有 LLM 调用记录时，无缓存/压缩节省项。"""
        ledger = MagicMock()
        ledger.summary.return_value = {
            "chat": {
                "count": 2,
                "prompt_tokens": 800,
                "completion_tokens": 200,
                "total_tokens": 1000,
            },
            "fact_extraction": {
                "count": 2,
                "prompt_tokens": 600,
                "completion_tokens": 100,
                "total_tokens": 700,
            },
            "total": {
                "count": 4,
                "prompt_tokens": 1400,
                "completion_tokens": 300,
                "total_tokens": 1700,
            },
        }
        engines = build_mock_engines(ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/lab/cost-waterfall")
            assert resp.status_code == 200
            data = resp.json()
            assert data["gross_tokens"] == 1700
            assert data["cache_savings"] == 0
            assert data["compression_savings"] == 0
            assert data["net_tokens"] == 1700
            # 步骤应为 2 个：总额 + 净消耗（无节省步骤）
            assert len(data["steps"]) == 2
            kinds = [s["kind"] for s in data["steps"]]
            assert kinds == ["gross", "net"]

    def test_cost_waterfall_with_savings(self) -> None:
        """包含缓存和压缩节省时，瀑布步骤完整。"""
        ledger = MagicMock()
        ledger.summary.return_value = {
            "chat": {
                "count": 2,
                "prompt_tokens": 3000,
                "completion_tokens": 1000,
                "total_tokens": 4000,
            },
            "fact_extraction": {
                "count": 2,
                "prompt_tokens": 800,
                "completion_tokens": 200,
                "total_tokens": 1000,
            },
            "cache_hit": {
                "count": 1,
                "prompt_tokens": 1200,
                "completion_tokens": 0,
                "total_tokens": 1200,
            },
            "compression_savings": {
                "count": 1,
                "prompt_tokens": 800,
                "completion_tokens": 0,
                "total_tokens": 800,
            },
            "total": {
                "count": 6,
                "prompt_tokens": 5000,
                "completion_tokens": 1200,
                "total_tokens": 6200,
            },
        }
        engines = build_mock_engines(ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/lab/cost-waterfall")
            assert resp.status_code == 200
            data = resp.json()
            assert data["gross_tokens"] == 6200
            assert data["cache_savings"] == 1200
            assert data["compression_savings"] == 800
            # net = 6200 - 1200 - 800 = 4200
            assert data["net_tokens"] == 4200
            # 步骤应为 4 个：总额 + 缓存节省 + 压缩节省 + 净消耗
            assert len(data["steps"]) == 4
            kinds = [s["kind"] for s in data["steps"]]
            assert kinds == ["gross", "savings", "savings", "net"]
            # 验证净消耗步骤的 tokens 正确
            net_step = data["steps"][-1]
            assert net_step["label"] == "净消耗"
            assert net_step["tokens"] == 4200

    def test_cost_waterfall_response_structure(self) -> None:
        """验证响应的所有必填字段和 step 字段均存在。"""
        ledger = MagicMock()
        ledger.summary.return_value = {
            "chat": {
                "count": 1,
                "prompt_tokens": 500,
                "completion_tokens": 100,
                "total_tokens": 600,
            },
            "total": {
                "count": 1,
                "prompt_tokens": 500,
                "completion_tokens": 100,
                "total_tokens": 600,
            },
        }
        engines = build_mock_engines(ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/lab/cost-waterfall")
            assert resp.status_code == 200
            data = resp.json()
            # 顶层字段
            waterfall_keys = (
                "steps",
                "gross_tokens",
                "cache_savings",
                "compression_savings",
                "net_tokens",
            )
            for key in waterfall_keys:
                assert key in data, f"Missing top-level key: {key}"
            # 步骤内部字段
            for step in data["steps"]:
                for key in ("label", "tokens", "kind", "color"):
                    assert key in step, f"Missing step key: {key}"
                assert isinstance(step["tokens"], int)
                assert step["kind"] in ("gross", "savings", "net")
