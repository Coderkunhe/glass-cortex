"""记忆固化引擎——日终慢降温：基于时间维度的 importance 渐进衰减。

设计原则（Phase 56 Batch 1）：
- Consolidator 负责"调什么"（调整 importance），
  TierClassifier 负责"怎么分"（基于 importance 分级）。
- 慢降温 = 距上次召回超过 grace_period 的记忆逐步降低 importance。
- B2 将追加"用进效应"（高频访问提升 importance 抵御衰减）。
- 遵循 TierRebalancer 的机会主义触发模式（consolidate_if_stale）。
- 纯后端引擎，零 API/前端变更。
"""

from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING, cast

from src.config import Settings, settings

if TYPE_CHECKING:
    from src.memory.store import EpisodeRow, MemoryStore


class ConsolidationCore:
    """日终慢降温引擎——基于时间维度的 importance 渐进衰减。

    每条 episode 在 grace_period 内（自创建或上次召回起算）豁免降温。
    超出窗口后每次 consolidate 调用将 importance 乘以 (1 - cooldown_rate)，
    下限为 cooldown_min_importance。降温后持久化 last_consolidated_at。

    使用方式：
        core = ConsolidationCore(store)
        core.consolidate_if_stale()  # 机会主义触发（默认 24h 间隔）
        result = core.consolidate_all()  # 强制全量降温
    """

    def __init__(
        self,
        store: MemoryStore,
        config: Settings | None = None,
    ) -> None:
        """初始化固化引擎。

        Args:
            store: MemoryStore 实例，用于读写 episode 数据。
            config: Settings 配置（降温速率/间隔/下限）。None 时使用全局 settings。
        """
        self._store = store
        self._config = config or settings
        self._last_consolidation: float = 0.0

    @staticmethod
    def _compute_access_freq_norm(
        episode: EpisodeRow,
        now: float,
    ) -> float:
        """计算归一化访问频率——tanh 映射到 [0, 1)。

        公式：access_freq_per_day = access_count / max(0.001, days_since_creation)
              access_freq_norm = tanh(access_freq_per_day / 1.0)

        Args:
            episode: episode 字典，需含 access_count / timestamp。
            now: 当前时间戳。

        Returns:
            归一化访问频率，范围 [0.0, 1.0)。
        """
        access_count = episode.get("access_count", 0)
        timestamp = episode.get("timestamp", now)
        days_since = max(0.001, (now - timestamp) / 86400.0)
        freq_per_day = access_count / days_since
        return math.tanh(freq_per_day / 1.0)

    def recalc_importance(
        self,
        episode: EpisodeRow,
        now: float | None = None,
    ) -> float:
        """动态重要性计算——用进效应。

        基于访问频率提升 importance：
        new_importance = old × (1 + access_freq_norm × boost_rate)
        钳制上限 = old × (1 + boost_max)，再钳制到 1.0。

        Args:
            episode: episode 字典，需含 access_count / timestamp / importance。
            now: 当前时间戳，None 时使用 time.time()。

        Returns:
            动态重算后的 importance，范围 [0.0, 1.0]。
        """
        if now is None:
            now = time.time()

        access_freq_norm = self._compute_access_freq_norm(episode, now)
        boost_factor = 1.0 + access_freq_norm * self._config.consolidation_access_boost_rate
        boost_factor = min(
            boost_factor,
            1.0 + self._config.consolidation_access_boost_max,
        )

        old_importance = episode.get("importance", 0.5)
        new_importance = old_importance * boost_factor
        return float(min(new_importance, 1.0))

    def consolidate_all(self, now: float | None = None) -> dict[str, object]:
        """全量慢降温——遍历所有 episode，合并冷却 + 访问提升。

        Phase 56 Batch 2 合并公式：
        new_importance = importance × cooldown_factor × (1 + access_freq_norm × boost_rate)
        clamped to [cooldown_min_importance, 1.0]

        流程：
        1. 获取全部 episode
        2. 对每条检查：创建/召回距 now 是否在 grace_period 内 → 豁免
        3. 超出窗口者：应用合并公式（冷却 + 用进 boost）
        4. 仅写入 importance 实际变化的 episode（批量事务）

        Args:
            now: 当前时间戳，None 时使用 time.time()。主要用于测试注入。

        Returns:
            dict 包含:
            - consolidated: int — 实际降温的 episode 数量
            - skipped: int — 豁免跳过的 episode 数量
            - boosted: int — 获得访问提升的 episode 数量 (access_freq_norm > 0)
            - total: int — 全库 episode 总数
        """
        if now is None:
            now = time.time()

        episodes = self._store.get_all_episodes()
        if not episodes:
            self._last_consolidation = now
            return {"consolidated": 0, "skipped": 0, "boosted": 0, "total": 0}

        cooldown_factor = 1.0 - self._config.consolidation_cooldown_rate
        floor = self._config.consolidation_cooldown_min_importance
        boost_rate = self._config.consolidation_access_boost_rate
        boost_max = self._config.consolidation_access_boost_max

        consolidated = 0
        skipped = 0
        boosted = 0
        updates: list[tuple[int, float, float]] = []

        for ep in episodes:
            eid = ep["id"]
            importance = ep.get("importance", 0.5)

            # 确定豁免窗口的起点：上次召回时间 > 创建时间
            last_recall = ep.get("last_recall")
            if last_recall is not None:
                reference_time = last_recall
            else:
                reference_time = ep.get("timestamp", now)

            hours_since_reference = (now - reference_time) / 3600.0

            # grace_period 内豁免（不降温也不 boost——太新了）
            if hours_since_reference < self._config.consolidation_grace_period_hours:
                skipped += 1
                continue

            # 计算访问频率 boost（用进效应）
            access_freq_norm = self._compute_access_freq_norm(ep, now)
            boost_factor = 1.0 + access_freq_norm * boost_rate
            boost_factor = min(boost_factor, 1.0 + boost_max)

            # 合并公式：冷却 × boost，钳制到 [floor, 1.0]
            new_importance = importance * cooldown_factor * boost_factor
            new_importance = max(min(new_importance, 1.0), floor)

            # track boosted episodes (access_freq_norm > 0 means some boost)
            if access_freq_norm > 0:
                boosted += 1

            # 仅当 importance 实际变化时才记录（浮点容差）
            if abs(new_importance - importance) < 1e-9:
                skipped += 1
                continue

            updates.append((eid, new_importance, now))
            consolidated += 1

        if updates:
            self._store.set_importance_batch(updates)

        self._last_consolidation = now

        return {
            "consolidated": consolidated,
            "skipped": skipped,
            "boosted": boosted,
            "total": len(episodes),
        }

    def protect_hot(self, now: float | None = None) -> dict[str, object]:
        """遗忘豁免——连续 N 次召回的 episode 获得 importance 提升。

        检查每个 episode 的 recall_log：若最近的 N 条记录均在
        protection_window_hours 内，则 importance += protect_boost（钳制到 1.0）。

        通过 update_importance_batch 写入（仅动 importance，不动
        last_consolidated_at），保持与冷却路径的语义隔离。

        设计为先于 consolidate_all 调用——先保护热记忆，再统一进入
        合并公式（冷却 + 访问提升），避免保护效果被冷却抵消。

        Args:
            now: 当前时间戳，None 时使用 time.time()。主要用于测试注入。

        Returns:
            dict 包含:
            - protected: int — 获得保护的 episode 数量
            - checked: int — 检查的 episode 总数
        """
        if now is None:
            now = time.time()

        episodes = self._store.get_all_episodes()
        if not episodes:
            return {"protected": 0, "checked": 0}

        n_threshold = self._config.consolidation_protect_consecutive_n
        window_seconds = self._config.consolidation_protect_window_hours * 3600.0
        boost = self._config.consolidation_protect_boost

        protected = 0
        updates: list[tuple[int, float]] = []

        for ep in episodes:
            eid = ep["id"]
            importance = ep.get("importance", 0.5)

            # 重要性已达上限，无提升空间
            if importance >= 1.0:
                continue

            logs = self._store.get_recall_log(eid)
            if len(logs) < n_threshold:
                continue

            # 取最近 N 条，全部在窗口内 → 触发保护
            recent = logs[-n_threshold:]  # recall_log 按 recalled_at ASC
            all_recent = all(
                now - cast(float, log["recalled_at"]) <= window_seconds for log in recent
            )
            if not all_recent:
                continue

            new_importance = min(1.0, importance + boost)
            if abs(new_importance - importance) < 1e-9:
                continue

            updates.append((eid, new_importance))
            protected += 1

        if updates:
            self._store.update_importance_batch(updates)

        return {"protected": protected, "checked": len(episodes)}

    def consolidate_if_stale(
        self,
        interval_seconds: float | None = None,
    ) -> dict[str, object] | None:
        """机会主义触发——距上次降温超过 interval 时执行全量降温。

        流程（Phase 56 Batch 2 增强）：
        1. protect_hot() — 先保护连续 N 次召回的热记忆
        2. consolidate_all() — 再统一执行合并公式（冷却 + 用进 boost）

        设计为在每次 chat 请求中调用，绝大多数调用只做一次
        time.time() 比较即返回，零开销。

        Args:
            interval_seconds: 最小间隔秒数。None 时使用 config 默认值（24h）。

        Returns:
            若执行了降温，返回 consolidate_all 的结果 dict。
            若跳过（consolidation 未启用或距上次执行不足 interval），返回 None。
        """
        if not self._config.consolidation_enabled:
            return None

        effective_interval = (
            interval_seconds
            if interval_seconds is not None
            else self._config.consolidation_interval_seconds
        )

        if time.time() - self._last_consolidation < effective_interval:
            return None

        # Phase 56 Batch 2: 先保护热记忆，再执行合并降温
        self.protect_hot()
        return self.consolidate_all()
