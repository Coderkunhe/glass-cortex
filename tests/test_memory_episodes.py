from __future__ import annotations

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

        assert set(cast("list[int]", result["faiss_ids"])) == {100, 200}
        store.close()
