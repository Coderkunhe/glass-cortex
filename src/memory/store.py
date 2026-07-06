"""SQLite 记忆存储——episode CRUD + 强度更新 + 事实关联 + 旧数据迁移。"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import TYPE_CHECKING, TypedDict

from src.config import settings
from src.memory.triple import Triple

if TYPE_CHECKING:
    from src.planner.plan import PlanResult


# ── DB 行 TypedDict (I-110: 读路径类型安全) ──────────────────────────────
# Python 保留字 "lambda" / "object" 无法在 class 体中使用标识符语法，
# 因此使用函数式 TypedDict 定义（PEP 589 § 替代语法）。
# I-106 记录了 lambda_ alias 为已知限制；I-110 在 DB 层直接匹配列名。


EpisodeRow = TypedDict(  # noqa: UP013
    "EpisodeRow",
    {
        "id": int,
        "content": str,
        "timestamp": float,
        "importance": float,
        "initial_strength": float,
        "lambda": float,  # DB 列名，Python 保留字 → 函数式语法
        "access_count": int,
        "last_recall": float | None,
        "faiss_id": int | None,
        "tier": str,
        "last_consolidated_at": float | None,
        "session_id": str | None,
    },
    total=False,
)
"""episodes 表行——SELECT * 返回的完整列集合。

total=False 意味着所有键可选，匹配 B73 建立的 TypedDict 模式。
消费者通过 ``row["column_name"]`` 访问字段时 mypy 可以校验键名正确性。
"""


FactRow = TypedDict(  # noqa: UP013
    "FactRow",
    {
        "id": int,
        "content": str,
        "confidence": float,
        "source_episode_id": int | None,
        "faiss_id": int | None,
        "subject": str | None,
        "relation": str | None,
        "object": str | None,  # DB 列名，Python 保留字 → 函数式语法
        "created_at": float,
        "updated_at": float,
    },
    total=False,
)
"""facts 表行——SELECT * 返回的完整列集合。

total=False 意味着所有键可选，匹配 B73 建立的 TypedDict 模式。
"""


class MemoryStore:
    """SQLite 记忆存储——episode 和事实的持久化 CRUD 层。

    ADR-001: SQLite 存储结构化元数据，FAISS 管理向量索引（外键关联）。
    ADR-002: Episode（对话片段，艾宾浩斯时间衰减）+ Fact（事实知识，重要性加权）。
    """

    def __init__(self, db_path: str = str(settings.resolved_db_path)) -> None:
        self.db_path = Path(db_path)
        self.conn: sqlite3.Connection | None = None

    @classmethod
    def create(cls, db_path: str = str(settings.resolved_db_path)) -> MemoryStore:
        """创建并初始化 MemoryStore（等价于 __init__ + init_db）。"""
        store = cls(db_path)
        store.init_db()
        return store

    @property
    def _db(self) -> sqlite3.Connection:
        if self.conn is None:
            raise RuntimeError("数据库未初始化——请先调用 init_db()")
        return self.conn

    def _execute(self, sql: str, params: tuple[object, ...] = ()) -> sqlite3.Cursor:
        return self._db.execute(sql, params)

    def init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode=WAL")
        schema = Path(__file__).parent / "schema.sql"
        self.conn.executescript(schema.read_text())
        self._migrate()
        self.conn.commit()

    def _record_version(self, version: int, description: str) -> None:
        """Record a completed migration in schema_version and update PRAGMA user_version."""
        assert self.conn is not None
        self.conn.execute(
            "INSERT INTO schema_version (version, description) VALUES (?, ?)",
            (version, description),
        )
        self.conn.execute(f"PRAGMA user_version = {version}")

    def _migrate(self) -> None:
        """Apply pending schema migrations in version order (I-113: version-gated).

        Each migration step has a version gate and an existence check (defense-in-depth).
        For existing DBs without schema_version, all steps run; already-applied steps
        are no-ops at the DDL level but still record their version.
        """
        assert self.conn is not None
        self.conn.execute("BEGIN")
        try:
            # ── Gather schema state once ──
            tables = {
                row[0]
                for row in self.conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            facts_cols = {
                row[1] for row in self.conn.execute("PRAGMA table_info('facts')").fetchall()
            }
            episode_cols = {
                row[1] for row in self.conn.execute("PRAGMA table_info('episodes')").fetchall()
            }

            # ── Ensure schema_version table exists (old-DB compat) ──
            if "schema_version" not in tables:
                self.conn.execute(
                    "CREATE TABLE schema_version ("
                    "version INTEGER PRIMARY KEY, "
                    "applied_at REAL NOT NULL DEFAULT (strftime('%s','now')), "
                    "description TEXT NOT NULL)"
                )
                tables.add("schema_version")

            # ── Determine current version ──
            max_recorded = self.conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[
                0
            ]
            if max_recorded is not None:
                current_version: int = max_recorded
            else:
                current_version = self.conn.execute("PRAGMA user_version").fetchone()[0]

            # ── v1: Add facts.faiss_id column (Phase 4) ──
            if current_version < 1:
                if "faiss_id" not in facts_cols:
                    self.conn.execute("ALTER TABLE facts ADD COLUMN faiss_id INTEGER")
                self._record_version(1, "Add facts.faiss_id column")

            # ── v2: Create recall_log table (Phase 5) ──
            if current_version < 2:
                if "recall_log" not in tables:
                    self.conn.execute(
                        "CREATE TABLE recall_log ("
                        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                        "episode_id INTEGER NOT NULL, "
                        "recalled_at REAL NOT NULL DEFAULT (strftime('%s', 'now')), "
                        "strength_before REAL NOT NULL, "
                        "strength_after REAL NOT NULL, "
                        "FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE)"
                    )
                self._record_version(2, "Create recall_log table")

            # ── v3: Add facts.subject/relation/object columns (User Profile 重构) ──
            if current_version < 3:
                if "subject" not in facts_cols:
                    self.conn.execute("ALTER TABLE facts ADD COLUMN subject TEXT")
                if "relation" not in facts_cols:
                    self.conn.execute("ALTER TABLE facts ADD COLUMN relation TEXT")
                if "object" not in facts_cols:
                    self.conn.execute("ALTER TABLE facts ADD COLUMN object TEXT")
                # Backfill s/r/o from content for existing rows
                empty_rows = self.conn.execute(
                    "SELECT id, content FROM facts WHERE subject IS NULL"
                ).fetchall()
                for row in empty_rows:
                    t = Triple.from_content(str(row["content"]))
                    if t is not None:
                        self.conn.execute(
                            "UPDATE facts SET subject=?, relation=?, object=? WHERE id=?",
                            (t.subject, t.relation, t.object, row["id"]),
                        )
                self._record_version(3, "Add facts.subject/relation/object columns")

            # ── v4: Create fact_confidence_log table (User Profile 重构) ──
            if current_version < 4:
                if "fact_confidence_log" not in tables:
                    self.conn.execute(
                        "CREATE TABLE fact_confidence_log ("
                        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                        "fact_id INTEGER NOT NULL, "
                        "confidence_before REAL NOT NULL, "
                        "confidence_after REAL NOT NULL, "
                        "reason TEXT NOT NULL DEFAULT '', "
                        "logged_at REAL NOT NULL DEFAULT (strftime('%s', 'now')), "
                        "FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE CASCADE)"
                    )
                self._record_version(4, "Create fact_confidence_log table")

            # ── v5: Create idx_facts_subject index ──
            if current_version < 5:
                self.conn.execute("CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject)")
                self._record_version(5, "Create idx_facts_subject index")

            # ── v6: Create pipeline_trace table (Phase 16 — Batch 59B) ──
            if current_version < 6:
                if "pipeline_trace" not in tables:
                    self.conn.execute(
                        "CREATE TABLE pipeline_trace ("
                        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                        "session_id TEXT NOT NULL, "
                        "step_name TEXT NOT NULL, "
                        "elapsed_ms REAL NOT NULL, "
                        "status TEXT NOT NULL DEFAULT 'ok', "
                        "metrics_json TEXT NOT NULL DEFAULT '{}', "
                        "created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')))"
                    )
                    self.conn.execute(
                        "CREATE INDEX idx_pipeline_trace_session "
                        "ON pipeline_trace(session_id, created_at)"
                    )
                self._record_version(6, "Create pipeline_trace table and index")

            # ── v7: Create plan_runs / plan_subtasks tables (Phase 53 Batch 1) ──
            if current_version < 7:
                if "plan_runs" not in tables:
                    self.conn.execute(
                        "CREATE TABLE plan_runs ("
                        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                        "session_id TEXT NOT NULL, "
                        "user_msg TEXT NOT NULL, "
                        "intent_category TEXT NOT NULL DEFAULT '', "
                        "rationale TEXT NOT NULL DEFAULT '', "
                        "confidence REAL NOT NULL DEFAULT 0.3, "
                        "subtask_count INTEGER NOT NULL DEFAULT 0, "
                        "dag_edges_json TEXT NOT NULL DEFAULT '[]', "
                        "created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')))"
                    )
                    self.conn.execute(
                        "CREATE TABLE plan_subtasks ("
                        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                        "plan_run_id INTEGER NOT NULL, "
                        "subtask_id TEXT NOT NULL, "
                        "description TEXT NOT NULL, "
                        "depends_on_json TEXT NOT NULL DEFAULT '[]', "
                        "sort_order INTEGER NOT NULL DEFAULT 0, "
                        "status TEXT NOT NULL DEFAULT 'pending', "
                        "created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')), "
                        "FOREIGN KEY (plan_run_id) REFERENCES plan_runs(id) ON DELETE CASCADE)"
                    )
                    self.conn.execute(
                        "CREATE INDEX idx_plan_runs_session ON plan_runs(session_id, created_at)"
                    )
                    self.conn.execute(
                        "CREATE INDEX idx_plan_subtasks_run "
                        "ON plan_subtasks(plan_run_id, sort_order)"
                    )
                self._record_version(7, "Create plan_runs and plan_subtasks tables")

            # ── v8: Add episodes.tier column + index (Phase 54 — 多层记忆分级) ──
            if current_version < 8:
                if "tier" not in episode_cols:
                    self.conn.execute(
                        "ALTER TABLE episodes ADD COLUMN tier TEXT NOT NULL DEFAULT 'warm'"
                    )
                self.conn.execute("CREATE INDEX IF NOT EXISTS idx_episodes_tier ON episodes(tier)")
                self._record_version(8, "Add episodes.tier column and index")

            # ── v9: Add episodes.last_consolidated_at column (Phase 56) ──
            if current_version < 9:
                if "last_consolidated_at" not in episode_cols:
                    self.conn.execute("ALTER TABLE episodes ADD COLUMN last_consolidated_at REAL")
                self._record_version(9, "Add episodes.last_consolidated_at column")

            # ── v10: Create session_summaries table (Phase 59) ──
            if current_version < 10:
                if "session_summaries" not in tables:
                    self.conn.execute(
                        "CREATE TABLE session_summaries ("
                        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                        "session_id TEXT NOT NULL, "
                        "last_activity_at REAL NOT NULL, "
                        "unfinished_intents_json TEXT NOT NULL DEFAULT '[]', "
                        "open_questions_json TEXT NOT NULL DEFAULT '[]', "
                        "created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')))"
                    )
                    self.conn.execute(
                        "CREATE INDEX idx_session_summaries_created "
                        "ON session_summaries(created_at DESC)"
                    )
                self._record_version(10, "Create session_summaries table and index")

            # ── v11: Create reflection_insights table (Phase 61) ──
            if current_version < 11:
                if "reflection_insights" not in tables:
                    self.conn.execute(
                        "CREATE TABLE reflection_insights ("
                        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                        "insight_type TEXT NOT NULL, "
                        "title TEXT NOT NULL, "
                        "description TEXT NOT NULL, "
                        "source_plan_ids_json TEXT NOT NULL DEFAULT '[]', "
                        "confidence REAL NOT NULL DEFAULT 0.5, "
                        "occurrence_count INTEGER NOT NULL DEFAULT 1, "
                        "created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')), "
                        "updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')))"
                    )
                    self.conn.execute(
                        "CREATE INDEX idx_reflection_insights_type "
                        "ON reflection_insights(insight_type, created_at DESC)"
                    )
                self._record_version(11, "Create reflection_insights table and index")

            # ── v12: Add episodes.session_id column + index (Phase 66) ──
            if current_version < 12:
                if "session_id" not in episode_cols:
                    self.conn.execute("ALTER TABLE episodes ADD COLUMN session_id TEXT")
                self.conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id)"
                )
                self._record_version(12, "Add episodes.session_id column and index")

        except Exception:
            self.conn.execute("ROLLBACK")
            raise
        else:
            self.conn.execute("COMMIT")

    def add_episode(
        self,
        content: str,
        importance: float = settings.default_importance,
        decay_lambda: float = settings.default_decay_lambda,
        faiss_id: int | None = None,
        session_id: str | None = None,
    ) -> int:
        cursor = self._db.execute(
            "INSERT INTO episodes (content, importance, lambda, faiss_id, session_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (content, importance, decay_lambda, faiss_id, session_id),
        )
        self._db.commit()
        rowid = cursor.lastrowid
        assert rowid is not None
        return rowid

    def get_episodes(self, ids: list[int]) -> list[EpisodeRow]:
        if not ids:
            return []
        placeholders = ",".join("?" * len(ids))
        rows = self._db.execute(
            f"SELECT * FROM episodes WHERE id IN ({placeholders})", ids
        ).fetchall()
        return [dict(row) for row in rows]  # type: ignore[misc]

    def get_episodes_by_faiss_id(self, faiss_ids: list[int]) -> list[EpisodeRow]:
        if not faiss_ids:
            return []
        placeholders = ",".join("?" * len(faiss_ids))
        rows = self._db.execute(
            f"SELECT * FROM episodes WHERE faiss_id IN ({placeholders})",
            faiss_ids,
        ).fetchall()
        return [dict(row) for row in rows]  # type: ignore[misc]

    def get_all_episodes(self) -> list[EpisodeRow]:
        rows = self._db.execute("SELECT * FROM episodes").fetchall()
        return [dict(row) for row in rows]  # type: ignore[misc]

    def get_episodes_since(self, timestamp: float) -> list[EpisodeRow]:
        rows = self._db.execute(
            "SELECT * FROM episodes WHERE timestamp >= ? ORDER BY timestamp ASC",
            (timestamp,),
        ).fetchall()
        return [dict(row) for row in rows]  # type: ignore[misc]

    def get_max_episode_timestamp(self) -> float | None:
        """返回 episodes 表中最大的时间戳，无数据时返回 None。

        供 SessionBoundaryDetector 三级回退的最底层降级查询使用。
        """
        row = self._db.execute("SELECT MAX(timestamp) AS last_ts FROM episodes").fetchone()
        if row is None:
            return None
        val = row["last_ts"]
        return float(val) if val is not None else None

    def get_episodes_with_questions_since(self, since: float) -> list[EpisodeRow]:
        """返回 ``since`` 之后包含问号（? 或 ？）的 episode。

        启发式检测用户未回答的问句——content 含 ``?`` 或 ``？`` 即视为潜在问题。
        供 SessionBoundaryDetector 的 open_questions 检测使用。
        """
        rows = self._db.execute(
            "SELECT * FROM episodes "
            "WHERE timestamp > ? "
            "AND (content LIKE '%?%' OR content LIKE '%？%') "
            "ORDER BY timestamp DESC",
            (since,),
        ).fetchall()
        return [dict(r) for r in rows]  # type: ignore[misc]

    def get_episode_count_since(self, timestamp: float) -> int:
        row = self._db.execute(
            "SELECT COUNT(*) as cnt FROM episodes WHERE timestamp >= ?",
            (timestamp,),
        ).fetchone()
        return int(row["cnt"]) if row else 0

    def get_total_episode_count(self) -> int:
        """返回 episodes 表总行数——冷启动检测信号（q2.19）。"""
        row = self._db.execute("SELECT COUNT(*) as cnt FROM episodes").fetchone()
        return int(row["cnt"]) if row else 0

    def get_episodes_by_session(self, session_id: str) -> list[EpisodeRow]:
        """按 session_id 查询 episodes，按时间升序排列。

        仅返回 session_id 精确匹配的 episode，忽略 NULL session_id 的旧数据。
        """
        rows = self._db.execute(
            "SELECT * FROM episodes WHERE session_id = ? ORDER BY timestamp ASC",
            (session_id,),
        ).fetchall()
        return [dict(row) for row in rows]  # type: ignore[misc]

    def delete_episodes_by_session(self, session_id: str) -> dict[str, object]:
        """级联删除 session 下所有 episodes + 关联 facts/recall_log/confidence_log。

        返回 dict：episodes_deleted / facts_deleted / faiss_ids。
        faiss_ids 供调用方（ForgettingEngine / API）在 SQL 事务后清理 FAISS 向量。
        """
        # 1. 收集 episode IDs + faiss_ids
        rows = self._db.execute(
            "SELECT id, faiss_id FROM episodes WHERE session_id = ?", (session_id,)
        ).fetchall()
        ep_ids = [r["id"] for r in rows]
        faiss_ids: list[int] = [r["faiss_id"] for r in rows if r["faiss_id"] is not None]

        if not ep_ids:
            return {"episodes_deleted": 0, "facts_deleted": 0, "faiss_ids": []}

        placeholders = ",".join("?" * len(ep_ids))

        # 2. 收集 facts 的 faiss_ids（在删除 facts 之前收集）
        fact_rows = self._db.execute(
            f"SELECT faiss_id FROM facts WHERE source_episode_id IN ({placeholders})",
            ep_ids,
        ).fetchall()
        for fr in fact_rows:
            if fr["faiss_id"] is not None:
                faiss_ids.append(int(fr["faiss_id"]))

        # 3. 级联删除（顺序：子→父，避免 FK 约束冲突）——显式事务保护
        self._db.execute("BEGIN")
        try:
            self._db.execute(
                f"DELETE FROM fact_confidence_log WHERE fact_id IN "
                f"(SELECT id FROM facts WHERE source_episode_id IN ({placeholders}))",
                ep_ids,
            )
            self._db.execute(f"DELETE FROM recall_log WHERE episode_id IN ({placeholders})", ep_ids)
            fact_cursor = self._db.execute(
                f"DELETE FROM facts WHERE source_episode_id IN ({placeholders})", ep_ids
            )
            ep_cursor = self._db.execute("DELETE FROM episodes WHERE session_id = ?", (session_id,))
            self._db.commit()
        except Exception:
            self._db.execute("ROLLBACK")
            raise

        return {
            "episodes_deleted": ep_cursor.rowcount,
            "facts_deleted": fact_cursor.rowcount,
            "faiss_ids": list(set(faiss_ids)),
        }

    def update_strength(self, episode_id: int, new_strength: float) -> None:
        self._db.execute(
            "UPDATE episodes "
            "SET initial_strength = ?, last_recall = strftime('%s', 'now'), "
            "access_count = access_count + 1 "
            "WHERE id = ?",
            (new_strength, episode_id),
        )
        self._db.commit()

    def set_strength_batch(self, updates: list[tuple[int, float]]) -> None:
        self._db.execute("BEGIN")
        self._db.executemany(
            "UPDATE episodes SET initial_strength = ? WHERE id = ?",
            [(new_str, eid) for eid, new_str in updates],
        )
        self._db.commit()

    def set_importance_batch(self, updates: list[tuple[int, float, float]]) -> None:
        """批量更新 importance + last_consolidated_at，单事务提交。

        与 set_strength_batch 的差异：本方法不动 access_count / last_recall，
        专用于 ConsolidationCore 的时间衰减写入。

        Args:
            updates: [(episode_id, new_importance, consolidated_at_timestamp), ...]。
                     空列表为 no-op。
        """
        if not updates:
            return
        self._db.execute("BEGIN")
        self._db.executemany(
            "UPDATE episodes SET importance = ?, last_consolidated_at = ? WHERE id = ?",
            [(new_imp, ts, eid) for eid, new_imp, ts in updates],
        )
        self._db.commit()

    def update_importance_batch(self, updates: list[tuple[int, float]]) -> None:
        """批量更新 importance（不动 last_consolidated_at），单事务提交。

        与 set_importance_batch 的差异：
        - set_importance_batch：更新 importance + last_consolidated_at（冷却路径）
        - update_importance_batch：仅更新 importance（保护/动态路径）

        Args:
            updates: [(episode_id, new_importance), ...]。空列表为 no-op。
        """
        if not updates:
            return
        self._db.execute("BEGIN")
        self._db.executemany(
            "UPDATE episodes SET importance = ? WHERE id = ?",
            [(new_imp, eid) for eid, new_imp in updates],
        )
        self._db.commit()

    def get_faiss_ids_for_episode(self, episode_id: int) -> list[int]:
        """收集 episode 及其关联 facts 的全部 faiss_id，用于 FAISS 索引联删。

        在 delete_episode() 前调用，收集需要从 IndexManager 中移除的向量 ID。
        纯查询，无副作用。
        """
        ids: list[int] = []
        row = self._db.execute(
            "SELECT faiss_id FROM episodes WHERE id = ?", (episode_id,)
        ).fetchone()
        if row and row["faiss_id"] is not None:
            ids.append(int(row["faiss_id"]))
        fact_rows = self._db.execute(
            "SELECT faiss_id FROM facts WHERE source_episode_id = ?", (episode_id,)
        ).fetchall()
        for fr in fact_rows:
            if fr["faiss_id"] is not None:
                ids.append(int(fr["faiss_id"]))
        return ids

    def delete_episode(self, episode_id: int) -> bool:
        """删除 episode，级联删除关联的 recall_log、fact_confidence_log 和 facts。"""
        # 清理 confidence log（FK 约束要求先删子表）
        self._db.execute(
            "DELETE FROM fact_confidence_log WHERE fact_id IN "
            "(SELECT id FROM facts WHERE source_episode_id = ?)",
            (episode_id,),
        )
        self._db.execute("DELETE FROM recall_log WHERE episode_id = ?", (episode_id,))
        self._db.execute("DELETE FROM facts WHERE source_episode_id = ?", (episode_id,))
        cursor = self._db.execute("DELETE FROM episodes WHERE id = ?", (episode_id,))
        self._db.commit()
        return cursor.rowcount > 0

    def update_episode_content(self, episode_id: int, content: str) -> bool:
        """更新 episode 文本内容。空/纯空格内容返回 False。"""
        if not content or not content.strip():
            return False
        cursor = self._db.execute(
            "UPDATE episodes SET content = ? WHERE id = ?",
            (content.strip(), episode_id),
        )
        self._db.commit()
        return cursor.rowcount > 0

    def delete_fact(self, fact_id: int) -> bool:
        """删除 fact 及其置信度历史。返回是否成功删除。"""
        self._db.execute("DELETE FROM fact_confidence_log WHERE fact_id = ?", (fact_id,))
        cursor = self._db.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
        self._db.commit()
        return cursor.rowcount > 0

    # ── 事实方法 ──

    def add_fact(
        self,
        content: str,
        confidence: float = settings.default_confidence,
        source_episode_id: int | None = None,
        faiss_id: int | None = None,
        subject: str | None = None,
        relation: str | None = None,
        object: str | None = None,
    ) -> int:
        cursor = self._db.execute(
            "INSERT INTO facts (content, confidence, source_episode_id, faiss_id, "
            "subject, relation, object) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (content, confidence, source_episode_id, faiss_id, subject, relation, object),
        )
        self._db.commit()
        rowid = cursor.lastrowid
        assert rowid is not None
        return rowid

    def get_all_facts(self) -> list[FactRow]:
        rows = self._db.execute("SELECT * FROM facts ORDER BY confidence DESC").fetchall()
        return [dict(row) for row in rows]  # type: ignore[misc]

    def get_predicate_tag_summary(self, limit: int = 10) -> list[dict[str, object]]:
        """按 (subject, relation) 聚合事实标签，用于标签云预览。"""
        rows = self._db.execute(
            "SELECT subject, relation, "
            "MAX(confidence) AS max_confidence, "
            "COUNT(*) AS fact_count, "
            "COUNT(DISTINCT object) AS distinct_objects "
            "FROM facts "
            "WHERE subject IS NOT NULL AND relation IS NOT NULL "
            "GROUP BY subject, relation "
            "ORDER BY max_confidence DESC "
            "LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_facts_by_faiss_id(self, faiss_ids: list[int]) -> list[FactRow]:
        if not faiss_ids:
            return []
        placeholders = ",".join("?" * len(faiss_ids))
        rows = self._db.execute(
            f"SELECT * FROM facts WHERE faiss_id IN ({placeholders})", faiss_ids
        ).fetchall()
        return [dict(row) for row in rows]  # type: ignore[misc]

    def update_fact_confidence(self, fact_id: int, delta: float) -> tuple[float, float] | None:
        """更新事实置信度并返回变更前后的值。

        在 store 层完成读→写→读闭环，消除调用方绕过 `_db` 自行查询的需要。

        Args:
            fact_id: 目标事实 ID。
            delta: 置信度增量（正值=加星，负值=纠正），夹紧到 [0, 1]。

        Returns:
            (confidence_before, confidence_after) 元组；
            None 表示 fact_id 不存在。
        """
        # 读取当前置信度——同时检查 fact 是否存在
        row = self._db.execute("SELECT confidence FROM facts WHERE id = ?", (fact_id,)).fetchone()
        if row is None:
            return None
        confidence_before: float = float(row["confidence"])

        # 更新
        self._db.execute(
            "UPDATE facts SET confidence = MAX(0, MIN(1, confidence + ?)), "
            "updated_at = strftime('%s', 'now') WHERE id = ?",
            (delta, fact_id),
        )
        self._db.commit()

        # 读取新置信度
        row = self._db.execute("SELECT confidence FROM facts WHERE id = ?", (fact_id,)).fetchone()
        confidence_after: float = float(row["confidence"]) if row is not None else confidence_before

        return confidence_before, confidence_after

    def get_facts_by_subject(self, subject: str) -> list[FactRow]:
        rows = self._db.execute(
            "SELECT * FROM facts WHERE subject = ? ORDER BY confidence DESC",
            (subject,),
        ).fetchall()
        return [dict(row) for row in rows]  # type: ignore[misc]

    def get_tag_detail(self, subject: str, relation: str) -> dict[str, object]:
        """获取标签详情——关联事实 + 来源 episode + 置信度变更日志。

        一次 LEFT JOIN 完成 facts + episodes 联查，
        再批量查询 fact_confidence_log 消除 N+1。
        返回结构见 API schemas.TagDetailResponse。
        """
        rows = self._db.execute(
            "SELECT f.*, e.content AS episode_content, "
            "e.timestamp AS episode_timestamp "
            "FROM facts f "
            "LEFT JOIN episodes e ON f.source_episode_id = e.id "
            "WHERE f.subject = ? AND f.relation = ? "
            "ORDER BY f.confidence DESC",
            (subject, relation),
        ).fetchall()

        facts = [dict(row) for row in rows]
        fact_ids = [int(f["id"]) for f in facts]
        confidence_logs = self.get_fact_confidence_history_batch(fact_ids)

        max_conf = max((float(f["confidence"]) for f in facts), default=0.0)
        objects = {str(f["object"]) for f in facts if f["object"] is not None}

        return {
            "subject": subject,
            "relation": relation,
            "max_confidence": max_conf,
            "fact_count": len(facts),
            "distinct_objects": len(objects),
            "facts": [
                {
                    **f,
                    "confidence_log": confidence_logs.get(int(f["id"]), []),
                }
                for f in facts
            ],
        }

    def get_fact_confidence_history(self, fact_id: int) -> list[dict[str, object]]:
        rows = self._db.execute(
            "SELECT * FROM fact_confidence_log WHERE fact_id = ? ORDER BY logged_at ASC",
            (fact_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_fact_confidence_history_batch(
        self, fact_ids: list[int]
    ) -> dict[int, list[dict[str, object]]]:
        """批量查询事实置信度历史，消除 N+1 查询。

        返回 {fact_id: [history_rows]} 映射。
        """
        if not fact_ids:
            return {}
        placeholders = ",".join("?" * len(fact_ids))
        rows = self._db.execute(
            f"SELECT * FROM fact_confidence_log "
            f"WHERE fact_id IN ({placeholders}) ORDER BY logged_at ASC",
            fact_ids,
        ).fetchall()
        result: dict[int, list[dict[str, object]]] = {}
        for row in rows:
            d = dict(row)
            fid = d["fact_id"]
            result.setdefault(int(fid), []).append(d)
        return result

    def log_fact_confidence(
        self,
        fact_id: int,
        confidence_before: float,
        confidence_after: float,
        reason: str = "",
    ) -> None:
        self._db.execute(
            "INSERT INTO fact_confidence_log "
            "(fact_id, confidence_before, confidence_after, reason) VALUES (?, ?, ?, ?)",
            (fact_id, confidence_before, confidence_after, reason),
        )
        self._db.commit()

    # ── 召回日志方法 ──

    def log_recall(
        self,
        episode_id: int,
        strength_before: float,
        strength_after: float,
    ) -> None:
        self._db.execute(
            "INSERT INTO recall_log (episode_id, strength_before, strength_after) VALUES (?, ?, ?)",
            (episode_id, strength_before, strength_after),
        )
        self._db.commit()

    def get_recall_log(self, episode_id: int) -> list[dict[str, object]]:
        rows = self._db.execute(
            "SELECT * FROM recall_log WHERE episode_id = ? ORDER BY recalled_at ASC",
            (episode_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    # ── Trace 持久化 (Phase 16 — Batch 59B) ──

    def insert_trace(
        self,
        session_id: str,
        step_name: str,
        elapsed_ms: float,
        status: str = "ok",
        metrics: dict[str, object] | None = None,
    ) -> int:
        """写入一条管道 trace 记录，返回 row id。"""
        metrics_json = json.dumps(metrics or {}, ensure_ascii=False, default=str)
        cursor = self._db.execute(
            "INSERT INTO pipeline_trace (session_id, step_name, elapsed_ms, status, metrics_json) "
            "VALUES (?, ?, ?, ?, ?)",
            (session_id, step_name, elapsed_ms, status, metrics_json),
        )
        self._db.commit()
        rowid = cursor.lastrowid
        assert rowid is not None
        return rowid

    def get_traces(self, session_id: str | None = None, limit: int = 50) -> list[dict[str, object]]:
        """按时间倒序获取 trace 记录。session_id=None 返回所有 session。"""
        if session_id is not None:
            rows = self._db.execute(
                "SELECT * FROM pipeline_trace WHERE session_id = ? "
                "ORDER BY created_at DESC, id DESC LIMIT ?",
                (session_id, limit),
            ).fetchall()
        else:
            rows = self._db.execute(
                "SELECT * FROM pipeline_trace ORDER BY created_at DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_traces_by_step(self, step_name: str, limit: int = 200) -> list[dict[str, object]]:
        """按 step_name 过滤追踪记录，按创建时间倒序。"""
        rows = self._db.execute(
            "SELECT * FROM pipeline_trace WHERE step_name = ? "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (step_name, limit),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_trace_count(self, session_id: str | None = None) -> int:
        """trace 记录总数。session_id=None 返回所有 session 的总数。"""
        if session_id is not None:
            row = self._db.execute(
                "SELECT COUNT(*) FROM pipeline_trace WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        else:
            row = self._db.execute("SELECT COUNT(*) FROM pipeline_trace").fetchone()
        assert row is not None
        return int(row[0])

    def get_latest_trace(self) -> dict[str, object] | None:
        """返回最近一条 pipeline_trace 记录，无数据时返回 None。

        供 SessionBoundaryDetector 三级回退的最优先查询使用。
        """
        row = self._db.execute(
            "SELECT * FROM pipeline_trace ORDER BY created_at DESC, id DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row is not None else None

    def delete_old_traces(self, retention_limit: int) -> int:
        """删除超过 retention_limit 条的旧记录（按 created_at ASC），返回删除数。
        仅当 retention_limit > 0 时执行。"""
        if retention_limit <= 0:
            return 0
        count_row = self._db.execute("SELECT COUNT(*) FROM pipeline_trace").fetchone()
        assert count_row is not None
        total = int(count_row[0])
        if total <= retention_limit:
            return 0
        delete_count = total - retention_limit
        self._db.execute(
            "DELETE FROM pipeline_trace WHERE id IN "
            "(SELECT id FROM pipeline_trace ORDER BY created_at ASC, id ASC LIMIT ?)",
            (delete_count,),
        )
        self._db.commit()
        return delete_count

    # ── 任务规划持久化 (Phase 53 Batch 1) ──

    def insert_plan(
        self,
        session_id: str,
        user_msg: str,
        intent_category: str,
        plan_result: PlanResult,
    ) -> int:
        """事务性写入一次规划结果——plan_run + N 条 plan_subtasks。

        Args:
            session_id: 当前会话标识。
            user_msg: 触发规划的用户消息原文。
            intent_category: L1 意图分类结果。
            plan_result: PlanGenerator 生成的 PlanResult。

        Returns:
            新插入的 plan_run id。
        """
        dag_edges_json = json.dumps(plan_result.dag_edges, ensure_ascii=False, default=str)
        subtasks = plan_result.subtasks

        self._db.execute("BEGIN")
        try:
            cursor = self._db.execute(
                "INSERT INTO plan_runs "
                "(session_id, user_msg, intent_category, rationale, confidence, "
                "subtask_count, dag_edges_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    session_id,
                    user_msg,
                    intent_category,
                    plan_result.rationale,
                    plan_result.confidence,
                    len(subtasks),
                    dag_edges_json,
                ),
            )
            plan_run_id = cursor.lastrowid
            assert plan_run_id is not None

            for idx, subtask in enumerate(subtasks):
                depends_on_json = json.dumps(
                    subtask.get("depends_on", []), ensure_ascii=False, default=str
                )
                self._db.execute(
                    "INSERT INTO plan_subtasks "
                    "(plan_run_id, subtask_id, description, depends_on_json, sort_order) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        plan_run_id,
                        str(subtask.get("id", "")),
                        str(subtask.get("description", "")),
                        depends_on_json,
                        idx,
                    ),
                )
            self._db.commit()
        except Exception:
            self._db.execute("ROLLBACK")
            raise

        return plan_run_id

    def get_plan(self, plan_run_id: int) -> dict[str, object] | None:
        """获取一次规划结果——plan_run 行 + 其所有 subtasks。

        Args:
            plan_run_id: 规划运行 id。

        Returns:
            plan_run 字典含内联 "subtasks" 键（list[dict]）。
            若 plan_run_id 不存在则返回 None。
        """
        row = self._db.execute("SELECT * FROM plan_runs WHERE id = ?", (plan_run_id,)).fetchone()
        if row is None:
            return None

        plan = dict(row)
        subtask_rows = self._db.execute(
            "SELECT * FROM plan_subtasks WHERE plan_run_id = ? ORDER BY sort_order ASC",
            (plan_run_id,),
        ).fetchall()
        plan["subtasks"] = [dict(sr) for sr in subtask_rows]
        return plan

    def list_plans(self, session_id: str | None = None, limit: int = 20) -> list[dict[str, object]]:
        """列出最近的规划运行（不含 subtasks，subtask_count 在计划行中）。

        Args:
            session_id: 可选的会话过滤。None 返回所有 session 的规划。
            limit: 返回数量上限，默认 20。

        Returns:
            按 created_at 倒序排列的 plan_run 字典列表。
        """
        if session_id is not None:
            rows = self._db.execute(
                "SELECT * FROM plan_runs WHERE session_id = ? "
                "ORDER BY created_at DESC, id DESC LIMIT ?",
                (session_id, limit),
            ).fetchall()
        else:
            rows = self._db.execute(
                "SELECT * FROM plan_runs ORDER BY created_at DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_latest_plan(self, session_id: str | None = None) -> dict[str, object] | None:
        """获取最近一次规划运行（含内联 subtasks）。

        Args:
            session_id: 可选的会话过滤。None 返回最近一次全局规划。

        Returns:
            plan_run 字典含 "subtasks" 键，或 None（无规划记录时）。
        """
        if session_id is not None:
            row = self._db.execute(
                "SELECT id FROM plan_runs WHERE session_id = ? "
                "ORDER BY created_at DESC, id DESC LIMIT 1",
                (session_id,),
            ).fetchone()
        else:
            row = self._db.execute(
                "SELECT id FROM plan_runs ORDER BY created_at DESC, id DESC LIMIT 1"
            ).fetchone()

        if row is None:
            return None
        return self.get_plan(int(row["id"]))

    def get_latest_plan_run(self) -> dict[str, object] | None:
        """返回最近一条 plan_runs 行（不含 subtasks），无数据时返回 None。

        不同于 get_latest_plan()——此方法不加载 subtasks，
        专供 SessionBoundaryDetector 三级回退的第二级使用。
        """
        row = self._db.execute(
            "SELECT * FROM plan_runs ORDER BY created_at DESC, id DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row is not None else None

    def get_unfinished_plans_since(self, since: float) -> list[dict[str, object]]:
        """返回 ``since`` 之后有未完成子任务的 plan_run，每个含 ``subtasks`` 键。

        未完成子任务定义：status IN ('pending', 'running')。
        结果按 created_at DESC 排列，每个 plan dict 附带的 ``subtasks``
        列表仅含非终态子任务。

        供 SessionBoundaryDetector 的 unfinished_intents 检测使用——
        一次 store 调用消除原来的 JOIN + N+1 循环。
        """
        plans = self._db.execute(
            "SELECT DISTINCT pr.* FROM plan_runs pr "
            "JOIN plan_subtasks ps ON ps.plan_run_id = pr.id "
            "WHERE ps.status IN ('pending', 'running') "
            "AND pr.created_at > ? "
            "ORDER BY pr.created_at DESC",
            (since,),
        ).fetchall()

        result: list[dict[str, object]] = []
        for plan in plans:
            plan_dict = dict(plan)
            subtasks = self._db.execute(
                "SELECT * FROM plan_subtasks "
                "WHERE plan_run_id = ? AND status IN ('pending', 'running') "
                "ORDER BY sort_order",
                (plan_dict["id"],),
            ).fetchall()
            if subtasks:
                plan_dict["subtasks"] = [dict(st) for st in subtasks]
                result.append(plan_dict)

        return result

    def update_subtask(
        self,
        plan_run_id: int,
        subtask_id: str,
        status: str,
        new_description: str | None = None,
    ) -> bool:
        """更新单条子任务状态和可选描述——用户干预接口的存储层。

        Args:
            plan_run_id: 规划运行 id。
            subtask_id: 子任务标识（对应 PlanResult.subtasks 中的 id）。
            status: 新状态（如 "accepted" / "rejected" / "modified" / "skipped"）。
            new_description: 可选的新描述文本（action=modify 时使用）。

        Returns:
            True 表示成功更新至少一行，False 表示目标子任务不存在。
        """
        if new_description is not None:
            cursor = self._db.execute(
                "UPDATE plan_subtasks SET status = ?, description = ? "
                "WHERE plan_run_id = ? AND subtask_id = ?",
                (status, new_description, plan_run_id, subtask_id),
            )
        else:
            cursor = self._db.execute(
                "UPDATE plan_subtasks SET status = ? WHERE plan_run_id = ? AND subtask_id = ?",
                (status, plan_run_id, subtask_id),
            )
        self._db.commit()
        return cursor.rowcount > 0

    # ── 多层记忆分级 (Phase 54 — 四支柱 1.2) ──

    def set_episode_tier(self, episode_id: int, tier: str) -> None:
        """设置单条 episode 的分级标签（hot/warm/cold）。

        Args:
            episode_id: 目标 episode id。
            tier: 分级标签，应为 "hot" / "warm" / "cold" 之一。
        """
        self._db.execute("UPDATE episodes SET tier = ? WHERE id = ?", (tier, episode_id))
        self._db.commit()

    def set_episode_tiers_batch(self, updates: list[tuple[int, str]]) -> None:
        """批量设置 episode 分级标签，单事务提交。

        Args:
            updates: [(episode_id, tier), ...] 列表。空列表为 no-op。
        """
        if not updates:
            return
        self._db.execute("BEGIN")
        self._db.executemany(
            "UPDATE episodes SET tier = ? WHERE id = ?",
            [(tier, eid) for eid, tier in updates],
        )
        self._db.commit()

    def get_episodes_by_tier(self, tier: str, limit: int = 50) -> list[EpisodeRow]:
        """按分级标签查询 episodes，按时间倒序。

        Args:
            tier: 分级标签（"hot" / "warm" / "cold"）。
            limit: 返回数量上限，默认 50。

        Returns:
            episode 字典列表，按 timestamp DESC 排序。
        """
        rows = self._db.execute(
            "SELECT * FROM episodes WHERE tier = ? ORDER BY timestamp DESC LIMIT ?",
            (tier, limit),
        ).fetchall()
        return [dict(row) for row in rows]  # type: ignore[misc]

    def get_tier_distribution(self) -> dict[str, int]:
        """获取三级分层的 episode 数量分布。

        Returns:
            {"hot": N, "warm": N, "cold": N}，未出现的层为 0。
        """
        rows = self._db.execute(
            "SELECT tier, COUNT(*) AS cnt FROM episodes GROUP BY tier"
        ).fetchall()
        result: dict[str, int] = {"hot": 0, "warm": 0, "cold": 0}
        for row in rows:
            t = str(row["tier"])
            if t in result:
                result[t] = int(row["cnt"])
        return result

    # ── 会话回归摘要 (Phase 59 — 跨会话连续性) ──

    def save_session_summary(
        self,
        session_id: str,
        last_activity_at: float,
        unfinished_intents: list[dict[str, object]],
        open_questions: list[dict[str, object]],
        created_at: float | None = None,
    ) -> int:
        """持久化会话边界的开放项快照——供未来回归摘要对比。

        Args:
            session_id: 会话标识。
            last_activity_at: 该会话最后活动时间戳。
            unfinished_intents: 未完成意图列表（来自 SessionBoundaryResult）。
            open_questions: 打开问题列表（来自 SessionBoundaryResult）。
            created_at: 写入时间戳，None 时用 SQLite 默认值。

        Returns:
            新行的 id。
        """
        unfinished_json = json.dumps(unfinished_intents, ensure_ascii=False, default=str)
        questions_json = json.dumps(open_questions, ensure_ascii=False, default=str)

        if created_at is not None:
            cursor = self._db.execute(
                "INSERT INTO session_summaries "
                "(session_id, last_activity_at, unfinished_intents_json, "
                "open_questions_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (session_id, last_activity_at, unfinished_json, questions_json, created_at),
            )
        else:
            cursor = self._db.execute(
                "INSERT INTO session_summaries "
                "(session_id, last_activity_at, unfinished_intents_json, "
                "open_questions_json) VALUES (?, ?, ?, ?)",
                (session_id, last_activity_at, unfinished_json, questions_json),
            )
        self._db.commit()
        rowid = cursor.lastrowid
        assert rowid is not None
        return rowid

    def get_recent_session_summaries(self, num_sessions: int) -> list[dict[str, object]]:
        """获取最近 N 个会话的回归摘要快照，按时间倒序。

        Args:
            num_sessions: 返回的会话数上限。

        Returns:
            session_summaries 行列表（dict），最新在前。
        """
        rows = self._db.execute(
            "SELECT * FROM session_summaries ORDER BY created_at DESC LIMIT ?",
            (num_sessions,),
        ).fetchall()
        return [dict(row) for row in rows]

    # ── 反思洞察 (Phase 61 — 反思闭环) ──

    def insert_reflection_insight(
        self,
        insight_type: str,
        title: str,
        description: str,
        source_plan_ids: list[int] | None = None,
        confidence: float = 0.5,
        occurrence_count: int = 1,
    ) -> int:
        """插入一条元知识洞察——从多次反思中提取的跨计划模式。

        Args:
            insight_type: "failure_pattern" / "improvement_pattern" / "best_practice"。
            title: 一句话概括。
            description: 详细说明。
            source_plan_ids: 来源 plan_run id 列表。
            confidence: 置信度 [0, 1]。
            occurrence_count: 已观测到的出现次数。

        Returns:
            新行的 id。
        """
        source_json = json.dumps(source_plan_ids or [], ensure_ascii=False)
        cursor = self._db.execute(
            "INSERT INTO reflection_insights "
            "(insight_type, title, description, source_plan_ids_json, "
            "confidence, occurrence_count) VALUES (?, ?, ?, ?, ?, ?)",
            (insight_type, title, description, source_json, confidence, occurrence_count),
        )
        self._db.commit()
        rowid = cursor.lastrowid
        assert rowid is not None
        return rowid

    def list_reflection_insights(
        self,
        insight_type: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, object]]:
        """列出最近的反思洞察，按创建时间倒序。

        Args:
            insight_type: 可选的类型过滤。None 返回所有类型。
            limit: 返回数量上限，默认 20。

        Returns:
            按 created_at DESC 排列的 insight 字典列表。
        """
        if insight_type is not None:
            rows = self._db.execute(
                "SELECT * FROM reflection_insights WHERE insight_type = ? "
                "ORDER BY created_at DESC, id DESC LIMIT ?",
                (insight_type, limit),
            ).fetchall()
        else:
            rows = self._db.execute(
                "SELECT * FROM reflection_insights ORDER BY created_at DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_reflection_insight(self, insight_id: int) -> dict[str, object]:
        """获取单条反思洞察。

        Args:
            insight_id: 洞察 id。

        Returns:
            洞察字典，不存在时返回空 dict。
        """
        row = self._db.execute(
            "SELECT * FROM reflection_insights WHERE id = ?", (insight_id,)
        ).fetchone()
        if row is None:
            return {}
        return dict(row)

    def upsert_reflection_insight(
        self,
        insight_type: str,
        title: str,
        description: str,
        source_plan_ids: list[int] | None = None,
        confidence: float = 0.5,
    ) -> int:
        """按 title 去重插入/更新洞察——同一模式再次出现时累加计数并更新置信度。

        存在匹配 title 的行时：occurrence_count += 1，confidence 取新旧平均，
        source_plan_ids 合并去重，description 更新为新描述。

        不存在匹配行时：等价于 insert_reflection_insight。

        Args:
            insight_type: 洞察类型。
            title: 模式标题（去重键）。
            description: 详细描述。
            source_plan_ids: 新来源 plan_run id 列表。
            confidence: 新置信度。

        Returns:
            受影响行的 id（新建行 id 或匹配行 id）。
        """
        existing = self._db.execute(
            "SELECT id, occurrence_count, confidence, source_plan_ids_json "
            "FROM reflection_insights WHERE title = ?",
            (title,),
        ).fetchone()

        if existing is None:
            return self.insert_reflection_insight(
                insight_type=insight_type,
                title=title,
                description=description,
                source_plan_ids=source_plan_ids,
                confidence=confidence,
                occurrence_count=1,
            )

        # 合并已有和新数据
        new_count = int(existing["occurrence_count"]) + 1
        new_confidence = (float(existing["confidence"]) + confidence) / 2.0
        new_source_ids: list[int] = json.loads(str(existing["source_plan_ids_json"]))
        for pid in source_plan_ids or []:
            if pid not in new_source_ids:
                new_source_ids.append(pid)
        new_source_json = json.dumps(new_source_ids, ensure_ascii=False)

        self._db.execute(
            "UPDATE reflection_insights SET "
            "occurrence_count = ?, confidence = ?, source_plan_ids_json = ?, "
            "description = ?, updated_at = strftime('%s', 'now') WHERE id = ?",
            (new_count, new_confidence, new_source_json, description, int(existing["id"])),
        )
        self._db.commit()
        return int(existing["id"])

    # ── 生命周期 ──

    def close(self) -> None:
        if self.conn:
            self.conn.close()
            self.conn = None

    def __enter__(self) -> MemoryStore:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
