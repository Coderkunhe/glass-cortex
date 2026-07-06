from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest

from src.memory.store import MemoryStore


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    s = MemoryStore(str(tmp_path / "test.db"))
    s.init_db()
    return s


def test_log_recall(store: MemoryStore) -> None:
    eid = store.add_episode("测试记忆")
    store.log_recall(eid, strength_before=0.8, strength_after=0.95)

    logs = store.get_recall_log(eid)
    assert len(logs) == 1
    assert logs[0]["episode_id"] == eid
    assert logs[0]["strength_before"] == pytest.approx(0.8)
    assert logs[0]["strength_after"] == pytest.approx(0.95)
    assert logs[0]["recalled_at"] is not None


def test_get_recall_log_returns_empty_for_no_logs(store: MemoryStore) -> None:
    eid = store.add_episode("没有 recall 记录的记忆")
    logs = store.get_recall_log(eid)
    assert logs == []


def test_get_recall_log_ordered_by_time(store: MemoryStore) -> None:
    eid = store.add_episode("多次 recall")
    store.log_recall(eid, strength_before=1.0, strength_after=1.0)
    store.log_recall(eid, strength_before=0.9, strength_after=0.98)
    store.log_recall(eid, strength_before=0.85, strength_after=0.93)

    logs = store.get_recall_log(eid)
    assert len(logs) == 3
    # 按时间升序
    t0 = cast(float, logs[0]["recalled_at"])
    t1 = cast(float, logs[1]["recalled_at"])
    t2 = cast(float, logs[2]["recalled_at"])
    assert t0 <= t1
    assert t1 <= t2


def test_log_recall_timestamps_are_unix_epoch(store: MemoryStore) -> None:
    import time

    eid = store.add_episode("时间戳测试")
    before = int(time.time())
    store.log_recall(eid, strength_before=0.5, strength_after=0.7)
    after = int(time.time()) + 1

    logs = store.get_recall_log(eid)
    ts = int(float(cast(float, logs[0]["recalled_at"])))
    assert before <= ts <= after


def test_migration_adds_recall_log_table(tmp_path: Path) -> None:
    import sqlite3

    db_path = str(tmp_path / "old.db")
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE episodes (id INTEGER PRIMARY KEY, content TEXT, "
        "timestamp REAL, importance REAL, initial_strength REAL, "
        "lambda REAL, access_count INTEGER, last_recall REAL, faiss_id INTEGER)"
    )
    conn.execute(
        "CREATE TABLE facts (id INTEGER PRIMARY KEY, content TEXT, "
        "confidence REAL DEFAULT 0.5, source_episode_id INTEGER, "
        "faiss_id INTEGER, created_at REAL, updated_at REAL)"
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
    assert "recall_log" in tables
    store.close()
