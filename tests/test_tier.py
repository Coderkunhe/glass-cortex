"""多层记忆分级测试——TierClassifier 热力评分 + 分级 + 批量 + 分布统计。"""

from __future__ import annotations

import dataclasses
import time
from pathlib import Path
from typing import cast

import pytest

from src.config import Settings, TierConfig
from src.memory.store import MemoryStore
from src.memory.tier import (
    TierClassifier,
    TierLevel,
    TierRebalancer,
    TierResult,
    classify_episode,
    get_tier_label,
)

# ── 测试辅助：构造 episode fixture ──

_BASE_TIME = 1_000_000.0  # 基准时间戳，所有测试共享避免 real time() 溢出


def _episode(
    eid: int = 1,
    *,
    access_count: int = 0,
    last_recall: float | None = None,
    importance: float = 0.5,
    initial_strength: float = 1.0,
    timestamp: float = _BASE_TIME,
    decay_lambda: float = 0.1,
) -> dict[str, object]:
    """构造测试用 episode 字典，模拟 MemoryStore.get_episodes 返回格式。"""
    return {
        "id": eid,
        "content": f"测试内容 {eid}",
        "timestamp": timestamp,
        "importance": importance,
        "initial_strength": initial_strength,
        "lambda": decay_lambda,
        "access_count": access_count,
        "last_recall": last_recall,
        "faiss_id": None,
    }


# ── 热力评分 ──


class TestHeatScore:
    def test_hot_episode_scores_high(self) -> None:
        """刚被召回、高访问量、高重要性的 episode 热力评分接近 1。"""
        now = _BASE_TIME + 60
        ep = _episode(
            1,
            access_count=50,
            last_recall=_BASE_TIME,  # 刚刚被召回
            importance=1.0,
            initial_strength=1.0,
        )
        classifier = TierClassifier()
        score = classifier.compute_heat_score(ep, max_access_count=50, now=now)  # type: ignore[arg-type]
        assert score > 0.7

    def test_cold_episode_scores_low(self) -> None:
        """从未被访问、低重要性的旧 episode 热力评分低。"""
        now = _BASE_TIME + 3600 * 24 * 30  # 30 天后
        ep = _episode(
            2,
            access_count=0,
            last_recall=None,
            importance=0.1,
            initial_strength=0.2,
            timestamp=_BASE_TIME,
        )
        classifier = TierClassifier()
        score = classifier.compute_heat_score(ep, max_access_count=50, now=now)  # type: ignore[arg-type]
        assert score < 0.3

    def test_never_recalled_uses_created_time(self) -> None:
        """从未被召回的 episode 使用创建时间计算新鲜度。"""
        now = _BASE_TIME + 3600  # 1 小时后
        ep = _episode(3, access_count=0, last_recall=None, timestamp=_BASE_TIME)
        classifier = TierClassifier()
        score = classifier.compute_heat_score(ep, now=now)  # type: ignore[arg-type]
        # 1h 前创建+从未召回 → 新鲜度 ≈ 0.99（半衰期 72h）→ 有一定热力但不会太高
        assert 0.0 < score < 0.7

    def test_recency_decay_over_time(self) -> None:
        """同一 episode，时间越久热力越低。"""
        now = _BASE_TIME + 3600 * 168  # 7 天后
        ep_recent = _episode(4, access_count=10, last_recall=now - 60, importance=0.8)
        ep_old = _episode(4, access_count=10, last_recall=now - 86400, importance=0.8)
        classifier = TierClassifier()
        score_recent = classifier.compute_heat_score(ep_recent, max_access_count=10, now=now)  # type: ignore[arg-type]
        score_old = classifier.compute_heat_score(ep_old, max_access_count=10, now=now)  # type: ignore[arg-type]
        assert score_recent > score_old

    def test_access_freq_normalization(self) -> None:
        """访问频率归一化：同一 access_count 在低 max 集合中得分更高。"""
        now = _BASE_TIME
        ep = _episode(5, access_count=5, last_recall=_BASE_TIME - 10, importance=0.5)
        classifier = TierClassifier()
        score_high_max = classifier.compute_heat_score(ep, max_access_count=100, now=now)  # type: ignore[arg-type]
        score_low_max = classifier.compute_heat_score(ep, max_access_count=5, now=now)  # type: ignore[arg-type]
        assert score_low_max > score_high_max

    def test_importance_and_strength_weighted(self) -> None:
        """importances 和 strength 都影响热力评分。"""
        now = _BASE_TIME
        ep_high = _episode(
            6,
            importance=1.0,
            initial_strength=1.0,
            last_recall=now,
            access_count=10,
        )
        ep_low = _episode(
            7,
            importance=0.1,
            initial_strength=0.2,
            last_recall=now,
            access_count=10,
        )
        classifier = TierClassifier()
        score_high = classifier.compute_heat_score(
            ep_high,  # type: ignore[arg-type]
            max_access_count=10,
            now=now,
        )
        score_low = classifier.compute_heat_score(
            ep_low,  # type: ignore[arg-type]
            max_access_count=10,
            now=now,
        )
        assert score_high > score_low

    def test_weights_sum_contribution(self) -> None:
        """三权重和为 1.0 时，全满 episode 热力评分 = 1.0。"""
        cfg = Settings(
            tier=TierConfig(
                tier_recency_weight=0.4,
                tier_access_weight=0.3,
                tier_importance_weight=0.3,
            ),
        )
        now = _BASE_TIME
        ep = _episode(
            8,
            last_recall=now,
            access_count=100,
            importance=1.0,
            initial_strength=1.0,
        )
        classifier = TierClassifier(cfg)
        score = classifier.compute_heat_score(ep, max_access_count=100, now=now)  # type: ignore[arg-type]
        assert score == pytest.approx(1.0, abs=0.01)

    def test_importance_clamped_to_one(self) -> None:
        """importance > 1.0 时被钳制，不破坏权重比例。"""
        now = _BASE_TIME
        ep_normal = _episode(
            9,
            last_recall=now,
            access_count=100,
            importance=1.0,
            initial_strength=1.0,
        )
        ep_overflow = _episode(
            10,
            last_recall=now,
            access_count=100,
            importance=5.0,
            initial_strength=1.0,  # importance 异常高
        )
        classifier = TierClassifier()
        # importance 被钳制 → 两 episode 评分应相等
        score_normal = classifier.compute_heat_score(
            ep_normal,  # type: ignore[arg-type]
            max_access_count=100,
            now=now,
        )
        score_overflow = classifier.compute_heat_score(
            ep_overflow,  # type: ignore[arg-type]
            max_access_count=100,
            now=now,
        )
        assert score_normal == pytest.approx(score_overflow, abs=0.01)


# ── 分级 ──


class TestClassification:
    def test_classify_hot(self) -> None:
        """高评分 episode 归类为 hot。"""
        now = _BASE_TIME
        ep = _episode(
            1,
            access_count=100,
            last_recall=now,
            importance=1.0,
            initial_strength=1.0,
        )
        classifier = TierClassifier()
        result = classifier.classify(ep, max_access_count=100, now=now)  # type: ignore[arg-type]
        assert result.tier == TierLevel.HOT
        assert result.episode_id == 1
        assert result.heat_score > 0.7

    def test_classify_warm(self) -> None:
        """中等评分 episode 归类为 warm。"""
        now = _BASE_TIME + 3600 * 48  # 2 天后
        ep = _episode(
            2,
            access_count=5,
            last_recall=_BASE_TIME,  # 2 天前被召回
            importance=0.5,
            initial_strength=0.6,
        )
        classifier = TierClassifier()
        result = classifier.classify(ep, max_access_count=10, now=now)  # type: ignore[arg-type]
        assert result.tier == TierLevel.WARM

    def test_classify_cold(self) -> None:
        """低评分 episode 归类为 cold。"""
        now = _BASE_TIME + 3600 * 24 * 90  # 90 天后
        ep = _episode(
            3,
            access_count=0,
            last_recall=None,
            importance=0.1,
            initial_strength=0.1,
            timestamp=_BASE_TIME,
        )
        classifier = TierClassifier()
        result = classifier.classify(ep, max_access_count=100, now=now)  # type: ignore[arg-type]
        assert result.tier == TierLevel.COLD

    def test_classify_boundary_at_threshold(self) -> None:
        """刚好在阈值上的 episode 归类正确。"""
        cfg = Settings(tier=TierConfig(tier_hot_threshold=0.7, tier_warm_threshold=0.3))
        now = _BASE_TIME
        ep_borderline = _episode(
            5,
            access_count=100,
            last_recall=now,
            importance=0.3,
            initial_strength=0.3,
        )
        classifier = TierClassifier(cfg)
        result = classifier.classify(ep_borderline, max_access_count=100, now=now)  # type: ignore[arg-type]
        # 评分 = 0.4*1.0 + 0.3*1.0 + 0.3*(0.3+0.3)/2 = 0.4+0.3+0.09 = 0.79 → hot
        assert result.tier == TierLevel.HOT

    def test_custom_thresholds(self) -> None:
        """自定义极高门槛可让原本 warm 的 episode 掉到冷层。"""
        cfg = Settings(tier=TierConfig(tier_hot_threshold=0.95, tier_warm_threshold=0.8))
        classifier = TierClassifier(cfg)
        now = _BASE_TIME + 3600 * 72  # 3 天后（半衰期=72h，新鲜度=0.5）
        ep = _episode(
            6,
            access_count=50,
            last_recall=_BASE_TIME,
            importance=0.8,
            initial_strength=0.9,
        )
        result = classifier.classify(ep, max_access_count=50, now=now)  # type: ignore[arg-type]
        # recency=0.5, access=1.0, importance=(0.8+0.9)/2=0.85
        # heat = 0.4*0.5 + 0.3*1.0 + 0.3*0.85 = 0.2+0.3+0.255 = 0.755 → cold (<0.8)
        assert result.tier == TierLevel.COLD

    def test_tier_result_is_frozen(self) -> None:
        """TierResult 是不可变 dataclass。"""
        now = _BASE_TIME
        ep = _episode(7, timestamp=_BASE_TIME)
        classifier = TierClassifier()
        result = classifier.classify(ep, now=now)  # type: ignore[arg-type]
        with pytest.raises(dataclasses.FrozenInstanceError):
            result.tier = TierLevel.HOT  # type: ignore[misc]
        with pytest.raises(dataclasses.FrozenInstanceError):
            result.heat_score = 1.0  # type: ignore[misc]


# ── 批量分级 ──


class TestBatchClassification:
    def test_empty_batch_returns_empty(self) -> None:
        """空列表输入返回空列表。"""
        classifier = TierClassifier()
        assert classifier.classify_batch([]) == []

    def test_batch_normalizes_across_all_episodes(self) -> None:
        """批量分级时 access_count 跨全集归一化，最热和最冷应有明显差异。"""
        now = _BASE_TIME + 3600 * 24 * 90  # 90 天后
        episodes = [
            _episode(
                1,
                access_count=100,
                last_recall=now,
                importance=1.0,
                initial_strength=1.0,
            ),
            _episode(
                2,
                access_count=0,
                last_recall=None,
                importance=0.1,
                initial_strength=0.1,
                timestamp=_BASE_TIME,
            ),
            _episode(
                3,
                access_count=50,
                last_recall=now - 3600 * 24,
                importance=0.6,
                initial_strength=0.7,
            ),
        ]
        classifier = TierClassifier()
        results = classifier.classify_batch(episodes, now=now)  # type: ignore[arg-type]
        assert len(results) == 3
        assert results[0].heat_score > results[1].heat_score

    def test_batch_results_ordered_like_input(self) -> None:
        """批量分级结果顺序与输入一致。"""
        now = _BASE_TIME
        episodes = [
            _episode(1, access_count=10, timestamp=_BASE_TIME),
            _episode(2, access_count=20, timestamp=_BASE_TIME),
            _episode(3, access_count=5, timestamp=_BASE_TIME),
        ]
        classifier = TierClassifier()
        results = classifier.classify_batch(episodes, now=now)  # type: ignore[arg-type]
        assert [r.episode_id for r in results] == [1, 2, 3]

    def test_batch_same_max_access_yields_different_scores(self) -> None:
        """相同 max_access_count 下，不同 access_count 的 episode 评分不同。"""
        now = _BASE_TIME
        episodes = [
            _episode(1, access_count=0, last_recall=now, importance=0.5),
            _episode(2, access_count=100, last_recall=now, importance=0.5),
        ]
        classifier = TierClassifier()
        results = classifier.classify_batch(episodes, now=now)  # type: ignore[arg-type]
        assert results[1].heat_score > results[0].heat_score


# ── 分布统计 ──


class TestTierDistribution:
    def test_distribution_counts_all_tiers(self) -> None:
        """分级分布统计含所有三层（含 0）。"""
        results = [
            TierResult(episode_id=1, tier=TierLevel.HOT, heat_score=0.9),
            TierResult(episode_id=2, tier=TierLevel.HOT, heat_score=0.8),
            TierResult(episode_id=3, tier=TierLevel.WARM, heat_score=0.5),
        ]
        classifier = TierClassifier()
        dist = classifier.get_tier_distribution(results)
        assert dist[TierLevel.HOT] == 2
        assert dist[TierLevel.WARM] == 1
        assert dist[TierLevel.COLD] == 0

    def test_get_tier_episode_ids_filters_correctly(self) -> None:
        """get_tier_episode_ids 正确筛选指定分层。"""
        results = [
            TierResult(episode_id=1, tier=TierLevel.HOT, heat_score=0.9),
            TierResult(episode_id=2, tier=TierLevel.WARM, heat_score=0.5),
            TierResult(episode_id=3, tier=TierLevel.HOT, heat_score=0.85),
            TierResult(episode_id=4, tier=TierLevel.COLD, heat_score=0.1),
        ]
        classifier = TierClassifier()
        hot_ids = classifier.get_tier_episode_ids(results, TierLevel.HOT)
        assert hot_ids == [1, 3]
        cold_ids = classifier.get_tier_episode_ids(results, TierLevel.COLD)
        assert cold_ids == [4]


# ── 模块级快捷函数 ──


class TestConvenienceFunctions:
    def test_classify_episode_shortcut(self) -> None:
        """classify_episode 快捷函数返回有效 TierResult。"""
        ep = _episode(99, access_count=10, last_recall=_BASE_TIME, importance=0.8)
        result = classify_episode(ep)  # type: ignore[arg-type]
        assert isinstance(result, TierResult)
        assert result.episode_id == 99

    def test_get_tier_label_hot(self) -> None:
        assert "热层" in get_tier_label(0.9)

    def test_get_tier_label_warm(self) -> None:
        assert "温层" in get_tier_label(0.5)

    def test_get_tier_label_cold(self) -> None:
        assert "冷层" in get_tier_label(0.1)

    def test_feature_flag_defaults_off(self) -> None:
        """默认 config tier_enabled=False。"""
        assert Settings().tier_enabled is False


# ── TierLevel 枚举 ──


class TestTierLevel:
    def test_tier_level_values(self) -> None:
        assert TierLevel.HOT.value == "hot"
        assert TierLevel.WARM.value == "warm"
        assert TierLevel.COLD.value == "cold"

    def test_tier_level_is_string(self) -> None:
        """TierLevel 继承 StrEnum，可直接用于字符串比较和 JSON 序列化。"""
        assert TierLevel.HOT == "hot"  # type: ignore[comparison-overlap]
        assert TierLevel.HOT != "cold"  # type: ignore[comparison-overlap]
        assert isinstance(TierLevel.WARM, str)


# ── 定时重均衡（Phase 54 Batch 4）──


class TestTierRebalancer:
    """TierRebalancer — 全量重均衡 + 机会主义周期触发。"""

    def test_rebalance_all_empty_store(self, tmp_path: Path) -> None:
        """空 DB 返回 0 rebalanced + 全零分布。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        rebalancer = TierRebalancer(store)
        result = rebalancer.rebalance_all()

        assert cast(int, result["rebalanced"]) == 0
        assert result["before"] == {"hot": 0, "warm": 0, "cold": 0}
        assert result["after"] == {"hot": 0, "warm": 0, "cold": 0}
        store.close()

    def test_rebalance_all_classifies_and_persists(self, tmp_path: Path) -> None:
        """热点 episode → hot，冷点 episode → cold，结果持久化到 DB。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        now = time.time()

        # 热记忆：高访问 + 刚刚召回 + 高重要性
        e_hot = store.add_episode("热层记忆", importance=1.0)
        # 冷记忆：无访问 + 从未召回 + 低重要性 + 旧时间戳
        e_cold = store.add_episode("冷层记忆", importance=0.1)

        # 直接 SQL 更新访问模式（add_episode 不设 access_count/last_recall）
        assert store.conn is not None
        store.conn.execute(
            "UPDATE episodes SET access_count=?, last_recall=?, initial_strength=? WHERE id=?",
            (100, now, 1.0, e_hot),
        )
        store.conn.execute(
            "UPDATE episodes SET access_count=?, last_recall=?, initial_strength=?, "
            "timestamp=? WHERE id=?",
            (0, None, 0.1, now - 3600 * 24 * 90, e_cold),
        )
        store.conn.commit()

        rebalancer = TierRebalancer(store)
        result = rebalancer.rebalance_all(now=now)
        assert cast(int, result["rebalanced"]) >= 1

        episodes = store.get_episodes([e_hot, e_cold])
        tiers = {ep["id"]: ep["tier"] for ep in episodes}
        assert tiers[e_hot] == "hot"
        assert tiers[e_cold] == "cold"
        store.close()

    def test_rebalance_all_returns_summary(self, tmp_path: Path) -> None:
        """返回 dict 包含 rebalanced/before/after 键，分布总和匹配 episode 数。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        now = time.time()

        e1 = store.add_episode("记忆 1", importance=1.0)
        assert store.conn is not None
        store.conn.execute(
            "UPDATE episodes SET access_count=?, last_recall=?, initial_strength=? WHERE id=?",
            (100, now, 1.0, e1),
        )
        store.conn.commit()

        rebalancer = TierRebalancer(store)
        result = rebalancer.rebalance_all(now=now)

        assert "rebalanced" in result
        assert "before" in result
        assert "after" in result
        assert isinstance(result["rebalanced"], int)
        # after 分布总和应等于总 episode 数
        after_dist = cast(dict[str, int], result["after"])
        assert sum(after_dist.values()) == 1
        store.close()

    def test_rebalance_only_persists_changes(self, tmp_path: Path) -> None:
        """已正确分层的 episode 不产生无意义的 DB 写操作。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        now = time.time()

        # 创建一个 hot episode 并预设 tier 为 hot
        e_hot = store.add_episode("热记忆", importance=1.0)
        assert store.conn is not None
        store.conn.execute(
            "UPDATE episodes SET access_count=?, last_recall=?, initial_strength=? WHERE id=?",
            (100, now, 1.0, e_hot),
        )
        store.conn.commit()
        store.set_episode_tier(e_hot, "hot")

        # 第一次重均衡 — hot 已对，不应产生变更
        rebalancer = TierRebalancer(store)
        result1 = rebalancer.rebalance_all(now=now)
        assert cast(int, result1["rebalanced"]) == 0, (
            f"Expected 0 changes, got {result1['rebalanced']}"
        )

        # 再创建一个 cold episode 但 tier 默认 warm（错配）
        e_cold = store.add_episode("冷记忆", importance=0.1)
        store.conn.execute(
            "UPDATE episodes SET access_count=?, last_recall=?, initial_strength=?, "
            "timestamp=? WHERE id=?",
            (0, None, 0.1, now - 3600 * 24 * 90, e_cold),
        )
        store.conn.commit()
        # e_cold 默认 tier 为 warm，重均衡应将其修正为 cold

        result2 = rebalancer.rebalance_all(now=now)
        assert cast(int, result2["rebalanced"]) == 1  # only e_cold changes: warm → cold
        store.close()

    def test_rebalance_if_stale_skips_when_fresh(self, tmp_path: Path) -> None:
        """刚执行完重均衡 → 立即再调用 → 返回 None（未过期）。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        now = time.time()

        e1 = store.add_episode("记忆", importance=1.0)
        assert store.conn is not None
        store.conn.execute(
            "UPDATE episodes SET access_count=?, last_recall=?, initial_strength=? WHERE id=?",
            (100, now, 1.0, e1),
        )
        store.conn.commit()

        # 使用开启 tier 的 config
        cfg = Settings(tier=TierConfig(tier_enabled=True))
        rebalancer = TierRebalancer(store, config=cfg)

        # 第一次 — 应执行
        result1 = rebalancer.rebalance_if_stale(interval_seconds=300)
        assert result1 is not None

        # 第二次 — 刚执行完，未过期
        result2 = rebalancer.rebalance_if_stale(interval_seconds=300)
        assert result2 is None
        store.close()

    def test_rebalance_if_stale_runs_when_stale(self, tmp_path: Path) -> None:
        """手动回拨 _last_rebalance → 触发执行。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        now = time.time()

        e1 = store.add_episode("记忆", importance=1.0)
        assert store.conn is not None
        store.conn.execute(
            "UPDATE episodes SET access_count=?, last_recall=?, initial_strength=? WHERE id=?",
            (100, now, 1.0, e1),
        )
        store.conn.commit()

        cfg = Settings(tier=TierConfig(tier_enabled=True))
        rebalancer = TierRebalancer(store, config=cfg)

        # 第一次执行
        rebalancer.rebalance_if_stale(interval_seconds=300)

        # 模拟时间回拨：将 _last_rebalance 设为 10 分钟前
        rebalancer._last_rebalance = now - 600

        # 应再次执行
        result = rebalancer.rebalance_if_stale(interval_seconds=300)
        assert result is not None
        assert cast(int, result["rebalanced"]) >= 0
        store.close()
