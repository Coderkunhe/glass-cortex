"""多层记忆分级——hot/warm/cold 三层分类器 + 批量重均衡。

ADR-005: 记忆分级存储（四支柱 1.2 多层存储）。
hot（热层）：高频访问、高重要性，优先召回。
warm（温层）：中等访问，正常召回。
cold（冷层）：低频/旧记忆，压缩总结，降采样召回。

设计原则：
- 热力评分是纯函数，不访问 I/O，方便测试和调参。
- 分级阈值可配置（Settings dataclass），实验时新建实例即可 A/B 对比。
- 默认 feature flag 关闭（tier_enabled=False），不影响现有管线。
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

from src.config import Settings, settings

if TYPE_CHECKING:
    from src.memory.store import EpisodeRow, MemoryStore


class TierLevel(StrEnum):
    """记忆分级三层标签——hot 优先召回，cold 降采样。"""

    HOT = "hot"
    WARM = "warm"
    COLD = "cold"


@dataclass(frozen=True)
class TierResult:
    """单条 episode 的分级结果——分级标签 + 热力评分 + 元数据快照。

    heat_score 范围 [0, 1]，由访问频率、新鲜度、重要性加权计算。
    """

    episode_id: int
    tier: TierLevel
    heat_score: float


class TierClassifier:
    """记忆分级分类器——根据访问模式将 episodes 分为 hot/warm/cold 三层。

    热力评分 = recency_weight × 时间新鲜度 + access_weight × 访问频率
              + importance_weight × (重要性 + 当前强度) / 2

    时间新鲜度使用指数衰减：exp(-hours_since_last_recall / half_life_hours)。
    未被召回过的 episode 使用创建时间作为首次召回参考（新鲜度下限 = 0）。
    访问频率归一化到 [0,1]：access_count / max(access_count_in_batch, 1)。
    批量分类时访问频率跨全集归一化，单个分类时默认 0.5 中线。
    """

    def __init__(self, config: Settings = settings) -> None:
        self.config = config

    # ── 热力评分 ──

    def compute_heat_score(
        self,
        episode: EpisodeRow,
        max_access_count: int = 1,
        now: float | None = None,
    ) -> float:
        """计算单条 episode 的热力评分（纯函数，无副作用）。

        Args:
            episode: episode 字典，需含 access_count / last_recall / timestamp
                     / importance / initial_strength 字段。
            max_access_count: 批量内最大访问次数，用于频率归一化。
                              默认 1 避免除零。
            now: 当前时间戳，None 时用 time.time()。

        Returns:
            0-1 热力评分。评分为 0 表示极冷（从未被访问且很久以前创建）。
        """
        if now is None:
            now = time.time()

        # 访问频率 —— 归一化到 [0, 1]
        access_count = episode.get("access_count", 0)
        freq_score = min(access_count / max(1, max_access_count), 1.0)

        # 时间新鲜度 —— 上次召回距现在的小时数，指数衰减
        last_recall = episode.get("last_recall")
        if last_recall is not None:
            hours_since = (now - float(last_recall)) / 3600.0
        else:
            # 从未被召回：用创建时间，新鲜度下限 = 0
            created = float(episode.get("timestamp", now))
            hours_since = (now - created) / 3600.0
        # 半衰期 72h（3 天），72h 后新鲜度降至 0.5
        half_life_hours = 72.0
        # 防止负 hours_since（时钟偏差导致 last_recall/timestamp 比 now 晚）
        clamped_hours = max(0.0, hours_since)
        recency_score = 2.0 ** (-clamped_hours / half_life_hours)

        # 重要性/强度 —— 钳制到 0-1 区间（防御 DB 异常值）
        importance = episode.get("importance", 0.5)
        strength = episode.get("initial_strength", 1.0)
        importance_score = (min(importance, 1.0) + min(strength, 1.0)) / 2.0

        # 加权求和
        heat = (
            self.config.tier_recency_weight * recency_score
            + self.config.tier_access_weight * freq_score
            + self.config.tier_importance_weight * importance_score
        )
        return float(max(0.0, min(1.0, heat)))

    # ── 分级 ──

    def classify(
        self,
        episode: EpisodeRow,
        max_access_count: int = 1,
        now: float | None = None,
    ) -> TierResult:
        """对单条 episode 进行分级。

        Args:
            episode: episode 字典。
            max_access_count: 批量内最大访问次数参考。单条调用默认为 1。
            now: 当前时间戳。

        Returns:
            TierResult（frozen dataclass，可哈希、可序列化）。
        """
        if now is None:
            now = time.time()

        heat = self.compute_heat_score(episode, max_access_count=max_access_count, now=now)
        tier = self._score_to_tier(heat)

        return TierResult(
            episode_id=episode["id"],
            tier=tier,
            heat_score=round(heat, 4),
        )

    def classify_batch(
        self,
        episodes: Sequence[EpisodeRow],
        now: float | None = None,
    ) -> list[TierResult]:
        """批量分级——访问频率跨全集归一化。

        Args:
            episodes: episode 字典列表。
            now: 当前时间戳。

        Returns:
            TierResult 列表，与输入顺序一致。
        """
        if not episodes:
            return []

        if now is None:
            now = time.time()

        # 跨全集计算最大访问次数用于归一化
        max_ac = max(
            (ep.get("access_count", 0) for ep in episodes),
            default=1,
        )

        return [self.classify(ep, max_access_count=max_ac, now=now) for ep in episodes]

    def _score_to_tier(self, heat: float) -> TierLevel:
        """将热力评分映射到分级标签。"""
        if heat >= self.config.tier_hot_threshold:
            return TierLevel.HOT
        elif heat >= self.config.tier_warm_threshold:
            return TierLevel.WARM
        else:
            return TierLevel.COLD

    # ── 分布统计 ──

    def get_tier_distribution(
        self,
        results: list[TierResult],
    ) -> dict[TierLevel, int]:
        """统计分级分布——每层 episode 数量。

        Args:
            results: classify_batch 的结果列表。

        Returns:
            {TierLevel: count} 字典，含所有三层（未出现者为 0）。
        """
        dist: dict[TierLevel, int] = {t: 0 for t in TierLevel}
        for r in results:
            dist[r.tier] += 1
        return dist

    def get_tier_episode_ids(
        self,
        results: list[TierResult],
        tier: TierLevel,
    ) -> list[int]:
        """筛选指定分层的 episode id 列表。

        Args:
            results: classify_batch 的结果列表。
            tier: 目标分级。

        Returns:
            属于该分层的 episode id 列表。
        """
        return [r.episode_id for r in results if r.tier == tier]


# ── 模块级快捷工具 ──


def classify_episode(
    episode: EpisodeRow,
    config: Settings | None = None,
) -> TierResult:
    """一次性对单条 episode 分级（不需要批量归一化时用此快捷函数）。"""
    classifier = TierClassifier(config or settings)
    return classifier.classify(episode)


def get_tier_label(heat_score: float, config: Settings | None = None) -> str:
    """根据热力评分返回中文分级标签，用于 UI 展示。"""
    cfg = config or settings
    if heat_score >= cfg.tier_hot_threshold:
        return "热层 · 高频活跃"
    elif heat_score >= cfg.tier_warm_threshold:
        return "温层 · 常规活跃"
    else:
        return "冷层 · 低频休眠"


# ── 定时重均衡（Phase 54 Batch 4）──


class TierRebalancer:
    """定时重均衡器——全量重算热度分并执行跨层迁移。

    Episode 的 access_count 和 last_recall 随每次召回持续变化，
    而 tier 列不会自动更新。TierRebalancer 定期重算所有 episode
    的热力评分并持久化新的分层标签，防止分层随时间漂移失效。

    使用方式：
        rebalancer = TierRebalancer(store)
        rebalancer.rebalance_if_stale()  # 机会主义触发（默认 5min 间隔）
        # 或强制全量重均衡：
        result = rebalancer.rebalance_all()
    """

    def __init__(
        self,
        store: MemoryStore,
        config: Settings | None = None,
    ) -> None:
        """初始化重均衡器。

        Args:
            store: MemoryStore 实例，用于读写 episode 和 tier 数据。
            config: Settings 配置（阈值/权重）。None 时使用全局 settings。
        """
        self._store = store
        self._config = config or settings
        self._last_rebalance: float = 0.0

    def rebalance_all(self, now: float | None = None) -> dict[str, object]:
        """全量重均衡——获取所有 episode，重新分级，仅持久化 tier 变更。

        流程：
        1. 从 DB 获取全部 episode
        2. 用 TierClassifier.classify_batch 重算热度
        3. 对比当前 tier，仅对实际变化的 episode 写入
        4. 返回重均衡摘要（变更数 + 前后分布）

        Args:
            now: 当前时间戳，None 时使用 time.time()。主要用于测试注入。

        Returns:
            dict 包含:
            - rebalanced: int — 实际变更的 episode 数量
            - before: dict[str, int] — 重均衡前各层分布
            - after: dict[str, int] — 重均衡后各层分布
        """
        if now is None:
            now = time.time()

        episodes = self._store.get_all_episodes()
        if not episodes:
            self._last_rebalance = now
            return {
                "rebalanced": 0,
                "before": {"hot": 0, "warm": 0, "cold": 0},
                "after": {"hot": 0, "warm": 0, "cold": 0},
            }

        before = self._store.get_tier_distribution()

        classifier = TierClassifier(self._config)
        results = classifier.classify_batch(episodes, now=now)

        # 检测变更——只更新 tier 实际变化的 episode
        current_tiers: dict[int, str] = {ep["id"]: str(ep.get("tier", "warm")) for ep in episodes}
        changed = [
            (r.episode_id, r.tier.value)
            for r in results
            if current_tiers.get(r.episode_id) != r.tier.value
        ]

        if changed:
            self._store.set_episode_tiers_batch(changed)

        after = classifier.get_tier_distribution(results)
        self._last_rebalance = now

        return {
            "rebalanced": len(changed),
            "before": before,
            "after": {k.value: v for k, v in after.items()},
        }

    def rebalance_if_stale(
        self,
        interval_seconds: float = 300,
    ) -> dict[str, object] | None:
        """机会主义触发——距上次重均衡超过 interval 时执行全量重均衡。

        设计为在每次 chat 请求中调用，绝大多数调用只做一次
        time.time() 比较即返回，零开销。

        Args:
            interval_seconds: 最小间隔秒数，默认 300（5 分钟）。

        Returns:
            若执行了重均衡，返回 rebalance_all 的结果 dict。
            若跳过（tier 未启用或距上次执行不足 interval），返回 None。
        """
        if not self._config.tier_enabled:
            return None
        if time.time() - self._last_rebalance < interval_seconds:
            return None
        return self.rebalance_all()
