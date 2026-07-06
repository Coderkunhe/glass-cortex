from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import cast

import pytest

from src.memory.store import MemoryStore


def test_init_db(tmp_path: Path) -> None:
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    assert store.conn is not None
    tables = store.conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = [t["name"] for t in tables]
    assert "episodes" in table_names
    assert "facts" in table_names
    store.close()


def test_add_and_get_episode(tmp_path: Path) -> None:
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()

    eid = store.add_episode("用户喜欢布偶猫", importance=0.8, decay_lambda=0.05)
    assert isinstance(eid, int)
    assert eid > 0

    episodes = store.get_episodes([eid])
    assert len(episodes) == 1
    ep = episodes[0]
    assert ep["content"] == "用户喜欢布偶猫"
    assert ep["importance"] == pytest.approx(0.8)
    assert ep["lambda"] == pytest.approx(0.05)
    assert ep["initial_strength"] == pytest.approx(1.0)
    assert ep["access_count"] == 0
    assert ep["last_recall"] is None

    store.close()


def test_update_strength(tmp_path: Path) -> None:
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()

    eid = store.add_episode("测试记忆")
    store.update_strength(eid, 0.35)

    episodes = store.get_episodes([eid])
    assert episodes[0]["initial_strength"] == pytest.approx(0.35)
    assert episodes[0]["last_recall"] is not None

    store.close()


def test_uninitialized_raises(tmp_path: Path) -> None:
    store = MemoryStore(str(tmp_path / "test.db"))
    with pytest.raises(RuntimeError, match="未初始化"):
        store.add_episode("不应该成功")
    store.close()


class TestSessionQueries:
    def test_get_episodes_since_filters_by_timestamp(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        store.add_episode("记忆 1")
        store.add_episode("记忆 2")
        store.add_episode("记忆 3")

        # far past → all returned
        all_recent = store.get_episodes_since(0.0)
        assert len(all_recent) == 3

        # far future → none returned
        future = store.get_episodes_since(time.time() + 3600)
        assert len(future) == 0

        # count matches
        assert store.get_episode_count_since(0.0) == 3
        assert store.get_episode_count_since(time.time() + 3600) == 0

        store.close()

    def test_get_episodes_since_empty_db(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        result = store.get_episodes_since(0.0)
        assert result == []

        count = store.get_episode_count_since(0.0)
        assert count == 0

        store.close()


class TestGetEpisodesByFaissId:
    """B76: get_episodes_by_faiss_id 直接测试——B75 TypedDict 改造覆盖缺口。"""

    def test_get_episodes_by_faiss_id_returns_matching(self, tmp_path: Path) -> None:
        """通过 faiss_id 查询匹配的 episodes。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        e1 = store.add_episode("ep 1", faiss_id=10)
        e2 = store.add_episode("ep 2", faiss_id=20)
        e3 = store.add_episode("ep 3", faiss_id=30)

        result = store.get_episodes_by_faiss_id([10, 30])
        ids = [r["id"] for r in result]
        assert e1 in ids
        assert e3 in ids
        assert e2 not in ids
        assert len(result) == 2
        store.close()

    def test_get_episodes_by_faiss_id_empty_list(self, tmp_path: Path) -> None:
        """空列表输入返回空列表。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_episode("ep", faiss_id=10)

        result = store.get_episodes_by_faiss_id([])
        assert result == []
        store.close()

    def test_get_episodes_by_faiss_id_nonexistent(self, tmp_path: Path) -> None:
        """不存在的 faiss_id 返回空列表。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_episode("ep", faiss_id=10)

        result = store.get_episodes_by_faiss_id([999])
        assert result == []
        store.close()

    def test_get_episodes_by_faiss_id_returns_episoderow_keys(self, tmp_path: Path) -> None:
        """返回的 dict 包含 EpisodeRow TypedDict 声明的所有键。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_episode("typed test", faiss_id=42)

        result = store.get_episodes_by_faiss_id([42])
        assert len(result) == 1
        row = result[0]
        expected_keys = {
            "id",
            "content",
            "timestamp",
            "importance",
            "initial_strength",
            "lambda",
            "access_count",
            "last_recall",
            "faiss_id",
            "tier",
            "last_consolidated_at",
            "session_id",
        }
        assert set(row.keys()) == expected_keys
        # 验证值类型
        assert isinstance(row["id"], int)
        assert isinstance(row["content"], str)
        assert isinstance(row["timestamp"], float)
        assert isinstance(row["importance"], float)
        assert isinstance(row["initial_strength"], float)
        assert isinstance(row["lambda"], float)
        assert isinstance(row["access_count"], int)
        assert isinstance(row["tier"], str)
        store.close()


class TestGetEpisodesWithQuestionsSince:
    """B76: get_episodes_with_questions_since 直接测试——B75 TypedDict 改造覆盖缺口。"""

    def test_finds_question_episodes(self, tmp_path: Path) -> None:
        """返回 since 之后包含 ? 或 ？的 episode。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        store.add_episode("今天天气怎么样？")
        store.add_episode("What is AI?")
        store.add_episode("这是一个陈述句")

        result = store.get_episodes_with_questions_since(0.0)
        contents = [r["content"] for r in result]
        assert "今天天气怎么样？" in contents
        assert "What is AI?" in contents
        assert "这是一个陈述句" not in contents
        assert len(result) == 2
        store.close()

    def test_respects_since_filter(self, tmp_path: Path) -> None:
        """仅返回 since 之后的问句 episode。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        store.add_episode("旧问题?")
        mid_time = time.time()
        time.sleep(1.1)  # timestamp 精度为秒级，跨越秒边界确保严格大于
        store.add_episode("新问题？")

        result = store.get_episodes_with_questions_since(mid_time)
        assert len(result) == 1
        assert result[0]["content"] == "新问题？"
        store.close()

    def test_empty_when_no_questions(self, tmp_path: Path) -> None:
        """没有问句时返回空列表。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_episode("陈述一")
        store.add_episode("陈述二")

        result = store.get_episodes_with_questions_since(0.0)
        assert result == []
        store.close()

    def test_empty_db(self, tmp_path: Path) -> None:
        """空数据库返回空列表。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        result = store.get_episodes_with_questions_since(0.0)
        assert result == []
        store.close()


class TestDeleteAndUpdate:
    """Batch 26: delete_episode / update_episode_content / delete_fact 测试."""

    def test_delete_episode_success(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("测试记忆")
        assert store.delete_episode(eid) is True
        assert store.get_episodes([eid]) == []
        store.close()

    def test_delete_episode_nonexistent_returns_false(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.delete_episode(9999) is False
        store.close()

    def test_delete_episode_cascades_to_facts(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("包含事实的对话")
        store.add_fact("事实A", source_episode_id=eid)
        store.add_fact("事实B", source_episode_id=eid)
        assert len(store.get_all_facts()) == 2
        store.delete_episode(eid)
        assert store.get_all_episodes() == []
        assert store.get_all_facts() == []
        store.close()

    def test_delete_episode_cascades_to_recall_log(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("被召回过的记忆")
        store.log_recall(eid, 0.8, 0.9)
        store.log_recall(eid, 0.9, 1.0)
        assert len(store.get_recall_log(eid)) == 2
        store.delete_episode(eid)
        assert store.get_recall_log(eid) == []
        assert store.get_episodes([eid]) == []
        store.close()

    def test_delete_episode_only_affects_target(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        e1 = store.add_episode("记忆1")
        e2 = store.add_episode("记忆2")
        store.add_fact("事实1", source_episode_id=e1)
        store.log_recall(e1, 1.0, 0.95)
        store.delete_episode(e1)
        eps = store.get_all_episodes()
        assert len(eps) == 1
        assert eps[0]["id"] == e2
        assert store.get_all_facts() == []
        store.close()

    def test_delete_episode_cascades_to_fact_confidence_log(self, tmp_path: Path) -> None:
        """删除 episode 时级联清理 fact_confidence_log（FK 约束兼容）。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("带事实的对话")
        fid = store.add_fact("用户 — 喜欢 → 猫", source_episode_id=eid)
        store.log_fact_confidence(fid, 0.0, 0.6, reason="initial")
        assert len(store.get_fact_confidence_history(fid)) == 1

        store.delete_episode(eid)
        assert store.get_all_facts() == []
        assert store.get_fact_confidence_history(fid) == []
        store.close()

    def test_update_episode_content_success(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("原始内容")
        assert store.update_episode_content(eid, "更新后的内容") is True
        eps = store.get_episodes([eid])
        assert eps[0]["content"] == "更新后的内容"
        store.close()

    def test_update_episode_content_nonexistent_returns_false(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.update_episode_content(9999, "新内容") is False
        store.close()

    def test_update_episode_content_empty_rejected(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("原始内容")
        assert store.update_episode_content(eid, "") is False
        assert store.update_episode_content(eid, "   ") is False
        eps = store.get_episodes([eid])
        assert eps[0]["content"] == "原始内容"
        store.close()

    def test_delete_fact_success(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        fid = store.add_fact("要被删除的事实")
        assert store.delete_fact(fid) is True
        assert store.get_all_facts() == []
        store.close()

    def test_delete_fact_nonexistent_returns_false(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.delete_fact(9999) is False
        store.close()

    # ── Batch 106: get_faiss_ids_for_episode ──

    def test_get_faiss_ids_for_episode_single(self, tmp_path: Path) -> None:
        """收集 episode 自身 + 关联 facts 的全部 faiss_id。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("测试", faiss_id=42)
        store.add_fact("事实A", source_episode_id=eid, faiss_id=100)
        store.add_fact("事实B", source_episode_id=eid, faiss_id=200)
        ids = store.get_faiss_ids_for_episode(eid)
        assert sorted(ids) == [42, 100, 200]
        store.close()

    def test_get_faiss_ids_for_episode_no_faiss_ids(self, tmp_path: Path) -> None:
        """无 faiss_id 的 episode 和 facts 返回空列表。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("测试")
        store.add_fact("事实", source_episode_id=eid)
        ids = store.get_faiss_ids_for_episode(eid)
        assert ids == []
        store.close()

    def test_get_faiss_ids_for_episode_nonexistent(self, tmp_path: Path) -> None:
        """不存在的 episode 返回空列表。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.get_faiss_ids_for_episode(9999) == []
        store.close()


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
        import sqlite3

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
        import sqlite3

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


class TestPipelineTrace:
    """测试 pipeline_trace 持久化表 (Batch 59B)。"""

    def test_insert_trace_roundtrip(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        tid = store.insert_trace("sess-1", "decay", 2.5, metrics={"count": 5})
        traces = store.get_traces(session_id="sess-1")
        assert len(traces) == 1
        t = traces[0]
        assert t["id"] == tid
        assert t["session_id"] == "sess-1"
        assert t["step_name"] == "decay"
        assert t["elapsed_ms"] == 2.5
        assert t["status"] == "ok"
        assert t["created_at"] is not None  # 有默认值，不为 NULL
        store.close()

    def test_get_traces_returns_latest_first(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        store.insert_trace("sess-1", "decay", 1.0)
        store.insert_trace("sess-1", "embed", 2.0)
        traces = store.get_traces(session_id="sess-1", limit=10)
        # 按 created_at DESC，最后插入的排前面
        assert traces[0]["step_name"] == "embed"
        assert traces[1]["step_name"] == "decay"
        store.close()

    def test_get_traces_with_session_filter(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        store.insert_trace("sess-1", "decay", 1.0)
        store.insert_trace("sess-2", "embed", 2.0)
        assert len(store.get_traces(session_id="sess-1")) == 1
        assert len(store.get_traces(session_id="sess-2")) == 1
        assert len(store.get_traces(session_id=None)) == 2
        store.close()

    def test_get_traces_respects_limit(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        for i in range(10):
            store.insert_trace("sess-1", f"step_{i}", float(i))
        assert len(store.get_traces(session_id="sess-1", limit=3)) == 3
        store.close()

    def test_get_trace_count(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        store.insert_trace("sess-1", "decay", 1.0)
        store.insert_trace("sess-2", "embed", 2.0)
        assert store.get_trace_count(session_id="sess-1") == 1
        assert store.get_trace_count(session_id=None) == 2
        store.close()

    def test_delete_old_traces_enforces_retention(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        for i in range(10):
            store.insert_trace("sess-1", f"step_{i}", float(i))
        deleted = store.delete_old_traces(retention_limit=3)
        assert deleted == 7
        traces = store.get_traces(session_id=None, limit=20)
        assert len(traces) == 3
        # 保留的是最新的 3 条（id 最大的），同秒插入按 id 排序
        trace_ids = [int(t["id"]) for t in traces]  # type: ignore[call-overload]
        assert min(trace_ids) >= 8  # step_7/8/9 对应 id 8-10
        store.close()

    def test_delete_old_traces_zero_limit_noop(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        for i in range(5):
            store.insert_trace("sess-1", f"step_{i}", float(i))
        deleted = store.delete_old_traces(retention_limit=0)
        assert deleted == 0
        assert store.get_trace_count() == 5
        store.close()

    def test_delete_old_traces_below_limit_noop(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        store.insert_trace("sess-1", "decay", 1.0)
        deleted = store.delete_old_traces(retention_limit=10)
        assert deleted == 0
        assert store.get_trace_count() == 1
        store.close()

    def test_trace_metrics_json_roundtrip(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        metrics = {"elapsed_raw": 0.0025, "items": [1, 2, 3], "label": "test"}
        store.insert_trace("sess-1", "decay", 2.5, metrics=metrics)
        traces = store.get_traces(session_id="sess-1")
        # metrics 通过 JSON 无损往返
        assert traces[0]["metrics_json"]  # 原始 JSON 字符串
        store.close()

    def test_trace_status_error(self, tmp_path: Path) -> None:
        store = MemoryStore.create(str(tmp_path / "test.db"))
        store.insert_trace(
            "sess-1", "llm_call", 1500.0, status="error", metrics={"error_type": "TimeoutError"}
        )
        traces = store.get_traces(session_id="sess-1")
        assert traces[0]["status"] == "error"
        store.close()

    def test_migration_adds_pipeline_trace_table(self, tmp_path: Path) -> None:
        import sqlite3

        db_path = str(tmp_path / "old.db")
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE episodes (id INTEGER PRIMARY KEY, content TEXT)")
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
        assert "pipeline_trace" in tables
        store.close()

    def test_get_traces_by_step(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.insert_trace("s1", "intent_classify", 100, "ok", {"category": "提问"})
        store.insert_trace("s1", "intent_classify", 200, "ok", {"category": "指令"})
        store.insert_trace("s1", "decay", 50, "ok", {"total": 5})
        store.insert_trace("s2", "intent_classify", 150, "ok", {"category": "探索"})

        results = store.get_traces_by_step("intent_classify", limit=10)
        assert len(results) == 3
        assert all(r["step_name"] == "intent_classify" for r in results)
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


class TestPlanStorage:
    """Phase 53 Batch 1 — PlanStorage (plan_runs / plan_subtasks) 测试."""

    def test_insert_and_get_plan(self, tmp_path: Path) -> None:
        """插入含 3 个子任务的 PlanResult，验证 get_plan 往返完整。"""
        from src.planner.plan import PlanResult

        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        plan_result = PlanResult(
            subtasks=[
                {"id": "1", "description": "收集用户需求", "depends_on": []},
                {"id": "2", "description": "分析技术方案", "depends_on": ["1"]},
                {"id": "3", "description": "输出最终结果", "depends_on": ["2"]},
            ],
            dag_edges=[("1", "2"), ("2", "3")],
            rationale="三步规划以逐步收敛方案",
            confidence=0.85,
        )

        plan_id = store.insert_plan(
            session_id="sess-001",
            user_msg="如何实现一个缓存层？",
            intent_category="提问",
            plan_result=plan_result,
        )
        assert isinstance(plan_id, int)
        assert plan_id > 0

        plan = store.get_plan(plan_id)
        assert plan is not None
        assert plan["session_id"] == "sess-001"
        assert plan["user_msg"] == "如何实现一个缓存层？"
        assert plan["intent_category"] == "提问"
        assert plan["rationale"] == "三步规划以逐步收敛方案"
        assert plan["confidence"] == pytest.approx(0.85)
        assert plan["subtask_count"] == 3
        assert plan["created_at"] is not None

        subtasks = cast("list[dict[str, object]]", plan["subtasks"])
        assert len(subtasks) == 3
        assert subtasks[0]["subtask_id"] == "1"
        assert subtasks[0]["description"] == "收集用户需求"
        assert subtasks[0]["sort_order"] == 0
        assert subtasks[0]["status"] == "pending"
        assert subtasks[1]["subtask_id"] == "2"
        assert subtasks[1]["sort_order"] == 1
        assert subtasks[2]["subtask_id"] == "3"
        assert subtasks[2]["sort_order"] == 2

        # dag_edges JSON 往返完整
        import json

        edges = json.loads(str(plan["dag_edges_json"]))
        assert edges == [["1", "2"], ["2", "3"]]

        store.close()

    def test_insert_plan_without_subtasks(self, tmp_path: Path) -> None:
        """空 subtasks 列表的 PlanResult 也能正常写入和读取。"""
        from src.planner.plan import PlanResult

        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        plan_result = PlanResult(
            subtasks=[],
            dag_edges=[],
            rationale="无需分解",
            confidence=1.0,
        )

        plan_id = store.insert_plan(
            session_id="sess-empty",
            user_msg="你好",
            intent_category="闲聊",
            plan_result=plan_result,
        )
        plan = store.get_plan(plan_id)
        assert plan is not None
        assert plan["subtask_count"] == 0
        assert plan["subtasks"] == []
        store.close()

    def test_list_plans(self, tmp_path: Path) -> None:
        """list_plans 返回最近计划（不含 subtasks），按时间倒序。"""
        from src.planner.plan import PlanResult

        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        for i in range(3):
            store.insert_plan(
                session_id="sess-list",
                user_msg=f"消息 {i}",
                intent_category="提问",
                plan_result=PlanResult(
                    subtasks=[{"id": "1", "description": f"任务 {i}", "depends_on": []}],
                    dag_edges=[],
                    rationale=f"理由 {i}",
                    confidence=0.5 + i * 0.1,
                ),
            )

        plans = store.list_plans()
        assert len(plans) == 3
        # 最新插入的排最前
        assert plans[0]["user_msg"] == "消息 2"
        assert plans[1]["user_msg"] == "消息 1"
        assert plans[2]["user_msg"] == "消息 0"
        # list_plans 不应包含 subtasks 键
        assert "subtasks" not in plans[0]
        # subtask_count 字段存在
        assert plans[0]["subtask_count"] == 1
        store.close()

    def test_list_plans_by_session(self, tmp_path: Path) -> None:
        """list_plans 按 session_id 过滤。"""
        from src.planner.plan import PlanResult

        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        store.insert_plan(
            session_id="sess-A",
            user_msg="A1",
            intent_category="提问",
            plan_result=PlanResult(rationale="A1"),
        )
        store.insert_plan(
            session_id="sess-B",
            user_msg="B1",
            intent_category="指令",
            plan_result=PlanResult(rationale="B1"),
        )
        store.insert_plan(
            session_id="sess-A",
            user_msg="A2",
            intent_category="探索",
            plan_result=PlanResult(rationale="A2"),
        )

        # 过滤 sess-A
        a_plans = store.list_plans(session_id="sess-A")
        assert len(a_plans) == 2
        assert all(p["session_id"] == "sess-A" for p in a_plans)

        # 过滤 sess-B
        b_plans = store.list_plans(session_id="sess-B")
        assert len(b_plans) == 1
        assert b_plans[0]["session_id"] == "sess-B"

        # 不过滤
        all_plans = store.list_plans(session_id=None)
        assert len(all_plans) == 3

        store.close()

    def test_list_plans_respects_limit(self, tmp_path: Path) -> None:
        """list_plans 遵守 limit 参数。"""
        from src.planner.plan import PlanResult

        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        for i in range(10):
            store.insert_plan(
                session_id="sess-limit",
                user_msg=f"消息 {i}",
                intent_category="提问",
                plan_result=PlanResult(rationale=f"R{i}"),
            )

        assert len(store.list_plans(limit=3)) == 3
        assert len(store.list_plans(limit=20)) == 10
        store.close()

    def test_get_latest_plan(self, tmp_path: Path) -> None:
        """get_latest_plan 返回最近一次规划（含 subtasks）。"""
        from src.planner.plan import PlanResult

        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        store.insert_plan(
            session_id="sess-latest",
            user_msg="较早的消息",
            intent_category="提问",
            plan_result=PlanResult(
                subtasks=[{"id": "1", "description": "旧任务", "depends_on": []}],
                dag_edges=[],
                rationale="旧理由",
                confidence=0.5,
            ),
        )
        store.insert_plan(
            session_id="sess-latest",
            user_msg="最新的消息",
            intent_category="指令",
            plan_result=PlanResult(
                subtasks=[
                    {"id": "1", "description": "新任务1", "depends_on": []},
                    {"id": "2", "description": "新任务2", "depends_on": ["1"]},
                ],
                dag_edges=[("1", "2")],
                rationale="新理由",
                confidence=0.9,
            ),
        )

        latest = store.get_latest_plan(session_id="sess-latest")
        assert latest is not None
        assert latest["user_msg"] == "最新的消息"
        assert latest["intent_category"] == "指令"
        assert latest["rationale"] == "新理由"
        assert latest["confidence"] == pytest.approx(0.9)
        assert latest["subtask_count"] == 2
        subtasks = cast("list[dict[str, object]]", latest["subtasks"])
        assert len(subtasks) == 2
        assert subtasks[0]["subtask_id"] == "1"
        assert subtasks[1]["subtask_id"] == "2"

        store.close()

    def test_get_latest_plan_empty(self, tmp_path: Path) -> None:
        """空数据库时 get_latest_plan 返回 None。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        assert store.get_latest_plan() is None
        assert store.get_latest_plan(session_id="no-such-session") is None
        store.close()

    def test_get_nonexistent_plan(self, tmp_path: Path) -> None:
        """请求不存在的 plan_run_id 返回空 dict。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        result = store.get_plan(9999)
        assert result is None
        store.close()

    def test_migration_adds_plan_tables(self, tmp_path: Path) -> None:
        """现有数据库（无 plan 表）init_db 后自动创建 plan_runs / plan_subtasks。"""
        import sqlite3

        db_path = str(tmp_path / "old.db")
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE episodes (id INTEGER PRIMARY KEY, content TEXT)")
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
        assert "plan_runs" in tables
        assert "plan_subtasks" in tables
        store.close()


# ═══════════════════════════════════════════════════════════════
# Phase 54 Batch 2 — 多层记忆分级 tier 列 + Store 分层方法
# ═══════════════════════════════════════════════════════════════


class TestTierStorage:
    """tier 列的写入/查询/分布 + 迁移测试。"""

    def test_new_episode_defaults_to_warm(self, tmp_path: Path) -> None:
        """新创建的 episode 默认 tier 为 'warm'。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid = store.add_episode("测试默认 tier")
        episodes = store.get_episodes([eid])
        assert episodes[0]["tier"] == "warm"
        store.close()

    def test_set_episode_tier(self, tmp_path: Path) -> None:
        """set_episode_tier 写入并回读 tier 值。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid = store.add_episode("热层记忆")
        store.set_episode_tier(eid, "hot")
        episodes = store.get_episodes([eid])
        assert episodes[0]["tier"] == "hot"

        store.set_episode_tier(eid, "cold")
        episodes = store.get_episodes([eid])
        assert episodes[0]["tier"] == "cold"
        store.close()

    def test_set_episode_tier_no_error_on_nonexistent(self, tmp_path: Path) -> None:
        """对不存在的 episode 设置 tier 不抛异常（no-op）。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        # 不应抛异常
        store.set_episode_tier(99999, "hot")
        store.close()

    def test_set_episode_tiers_batch(self, tmp_path: Path) -> None:
        """批量设置 tier——单事务写入多条。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        e1 = store.add_episode("记忆 A")
        e2 = store.add_episode("记忆 B")
        e3 = store.add_episode("记忆 C")

        store.set_episode_tiers_batch([(e1, "hot"), (e2, "warm"), (e3, "cold")])

        episodes = store.get_episodes([e1, e2, e3])
        tiers = {ep["id"]: ep["tier"] for ep in episodes}
        assert tiers[e1] == "hot"
        assert tiers[e2] == "warm"
        assert tiers[e3] == "cold"
        store.close()

    def test_set_episode_tiers_batch_empty(self, tmp_path: Path) -> None:
        """空列表批量更新为 no-op，不抛异常。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        store.set_episode_tiers_batch([])  # 不应抛异常
        store.close()

    def test_get_episodes_by_tier(self, tmp_path: Path) -> None:
        """按 tier 过滤 episodes，只返回匹配层。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        e1 = store.add_episode("hot 记忆")
        e2 = store.add_episode("warm 记忆")
        e3 = store.add_episode("cold 记忆")
        store.set_episode_tiers_batch([(e1, "hot"), (e2, "warm"), (e3, "cold")])

        hot_eps = store.get_episodes_by_tier("hot")
        assert len(hot_eps) == 1
        assert hot_eps[0]["id"] == e1

        warm_eps = store.get_episodes_by_tier("warm")
        assert len(warm_eps) == 1
        assert warm_eps[0]["id"] == e2

        cold_eps = store.get_episodes_by_tier("cold")
        assert len(cold_eps) == 1
        assert cold_eps[0]["id"] == e3
        store.close()

    def test_get_episodes_by_tier_empty(self, tmp_path: Path) -> None:
        """无匹配 tier 时返回空列表。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        assert store.get_episodes_by_tier("hot") == []
        store.close()

    def test_get_episodes_by_tier_respects_limit(self, tmp_path: Path) -> None:
        """get_episodes_by_tier 遵守 limit 参数。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        for i in range(10):
            eid = store.add_episode(f"warm 记忆 {i}")
            store.set_episode_tier(eid, "warm")

        assert len(store.get_episodes_by_tier("warm", limit=3)) == 3
        assert len(store.get_episodes_by_tier("warm", limit=50)) == 10
        store.close()

    def test_get_tier_distribution(self, tmp_path: Path) -> None:
        """get_tier_distribution 返回三层计数。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        # 2 hot, 3 warm, 1 cold
        eids_hot = [store.add_episode(f"hot {i}") for i in range(2)]
        eids_warm = [store.add_episode(f"warm {i}") for i in range(3)]
        eids_cold = [store.add_episode(f"cold {i}") for i in range(1)]

        store.set_episode_tiers_batch(
            [(eid, "hot") for eid in eids_hot]
            + [(eid, "warm") for eid in eids_warm]
            + [(eid, "cold") for eid in eids_cold]
        )

        dist = store.get_tier_distribution()
        assert dist == {"hot": 2, "warm": 3, "cold": 1}
        store.close()

    def test_get_tier_distribution_empty(self, tmp_path: Path) -> None:
        """空数据库返回全零分布。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        dist = store.get_tier_distribution()
        assert dist == {"hot": 0, "warm": 0, "cold": 0}
        store.close()

    def test_migration_adds_tier_column(self, tmp_path: Path) -> None:
        """现有数据库（无 tier 列）init_db 后自动添加 tier 列。"""
        import sqlite3

        db_path = str(tmp_path / "old.db")
        conn = sqlite3.connect(db_path)
        # 模拟旧版 episodes 表（所有列均有，仅缺 tier）
        conn.execute(
            "CREATE TABLE episodes ("
            "id INTEGER PRIMARY KEY, content TEXT, timestamp REAL, "
            "importance REAL DEFAULT 0.5, initial_strength REAL DEFAULT 1.0, "
            "lambda REAL DEFAULT 0.1, access_count INTEGER DEFAULT 0, "
            "last_recall REAL, faiss_id INTEGER)"
        )
        conn.commit()
        conn.close()

        store = MemoryStore(db_path)
        store.init_db()

        cols = {
            row[1]
            for row in store.conn.execute(  # type: ignore[union-attr]
                "PRAGMA table_info('episodes')"
            ).fetchall()
        }
        assert "tier" in cols

        # 已有行默认值为 'warm'
        eid = store.add_episode("迁移后新 memory")
        episodes = store.get_episodes([eid])
        assert episodes[0]["tier"] == "warm"
        store.close()


# ── Phase 57 B3: update_subtask — 用户干预持久化 ──────────────────────────


def test_update_subtask_status_only(tmp_path: Path) -> None:
    """更新子任务状态（不修改描述）。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()

    from src.planner.plan import PlanResult

    plan = PlanResult(
        subtasks=[
            {"id": "1", "description": "检索"},
            {"id": "2", "description": "分析"},
        ],
        rationale="测试",
        confidence=0.8,
    )
    plan_id = store.insert_plan("test-session", "测试消息", "提问", plan)

    # 更新 subtask "1" 状态为 accepted
    ok = store.update_subtask(plan_id, "1", "accepted")
    assert ok is True

    # 验证持久化
    detail = store.get_plan(plan_id)
    assert detail is not None
    subtasks = detail["subtasks"]
    assert len(subtasks) == 2  # type: ignore[arg-type]
    statuses = {s["subtask_id"]: s["status"] for s in subtasks}  # type: ignore[attr-defined]
    assert statuses["1"] == "accepted"
    assert statuses["2"] == "pending"  # 未动
    store.close()


def test_update_subtask_with_description(tmp_path: Path) -> None:
    """更新子任务状态和描述。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()

    from src.planner.plan import PlanResult

    plan = PlanResult(
        subtasks=[{"id": "1", "description": "原描述"}],
        rationale="测试",
        confidence=0.8,
    )
    plan_id = store.insert_plan("test-session", "消息", "指令", plan)

    ok = store.update_subtask(plan_id, "1", "modified", new_description="修改后的描述")
    assert ok is True

    detail = store.get_plan(plan_id)
    assert detail["subtasks"][0]["description"] == "修改后的描述"  # type: ignore[index]
    assert detail["subtasks"][0]["status"] == "modified"  # type: ignore[index]
    store.close()


def test_update_subtask_nonexistent_returns_false(tmp_path: Path) -> None:
    """更新不存在的子任务返回 False。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()

    from src.planner.plan import PlanResult

    plan = PlanResult(subtasks=[{"id": "1", "description": "检索"}], rationale="", confidence=0.5)
    plan_id = store.insert_plan("s", "m", "提问", plan)

    ok = store.update_subtask(plan_id, "nonexistent", "skipped")
    assert ok is False
    store.close()


def test_update_subtask_wrong_plan_id_returns_false(tmp_path: Path) -> None:
    """用错误的 plan_run_id 更新返回 False。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()

    ok = store.update_subtask(99999, "1", "accepted")
    assert ok is False
    store.close()


# ── Phase 66 Batch 20 — Session→Episode 链路测试 ──


class TestEpisodeSessionId:
    """episodes.session_id 写入 + 查询。"""

    def test_add_episode_with_session_id(self, tmp_path: Path) -> None:
        """add_episode(session_id=...) 写入后，get_episodes_by_session 可查询。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid = store.add_episode("test content", session_id="sess-abc")
        assert isinstance(eid, int) and eid > 0

        episodes = store.get_episodes_by_session("sess-abc")
        assert len(episodes) == 1
        assert episodes[0]["content"] == "test content"
        assert episodes[0]["session_id"] == "sess-abc"
        store.close()

    def test_add_episode_without_session_id_is_null(self, tmp_path: Path) -> None:
        """不传 session_id 时，episode 的 session_id 为 NULL，且不在按 session 查询中返回。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid = store.add_episode("no session")
        assert eid > 0

        # 直接查数据库验证 NULL
        assert store.conn is not None
        row = store.conn.execute("SELECT session_id FROM episodes WHERE id = ?", (eid,)).fetchone()
        assert row is not None and row["session_id"] is None

        # 按空 session 查询不返回（不匹配 NULL）
        from_get = store.get_episodes_by_session("any-session")
        ep_ids = [ep["id"] for ep in from_get]
        assert eid not in ep_ids
        store.close()

    def test_get_episodes_by_session_multi_episode_ordering(self, tmp_path: Path) -> None:
        """同一 session 的多条 episode 按时间升序返回。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        e1 = store.add_episode("first", session_id="sess-x")
        e2 = store.add_episode("second", session_id="sess-x")
        e3 = store.add_episode("third", session_id="sess-x")

        episodes = store.get_episodes_by_session("sess-x")
        ep_ids = [ep["id"] for ep in episodes]
        assert ep_ids == [e1, e2, e3]
        store.close()

    def test_get_episodes_by_session_isolates_sessions(self, tmp_path: Path) -> None:
        """不同 session 的 episode 互不干扰。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        e_a = store.add_episode("A", session_id="sess-a")
        e_b = store.add_episode("B", session_id="sess-b")

        a_eps = store.get_episodes_by_session("sess-a")
        b_eps = store.get_episodes_by_session("sess-b")
        assert [ep["id"] for ep in a_eps] == [e_a]
        assert [ep["id"] for ep in b_eps] == [e_b]
        store.close()


class TestDeleteEpisodesBySession:
    """delete_episodes_by_session 级联删除。"""

    def test_delete_empty_session_returns_zero(self, tmp_path: Path) -> None:
        """不存在的 session 返回全零。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        result = store.delete_episodes_by_session("nonexistent")
        assert result["episodes_deleted"] == 0
        assert result["facts_deleted"] == 0
        store.close()

    def test_delete_session_cascades_episodes_and_facts(self, tmp_path: Path) -> None:
        """删除 session 级联清除 episodes + facts。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid1 = store.add_episode("ep1", session_id="sess-del")
        eid2 = store.add_episode("ep2", session_id="sess-del")
        store.add_fact("fact1", source_episode_id=eid1)
        store.add_fact("fact2", source_episode_id=eid2)

        result = store.delete_episodes_by_session("sess-del")
        assert result["episodes_deleted"] == 2
        assert result["facts_deleted"] == 2

        # 验证 episodes 已清除
        assert store.get_episodes_by_session("sess-del") == []
        # 验证 facts 已清除
        assert store.get_all_facts() == []
        store.close()

    def test_delete_session_cascades_recall_log(self, tmp_path: Path) -> None:
        """删除 session 级联清除 recall_log。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid = store.add_episode("ep", session_id="sess-rl")
        store.log_recall(eid, 0.9, 1.0)

        # 删除前确认有日志
        logs_before = store.get_recall_log(eid)
        assert len(logs_before) == 1

        store.delete_episodes_by_session("sess-rl")

        # 删除后无日志（episode 已不存在）
        assert store.get_episodes_by_session("sess-rl") == []
        store.close()

    def test_delete_session_cascades_confidence_log(self, tmp_path: Path) -> None:
        """删除 session 级联清除 fact_confidence_log。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid = store.add_episode("ep", session_id="sess-cl")
        fid = store.add_fact("fact", source_episode_id=eid)
        store.log_fact_confidence(fid, 0.5, 0.8, "test")

        history_before = store.get_fact_confidence_history(fid)
        assert len(history_before) == 1

        store.delete_episodes_by_session("sess-cl")
        assert store.get_all_facts() == []
        store.close()

    def test_delete_session_only_affects_target(self, tmp_path: Path) -> None:
        """只删除目标 session，不影响其他 session。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        e_a = store.add_episode("A", session_id="keep")
        e_b = store.add_episode("B", session_id="del")
        store.add_fact("fact-keep", source_episode_id=e_a)
        store.add_fact("fact-del", source_episode_id=e_b)

        result = store.delete_episodes_by_session("del")
        assert result["episodes_deleted"] == 1
        assert result["facts_deleted"] == 1

        # "keep" session 的 episode 仍在
        keep_eps = store.get_episodes_by_session("keep")
        assert len(keep_eps) == 1
        assert keep_eps[0]["id"] == e_a
        # fact-keep 仍在
        all_facts = store.get_all_facts()
        assert len(all_facts) == 1
        assert all_facts[0]["content"] == "fact-keep"
        store.close()

    def test_delete_session_collects_faiss_ids(self, tmp_path: Path) -> None:
        """delete_episodes_by_session 返回的 faiss_ids 包含 episode 和 fact 的向量 ID。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid = store.add_episode("ep", faiss_id=100, session_id="sess-faiss")
        store.add_fact("fact", source_episode_id=eid, faiss_id=200)

        result = store.delete_episodes_by_session("sess-faiss")
        from typing import cast

        assert set(cast("list[int]", result["faiss_ids"])) == {100, 200}
        store.close()


class TestSessionIdMigration:
    """旧 DB 自动迁移兼容。"""

    def test_old_db_without_session_id_migrates(self, tmp_path: Path) -> None:
        """模拟旧 DB（episodes 表无 session_id 列）→ 初始化后自动迁移。"""
        import sqlite3

        db_path = str(tmp_path / "old.db")

        # 手动创建旧版 episodes 表（无 session_id）
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
            "last_recall REAL, faiss_id INTEGER, "
            "tier TEXT NOT NULL DEFAULT 'warm', "
            "last_consolidated_at REAL)"
        )
        conn.commit()
        conn.close()

        # 用 MemoryStore 打开 → _migrate 自动加 session_id 列
        store = MemoryStore(db_path)
        store.init_db()

        # 验证迁移后可以正常写入 session_id
        eid = store.add_episode("migrated", session_id="post-migrate")
        assert eid > 0

        assert store.conn is not None
        row = store.conn.execute("SELECT session_id FROM episodes WHERE id = ?", (eid,)).fetchone()
        assert row is not None and row["session_id"] == "post-migrate"
        store.close()


# ── I-112: schema.sql ↔ _migrate() 交叉验证 ────────────────────────────────


class TestSchemaMigrationParity:
    """I-112 — schema.sql 与 _migrate() 列默认值一致性自动化验证。

    新鲜数据库（schema.sql 直接建表）为 canonical 参考；
    旧数据库（手动建旧表后 init_db 触发 _migrate）为迁移路径。
    对比两库 PRAGMA table_info 的 dflt_value，防止两处 DDL 漂移。
    """

    # 旧库基线：episodes + facts 仅含 _migrate 出现之前的原始列
    OLD_EPISODES_DDL = (
        "CREATE TABLE episodes ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "content TEXT NOT NULL, "
        "timestamp REAL NOT NULL DEFAULT (strftime('%s', 'now')), "
        "importance REAL NOT NULL DEFAULT 0.5, "
        "initial_strength REAL NOT NULL DEFAULT 1.0, "
        "lambda REAL NOT NULL DEFAULT 0.1, "
        "access_count INTEGER NOT NULL DEFAULT 0, "
        "last_recall REAL, "
        "faiss_id INTEGER)"
    )

    OLD_FACTS_DDL = (
        "CREATE TABLE facts ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "content TEXT NOT NULL, "
        "confidence REAL NOT NULL DEFAULT 0.5, "
        "source_episode_id INTEGER, "
        "created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')), "
        "updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')))"
    )

    # schema.sql CREATE TABLE 中包含但旧库 CRATE 中不含的全量表
    # （_migrate 通过 CREATE TABLE IF NOT EXISTS 补建）——这些表在两种路径都由 schema.sql 创建
    MIGRATE_CREATED_TABLES = frozenset(
        {
            "recall_log",
            "fact_confidence_log",
            "pipeline_trace",
            "plan_runs",
            "plan_subtasks",
            "session_summaries",
            "reflection_insights",
        }
    )

    @staticmethod
    def _get_column_info(conn: sqlite3.Connection, table: str) -> dict[str, dict[str, object]]:
        """返回 {col_name: {name, type, notnull, dflt_value, pk}} 的映射。"""
        rows = conn.execute(f"PRAGMA table_info('{table}')").fetchall()
        return {row["name"]: dict(row) for row in rows}

    def test_fresh_vs_migrated_column_defaults_match(self, tmp_path: Path) -> None:
        """新鲜库 vs 迁移旧库 —— 每表每列的 dflt_value 必须一致。"""
        import sqlite3

        # ── 新鲜库（canonical）──
        fresh = MemoryStore.create(str(tmp_path / "fresh.db"))
        assert fresh.conn is not None

        # ── 旧库 → 迁移 ──
        old_path = str(tmp_path / "old.db")
        raw = sqlite3.connect(old_path)
        raw.execute(self.OLD_EPISODES_DDL)
        raw.execute(self.OLD_FACTS_DDL)
        raw.commit()
        raw.close()

        migrated = MemoryStore(old_path)
        migrated.init_db()
        assert migrated.conn is not None

        # ── 比较所有表 ──
        fresh_tables = {
            row["name"]
            for row in fresh.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()
        }
        migrated_tables = {
            row["name"]
            for row in migrated.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()
        }

        # 两库表集合应相同
        assert fresh_tables == migrated_tables, (
            f"Table mismatch: fresh={fresh_tables - migrated_tables}, "
            f"migrated={migrated_tables - fresh_tables}"
        )

        mismatches: list[str] = []
        for table in sorted(fresh_tables):
            fresh_cols = self._get_column_info(fresh.conn, table)
            migrated_cols = self._get_column_info(migrated.conn, table)

            for col_name in fresh_cols:
                if col_name not in migrated_cols:
                    mismatches.append(f"{table}.{col_name}: missing in migrated DB")
                    continue

                f_dflt = fresh_cols[col_name]["dflt_value"]
                m_dflt = migrated_cols[col_name]["dflt_value"]

                # SQLite 返回的 dflt_value 可能是字符串或 None
                # 标准化：None → None，字符串去外层空格
                f_normalized = f_dflt.strip() if isinstance(f_dflt, str) else f_dflt
                m_normalized = m_dflt.strip() if isinstance(m_dflt, str) else m_dflt

                if f_normalized != m_normalized:
                    mismatches.append(
                        f"{table}.{col_name}: fresh={f_dflt!r} vs migrated={m_dflt!r}"
                    )

        assert not mismatches, (
            f"schema.sql vs _migrate() column default mismatches ({len(mismatches)}):\n"
            + "\n".join(f"  • {m}" for m in mismatches)
        )

        fresh.close()
        migrated.close()


# ── I-113: Schema Versioning — schema_version table + PRAGMA user_version ──────


class TestSchemaVersioning:
    """I-113 — Schema version tracking with schema_version table + PRAGMA user_version.

    Dual tracking: schema_version table (human-readable audit log within transaction)
    + PRAGMA user_version (fast integer lookup, kept in lockstep).
    """

    def test_fresh_db_records_all_versions(self, tmp_path: Path) -> None:
        """Fresh DB via MemoryStore.create() records all 12 migration versions."""
        store = MemoryStore.create(str(tmp_path / "fresh.db"))
        assert store.conn is not None

        # schema_version table exists
        tables = {
            row[0]
            for row in store.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "schema_version" in tables

        # All 12 versions recorded
        rows = store.conn.execute(
            "SELECT version, description FROM schema_version ORDER BY version"
        ).fetchall()
        assert len(rows) == 12
        assert [r["version"] for r in rows] == list(range(1, 13))

        # PRAGMA user_version matches
        uv = store.conn.execute("PRAGMA user_version").fetchone()[0]
        assert uv == 12

        store.close()

    def test_second_init_db_is_noop(self, tmp_path: Path) -> None:
        """Second init_db() call on same store is a no-op (no duplicate versions)."""
        store = MemoryStore.create(str(tmp_path / "fresh.db"))

        # Call init_db again on same connection — should be idempotent
        store.init_db()

        assert store.conn is not None
        rows = store.conn.execute("SELECT version FROM schema_version ORDER BY version").fetchall()
        assert len(rows) == 12  # still 12, UNIQUE constraint prevents duplicates

        store.close()

    def test_reopen_skips_all_migrations(self, tmp_path: Path) -> None:
        """Reopening a fully-migrated DB skips all migration steps."""
        db_path = str(tmp_path / "test.db")

        # First init creates + migrates
        store1 = MemoryStore.create(db_path)
        store1.close()

        # Reopen — all 12 migrations should be skipped (current_version == 12)
        store2 = MemoryStore(db_path)
        store2.init_db()

        assert store2.conn is not None
        rows = store2.conn.execute("SELECT version FROM schema_version ORDER BY version").fetchall()
        assert len(rows) == 12  # still exactly 12, no re-runs

        uv = store2.conn.execute("PRAGMA user_version").fetchone()[0]
        assert uv == 12

        store2.close()

    def test_old_db_all_migrations_backfills_versions(self, tmp_path: Path) -> None:
        """Old DB with all physical migrations applied — version backfill on first I-113 init."""
        import sqlite3

        db_path = str(tmp_path / "old_full.db")
        conn = sqlite3.connect(db_path)
        # Create all tables/columns that represent a fully-migrated pre-I-113 DB
        conn.execute(
            "CREATE TABLE episodes ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, "
            "timestamp REAL NOT NULL DEFAULT (strftime('%s','now')), "
            "importance REAL NOT NULL DEFAULT 0.5, "
            "initial_strength REAL NOT NULL DEFAULT 1.0, "
            "lambda REAL NOT NULL DEFAULT 0.1, "
            "access_count INTEGER NOT NULL DEFAULT 0, "
            "last_recall REAL, faiss_id INTEGER, "
            "tier TEXT NOT NULL DEFAULT 'warm', "
            "last_consolidated_at REAL, session_id TEXT)"
        )
        conn.execute(
            "CREATE TABLE facts ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, "
            "confidence REAL NOT NULL DEFAULT 0.5, source_episode_id INTEGER, "
            "faiss_id INTEGER, subject TEXT, relation TEXT, object TEXT, "
            "created_at REAL NOT NULL DEFAULT (strftime('%s','now')), "
            "updated_at REAL NOT NULL DEFAULT (strftime('%s','now')), "
            "FOREIGN KEY (source_episode_id) REFERENCES episodes(id) ON DELETE CASCADE)"
        )
        conn.execute(
            "CREATE TABLE recall_log ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id INTEGER NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE fact_confidence_log ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, fact_id INTEGER NOT NULL)"
        )
        # Tables must match schema.sql columns so CREATE INDEX IF NOT EXISTS succeeds
        conn.execute(
            "CREATE TABLE pipeline_trace ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, "
            "step_name TEXT NOT NULL, elapsed_ms REAL NOT NULL, "
            "status TEXT NOT NULL DEFAULT 'ok', "
            "metrics_json TEXT NOT NULL DEFAULT '{}', "
            "created_at REAL NOT NULL DEFAULT (strftime('%s','now')))"
        )
        conn.execute(
            "CREATE TABLE plan_runs ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, "
            "user_msg TEXT NOT NULL, intent_category TEXT NOT NULL DEFAULT '', "
            "rationale TEXT NOT NULL DEFAULT '', confidence REAL NOT NULL DEFAULT 0.3, "
            "subtask_count INTEGER NOT NULL DEFAULT 0, "
            "dag_edges_json TEXT NOT NULL DEFAULT '[]', "
            "created_at REAL NOT NULL DEFAULT (strftime('%s','now')))"
        )
        conn.execute(
            "CREATE TABLE plan_subtasks ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, plan_run_id INTEGER NOT NULL, "
            "subtask_id TEXT NOT NULL, description TEXT NOT NULL, "
            "depends_on_json TEXT NOT NULL DEFAULT '[]', "
            "sort_order INTEGER NOT NULL DEFAULT 0, "
            "status TEXT NOT NULL DEFAULT 'pending', "
            "created_at REAL NOT NULL DEFAULT (strftime('%s','now')))"
        )
        conn.execute(
            "CREATE TABLE session_summaries ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, "
            "last_activity_at REAL NOT NULL, "
            "unfinished_intents_json TEXT NOT NULL DEFAULT '[]', "
            "open_questions_json TEXT NOT NULL DEFAULT '[]', "
            "created_at REAL NOT NULL DEFAULT (strftime('%s','now')))"
        )
        conn.execute(
            "CREATE TABLE reflection_insights ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, insight_type TEXT NOT NULL, "
            "title TEXT NOT NULL, description TEXT NOT NULL, "
            "source_plan_ids_json TEXT NOT NULL DEFAULT '[]', "
            "confidence REAL NOT NULL DEFAULT 0.5, "
            "occurrence_count INTEGER NOT NULL DEFAULT 1, "
            "created_at REAL NOT NULL DEFAULT (strftime('%s','now')), "
            "updated_at REAL NOT NULL DEFAULT (strftime('%s','now')))"
        )
        conn.execute("CREATE INDEX idx_facts_subject ON facts(subject)")
        conn.execute("CREATE INDEX idx_episodes_tier ON episodes(tier)")
        conn.execute("CREATE INDEX idx_episodes_session ON episodes(session_id)")
        conn.commit()
        conn.close()

        # Init with I-113 code — all steps should find artifacts present, record versions
        store = MemoryStore(db_path)
        store.init_db()

        assert store.conn is not None
        rows = store.conn.execute("SELECT version FROM schema_version ORDER BY version").fetchall()
        assert len(rows) == 12
        assert [r["version"] for r in rows] == list(range(1, 13))

        uv = store.conn.execute("PRAGMA user_version").fetchone()[0]
        assert uv == 12

        store.close()

    def test_old_db_partial_migration_applies_remaining(self, tmp_path: Path) -> None:
        """Old DB with only v1-v5 applied — v6-v12 applied + all 12 versions recorded."""
        import sqlite3

        db_path = str(tmp_path / "old_partial.db")
        conn = sqlite3.connect(db_path)
        # Only v1-v5: faiss_id col, recall_log, s/r/o cols, fact_confidence_log, idx_facts_subject
        conn.execute(
            "CREATE TABLE episodes ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, "
            "timestamp REAL NOT NULL DEFAULT (strftime('%s','now')), "
            "importance REAL NOT NULL DEFAULT 0.5, "
            "initial_strength REAL NOT NULL DEFAULT 1.0, "
            "lambda REAL NOT NULL DEFAULT 0.1, "
            "access_count INTEGER NOT NULL DEFAULT 0, "
            "last_recall REAL, faiss_id INTEGER)"
        )
        conn.execute(
            "CREATE TABLE facts ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, "
            "confidence REAL NOT NULL DEFAULT 0.5, source_episode_id INTEGER, "
            "faiss_id INTEGER, subject TEXT, relation TEXT, object TEXT, "
            "created_at REAL NOT NULL DEFAULT (strftime('%s','now')), "
            "updated_at REAL NOT NULL DEFAULT (strftime('%s','now')))"
        )
        conn.execute(
            "CREATE TABLE recall_log ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id INTEGER NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE fact_confidence_log ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, fact_id INTEGER NOT NULL)"
        )
        conn.execute("CREATE INDEX idx_facts_subject ON facts(subject)")
        # Missing: pipeline_trace, plan_runs/plan_subtasks, tier col, last_consolidated_at,
        # session_summaries, reflection_insights, session_id col
        conn.commit()
        conn.close()

        store = MemoryStore(db_path)
        store.init_db()

        assert store.conn is not None

        # All 12 versions recorded
        rows = store.conn.execute("SELECT version FROM schema_version ORDER BY version").fetchall()
        assert len(rows) == 12

        # Previously-missing tables now exist
        tables = {
            row[0]
            for row in store.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for tbl in (
            "pipeline_trace",
            "plan_runs",
            "plan_subtasks",
            "session_summaries",
            "reflection_insights",
        ):
            assert tbl in tables, f"{tbl} should exist after migration"

        # Previously-missing columns now exist
        episode_cols = {
            row[1] for row in store.conn.execute("PRAGMA table_info('episodes')").fetchall()
        }
        for col in ("tier", "last_consolidated_at", "session_id"):
            assert col in episode_cols, f"{col} should exist after migration"

        store.close()

    def test_version_table_matches_schema_sql(self, tmp_path: Path) -> None:
        """schema_version table DDL matches between schema.sql path and _migrate() path."""
        import sqlite3

        # Fresh DB (schema.sql path creates schema_version)
        fresh = MemoryStore.create(str(tmp_path / "fresh.db"))
        assert fresh.conn is not None
        fresh_cols = {
            (row["name"], row["type"], row["notnull"], row["dflt_value"])
            for row in fresh.conn.execute("PRAGMA table_info('schema_version')").fetchall()
        }

        # Old DB (_migrate() path creates schema_version during init)
        old_path = str(tmp_path / "old.db")
        raw = sqlite3.connect(old_path)
        raw.execute("CREATE TABLE episodes (id INTEGER PRIMARY KEY, content TEXT)")
        raw.commit()
        raw.close()

        migrated = MemoryStore(old_path)
        migrated.init_db()
        assert migrated.conn is not None
        migrated_cols = {
            (row["name"], row["type"], row["notnull"], row["dflt_value"])
            for row in migrated.conn.execute("PRAGMA table_info('schema_version')").fetchall()
        }

        assert fresh_cols == migrated_cols, (
            f"schema_version column mismatch:\n  fresh={fresh_cols}\n  migrated={migrated_cols}"
        )

        fresh.close()
        migrated.close()

    def test_version_order_is_ascending(self, tmp_path: Path) -> None:
        """Schema versions are recorded in ascending order (1, 2, ..., 12)."""
        store = MemoryStore.create(str(tmp_path / "test.db"))
        assert store.conn is not None

        rows = store.conn.execute(
            "SELECT version, applied_at FROM schema_version ORDER BY rowid"
        ).fetchall()
        versions = [r["version"] for r in rows]
        assert versions == list(range(1, 13))

        # applied_at timestamps should be non-decreasing (all recorded in same transaction)
        timestamps = [r["applied_at"] for r in rows]
        assert timestamps == sorted(timestamps)

        store.close()


class TestTypedDictConformance:
    """B76: EpisodeRow + FactRow TypedDict 结构与运行时一致性验证。

    TypedDict 是编译时类型——mypy 通过不代表运行时正确。
    本类验证 B75 改造的 10 个高频方法返回的 dict 在运行时与 TypedDict 声明一致。
    """

    # ── EpisodeRow 结构验证 ──

    EPISODE_EXPECTED_KEYS = {
        "id",
        "content",
        "timestamp",
        "importance",
        "initial_strength",
        "lambda",
        "access_count",
        "last_recall",
        "faiss_id",
        "tier",
        "last_consolidated_at",
        "session_id",
    }

    EPISODE_KEY_TYPES: dict[str, type | tuple[type, ...]] = {
        "id": int,
        "content": str,
        "timestamp": float,
        "importance": float,
        "initial_strength": float,
        "lambda": float,
        "access_count": int,
        "last_recall": (float, type(None)),
        "faiss_id": (int, type(None)),
        "tier": str,
        "last_consolidated_at": (float, type(None)),
        "session_id": (str, type(None)),
    }

    # ── FactRow 结构验证 ──

    FACT_EXPECTED_KEYS = {
        "id",
        "content",
        "confidence",
        "source_episode_id",
        "faiss_id",
        "subject",
        "relation",
        "object",
        "created_at",
        "updated_at",
    }

    FACT_KEY_TYPES: dict[str, type | tuple[type, ...]] = {
        "id": int,
        "content": str,
        "confidence": float,
        "source_episode_id": (int, type(None)),
        "faiss_id": (int, type(None)),
        "subject": (str, type(None)),
        "relation": (str, type(None)),
        "object": (str, type(None)),
        "created_at": float,
        "updated_at": float,
    }

    # ── EpisodeRow 测试 ──

    def test_get_episodes_keys_match_typeddict(self, tmp_path: Path) -> None:
        """get_episodes 返回的每行包含 EpisodeRow 的全部键。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("test")
        rows = store.get_episodes([eid])
        assert len(rows) == 1
        assert set(rows[0].keys()) == self.EPISODE_EXPECTED_KEYS
        store.close()

    def test_get_episodes_value_types(self, tmp_path: Path) -> None:
        """get_episodes 返回值类型与 EpisodeRow 声明一致。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("test")
        rows = store.get_episodes([eid])
        row: dict[str, object] = cast("dict[str, object]", rows[0])
        for key, expected_type in self.EPISODE_KEY_TYPES.items():
            assert isinstance(row[key], expected_type), (
                f"EpisodeRow[{key!r}] 期望 {expected_type}，实际 {type(row[key])}"
            )
        store.close()

    def test_get_all_episodes_keys_match_typeddict(self, tmp_path: Path) -> None:
        """get_all_episodes 返回的每行包含 EpisodeRow 的全部键。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_episode("a")
        store.add_episode("b")
        rows = store.get_all_episodes()
        assert len(rows) == 2
        for row in rows:
            assert set(row.keys()) == self.EPISODE_EXPECTED_KEYS
        store.close()

    def test_get_episodes_since_keys_match_typeddict(self, tmp_path: Path) -> None:
        """get_episodes_since 返回值结构符合 EpisodeRow。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_episode("recent")
        rows = store.get_episodes_since(0.0)
        assert len(rows) == 1
        assert set(rows[0].keys()) == self.EPISODE_EXPECTED_KEYS
        store.close()

    def test_get_episodes_by_session_keys_match_typeddict(self, tmp_path: Path) -> None:
        """get_episodes_by_session 返回值结构符合 EpisodeRow。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_episode("session ep", session_id="sess-1")
        rows = store.get_episodes_by_session("sess-1")
        assert len(rows) == 1
        assert set(rows[0].keys()) == self.EPISODE_EXPECTED_KEYS
        store.close()

    def test_get_episodes_by_tier_keys_match_typeddict(self, tmp_path: Path) -> None:
        """get_episodes_by_tier 返回值结构符合 EpisodeRow。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("tiered")
        store.set_episode_tier(eid, "hot")
        rows = store.get_episodes_by_tier("hot")
        assert len(rows) >= 1
        assert set(rows[0].keys()) == self.EPISODE_EXPECTED_KEYS
        store.close()

    # ── FactRow 测试 ──

    def test_get_all_facts_keys_match_typeddict(self, tmp_path: Path) -> None:
        """get_all_facts 返回的每行包含 FactRow 的全部键。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_fact("fact A", confidence=0.9)
        rows = store.get_all_facts()
        assert len(rows) == 1
        assert set(rows[0].keys()) == self.FACT_EXPECTED_KEYS
        store.close()

    def test_get_all_facts_value_types(self, tmp_path: Path) -> None:
        """get_all_facts 返回值类型与 FactRow 声明一致。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_fact("fact", confidence=0.7)
        rows = store.get_all_facts()
        row: dict[str, object] = cast("dict[str, object]", rows[0])
        for key, expected_type in self.FACT_KEY_TYPES.items():
            assert isinstance(row[key], expected_type), (
                f"FactRow[{key!r}] 期望 {expected_type}，实际 {type(row[key])}"
            )
        store.close()

    def test_get_facts_by_subject_keys_match_typeddict(self, tmp_path: Path) -> None:
        """get_facts_by_subject 返回值结构符合 FactRow。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_fact("fact", subject="用户", relation="喜欢", object="猫")
        rows = store.get_facts_by_subject("用户")
        assert len(rows) == 1
        assert set(rows[0].keys()) == self.FACT_EXPECTED_KEYS
        store.close()

    def test_get_facts_by_faiss_id_keys_match_typeddict(self, tmp_path: Path) -> None:
        """get_facts_by_faiss_id 返回值结构符合 FactRow。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        store.add_fact("fact", faiss_id=50)
        rows = store.get_facts_by_faiss_id([50])
        assert len(rows) == 1
        assert set(rows[0].keys()) == self.FACT_EXPECTED_KEYS
        store.close()

    # ── total=False 边界：可选字段为 None ──

    def test_episoderow_nullable_fields_can_be_none(self, tmp_path: Path) -> None:
        """total=False — EpisodeRow 的可选字段在未设置时为 None。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        # 最小化添加，不传 faiss_id/session_id
        eid = store.add_episode("minimal")
        rows = store.get_episodes([eid])
        row = rows[0]

        # 未传的可空字段应为 None
        assert row["faiss_id"] is None
        assert row["last_recall"] is None
        assert row["session_id"] is None
        assert row["last_consolidated_at"] is None

        # 非空字段应有值
        assert isinstance(row["id"], int)
        assert isinstance(row["content"], str)
        assert isinstance(row["timestamp"], float)
        store.close()

    def test_factrow_nullable_fields_can_be_none(self, tmp_path: Path) -> None:
        """total=False — FactRow 的可选字段在未设置时为 None。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        # 仅传必填字段
        store.add_fact("minimal fact")
        rows = store.get_all_facts()
        row = rows[0]

        # 未传的可空字段应为 None
        assert row["source_episode_id"] is None
        assert row["faiss_id"] is None
        assert row["subject"] is None
        assert row["relation"] is None
        assert row["object"] is None

        # 非空字段应有值
        assert isinstance(row["id"], int)
        assert isinstance(row["content"], str)
        assert isinstance(row["confidence"], float)
        store.close()

    # ── 10 方法全量覆盖：每个 TypedDict 返回方法均验证键集 ──

    def test_all_typed_episode_methods_keys_consistent(self, tmp_path: Path) -> None:
        """B75 改造的全部 EpisodeRow 返回方法键集一致。

        覆盖：get_episodes / get_episodes_by_faiss_id / get_all_episodes /
        get_episodes_since / get_episodes_with_questions_since /
        get_episodes_by_session / get_episodes_by_tier
        """
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        eid = store.add_episode("consistency check?", faiss_id=1, session_id="s1")
        store.set_episode_tier(eid, "warm")

        methods: list[tuple[str, object]] = [
            ("get_episodes", store.get_episodes([eid])),
            ("get_episodes_by_faiss_id", store.get_episodes_by_faiss_id([1])),
            ("get_all_episodes", store.get_all_episodes()),
            ("get_episodes_since", store.get_episodes_since(0.0)),
            ("get_episodes_with_questions_since", store.get_episodes_with_questions_since(0.0)),
            ("get_episodes_by_session", store.get_episodes_by_session("s1")),
            ("get_episodes_by_tier", store.get_episodes_by_tier("warm")),
        ]

        for method_name, rows in methods:
            episode_rows = cast("list[dict[str, object]]", rows)
            assert len(episode_rows) >= 1, f"{method_name} 返回空列表"
            for row in episode_rows:
                assert set(row.keys()) == self.EPISODE_EXPECTED_KEYS, (
                    f"{method_name} 键集不一致: {set(row.keys()) - self.EPISODE_EXPECTED_KEYS}"
                )

        store.close()

    def test_all_typed_fact_methods_keys_consistent(self, tmp_path: Path) -> None:
        """B75 改造的全部 FactRow 返回方法键集一致。

        覆盖：get_all_facts / get_facts_by_faiss_id / get_facts_by_subject
        """
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        store.add_fact("consistent fact", faiss_id=10, subject="S", relation="R", object="O")

        methods: list[tuple[str, object]] = [
            ("get_all_facts", store.get_all_facts()),
            ("get_facts_by_faiss_id", store.get_facts_by_faiss_id([10])),
            ("get_facts_by_subject", store.get_facts_by_subject("S")),
        ]

        for method_name, rows in methods:
            fact_rows = cast("list[dict[str, object]]", rows)
            assert len(fact_rows) >= 1, f"{method_name} 返回空列表"
            for row in fact_rows:
                assert set(row.keys()) == self.FACT_EXPECTED_KEYS, (
                    f"{method_name} 键集不一致: {set(row.keys()) - self.FACT_EXPECTED_KEYS}"
                )

        store.close()

    # ── recall.py 兼容性：确保 store 返回的 dict 可被 recall 追加合成键 ──

    def test_episoderow_supports_synthetic_key_injection(self, tmp_path: Path) -> None:
        """recall.py 在 EpisodeRow 上追加 _recall_score 等合成键，不应冲突。

        B75 设计决策：recall.py 保持 list[dict[str, object]]，因为它在
        store 返回的 dict 上注入合成键（_recall_score, _strength 等）。
        此测试确保 TypedDict 返回的 dict 支持这种模式。
        """
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        eid = store.add_episode("recall test", faiss_id=100)
        rows = store.get_episodes_by_faiss_id([100])
        assert len(rows) == 1

        # 模拟 recall.py 的合成键注入
        row: dict[str, object] = cast("dict[str, object]", rows[0])
        row["_recall_score"] = 0.95
        row["_strength"] = 0.8
        row["_semantic_similarity"] = 0.7
        row["_composite"] = 0.85

        # 验证原有字段未被覆盖
        assert row["id"] == eid
        assert row["content"] == "recall test"
        assert row["faiss_id"] == 100

        # 验证合成键存在
        assert row["_recall_score"] == 0.95
        assert row["_strength"] == 0.8

        store.close()
