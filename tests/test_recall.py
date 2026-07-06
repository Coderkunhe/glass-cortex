from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np

from src.config import TierConfig, settings
from src.embed import embed
from src.memory.index import IndexManager
from src.memory.recall import (
    RecallEngine,
    analyze_regret,
    apply_truncation,
    mmr_rerank,
)
from src.memory.store import MemoryStore

_EMBEDDING_DIM = 384


def _insert_episode(store: MemoryStore, idx: IndexManager, text: str, **kw: float) -> int:
    """插入一条 episode 并关联 FAISS 索引。"""
    assert store.conn is not None
    vec = embed(text)
    faiss_ids = idx.add(vec.reshape(1, -1))
    cursor = store.conn.execute(
        "INSERT INTO episodes (content, importance, lambda, initial_strength, faiss_id) "
        "VALUES (?, ?, ?, ?, ?)",
        (
            text,
            kw.get("importance", 0.5),
            kw.get("lambda", 0.1),
            kw.get("initial_strength", 1.0),
            faiss_ids[0],
        ),
    )
    store.conn.commit()
    rowid = cursor.lastrowid
    assert rowid is not None
    return rowid


def test_recall_returns_top_k(tmp_path: Path) -> None:
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager(dimension=_EMBEDDING_DIM)

    texts = [
        "布偶猫很温顺适合家养",
        "Python 类型检查用 mypy",
        "布偶猫需要定期梳毛否则会打结",
        "FAISS 是 Facebook 开源的向量检索库",
        "艾宾浩斯遗忘曲线描述了记忆衰减规律",
        "布偶猫的蓝色眼睛是其品种特征",
        "pytest 支持 fixture 和参数化测试",
        "sentence-transformers 可以生成文本向量",
        "布偶猫原产于美国加州",
        "ruff 是一个快速的 Python linter",
    ]
    for text in texts:
        _insert_episode(store, idx, text)

    engine = RecallEngine(store, idx, embed)
    results = engine.recall("布偶猫的毛发需要怎么打理", top_k=3)

    assert len(results) == 3
    contents = [str(r["content"]) for r in results]
    assert any("布偶猫" in c for c in contents)
    for r in results:
        assert "id" in r
        assert "content" in r
        assert "importance" in r
        assert "initial_strength" in r


def test_recall_filters_below_threshold(tmp_path: Path) -> None:
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager(dimension=_EMBEDDING_DIM)

    _insert_episode(store, idx, "正常记忆内容用于测试", initial_strength=1.0)
    _insert_episode(store, idx, "这条记忆强度极低会被过滤", initial_strength=0.01)

    engine = RecallEngine(store, idx, embed)
    results = engine.recall("查询测试", top_k=5, threshold=0.05)

    contents = [r["content"] for r in results]
    assert "正常记忆内容用于测试" in contents
    assert "这条记忆强度极低会被过滤" not in contents


def test_recall_includes_facts(tmp_path: Path) -> None:
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager(dimension=_EMBEDDING_DIM)

    _insert_episode(store, idx, "用户昨天聊了布偶猫的话题")
    # 直接通过 store 插入 fact 并关联 FAISS
    fact_vec = embed("用户喜欢布偶猫")
    fact_faiss_ids = idx.add(fact_vec.reshape(1, -1))
    store.add_fact("用户喜欢布偶猫", confidence=0.9, faiss_id=fact_faiss_ids[0])

    engine = RecallEngine(store, idx, embed)
    results = engine.recall("布偶猫", top_k=5)

    contents = [str(r["content"]) for r in results]
    # 事实应被召回
    assert "用户喜欢布偶猫" in contents
    # 返回结果中事实有 _row_type 标记
    fact_entry = next(r for r in results if str(r["content"]) == "用户喜欢布偶猫")
    assert fact_entry.get("_row_type") == "fact"


def test_apply_truncation_zero_threshold_passes_all() -> None:
    """threshold=0 时全部保留。"""
    items: list[dict[str, object]] = [
        {"content": "高相关", "composite_score": 0.5},
        {"content": "低相关", "composite_score": 0.01},
    ]
    kept, truncated = apply_truncation(items, 0.0)
    assert len(kept) == 2
    assert len(truncated) == 0


def test_apply_truncation_splits_by_score() -> None:
    """按 composite_score 阈值正确分隔。"""
    items: list[dict[str, object]] = [
        {"content": "高", "composite_score": 0.5},
        {"content": "中", "composite_score": 0.1},
        {"content": "低", "composite_score": 0.02},
    ]
    kept, truncated = apply_truncation(items, 0.05)
    assert len(kept) == 2
    assert len(truncated) == 1
    assert str(truncated[0]["content"]) == "低"


def test_apply_truncation_empty_list() -> None:
    """空列表不做截断。"""
    kept, truncated = apply_truncation([], 0.3)
    assert kept == []
    assert truncated == []


# ── recall() mmr_lambda 参数 ──


def test_recall_mmr_lambda_override(tmp_path: Path) -> None:
    """recall() 接受 mmr_lambda 参数——None 使用 settings 默认，显式值透传。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager(dimension=_EMBEDDING_DIM)

    engine = RecallEngine(store, idx, embed)

    # 插入足够多的记忆触发 MMR 重排路径
    topics = [
        "布偶猫毛发需要每天梳理，防止打结",
        "布偶猫性格温顺，适合家庭饲养",
        "布偶猫眼睛是蓝色的，非常漂亮",
        "布偶猫食量适中，需要高质量猫粮",
        "布偶猫喜欢与人互动，不喜欢独处",
    ]
    for topic in topics:
        vec = embed(topic)
        faiss_ids = idx.add(vec.reshape(1, -1))
        store.add_episode(topic, faiss_id=faiss_ids[0])

    # mmr_lambda=None（使用默认值）不应报错
    results_default = engine.recall("布偶猫", top_k=3, mmr_lambda=None)
    assert len(results_default) <= 3

    # mmr_lambda=1.0（纯相关性，无多样性惩罚）应返回结果
    results_relevance = engine.recall("布偶猫", top_k=3, mmr_lambda=1.0)
    assert len(results_relevance) <= 3

    # mmr_lambda=0.0（纯多样性）应返回不同结果
    results_diverse = engine.recall("布偶猫", top_k=3, mmr_lambda=0.0)
    assert len(results_diverse) <= 3


# ── MMR 重排测试 ──


def _make_reconstruct_fn(
    vectors: dict[int, np.ndarray],
) -> Callable[[int], np.ndarray]:
    def reconstruct(fid: int) -> np.ndarray:
        return vectors[fid]

    return reconstruct


def _make_scored_items(
    n: int, scores: list[float], faiss_ids: list[int] | None = None
) -> list[tuple[dict[str, object], float]]:
    items: list[tuple[dict[str, object], float]] = []
    for i in range(n):
        item: dict[str, object] = {
            "content": f"item_{i}",
            "composite_score": scores[i],
        }
        if faiss_ids:
            item["faiss_id"] = faiss_ids[i]
        items.append((item, scores[i]))
    return items


class TestMMRRerank:
    def test_top_k_equals_len_returns_all(self) -> None:
        scored = _make_scored_items(3, [0.9, 0.8, 0.7])
        vectors = {0: np.array([1.0, 0.0], dtype=np.float32)}
        selected, dropped = mmr_rerank(scored, 3, 0.7, _make_reconstruct_fn(vectors))
        assert len(selected) == 3
        assert len(dropped) == 0

    def test_lambda_1_equals_relevance_ranking(self) -> None:
        scored = _make_scored_items(5, [0.9, 0.8, 0.7, 0.6, 0.5])
        vectors = {i: np.eye(1, 5, i).flatten().astype(np.float32) for i in range(5)}
        for v in vectors.values():
            v /= np.linalg.norm(v)
        selected, _ = mmr_rerank(scored, 3, 1.0, _make_reconstruct_fn(vectors))
        scores = [float(s["composite_score"]) for s in selected]  # type: ignore[arg-type]
        assert scores == [0.9, 0.8, 0.7]  # pure relevance order

    def test_diversity_penalty_changes_order(self) -> None:
        # item_0 (high score), item_1 (medium, similar to 0), item_2 (medium, diverse)
        vecs = {
            0: np.array([1.0, 0.0], dtype=np.float32),
            1: np.array([0.99, 0.01], dtype=np.float32),
            2: np.array([0.0, 1.0], dtype=np.float32),
        }
        for v in vecs.values():
            v /= np.linalg.norm(v)
        scored = _make_scored_items(3, [0.9, 0.85, 0.8], [0, 1, 2])
        selected, _ = mmr_rerank(scored, 2, 0.5, _make_reconstruct_fn(vecs))
        # item_0 picked first (highest score), then item_2 (diverse) beats item_1 (similar)
        contents = [str(s["content"]) for s in selected]
        assert contents[0] == "item_0"
        assert contents[1] == "item_2"  # not item_1

    def test_mmr_metadata_added(self) -> None:
        scored = _make_scored_items(3, [0.9, 0.8, 0.7])
        vecs = {i: np.eye(1, 3, i).flatten().astype(np.float32) for i in range(3)}
        for v in vecs.values():
            v /= np.linalg.norm(v)
        selected, _ = mmr_rerank(scored, 2, 0.7, _make_reconstruct_fn(vecs))
        for item in selected:
            assert item.get("_mmr_selected") is True

    def test_dropped_populated(self) -> None:
        scored = _make_scored_items(4, [0.9, 0.8, 0.7, 0.6])
        vecs = {i: np.eye(1, 4, i).flatten().astype(np.float32) for i in range(4)}
        for v in vecs.values():
            v /= np.linalg.norm(v)
        selected, dropped = mmr_rerank(scored, 2, 0.7, _make_reconstruct_fn(vecs))
        assert len(selected) == 2
        assert len(dropped) == 2

    def test_handles_missing_vectors(self) -> None:
        """faiss_id 无对应向量时 max_sim=0，不影响选优。"""
        scored = _make_scored_items(3, [0.9, 0.8, 0.7])
        selected, _ = mmr_rerank(scored, 2, 0.7, _make_reconstruct_fn({}))
        assert len(selected) == 2

    def test_single_scored_item(self) -> None:
        scored = _make_scored_items(1, [0.9])
        selected, dropped = mmr_rerank(scored, 1, 0.7, _make_reconstruct_fn({}))
        assert len(selected) == 1
        assert len(dropped) == 0


class TestAnalyzeRegret:
    def test_all_empty(self) -> None:
        regret = analyze_regret([], [], [])
        assert regret.deduped == []
        assert regret.mmr_dropped == []
        assert regret.truncated == []

    def test_partial_regret(self) -> None:
        deduped: list[dict[str, object]] = [{"faiss_id": 1}]
        mmr_dropped: list[dict[str, object]] = [{"content": "dropped", "composite_score": 0.5}]
        regret = analyze_regret(deduped, mmr_dropped, [])
        assert len(regret.deduped) == 1
        assert len(regret.mmr_dropped) == 1
        assert len(regret.truncated) == 0

    def test_full_regret(self) -> None:
        deduped: list[dict[str, object]] = [{"faiss_id": 1}, {"faiss_id": 2}]
        mmr_dropped: list[dict[str, object]] = [{"content": "a", "composite_score": 0.5}]
        truncated: list[dict[str, object]] = [{"content": "b", "composite_score": 0.01}]
        regret = analyze_regret(deduped, mmr_dropped, truncated)
        assert len(regret.deduped) == 2
        assert len(regret.mmr_dropped) == 1
        assert len(regret.truncated) == 1


# ── 分层感知测试辅助 ──


def _insert_episode_with_tier(
    store: MemoryStore,
    idx: IndexManager,
    text: str,
    tier: str = "warm",
    **kw: float,
) -> int:
    """插入 episode 并设置 tier，返回 episode id。"""
    eid = _insert_episode(store, idx, text, **kw)
    store.set_episode_tier(eid, tier)
    return eid


def _enable_tier() -> None:
    """启用分层模式（直接修改 frozen dataclass）。"""
    object.__setattr__(settings, "tier", TierConfig(tier_enabled=True))


def _disable_tier() -> None:
    """关闭分层模式（恢复默认）。"""
    object.__setattr__(settings, "tier", TierConfig(tier_enabled=False))


# ── Phase 54 Batch 3: RecallEngine 分层感知测试 ──


class TestTierAwareRecall:
    """分层召回：hot 优先 → warm 补充 → cold 排除。"""

    def test_hot_priority_over_warm(self, tmp_path: Path) -> None:
        """分层模式下 hot 层 episode 优先于 warm 层出现在结果中。"""
        _enable_tier()
        try:
            store = MemoryStore(str(tmp_path / "test.db"))
            store.init_db()
            idx = IndexManager(dimension=_EMBEDDING_DIM)

            # hot: 语义远离查询（关于 Python），但因 hot 层而优先
            _insert_episode_with_tier(
                store,
                idx,
                "Python 类型检查常用 mypy 工具",
                tier="hot",
                importance=0.8,
                initial_strength=1.0,
            )
            # warm: 语义匹配查询（关于布偶猫）
            _insert_episode_with_tier(
                store,
                idx,
                "布偶猫的毛发护理需要每天梳理",
                tier="warm",
                importance=0.5,
                initial_strength=1.0,
            )

            engine = RecallEngine(store, idx, embed)
            results = engine.recall("布偶猫毛发怎么打理", top_k=2)

            assert len(results) == 2
            contents = [str(r["content"]) for r in results]
            # hot 优先——即使语义不匹配也排在 warm 之前
            assert contents[0] == "Python 类型检查常用 mypy 工具"
            assert "布偶猫" in contents[1]
        finally:
            _disable_tier()

    def test_cold_tier_excluded(self, tmp_path: Path) -> None:
        """冷层 episode 不会被召回。"""
        _enable_tier()
        try:
            store = MemoryStore(str(tmp_path / "test.db"))
            store.init_db()
            idx = IndexManager(dimension=_EMBEDDING_DIM)

            _insert_episode_with_tier(
                store,
                idx,
                "冷层记忆：很久以前的对话",
                tier="cold",
                importance=0.5,
                initial_strength=1.0,
            )
            _insert_episode_with_tier(
                store,
                idx,
                "温层记忆：最近的对话",
                tier="warm",
                importance=0.5,
                initial_strength=1.0,
            )

            engine = RecallEngine(store, idx, embed)
            results = engine.recall("记忆对话", top_k=5)

            contents = [str(r["content"]) for r in results]
            assert "温层记忆：最近的对话" in contents
            assert "冷层记忆：很久以前的对话" not in contents
        finally:
            _disable_tier()

    def test_warm_supplements_when_hot_insufficient(self, tmp_path: Path) -> None:
        """hot 不足 top_k 时 warm 层补充。"""
        _enable_tier()
        try:
            store = MemoryStore(str(tmp_path / "test.db"))
            store.init_db()
            idx = IndexManager(dimension=_EMBEDDING_DIM)

            _insert_episode_with_tier(
                store,
                idx,
                "热层记忆",
                tier="hot",
                importance=1.0,
                initial_strength=1.0,
            )
            _insert_episode_with_tier(
                store,
                idx,
                "温层记忆 A",
                tier="warm",
                importance=0.5,
                initial_strength=1.0,
            )
            _insert_episode_with_tier(
                store,
                idx,
                "温层记忆 B",
                tier="warm",
                importance=0.5,
                initial_strength=1.0,
            )

            engine = RecallEngine(store, idx, embed)
            results = engine.recall("记忆", top_k=3)

            assert len(results) == 3
            contents = [str(r["content"]) for r in results]
            # hot 优先
            assert contents[0] == "热层记忆"
            # warm 补充
            assert "温层记忆 A" in contents
            assert "温层记忆 B" in contents
        finally:
            _disable_tier()

    def test_tier_disabled_flat_behavior(self, tmp_path: Path) -> None:
        """tier_enabled=False 时行为不变——所有 episode 按评分排序。"""
        # 确保 tier 关闭（默认已是 False）
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        idx = IndexManager(dimension=_EMBEDDING_DIM)

        _insert_episode_with_tier(
            store,
            idx,
            "布偶猫毛发护理每日梳理",
            tier="hot",
            importance=0.5,
            initial_strength=1.0,
        )
        _insert_episode_with_tier(
            store,
            idx,
            "Python 静态类型检查工具",
            tier="warm",
            importance=0.5,
            initial_strength=1.0,
        )

        engine = RecallEngine(store, idx, embed)
        results = engine.recall("布偶猫毛发", top_k=2)

        # 非分层模式：语义匹配者排前面
        assert len(results) == 2
        contents = [str(r["content"]) for r in results]
        assert "布偶猫" in contents[0]
        # Python 相关也可能在结果中（第二个）
        assert len(results) == 2
        assert any("Python" in c for c in contents)
        # 非分层模式按评分排序，语义匹配的应在前
        assert "布偶猫" in contents[0]

    def test_all_hot_no_warm_needed(self, tmp_path: Path) -> None:
        """hot 层 item 足够 top_k 时不从 warm 补充。"""
        _enable_tier()
        try:
            store = MemoryStore(str(tmp_path / "test.db"))
            store.init_db()
            idx = IndexManager(dimension=_EMBEDDING_DIM)

            _insert_episode_with_tier(
                store,
                idx,
                "热层记忆 1",
                tier="hot",
                importance=0.9,
                initial_strength=1.0,
            )
            _insert_episode_with_tier(
                store,
                idx,
                "热层记忆 2",
                tier="hot",
                importance=0.8,
                initial_strength=1.0,
            )
            _insert_episode_with_tier(
                store,
                idx,
                "温层记忆不应出现",
                tier="warm",
                importance=0.5,
                initial_strength=1.0,
            )

            engine = RecallEngine(store, idx, embed)
            results = engine.recall("记忆", top_k=2)

            assert len(results) == 2
            contents = [str(r["content"]) for r in results]
            assert "热层记忆 1" in contents
            assert "热层记忆 2" in contents
            assert "温层记忆不应出现" not in contents
        finally:
            _disable_tier()

    def test_no_hot_all_from_warm(self, tmp_path: Path) -> None:
        """无 hot 层 item 时全部从 warm 召回。"""
        _enable_tier()
        try:
            store = MemoryStore(str(tmp_path / "test.db"))
            store.init_db()
            idx = IndexManager(dimension=_EMBEDDING_DIM)

            _insert_episode_with_tier(
                store,
                idx,
                "温层记忆 A",
                tier="warm",
                importance=0.7,
                initial_strength=1.0,
            )
            _insert_episode_with_tier(
                store,
                idx,
                "温层记忆 B",
                tier="warm",
                importance=0.5,
                initial_strength=1.0,
            )

            engine = RecallEngine(store, idx, embed)
            results = engine.recall("记忆", top_k=3)

            assert len(results) == 2  # 总共只有 2 条 warm
            contents = [str(r["content"]) for r in results]
            assert "温层记忆 A" in contents
            assert "温层记忆 B" in contents
        finally:
            _disable_tier()

    def test_empty_episodes_returns_empty(self, tmp_path: Path) -> None:
        """无任何 episode 时返回空列表。"""
        _enable_tier()
        try:
            store = MemoryStore(str(tmp_path / "test.db"))
            store.init_db()
            idx = IndexManager(dimension=_EMBEDDING_DIM)

            engine = RecallEngine(store, idx, embed)
            results = engine.recall("任意查询", top_k=5)

            assert results == []
        finally:
            _disable_tier()

    def test_facts_always_included(self, tmp_path: Path) -> None:
        """fact 没有 tier 概念——分层模式下仍然参与召回。"""
        _enable_tier()
        try:
            store = MemoryStore(str(tmp_path / "test.db"))
            store.init_db()
            idx = IndexManager(dimension=_EMBEDDING_DIM)

            # 一条 cold 层 episode + 一条 fact
            _insert_episode_with_tier(
                store,
                idx,
                "冷层记忆不应出现",
                tier="cold",
                importance=0.5,
                initial_strength=1.0,
            )
            fact_vec = embed("用户喜欢布偶猫这个品种")
            fact_faiss_ids = idx.add(fact_vec.reshape(1, -1))
            store.add_fact(
                "用户喜欢布偶猫这个品种",
                confidence=0.9,
                faiss_id=fact_faiss_ids[0],
            )

            engine = RecallEngine(store, idx, embed)
            results = engine.recall("布偶猫", top_k=5)

            contents = [str(r["content"]) for r in results]
            # cold 不应出现
            assert "冷层记忆不应出现" not in contents
            # fact 必须出现
            assert "用户喜欢布偶猫这个品种" in contents
            fact_entry = next(r for r in results if str(r["content"]) == "用户喜欢布偶猫这个品种")
            assert fact_entry.get("_row_type") == "fact"
        finally:
            _disable_tier()
