"""ConsolidationCore 测试——日终慢降温 + 机会主义触发 + 迁移 + 动态重要性 + 遗忘豁免。"""

from __future__ import annotations

import math
from pathlib import Path
from typing import cast

import pytest

from src.config import ConsolidationConfig, settings
from src.memory.consolidate import ConsolidationCore
from src.memory.store import MemoryStore

# ── 固定时间基点（2026-07-01 00:00:00 UTC）──
_BASE_TIME = 1751932800.0  # 2026-07-01T00:00:00Z


def _enable_consolidation() -> None:
    object.__setattr__(settings, "consolidation", ConsolidationConfig(consolidation_enabled=True))


def _disable_consolidation() -> None:
    object.__setattr__(settings, "consolidation", ConsolidationConfig(consolidation_enabled=False))


class TestConsolidateAll:
    """consolidate_all 核心逻辑测试。"""

    def test_empty_db(self, tmp_path: Path) -> None:
        """空库 consolidate 返回全零。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            core = ConsolidationCore(store)
            result = core.consolidate_all(now=_BASE_TIME)
            assert result == {"consolidated": 0, "skipped": 0, "boosted": 0, "total": 0}
        finally:
            store.close()

    def test_grace_period_immune_new(self, tmp_path: Path) -> None:
        """grace_period 内的新 episode 不降温。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            # 创建 1 小时前的 episode（在 24h grace_period 内）
            one_hour_ago = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance) VALUES (?, ?, ?)",
                ("新创建的记忆", one_hour_ago, 0.8),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            result = core.consolidate_all(now=_BASE_TIME)

            assert result["consolidated"] == 0
            assert result["skipped"] == 1
            assert result["total"] == 1

            # importance 不变
            ep = store.get_all_episodes()[0]
            assert ep["importance"] == pytest.approx(0.8, abs=0.001)
        finally:
            store.close()

    def test_grace_period_immune_recently_recalled(self, tmp_path: Path) -> None:
        """上周创建但刚被召回的 episode 不降温（last_recall 重置窗口）。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            # 7 天前创建，但 1 小时前刚被召回
            seven_days_ago = _BASE_TIME - 7 * 86400
            one_hour_ago = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance, last_recall) "
                "VALUES (?, ?, ?, ?)",
                ("旧但活跃的记忆", seven_days_ago, 0.9, one_hour_ago),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            result = core.consolidate_all(now=_BASE_TIME)

            assert result["consolidated"] == 0
            assert result["skipped"] == 1

            ep = store.get_all_episodes()[0]
            assert ep["importance"] == pytest.approx(0.9, abs=0.001)
        finally:
            store.close()

    def test_cooldown_reduces_importance(self, tmp_path: Path) -> None:
        """超 grace_period 的 episode 降 importance。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            # 48 小时前创建，从未召回，超出默认 24h grace_period
            two_days_ago = _BASE_TIME - 48 * 3600
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance) VALUES (?, ?, ?)",
                ("旧记忆", two_days_ago, 0.5),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            result = core.consolidate_all(now=_BASE_TIME)

            assert result["consolidated"] == 1
            assert result["skipped"] == 0
            assert result["total"] == 1

            # importance: 0.5 * (1 - 0.02) = 0.49
            ep = store.get_all_episodes()[0]
            expected = 0.5 * (1.0 - settings.consolidation_cooldown_rate)
            assert ep["importance"] == pytest.approx(expected, abs=0.001)
        finally:
            store.close()

    def test_cooldown_respects_floor(self, tmp_path: Path) -> None:
        """importance 不低于 cooldown_min_importance。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            # importance 略高于下限，降温后应被钳制到 floor
            two_days_ago = _BASE_TIME - 48 * 3600
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance) VALUES (?, ?, ?)",
                ("接近下限的记忆", two_days_ago, 0.051),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            result = core.consolidate_all(now=_BASE_TIME)

            assert result["consolidated"] == 1

            ep = store.get_all_episodes()[0]
            assert ep["importance"] == pytest.approx(
                settings.consolidation_cooldown_min_importance, abs=0.001
            )
        finally:
            store.close()

    def test_last_consolidated_at_updated(self, tmp_path: Path) -> None:
        """降温后 last_consolidated_at 字段更新为当前时间。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            two_days_ago = _BASE_TIME - 48 * 3600
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance) VALUES (?, ?, ?)",
                ("旧记忆", two_days_ago, 0.5),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            core.consolidate_all(now=_BASE_TIME)

            ep = store.get_all_episodes()[0]
            assert ep["last_consolidated_at"] == pytest.approx(_BASE_TIME, abs=0.001)
        finally:
            store.close()

    def test_multiple_episodes_mixed(self, tmp_path: Path) -> None:
        """混合场景：新/召回/旧 episode 各一个。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            now = _BASE_TIME
            # 1h 前新建（豁免）
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance) VALUES (?, ?, ?)",
                ("新记忆", now - 3600, 0.5),
            )
            # 7 天前创建，1h 前召回（豁免）
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance, last_recall) "
                "VALUES (?, ?, ?, ?)",
                ("活跃旧记忆", now - 7 * 86400, 0.9, now - 3600),
            )
            # 7 天前创建，从未召回（应降温）
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance) VALUES (?, ?, ?)",
                ("冷记忆", now - 7 * 86400, 0.7),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            result = core.consolidate_all(now=now)

            assert result["consolidated"] == 1
            assert result["skipped"] == 2
            assert result["total"] == 3

            episodes = {ep["content"]: ep for ep in store.get_all_episodes()}
            assert episodes["新记忆"]["importance"] == pytest.approx(0.5, abs=0.001)
            assert episodes["活跃旧记忆"]["importance"] == pytest.approx(0.9, abs=0.001)
            # 冷记忆降了：0.7 * 0.98 = 0.686
            expected_cold = 0.7 * (1.0 - settings.consolidation_cooldown_rate)
            assert episodes["冷记忆"]["importance"] == pytest.approx(expected_cold, abs=0.001)
        finally:
            store.close()

    def test_no_change_when_already_at_floor(self, tmp_path: Path) -> None:
        """已经在地板上的 episode 不再产生写操作（跳过而非 consolidated）。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            two_days_ago = _BASE_TIME - 48 * 3600
            floor = settings.consolidation_cooldown_min_importance
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance) VALUES (?, ?, ?)",
                ("地板记忆", two_days_ago, floor),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            result = core.consolidate_all(now=_BASE_TIME)

            # importance 已是 floor，cooldown_factor 乘法后仍是 floor
            # 容差内无变化 → 计入 skipped
            assert result["consolidated"] == 0
            assert result["skipped"] == 1
        finally:
            store.close()


class TestConsolidateIfStale:
    """consolidate_if_stale 机会主义触发测试。"""

    def test_skips_when_within_interval(self, tmp_path: Path) -> None:
        """距上次执行不足 interval 时跳过。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _enable_consolidation()
            try:
                core = ConsolidationCore(store)

                # 首次调用——执行
                result1 = core.consolidate_if_stale(interval_seconds=3600)
                assert result1 is not None

                # 立即第二次调用——跳过（0s < 3600s）
                result2 = core.consolidate_if_stale(interval_seconds=3600)
                assert result2 is None
            finally:
                _disable_consolidation()
        finally:
            store.close()

    def test_runs_when_stale(self, tmp_path: Path) -> None:
        """距上次执行超过 interval 时执行。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _enable_consolidation()
            try:
                # 手动将 _last_consolidation 设为很久以前
                core = ConsolidationCore(store)
                core._last_consolidation = _BASE_TIME - 7200  # 2h 前

                result = core.consolidate_if_stale(interval_seconds=3600)
                # 2h > 1h interval → 应执行
                assert result is not None
                assert "total" in result
            finally:
                _disable_consolidation()
        finally:
            store.close()

    def test_disabled_skips(self, tmp_path: Path) -> None:
        """consolidation_enabled=False 时总是跳过。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            core = ConsolidationCore(store)
            core._last_consolidation = 0.0  # 确保间隔足够

            result = core.consolidate_if_stale(interval_seconds=1)
            assert result is None
        finally:
            store.close()

    def test_uses_config_interval_by_default(self, tmp_path: Path) -> None:
        """未传 interval_seconds 时使用 config 默认值。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _enable_consolidation()
            try:
                core = ConsolidationCore(store)
                # 刚创建，last_consolidation 是 0.0
                # 默认 interval = 86400s (24h)，默认 _last_consolidation = 0.0
                # 时间差 >> 86400s → 应执行
                result = core.consolidate_if_stale()
                assert result is not None
            finally:
                _disable_consolidation()
        finally:
            store.close()


class TestConsolidationMigration:
    """last_consolidated_at 列迁移测试。"""

    def test_migration_adds_column(self, tmp_path: Path) -> None:
        """旧 schema（无 last_consolidated_at）迁移后新增列存在。"""
        import sqlite3

        db_path = str(tmp_path / "old.db")

        # 创建旧 schema 的 episodes 表（无 last_consolidated_at）
        conn = sqlite3.connect(db_path)
        conn.execute(
            "CREATE TABLE episodes ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "content TEXT NOT NULL, "
            "timestamp REAL NOT NULL DEFAULT (strftime('%s', 'now')), "
            "importance REAL NOT NULL DEFAULT 0.5, "
            "initial_strength REAL NOT NULL DEFAULT 1.0, "
            "lambda REAL NOT NULL DEFAULT 0.1, "
            "access_count INTEGER NOT NULL DEFAULT 0, "
            "last_recall REAL, "
            "faiss_id INTEGER, "
            "tier TEXT NOT NULL DEFAULT 'warm'"
            ")"
        )
        conn.commit()
        conn.close()

        store = MemoryStore(db_path)
        store.init_db()
        assert store.conn is not None
        try:
            cols = {
                row[1] for row in store.conn.execute("PRAGMA table_info('episodes')").fetchall()
            }
            assert "last_consolidated_at" in cols

            # 新创建的 episode 默认 NULL
            eid = store.add_episode("迁移后新记忆")
            ep = store.get_episodes([eid])[0]
            assert ep["last_consolidated_at"] is None
        finally:
            store.close()


# ═══════════════════════════════════════════════════════════════════
# Phase 56 Batch 2 — 动态重要性 + 遗忘豁免
# ═══════════════════════════════════════════════════════════════════


class TestComputeAccessFreqNorm:
    """_compute_access_freq_norm 静态方法测试。"""

    def test_zero_access_returns_zero(self) -> None:
        """access_count=0 → tanh(0) = 0。"""
        ep: dict[str, object] = {"access_count": 0, "timestamp": _BASE_TIME - 86400}
        result = ConsolidationCore._compute_access_freq_norm(ep, _BASE_TIME)  # type: ignore[arg-type]
        assert result == pytest.approx(0.0, abs=0.001)

    def test_one_per_day_returns_moderate(self) -> None:
        """1 次/天 → tanh(1) ≈ 0.762。"""
        ep: dict[str, object] = {"access_count": 7, "timestamp": _BASE_TIME - 7 * 86400}
        result = ConsolidationCore._compute_access_freq_norm(ep, _BASE_TIME)  # type: ignore[arg-type]
        assert result == pytest.approx(math.tanh(1.0), abs=0.01)

    def test_high_freq_approaches_one(self) -> None:
        """10 次/天 → tanh(10) ≈ 1.0。"""
        ep: dict[str, object] = {"access_count": 100, "timestamp": _BASE_TIME - 10 * 86400}
        result = ConsolidationCore._compute_access_freq_norm(ep, _BASE_TIME)  # type: ignore[arg-type]
        assert result > 0.99

    def test_brand_new_episode_no_divide_by_zero(self) -> None:
        """新 episode (< 0.001 天) 不会除零——max(0.001, ...) 防护。"""
        ep: dict[str, object] = {"access_count": 5, "timestamp": _BASE_TIME}  # 同一时刻
        result = ConsolidationCore._compute_access_freq_norm(ep, _BASE_TIME)  # type: ignore[arg-type]
        # freq_per_day = 5 / 0.001 = 5000, tanh(5000) ≈ 1.0
        assert result > 0.99

    def test_older_episode_gets_more_boost_per_access(self) -> None:
        """相同 access_count，更老的 episode 每次访问获得更高归一化频率。"""
        new_ep: dict[str, object] = {"access_count": 10, "timestamp": _BASE_TIME - 86400}  # 1 天
        old_ep: dict[str, object] = {
            "access_count": 10,
            "timestamp": _BASE_TIME - 30 * 86400,
        }  # 30 天
        new_norm = ConsolidationCore._compute_access_freq_norm(new_ep, _BASE_TIME)  # type: ignore[arg-type]
        old_norm = ConsolidationCore._compute_access_freq_norm(old_ep, _BASE_TIME)  # type: ignore[arg-type]
        # 老 episode: 10/30=0.33/天, tanh(0.33)≈0.32
        # 新 episode: 10/1=10/天, tanh(10)≈1.0
        # 新 episode 每天访问频率更高 → norm 更大
        assert new_norm > old_norm


class TestRecalcImportance:
    """recalc_importance 动态重要性计算测试。"""

    def test_zero_access_returns_unchanged(self, tmp_path: Path) -> None:
        """access_count=0 → boost_factor=1.0 → importance 不变。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            core = ConsolidationCore(store)
            ep: dict[str, object] = {
                "access_count": 0,
                "timestamp": _BASE_TIME - 86400,
                "importance": 0.5,
            }
            new_imp = core.recalc_importance(ep, now=_BASE_TIME)  # type: ignore[arg-type]
            assert new_imp == pytest.approx(0.5, abs=0.001)
        finally:
            store.close()

    def test_high_access_boosts_importance(self, tmp_path: Path) -> None:
        """10 次/天 → boost_factor ≈ 1.2 → importance 提升。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            core = ConsolidationCore(store)
            # 100 次访问 / 10 天 = 10 次/天, tanh(10)≈1.0
            # boost = 1 + 1.0 * 0.2 = 1.2
            ep: dict[str, object] = {
                "access_count": 100,
                "timestamp": _BASE_TIME - 10 * 86400,
                "importance": 0.5,
            }
            new_imp = core.recalc_importance(ep, now=_BASE_TIME)  # type: ignore[arg-type]
            # freq_per_day = 100/10 = 10, tanh(10) ≈ 1.0
            expected = 0.5 * (1.0 + math.tanh(10.0) * 0.2)
            assert new_imp == pytest.approx(expected, abs=0.01)
            assert new_imp > 0.5  # 确实提升了
        finally:
            store.close()

    def test_boost_respects_max(self, tmp_path: Path) -> None:
        """极高频访问不会超过 boost_max 上限。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            core = ConsolidationCore(store)
            # 1000 次/天 → tanh ≈ 1.0, boost_factor 应被钳制
            ep: dict[str, object] = {
                "access_count": 100000,
                "timestamp": _BASE_TIME - 100 * 86400,
                "importance": 0.5,
            }
            new_imp = core.recalc_importance(ep, now=_BASE_TIME)  # type: ignore[arg-type]
            max_allowed = 0.5 * (1.0 + settings.consolidation_access_boost_max)
            assert new_imp <= max_allowed + 0.001
        finally:
            store.close()

    def test_already_at_one_stays_one(self, tmp_path: Path) -> None:
        """importance=1.0 → 钳制后仍为 1.0。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            core = ConsolidationCore(store)
            ep: dict[str, object] = {
                "access_count": 100,
                "timestamp": _BASE_TIME - 86400,
                "importance": 1.0,
            }
            new_imp = core.recalc_importance(ep, now=_BASE_TIME)  # type: ignore[arg-type]
            assert new_imp == pytest.approx(1.0, abs=0.001)
        finally:
            store.close()


class TestConsolidateAllBoost:
    """consolidate_all 合并公式（冷却 + 用进 boost）测试。"""

    def test_boost_counteracts_cooldown(self, tmp_path: Path) -> None:
        """高频访问 memory 的 importance 在冷却后保持稳定。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            # 创建 48h 前（超出 grace_period），但 access_count 很高
            two_days_ago = _BASE_TIME - 48 * 3600
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance, access_count) "
                "VALUES (?, ?, ?, ?)",
                ("高频记忆", two_days_ago, 0.5, 50),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            result = core.consolidate_all(now=_BASE_TIME)

            # 冷却：*0.98, boost: tanh(50/2)=tanh(25)≈1.0, boost_factor≈1.2
            # 合并: 0.5 * 0.98 * 1.2 ≈ 0.588
            ep = store.get_all_episodes()[0]
            assert ep["importance"] > 0.5  # 提升了！
            assert "boosted" in result
            assert cast(int, result["boosted"]) >= 1
        finally:
            store.close()

    def test_low_access_still_cools(self, tmp_path: Path) -> None:
        """低频访问 memory（access_count=0）正常降温。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            two_days_ago = _BASE_TIME - 48 * 3600
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance, access_count) "
                "VALUES (?, ?, ?, ?)",
                ("低频记忆", two_days_ago, 0.5, 0),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            result = core.consolidate_all(now=_BASE_TIME)

            # 无 boost: 0.5 * 0.98 = 0.49
            ep = store.get_all_episodes()[0]
            expected = 0.5 * (1.0 - settings.consolidation_cooldown_rate)
            assert ep["importance"] == pytest.approx(expected, abs=0.001)
            assert result["boosted"] == 0
        finally:
            store.close()

    def test_boosted_count_in_result(self, tmp_path: Path) -> None:
        """结果中 boosted 键准确计数获得提升的 episode 数。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            two_days_ago = _BASE_TIME - 48 * 3600
            # 高频
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance, access_count) "
                "VALUES (?, ?, ?, ?)",
                ("高频", two_days_ago, 0.5, 100),
            )
            # 低频
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp, importance, access_count) "
                "VALUES (?, ?, ?, ?)",
                ("低频", two_days_ago, 0.5, 0),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            result = core.consolidate_all(now=_BASE_TIME)
            assert result["boosted"] == 1
            assert result["total"] == 2
        finally:
            store.close()


class TestProtectHot:
    """protect_hot 遗忘豁免测试。"""

    def _seed_recall_logs(self, store: MemoryStore, eid: int, timestamps: list[float]) -> None:
        """辅助方法：为 episode 插入 recall_log 记录。"""
        assert store.conn is not None
        for ts in timestamps:
            store.conn.execute(
                "INSERT INTO recall_log (episode_id, recalled_at, strength_before, strength_after) "
                "VALUES (?, ?, ?, ?)",
                (eid, ts, 0.5, 0.8),
            )
        store.conn.commit()

    def test_empty_db_returns_zero(self, tmp_path: Path) -> None:
        """空库 protect_hot 返回全零。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            core = ConsolidationCore(store)
            result = core.protect_hot(now=_BASE_TIME)
            assert result == {"protected": 0, "checked": 0}
        finally:
            store.close()

    def test_insufficient_recalls_skips(self, tmp_path: Path) -> None:
        """recall_log 不足 N 条时跳过。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            eid = store.add_episode("普通记忆")
            # 仅 2 条记录，不足 3 条阈值
            self._seed_recall_logs(
                store,
                eid,
                [_BASE_TIME - 3600, _BASE_TIME - 1800],
            )

            core = ConsolidationCore(store)
            result = core.protect_hot(now=_BASE_TIME)
            assert result["protected"] == 0
            assert result["checked"] == 1
        finally:
            store.close()

    def test_exact_n_recalls_triggers_protection(self, tmp_path: Path) -> None:
        """正好 N 条窗口内召回记录 → 触发保护。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            eid = store.add_episode("热记忆", importance=0.5)
            # 3 条记录，均在 1h 窗口内
            self._seed_recall_logs(
                store,
                eid,
                [_BASE_TIME - 5400, _BASE_TIME - 3600, _BASE_TIME - 1800],
            )

            core = ConsolidationCore(store)
            result = core.protect_hot(now=_BASE_TIME)
            assert result["protected"] == 1
            assert result["checked"] == 1

            # importance 被提升
            ep = store.get_all_episodes()[0]
            assert ep["importance"] == pytest.approx(
                0.5 + settings.consolidation_protect_boost, abs=0.001
            )
        finally:
            store.close()

    def test_recalls_outside_window_skips(self, tmp_path: Path) -> None:
        """N 条记录但部分在窗口外 → 跳过。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            eid = store.add_episode("温记忆", importance=0.5)
            # 3 条记录，最老的在 8 天前（超出 7 天窗口）
            self._seed_recall_logs(
                store,
                eid,
                [
                    _BASE_TIME - 8 * 86400,  # 8 天前——超出 7 天窗口
                    _BASE_TIME - 3600,
                    _BASE_TIME - 1800,
                ],
            )

            core = ConsolidationCore(store)
            result = core.protect_hot(now=_BASE_TIME)
            assert result["protected"] == 0
            # importance 不变
            ep = store.get_all_episodes()[0]
            assert ep["importance"] == pytest.approx(0.5, abs=0.001)
        finally:
            store.close()

    def test_importance_already_one_skips(self, tmp_path: Path) -> None:
        """importance 已达 1.0 → 跳过（无提升空间）。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            eid = store.add_episode("顶格记忆", importance=1.0)
            self._seed_recall_logs(
                store,
                eid,
                [_BASE_TIME - 5400, _BASE_TIME - 3600, _BASE_TIME - 1800],
            )

            core = ConsolidationCore(store)
            result = core.protect_hot(now=_BASE_TIME)
            assert result["protected"] == 0
        finally:
            store.close()

    def test_protect_clamps_at_one(self, tmp_path: Path) -> None:
        """importance + boost 超过 1.0 时钳制到 1.0。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            eid = store.add_episode("接近顶格", importance=0.85)
            self._seed_recall_logs(
                store,
                eid,
                [_BASE_TIME - 5400, _BASE_TIME - 3600, _BASE_TIME - 1800],
            )

            core = ConsolidationCore(store)
            result = core.protect_hot(now=_BASE_TIME)
            assert result["protected"] == 1
            ep = store.get_all_episodes()[0]
            assert ep["importance"] == pytest.approx(1.0, abs=0.001)
        finally:
            store.close()

    def test_protect_does_not_touch_last_consolidated_at(self, tmp_path: Path) -> None:
        """保护路径使用 update_importance_batch，不动 last_consolidated_at。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            eid = store.add_episode("热记忆", importance=0.5)
            self._seed_recall_logs(
                store,
                eid,
                [_BASE_TIME - 5400, _BASE_TIME - 3600, _BASE_TIME - 1800],
            )

            core = ConsolidationCore(store)
            core.protect_hot(now=_BASE_TIME)

            ep = store.get_all_episodes()[0]
            # last_consolidated_at 应保持 NULL（未被 protect 路径修改）
            assert ep["last_consolidated_at"] is None
        finally:
            store.close()

    def test_multiple_episodes_mixed(self, tmp_path: Path) -> None:
        """混合场景：部分满足条件，部分不满足。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            eid1 = store.add_episode("热记忆", importance=0.5)
            eid2 = store.add_episode("冷记忆", importance=0.5)
            eid3 = store.add_episode("顶格记忆", importance=1.0)

            self._seed_recall_logs(
                store,
                eid1,
                [_BASE_TIME - 5400, _BASE_TIME - 3600, _BASE_TIME - 1800],
            )
            # eid2 只有 1 条记录，不足阈值
            self._seed_recall_logs(store, eid2, [_BASE_TIME - 3600])
            # eid3 有 N 条记录但 importance 已达 1.0
            self._seed_recall_logs(
                store,
                eid3,
                [_BASE_TIME - 5400, _BASE_TIME - 3600, _BASE_TIME - 1800],
            )

            core = ConsolidationCore(store)
            result = core.protect_hot(now=_BASE_TIME)
            assert result["protected"] == 1  # 只有 eid1
            assert result["checked"] == 3

            eps = {ep["content"]: ep for ep in store.get_all_episodes()}
            assert eps["热记忆"]["importance"] > 0.5
            assert eps["冷记忆"]["importance"] == pytest.approx(0.5, abs=0.001)
            assert eps["顶格记忆"]["importance"] == pytest.approx(1.0, abs=0.001)
        finally:
            store.close()


class TestUpdateImportanceBatch:
    """MemoryStore.update_importance_batch 测试。"""

    def test_batch_updates_importance_only(self, tmp_path: Path) -> None:
        """update_importance_batch 仅写 importance，不动 last_consolidated_at。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            eid1 = store.add_episode("记忆1", importance=0.5)
            eid2 = store.add_episode("记忆2", importance=0.3)

            store.update_importance_batch([(eid1, 0.8), (eid2, 0.6)])

            eps = {ep["id"]: ep for ep in store.get_all_episodes()}
            assert eps[eid1]["importance"] == pytest.approx(0.8, abs=0.001)
            assert eps[eid2]["importance"] == pytest.approx(0.6, abs=0.001)
            # last_consolidated_at 不应被修改
            assert eps[eid1]["last_consolidated_at"] is None
            assert eps[eid2]["last_consolidated_at"] is None
        finally:
            store.close()

    def test_empty_batch_noop(self, tmp_path: Path) -> None:
        """空列表不崩溃，不产生写操作。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            store.update_importance_batch([])  # 不应崩溃
        finally:
            store.close()

    def test_multiple_rows_in_transaction(self, tmp_path: Path) -> None:
        """多行在同一事务中原子更新。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            eids = [store.add_episode(f"记忆{i}", importance=0.5) for i in range(5)]

            updates = [(eid, 0.9) for eid in eids]
            store.update_importance_batch(updates)

            eps = store.get_all_episodes()
            for ep in eps:
                assert ep["importance"] == pytest.approx(0.9, abs=0.001)
        finally:
            store.close()


class TestForgettingEngineInteraction:
    """与 ForgettingEngine 交互测试——验证保护 & 冷却联合效果。"""

    def test_protected_memory_survives_consolidation_cycle(self, tmp_path: Path) -> None:
        """保护后执行 consolidate_all——高频记忆 importance 不降反升。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            # 创建 7 天前的 memory（超出 grace_period）
            seven_days_ago = _BASE_TIME - 7 * 86400
            eid = store.add_episode("待保护记忆", importance=0.5)

            # 手动设置 timestamp 为 7 天前
            store.conn.execute(
                "UPDATE episodes SET timestamp = ? WHERE id = ?",
                (seven_days_ago, eid),
            )
            # 插入 3 条窗口内召回记录（触发 protect_hot）
            for ts in [_BASE_TIME - 5400, _BASE_TIME - 3600, _BASE_TIME - 1800]:
                store.conn.execute(
                    "INSERT INTO recall_log "
                    "(episode_id, recalled_at, strength_before, strength_after) "
                    "VALUES (?, ?, ?, ?)",
                    (eid, ts, 0.5, 0.8),
                )
            store.conn.commit()

            # 执行完整固化周期：先保护，再合并冷却+boost
            core = ConsolidationCore(store)
            core.protect_hot(now=_BASE_TIME)

            # protect_hot 应该提升了 importance
            ep_after_protect = store.get_all_episodes()[0]
            assert ep_after_protect["importance"] > 0.5

            # consolidate_all 在此基础上应用合并公式
            result = core.consolidate_all(now=_BASE_TIME)
            assert result["total"] == 1

            # 最终 importance 仍高于原始值（保护 + 用进 > 冷却）
            ep_final = store.get_all_episodes()[0]
            assert ep_final["importance"] > 0.5
        finally:
            store.close()

    def test_unprotected_old_memory_cools_normally(self, tmp_path: Path) -> None:
        """未受保护的旧 memory 正常冷却。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            two_days_ago = _BASE_TIME - 48 * 3600
            eid = store.add_episode("旧记忆", importance=0.5)
            store.conn.execute(
                "UPDATE episodes SET timestamp = ? WHERE id = ?",
                (two_days_ago, eid),
            )
            store.conn.commit()

            core = ConsolidationCore(store)
            core.protect_hot(now=_BASE_TIME)  # 无召回记录，不保护
            core.consolidate_all(now=_BASE_TIME)

            ep = store.get_all_episodes()[0]
            # 无 boost: 0.5 * 0.98 = 0.49
            expected = 0.5 * (1.0 - settings.consolidation_cooldown_rate)
            assert ep["importance"] == pytest.approx(expected, abs=0.001)
        finally:
            store.close()

    def test_end_to_end_recall_protect_verify(self, tmp_path: Path) -> None:
        """端到端：N 次召回 → protect_hot → importance 提升 → 验证不丢。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            # 模拟 RecallEngine.recall() 流程中发生的：
            # store.update_strength() 每次召回都会 bump access_count + 更新 last_recall
            # store.log_recall() 记录召回事件
            eid = store.add_episode("被频繁召回的对话片段", importance=0.5)

            for _ in range(5):
                # 模拟 5 次召回
                store.update_strength(eid, 0.8)
                store.log_recall(eid, 0.5, 0.8)

            # 验证 access_count 被 bump 到 5
            ep = store.get_all_episodes()[0]
            assert ep["access_count"] == 5

            # 执行保护
            core = ConsolidationCore(store)
            protect_result = core.protect_hot(now=_BASE_TIME + 1)
            assert protect_result["protected"] == 1

            # importance 被提升
            ep_after = store.get_all_episodes()[0]
            assert ep_after["importance"] > 0.5

            # 验证 protect 未污染 last_consolidated_at
            assert ep_after["last_consolidated_at"] is None
        finally:
            store.close()
