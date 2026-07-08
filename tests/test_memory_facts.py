from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import cast

from src.memory.store import MemoryStore


class TestFactConfidenceLog:
    def test_log_and_retrieve_history(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        fid = store.add_fact("用户 — 喜欢 → 猫", confidence=0.5)
        store.log_fact_confidence(fid, 0.0, 0.5, reason="initial")
        store.log_fact_confidence(fid, 0.5, 0.65, reason="merge")

        history = store.get_fact_confidence_history(fid)
        assert len(history) == 2
        assert history[0]["confidence_before"] == 0.0
        assert history[0]["confidence_after"] == 0.5
        assert history[0]["reason"] == "initial"
        assert history[1]["confidence_before"] == 0.5
        assert history[1]["confidence_after"] == 0.65
        assert history[1]["reason"] == "merge"
        store.close()

    def test_empty_history_for_new_fact(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        fid = store.add_fact("用户 — 喜欢 → 猫")
        assert store.get_fact_confidence_history(fid) == []
        store.close()

    def test_history_ordered_by_time(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        fid = store.add_fact("test")
        store.log_fact_confidence(fid, 0.0, 0.5, "initial")
        time.sleep(0.02)
        store.log_fact_confidence(fid, 0.5, 0.6, "merge")
        time.sleep(0.02)
        store.log_fact_confidence(fid, 0.6, 0.4, "conflict")

        history = store.get_fact_confidence_history(fid)
        assert len(history) == 3
        confs = [h["confidence_after"] for h in history]
        assert confs == [0.5, 0.6, 0.4]
        store.close()

    def test_cascade_delete_cleans_up_log(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        fid = store.add_fact("test")
        store.log_fact_confidence(fid, 0.0, 0.5, "initial")
        assert len(store.get_fact_confidence_history(fid)) == 1

        store.delete_fact(fid)
        assert store.get_fact_confidence_history(fid) == []
        store.close()

    def test_add_fact_with_subject_relation_object(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        fid = store.add_fact(
            "用户 — 喜欢 → 布偶猫",
            subject="用户",
            relation="喜欢",
            object="布偶猫",
        )
        facts = store.get_all_facts()
        assert len(facts) == 1
        assert facts[0]["subject"] == "用户"
        assert facts[0]["relation"] == "喜欢"
        assert facts[0]["object"] == "布偶猫"
        assert facts[0]["id"] == fid
        store.close()

    def test_add_fact_backward_compat_no_triple_fields(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        fid = store.add_fact("自由文本事实")
        facts = store.get_all_facts()
        assert facts[0]["content"] == "自由文本事实"
        assert facts[0]["subject"] is None
        assert facts[0]["relation"] is None
        assert facts[0]["object"] is None
        assert facts[0]["id"] == fid
        store.close()

    def test_get_facts_by_subject_filters_correctly(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_fact("用户 — 喜欢 → 猫", subject="用户", relation="喜欢", object="猫")
        store.add_fact("用户 — 工作地点 → 北京", subject="用户", relation="工作地点", object="北京")
        store.add_fact("小明 — 职业 → 工程师", subject="小明", relation="职业", object="工程师")

        user_facts = store.get_facts_by_subject("用户")
        assert len(user_facts) == 2
        assert all(f["subject"] == "用户" for f in user_facts)
        # Ordered by confidence DESC
        assert user_facts[0]["confidence"] >= user_facts[1]["confidence"]
        store.close()

    def test_get_facts_by_subject_empty(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.get_facts_by_subject("nonexistent") == []
        store.close()

    def test_migration_backfills_subject_from_content(self, tmp_path: Path) -> None:

        db_path = str(tmp_path / "old.db")
        conn = sqlite3.connect(db_path)
        conn.execute(
            "CREATE TABLE facts (id INTEGER PRIMARY KEY, content TEXT, "
            "confidence REAL DEFAULT 0.5, source_episode_id INTEGER, "
            "faiss_id INTEGER, created_at REAL, updated_at REAL)"
        )
        conn.execute(
            "INSERT INTO facts (content, confidence) VALUES (?, ?)",
            ("用户 — 喜欢 → 布偶猫", 0.8),
        )
        conn.commit()
        conn.close()

        store = MemoryStore(db_path)
        store.init_db()
        facts = store.get_all_facts()
        assert facts[0]["subject"] == "用户"
        assert facts[0]["relation"] == "喜欢"
        assert facts[0]["object"] == "布偶猫"
        store.close()

    def test_migration_adds_confidence_log_table(self, tmp_path: Path) -> None:

        db_path = str(tmp_path / "old.db")
        conn = sqlite3.connect(db_path)
        conn.execute(
            "CREATE TABLE facts (id INTEGER PRIMARY KEY, content TEXT, "
            "confidence REAL DEFAULT 0.5, source_episode_id INTEGER, "
            "faiss_id INTEGER, created_at REAL, updated_at, "
            "subject TEXT, relation TEXT, object TEXT)"
        )
        conn.commit()
        conn.close()

        store = MemoryStore(db_path)
        store.init_db()
        tables = {
            row[0]
            for row in store.conn.execute(  # type: ignore[union-attr]
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "fact_confidence_log" in tables
        store.close()


class TestGetTagDetail:
    """测试 get_tag_detail — 标签来源追溯 (Phase 30 B1)。"""

    def test_basic_tag_detail(self, tmp_path: Path) -> None:
        """基本场景：同一 (subject, relation) 的多条 fact + episode + confidence log。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid = store.add_episode("用户喜欢布偶猫，因为它们温顺可爱")
        fid1 = store.add_fact(
            "用户 — 喜欢 → 布偶猫",
            subject="用户",
            relation="喜欢",
            object="布偶猫",
            confidence=0.9,
            source_episode_id=eid,
        )
        store.add_fact(
            "用户 — 喜欢 → 橘猫",
            subject="用户",
            relation="喜欢",
            object="橘猫",
            confidence=0.7,
            source_episode_id=eid,
        )
        store.log_fact_confidence(fid1, 0.8, 0.9, reason="用户确认")
        store.log_fact_confidence(fid1, 0.9, 0.95, reason="再次确认")

        result = store.get_tag_detail("用户", "喜欢")

        assert result["subject"] == "用户"
        assert result["relation"] == "喜欢"
        assert result["max_confidence"] == 0.9
        assert result["fact_count"] == 2
        assert result["distinct_objects"] == 2  # 布偶猫 + 橘猫

        facts = cast("list[dict[str, object]]", result["facts"])
        assert len(facts) == 2
        # 按 confidence DESC 排序
        assert float(facts[0]["confidence"]) >= float(facts[1]["confidence"])  # type: ignore[arg-type]
        # 第一条 fact 的 episode 信息
        assert facts[0]["episode_content"] == "用户喜欢布偶猫，因为它们温顺可爱"
        assert facts[0]["episode_timestamp"] is not None

        # 第一条 fact 的 confidence log（应该有 2 条）
        logs = cast("list[dict[str, object]]", facts[0]["confidence_log"])
        assert len(logs) == 2
        assert logs[0]["confidence_before"] == 0.8
        assert logs[0]["confidence_after"] == 0.9
        assert logs[1]["confidence_before"] == 0.9
        assert logs[1]["confidence_after"] == 0.95

        store.close()

    def test_tag_detail_empty_for_nonexistent(self, tmp_path: Path) -> None:
        """不存在的 (subject, relation) 返回空结果。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        result = store.get_tag_detail("nonexistent", "nonexistent")

        assert result["subject"] == "nonexistent"
        assert result["relation"] == "nonexistent"
        assert result["max_confidence"] == 0.0
        assert result["fact_count"] == 0
        assert result["distinct_objects"] == 0
        assert result["facts"] == []

        store.close()

    def test_tag_detail_without_episode(self, tmp_path: Path) -> None:
        """Fact 没有关联 episode 时 episode_content 为 None。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        store.add_fact(
            "用户 — 工作地点 → 北京",
            subject="用户",
            relation="工作地点",
            object="北京",
            confidence=0.8,
            source_episode_id=None,
        )

        result = store.get_tag_detail("用户", "工作地点")

        assert result["fact_count"] == 1
        fact = cast("list[dict[str, object]]", result["facts"])[0]
        assert fact["episode_content"] is None
        assert fact["episode_timestamp"] is None
        assert fact["confidence_log"] == []

        store.close()

    def test_tag_detail_no_confidence_logs(self, tmp_path: Path) -> None:
        """没有 confidence log 时返回空列表。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        store.add_fact(
            "用户 — 职业 → 工程师",
            subject="用户",
            relation="职业",
            object="工程师",
        )

        result = store.get_tag_detail("用户", "职业")

        assert result["fact_count"] == 1
        assert cast("list[dict[str, object]]", result["facts"])[0]["confidence_log"] == []

        store.close()
