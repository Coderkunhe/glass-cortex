from __future__ import annotations

import math
import time
from pathlib import Path

import pytest

from src.memory.forget import ForgettingEngine
from src.memory.store import MemoryStore


def test_ebbinghaus_decay(tmp_path: Path) -> None:
    """给定 initial=1.0, λ=0.1, t=10h → e^(-1.0) ≈ 0.3679。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    assert store.conn is not None

    ten_hours_ago = time.time() - 10 * 3600
    store.conn.execute(
        "INSERT INTO episodes (content, timestamp, initial_strength, lambda) "
        "VALUES (?, ?, 1.0, 0.1)",
        ("测试记忆", ten_hours_ago),
    )
    store.conn.commit()

    engine = ForgettingEngine(store)
    episodes = store.get_all_episodes()
    strength = engine.current_strength(episodes[0])

    expected = 1.0 * math.exp(-1.0)
    assert strength == pytest.approx(expected, rel=0.001)
    store.close()


def test_recall_strengthening() -> None:
    """召回后强度 > 原强度，且不超过 1.0。"""
    assert ForgettingEngine.strengthen(0.5) == pytest.approx(0.8)
    assert ForgettingEngine.strengthen(0.5, boost=0.1) == pytest.approx(0.6)
    assert ForgettingEngine.strengthen(0.95) == 1.0


def test_decay_all_updates_strengths(tmp_path: Path) -> None:
    """decay_all 应更新所有 episode 的强度。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    assert store.conn is not None

    one_hour_ago = time.time() - 3600
    store.conn.execute(
        "INSERT INTO episodes (content, timestamp, initial_strength, lambda) "
        "VALUES (?, ?, 1.0, 0.5)",
        ("即将衰减", one_hour_ago),
    )
    store.conn.commit()

    engine = ForgettingEngine(store)
    engine.decay_all()

    ep = store.get_all_episodes()[0]
    assert ep["initial_strength"] == pytest.approx(0.6065, rel=0.01)
    store.close()


def test_decay_all_returns_deltas(tmp_path: Path) -> None:
    """decay_all 返回 [(id, old_strength, new_strength), ...]，override 时 old≠new"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    assert store.conn is not None

    one_hour_ago = time.time() - 3600
    store.conn.execute(
        "INSERT INTO episodes (content, timestamp, initial_strength, lambda) "
        "VALUES (?, ?, 1.0, 0.1)",
        ("test", one_hour_ago),
    )
    store.conn.commit()

    engine = ForgettingEngine(store)
    # λ_override=0.5 vs 个体 λ=0.1 — 不同值才会产生 delta
    deltas = engine.decay_all(lambda_override=0.5)

    assert len(deltas) == 1
    eid, old_s, new_s = deltas[0]
    assert isinstance(eid, int)
    assert old_s > new_s  # λ=0.5 比 λ=0.1 快，强度下降
    store.close()


def test_lambda_override_accelerates_decay(tmp_path: Path) -> None:
    """λ_override=1.0 比 λ=0.1 衰减更快。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    assert store.conn is not None

    one_hour_ago = time.time() - 3600
    store.conn.execute(
        "INSERT INTO episodes (content, timestamp, initial_strength, lambda) "
        "VALUES (?, ?, 1.0, 0.1)",
        ("慢衰减", one_hour_ago),
    )
    store.conn.commit()

    engine = ForgettingEngine(store)
    deltas_fast = engine.decay_all(lambda_override=1.0)

    # 重置 strength
    store.conn.execute("UPDATE episodes SET initial_strength = 1.0")
    store.conn.commit()

    deltas_slow = engine.decay_all(lambda_override=0.01)

    _, _, fast_new = deltas_fast[0]
    _, _, slow_new = deltas_slow[0]
    assert fast_new < slow_new  # 高 λ 衰减更快
    store.close()


def test_lambda_override_zero_preserves_strength(tmp_path: Path) -> None:
    """λ=0 时强度保持原始值 1.0。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    assert store.conn is not None

    one_hour_ago = time.time() - 3600
    store.conn.execute(
        "INSERT INTO episodes (content, timestamp, initial_strength, lambda) "
        "VALUES (?, ?, 1.0, 0.1)",
        ("不衰减", one_hour_ago),
    )
    store.conn.commit()

    engine = ForgettingEngine(store)
    deltas = engine.decay_all(lambda_override=0.0)

    _, old_s, new_s = deltas[0]
    assert new_s == pytest.approx(1.0)  # λ=0 → 强度重置回初始值 1.0
    # old_s 用个体 λ=0.1 计算 (≈0.9)，new_s 用 override λ=0 (=1.0)，应不同
    assert old_s < new_s
    store.close()


# ── Phase 66 B21: forget_session 定向遗忘 ─────────────────────────


class TestForgetSession:
    """ForgettingEngine.forget_session() —— 按 session_id 级联删除。"""

    def test_forget_session_deletes_episodes_and_facts(self, tmp_path: Path) -> None:
        """forget_session 删除指定 session 的 episodes + facts，返回计数。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        # 插入 2 个 episodes（同 session） + 各 1 个 fact
        sid = "test-session-1"
        eid1 = store.add_episode("消息 1", session_id=sid)
        eid2 = store.add_episode("消息 2", session_id=sid)
        store.add_fact("事实 A", source_episode_id=eid1)
        store.add_fact("事实 B", source_episode_id=eid2)

        engine = ForgettingEngine(store)
        result = engine.forget_session(sid)

        assert result["episodes_deleted"] == 2
        assert result["facts_deleted"] == 2
        assert result["faiss_vectors_removed"] == 0  # 无 FAISS ID
        assert result["session_id"] == sid

        # 验证确实删除了
        assert store.get_episodes_by_session(sid) == []
        store.close()

    def test_forget_session_isolates_other_sessions(self, tmp_path: Path) -> None:
        """forget_session 只删除目标 session，不影响其他 session 的数据。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        sid_a = "session-a"
        sid_b = "session-b"

        store.add_episode("A 的消息", session_id=sid_a)
        store.add_episode("B 的消息", session_id=sid_b)

        engine = ForgettingEngine(store)
        result = engine.forget_session(sid_a)

        assert result["episodes_deleted"] == 1
        # session B 的数据还在
        assert len(store.get_episodes_by_session(sid_b)) == 1
        store.close()

    def test_forget_session_empty_returns_zero(self, tmp_path: Path) -> None:
        """不存在的 session_id 返回全零计数。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        engine = ForgettingEngine(store)
        result = engine.forget_session("nonexistent-session")

        assert result["episodes_deleted"] == 0
        assert result["facts_deleted"] == 0
        assert result["faiss_vectors_removed"] == 0
        store.close()

    def test_forget_session_with_faiss_cleanup(self, tmp_path: Path) -> None:
        """有 FAISS ID 时 forget_session 应调用 index.remove_faiss_ids。"""
        from unittest.mock import MagicMock

        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()

        sid = "session-with-faiss"
        # 通过原始 SQL 插入带 faiss_id 的 episode（add_episode 的 faiss_id 会被
        # 后续 embedding 流水线设置，这里直接模拟已有 FAISS 向量的场景）
        store._db.execute(
            "INSERT INTO episodes (content, faiss_id, session_id) VALUES (?, 42, ?)",
            ("带 FAISS 的消息", sid),
        )
        store._db.commit()

        mock_index = MagicMock()
        mock_index.remove_faiss_ids.return_value = 1

        engine = ForgettingEngine(store, index=mock_index)
        result = engine.forget_session(sid)

        assert result["faiss_vectors_removed"] == 1
        mock_index.remove_faiss_ids.assert_called_once_with([42])
        store.close()
