from __future__ import annotations

from pathlib import Path

import pytest

from src.memory.store import MemoryStore


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    s = MemoryStore(str(tmp_path / "test.db"))
    s.init_db()
    return s


def test_add_fact(store: MemoryStore) -> None:
    eid = store.add_episode("用户喜欢布偶猫")
    fid = store.add_fact("用户喜欢布偶猫", confidence=0.8, source_episode_id=eid, faiss_id=5)
    assert isinstance(fid, int)
    assert fid > 0


def test_get_all_facts(store: MemoryStore) -> None:
    store.add_fact("事实A", confidence=0.9)
    store.add_fact("事实B", confidence=0.5)
    store.add_fact("事实C", confidence=0.7)

    facts = store.get_all_facts()
    assert len(facts) == 3
    # 按 confidence DESC 排序
    assert facts[0]["content"] == "事实A"
    assert facts[1]["content"] == "事实C"
    assert facts[2]["content"] == "事实B"


def test_get_facts_by_faiss_id(store: MemoryStore) -> None:
    store.add_fact("事实1", faiss_id=10)
    store.add_fact("事实2", faiss_id=20)
    store.add_fact("事实3", faiss_id=30)

    result = store.get_facts_by_faiss_id([10, 30])
    contents = [r["content"] for r in result]
    assert "事实1" in contents
    assert "事实3" in contents
    assert "事实2" not in contents


def test_get_facts_by_faiss_id_empty(store: MemoryStore) -> None:
    result = store.get_facts_by_faiss_id([])
    assert result == []


def test_update_fact_confidence(store: MemoryStore) -> None:
    fid = store.add_fact("测试事实", confidence=0.5)
    store.update_fact_confidence(fid, 0.2)

    facts = store.get_all_facts()
    assert facts[0]["confidence"] == pytest.approx(0.7)

    # 上限 capped at 1.0
    store.update_fact_confidence(fid, 0.5)
    facts = store.get_all_facts()
    assert facts[0]["confidence"] == pytest.approx(1.0)

    # 下限 capped at 0
    store.update_fact_confidence(fid, -2.0)
    facts = store.get_all_facts()
    assert facts[0]["confidence"] == pytest.approx(0.0)


def test_migration_adds_faiss_id_column(tmp_path: Path) -> None:
    """Existing DB without faiss_id in facts table gets migrated."""
    import sqlite3

    db_path = str(tmp_path / "old.db")
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE facts (id INTEGER PRIMARY KEY, content TEXT, "
        "confidence REAL DEFAULT 0.5, source_episode_id INTEGER, "
        "created_at REAL, updated_at REAL)"
    )
    conn.commit()
    conn.close()

    store = MemoryStore(db_path)
    store.init_db()

    cols = {
        row[1]
        for row in store.conn.execute("PRAGMA table_info('facts')").fetchall()  # type: ignore[union-attr]
    }
    assert "faiss_id" in cols
    store.close()
