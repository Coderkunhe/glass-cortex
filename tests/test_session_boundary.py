"""Phase 59 Batch 1+2 — SessionBoundaryDetector + RegressionSummary 单元测试。

测试策略：
- 遵循 test_consolidate.py 模式 —— 无 pytest fixtures，每个测试手动
  构造 MemoryStore + try/finally close，避免 fixture 耦合。
- 固定时间基准 _BASE_TIME 确保时间戳可预测。
- 直接 SQL INSERT 预置测试数据，覆盖所有三级回退 + 边界条件。
- Batch 2 新增回归摘要 + 待办跟踪测试。
"""

import json
from pathlib import Path
from typing import cast

from src.config import SessionBoundaryConfig, Settings
from src.context.session_boundary import (
    RegressionSummary,
    SessionBoundaryDetector,
    SessionBoundaryResult,
)
from src.memory.store import MemoryStore

_BASE_TIME = 1751932800.0  # 2026-07-01T00:00:00Z


# ═══════════════════════════════════════════════════════════════
# 首次会话检测
# ═══════════════════════════════════════════════════════════════


class TestDetectFirstSession:
    """空数据库 → 首次会话结果。"""

    def test_empty_db_is_first_session(self, tmp_path: Path) -> None:
        """三表全空 → is_first_session=True，所有列表为空。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            cfg = Settings(session_boundary=SessionBoundaryConfig(enabled=True))
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.is_first_session is True
            assert result.last_session_end is None
            assert result.last_session_id is None
            assert result.unfinished_intents == []
            assert result.open_questions == []
        finally:
            store.close()

    def test_disabled_flag_returns_none(self, tmp_path: Path) -> None:
        """feature flag 关闭 → detect() 返回 None。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            cfg = Settings(session_boundary=SessionBoundaryConfig(enabled=False))
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is None
        finally:
            store.close()


# ═══════════════════════════════════════════════════════════════
# 上次会话结束时间检测
# ═══════════════════════════════════════════════════════════════


class TestDetectLastSessionEnd:
    """三级回退检测上次会话结束时间。"""

    def test_from_pipeline_trace(self, tmp_path: Path) -> None:
        """pipeline_trace 有记录 → 返回最近时间戳 + session_id。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 7200  # 2 hours ago
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("old-session-abc", "recall", 150.0, "ok", prev_time),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.is_first_session is False
            assert result.last_session_end == prev_time
            assert result.last_session_id == "old-session-abc"
        finally:
            store.close()

    def test_within_session_gap_returns_none(self, tmp_path: Path) -> None:
        """会话间隔 < gap → 仍同一会话，返回 None。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            recent_time = _BASE_TIME - 600  # 10 min ago, within 30 min gap
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("current-session", "recall", 150.0, "ok", recent_time),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is None  # 仍在同一会话
        finally:
            store.close()

    def test_fallback_to_plan_runs(self, tmp_path: Path) -> None:
        """pipeline_trace 为空 → 回退到 plan_runs。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO plan_runs (session_id, user_msg, intent_category, "
                "rationale, confidence, subtask_count, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("plan-session-1", "帮我分析", "分析", "test rationale", 0.8, 3, prev_time),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.last_session_end == prev_time
            assert result.last_session_id == "plan-session-1"
        finally:
            store.close()

    def test_fallback_to_episodes(self, tmp_path: Path) -> None:
        """pipeline_trace 和 plan_runs 都为空 → 回退到 episodes（无 session_id）。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 1800
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp) VALUES (?, ?)",
                ("hello", prev_time),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=600,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.last_session_end == prev_time
            assert result.last_session_id is None  # episodes 无 session_id
        finally:
            store.close()

    def test_most_recent_of_multiple_traces(self, tmp_path: Path) -> None:
        """多条 pipeline_trace → 取 created_at 最大的那条。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            older = _BASE_TIME - 5000
            newer = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("old-sess", "recall", 100.0, "ok", older),
            )
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("recent-sess", "plan", 200.0, "ok", newer),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.last_session_end == newer
            assert result.last_session_id == "recent-sess"
        finally:
            store.close()


# ═══════════════════════════════════════════════════════════════
# 未完成意图检测
# ═══════════════════════════════════════════════════════════════


class TestDetectUnfinishedIntents:
    """检测含非终态子任务的 Plan。"""

    def test_detect_pending_and_running_subtasks(self, tmp_path: Path) -> None:
        """plan 含 pending + running subtask → 检出，succeeded 不检出。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("sess-1", "plan", 200.0, "ok", prev_time),
            )
            store.conn.execute(
                "INSERT INTO plan_runs (id, session_id, user_msg, intent_category, "
                "rationale, confidence, subtask_count, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (1, "sess-1", "帮我做三件事", "任务", "test", 0.9, 3, prev_time + 100),
            )
            # 三个子任务：成功、待处理、运行中
            store.conn.execute(
                "INSERT INTO plan_subtasks"
                " (plan_run_id, subtask_id, description, status, sort_order, created_at)"
                "VALUES (?, ?, ?, ?, ?, ?)",
                (1, "s1", "已完成", "succeeded", 0, prev_time + 200),
            )
            store.conn.execute(
                "INSERT INTO plan_subtasks"
                " (plan_run_id, subtask_id, description, status, sort_order, created_at)"
                "VALUES (?, ?, ?, ?, ?, ?)",
                (1, "s2", "未完成", "pending", 1, prev_time + 300),
            )
            store.conn.execute(
                "INSERT INTO plan_subtasks"
                " (plan_run_id, subtask_id, description, status, sort_order, created_at)"
                "VALUES (?, ?, ?, ?, ?, ?)",
                (1, "s3", "进行中", "running", 2, prev_time + 400),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert len(result.unfinished_intents) == 1
            intent = result.unfinished_intents[0]
            assert intent["intent_category"] == "任务"
            subtasks = cast("list[dict[str, object]]", intent["subtasks"])
            assert len(subtasks) == 2  # 仅 pending + running
            statuses = {st["status"] for st in subtasks}
            assert statuses == {"pending", "running"}
        finally:
            store.close()

    def test_all_terminal_subtasks_not_detected(self, tmp_path: Path) -> None:
        """全部 subtask 终态（succeeded/skipped/failed）→ 不检出。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("sess-2", "plan", 200.0, "ok", prev_time),
            )
            store.conn.execute(
                "INSERT INTO plan_runs (id, session_id, user_msg, intent_category, "
                "rationale, confidence, subtask_count, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (1, "sess-2", "全部完成", "任务", "done", 0.9, 2, prev_time + 100),
            )
            for st_id, status in [("s1", "succeeded"), ("s2", "skipped")]:
                store.conn.execute(
                    "INSERT INTO plan_subtasks"
                    " (plan_run_id, subtask_id, description, status, sort_order, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (1, st_id, f"任务 {st_id}", status, 0, prev_time + 200),
                )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.unfinished_intents == []
        finally:
            store.close()

    def test_failed_subtask_is_terminal(self, tmp_path: Path) -> None:
        """failed 状态是终态——不检出。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("sess-2b", "plan", 200.0, "ok", prev_time),
            )
            store.conn.execute(
                "INSERT INTO plan_runs (id, session_id, user_msg, intent_category, "
                "rationale, confidence, subtask_count, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (1, "sess-2b", "已失败", "任务", "done", 0.5, 1, prev_time + 100),
            )
            store.conn.execute(
                "INSERT INTO plan_subtasks"
                " (plan_run_id, subtask_id, description, status, sort_order, created_at)"
                "VALUES (?, ?, ?, ?, ?, ?)",
                (1, "s-fail", "失败了", "failed", 0, prev_time + 200),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.unfinished_intents == []
        finally:
            store.close()

    def test_old_plans_excluded_by_since_filter(self, tmp_path: Path) -> None:
        """上次会话之前的旧 plan 不被检出（since 时间过滤）。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 3600
            older_time = _BASE_TIME - 7200  # 上次会话之前
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("sess-3", "plan", 200.0, "ok", prev_time),
            )
            # 旧 plan —— 在上次会话之前创建
            store.conn.execute(
                "INSERT INTO plan_runs (id, session_id, user_msg, intent_category, "
                "rationale, confidence, subtask_count, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (1, "old-sess", "旧任务", "任务", "old", 0.5, 1, older_time),
            )
            store.conn.execute(
                "INSERT INTO plan_subtasks"
                " (plan_run_id, subtask_id, description, status, sort_order, created_at)"
                "VALUES (?, ?, ?, ?, ?, ?)",
                (1, "s1", "旧子任务", "pending", 0, older_time + 100),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.unfinished_intents == []
        finally:
            store.close()


# ═══════════════════════════════════════════════════════════════
# 打开问题检测
# ═══════════════════════════════════════════════════════════════


class TestDetectOpenQuestions:
    """检测 episodes 中的潜在用户问句。"""

    def test_detect_question_mark_episodes(self, tmp_path: Path) -> None:
        """episodes 含 ? 或 ？→ 检出为打开问题。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("sess-q1", "chat", 500.0, "ok", prev_time),
            )
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp) VALUES (?, ?)",
                ("什么是会话边界检测？", prev_time + 100),
            )
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp) VALUES (?, ?)",
                ("How does session boundary work?", prev_time + 200),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert len(result.open_questions) == 2
        finally:
            store.close()

    def test_no_question_marker_not_detected(self, tmp_path: Path) -> None:
        """陈述句（无 ?/?）→ 不检出。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("sess-q2", "chat", 500.0, "ok", prev_time),
            )
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp) VALUES (?, ?)",
                ("帮我分析一下这个数据", prev_time + 100),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.open_questions == []
        finally:
            store.close()

    def test_question_mark_mid_content(self, tmp_path: Path) -> None:
        """问号在内容中间也应检出（LIKE %?% 而非 ? 结尾）。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 3600
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("sess-q3", "chat", 500.0, "ok", prev_time),
            )
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp) VALUES (?, ?)",
                ("你觉得这个方案怎么样？我还在考虑", prev_time + 100),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert len(result.open_questions) == 1
        finally:
            store.close()

    def test_old_questions_excluded_by_since_filter(self, tmp_path: Path) -> None:
        """上次会话之前的问题不被检出。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            prev_time = _BASE_TIME - 3600
            older_time = _BASE_TIME - 7200
            store.conn.execute(
                "INSERT INTO pipeline_trace"
                " (session_id, step_name, elapsed_ms, status, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("sess-q4", "chat", 500.0, "ok", prev_time),
            )
            store.conn.execute(
                "INSERT INTO episodes (content, timestamp) VALUES (?, ?)",
                ("这是旧问题？", older_time),
            )
            store.conn.commit()

            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    session_gap_seconds=1800,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = detector.detect(now=_BASE_TIME)
            assert result is not None
            assert result.open_questions == []
        finally:
            store.close()


# ═══════════════════════════════════════════════════════════════
# SessionBoundaryResult 数据类
# ═══════════════════════════════════════════════════════════════


class TestSessionBoundaryResult:
    """SessionBoundaryResult 属性与默认值。"""

    def test_is_first_session_when_no_history(self) -> None:
        """last_session_end=None → is_first_session=True。"""
        r = SessionBoundaryResult(last_session_end=None, last_session_id=None)
        assert r.is_first_session is True

    def test_is_not_first_session_with_history(self) -> None:
        """last_session_end 有值 → is_first_session=False。"""
        r = SessionBoundaryResult(last_session_end=_BASE_TIME, last_session_id="sess-1")
        assert r.is_first_session is False

    def test_default_factories_are_empty_lists(self) -> None:
        """未提供时 unfinished_intents 和 open_questions 为空列表。"""
        r = SessionBoundaryResult(last_session_end=_BASE_TIME, last_session_id="sess-1")
        assert r.unfinished_intents == []
        assert r.open_questions == []
        assert isinstance(r.unfinished_intents, list)
        assert isinstance(r.open_questions, list)


# ═══════════════════════════════════════════════════════════════
# 回归摘要生成 (Batch 2)
# ═══════════════════════════════════════════════════════════════


class TestGenerateRegressionSummary:
    """generate_regression_summary() 的回归摘要生成逻辑。"""

    def test_no_history_yields_empty_summary(self, tmp_path: Path) -> None:
        """无历史 session_summaries → ongoing/resolved 皆空，摘要文本简洁。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            cfg = Settings(
                session_boundary=SessionBoundaryConfig(
                    enabled=True,
                    num_sessions_for_regression=3,
                ),
            )
            detector = SessionBoundaryDetector(store, cfg)
            result = SessionBoundaryResult(
                last_session_end=_BASE_TIME - 3600,
                last_session_id="sess-1",
                unfinished_intents=[
                    {"id": 1, "intent_category": "任务", "subtasks": []},
                ],
                open_questions=[
                    {"content": "下一步怎么做？", "id": 100},
                ],
            )
            summary = detector.generate_regression_summary(result, num_sessions=3)
            assert summary.previous_sessions == []
            assert summary.ongoing_items == []
            assert summary.resolved_items == []
            assert "1 个未完成意图" in summary.summary_text
            assert "1 个打开问题" in summary.summary_text
        finally:
            store.close()

    def test_first_session_result_yields_simple_text(self, tmp_path: Path) -> None:
        """首次会话 is_first_session=True → 摘要注明首次会话。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            detector = SessionBoundaryDetector(
                store,
                Settings(session_boundary=SessionBoundaryConfig(enabled=True)),
            )
            result = SessionBoundaryResult(
                last_session_end=None,
                last_session_id=None,
            )
            summary = detector.generate_regression_summary(result)
            assert "首次会话" in summary.summary_text
        finally:
            store.close()

    def test_ongoing_items_across_sessions(self, tmp_path: Path) -> None:
        """跨会话持续未完成的意图 → ongoing_items 检出。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            # 插入一个历史 session_summary，含 2 个未完成意图
            store.save_session_summary(
                session_id="old-sess-1",
                last_activity_at=_BASE_TIME - 7200,
                unfinished_intents=[
                    {"id": 1, "intent_category": "分析", "subtasks": []},
                    {"id": 2, "intent_category": "修复", "subtasks": []},
                ],
                open_questions=[],
                created_at=_BASE_TIME - 7200,
            )

            detector = SessionBoundaryDetector(
                store,
                Settings(
                    session_boundary=SessionBoundaryConfig(
                        enabled=True, num_sessions_for_regression=3
                    ),
                ),
            )
            # 当前 boundary 中 id=1 仍存在 → ongoing；id=2 不存在 → resolved
            result = SessionBoundaryResult(
                last_session_end=_BASE_TIME - 3600,
                last_session_id="sess-2",
                unfinished_intents=[
                    {"id": 1, "intent_category": "分析", "subtasks": []},
                ],
                open_questions=[],
            )
            summary = detector.generate_regression_summary(result, num_sessions=3)
            assert len(summary.ongoing_items) == 1
            assert summary.ongoing_items[0]["id"] == 1
            assert len(summary.resolved_items) == 1
            assert summary.resolved_items[0]["id"] == 2
        finally:
            store.close()

    def test_resolved_questions_detected(self, tmp_path: Path) -> None:
        """上次会话有问题，本次无此问题 → resolved_items 检出。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            store.save_session_summary(
                session_id="old-sess-1",
                last_activity_at=_BASE_TIME - 7200,
                unfinished_intents=[],
                open_questions=[
                    {"content": "需要帮助吗？", "id": 10},
                    {"content": "性能如何优化？", "id": 11},
                ],
                created_at=_BASE_TIME - 7200,
            )

            detector = SessionBoundaryDetector(
                store,
                Settings(
                    session_boundary=SessionBoundaryConfig(
                        enabled=True, num_sessions_for_regression=3
                    ),
                ),
            )
            # 当前仅剩一个问题 → 另一个视为已解决
            result = SessionBoundaryResult(
                last_session_end=_BASE_TIME - 3600,
                last_session_id="sess-2",
                unfinished_intents=[],
                open_questions=[
                    {"content": "性能如何优化？", "id": 11},
                ],
            )
            summary = detector.generate_regression_summary(result, num_sessions=3)
            assert len(summary.ongoing_items) == 1
            assert summary.ongoing_items[0]["content"] == "性能如何优化？"
            assert len(summary.resolved_items) == 1
            assert summary.resolved_items[0]["content"] == "需要帮助吗？"
            assert "1 项持续未解决" in summary.summary_text
            assert "1 项已解决" in summary.summary_text
        finally:
            store.close()

    def test_empty_open_items_yields_clean_summary(self, tmp_path: Path) -> None:
        """上次会话无开放项 → 摘要注明无遗留。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            detector = SessionBoundaryDetector(
                store,
                Settings(session_boundary=SessionBoundaryConfig(enabled=True)),
            )
            result = SessionBoundaryResult(
                last_session_end=_BASE_TIME - 3600,
                last_session_id="sess-1",
            )
            summary = detector.generate_regression_summary(result, num_sessions=3)
            assert "没有遗留开放项" in summary.summary_text
        finally:
            store.close()

    def test_respects_num_sessions_config(self, tmp_path: Path) -> None:
        """num_sessions 参数限制回顾的会话数。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            # 插入 3 条历史摘要
            for i in range(3):
                store.save_session_summary(
                    session_id=f"old-sess-{i}",
                    last_activity_at=_BASE_TIME - (i + 1) * 3600,
                    unfinished_intents=[{"id": i + 1}],
                    open_questions=[],
                    created_at=_BASE_TIME - (i + 1) * 3600,
                )

            detector = SessionBoundaryDetector(
                store,
                Settings(
                    session_boundary=SessionBoundaryConfig(
                        enabled=True, num_sessions_for_regression=3
                    ),
                ),
            )
            result = SessionBoundaryResult(
                last_session_end=_BASE_TIME - 100,
                last_session_id="current",
                unfinished_intents=[{"id": 99}],
                open_questions=[],
            )
            # 只要求回看 1 个会话
            summary = detector.generate_regression_summary(result, num_sessions=1)
            assert len(summary.previous_sessions) == 1
            # 要求回看全部 3 个
            summary_all = detector.generate_regression_summary(result, num_sessions=3)
            assert len(summary_all.previous_sessions) == 3
        finally:
            store.close()


# ═══════════════════════════════════════════════════════════════
# 待办跟踪 (Batch 2)
# ═══════════════════════════════════════════════════════════════


class TestTrackOpenItems:
    """track_open_items() 的持久化逻辑。"""

    def test_persists_and_retrieves_items(self, tmp_path: Path) -> None:
        """track_open_items 写入后 get_recent_session_summaries 可读取。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            detector = SessionBoundaryDetector(
                store,
                Settings(session_boundary=SessionBoundaryConfig(enabled=True)),
            )
            result = SessionBoundaryResult(
                last_session_end=_BASE_TIME - 3600,
                last_session_id="sess-to-track",
                unfinished_intents=[
                    {"id": 5, "intent_category": "调试", "subtasks": []},
                ],
                open_questions=[
                    {"content": "这个是 bug 吗？", "id": 20},
                ],
            )
            row_id = detector.track_open_items(result, session_id="sess-to-track")
            assert row_id > 0

            # 回读验证
            recent = store.get_recent_session_summaries(1)
            assert len(recent) == 1
            row = recent[0]
            assert row["session_id"] == "sess-to-track"

            # JSON 字段可逆序列化
            intents = json.loads(str(row["unfinished_intents_json"]))
            assert len(intents) == 1
            assert intents[0]["id"] == 5

            questions = json.loads(str(row["open_questions_json"]))
            assert len(questions) == 1
            assert questions[0]["content"] == "这个是 bug 吗？"
        finally:
            store.close()

    def test_tracks_empty_result(self, tmp_path: Path) -> None:
        """空的 open items 也正常持久化——JSON 数组为空。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            detector = SessionBoundaryDetector(
                store,
                Settings(session_boundary=SessionBoundaryConfig(enabled=True)),
            )
            result = SessionBoundaryResult(
                last_session_end=_BASE_TIME - 3600,
                last_session_id="sess-empty",
            )
            row_id = detector.track_open_items(result, session_id="sess-empty")
            assert row_id > 0

            recent = store.get_recent_session_summaries(1)
            assert json.loads(str(recent[0]["unfinished_intents_json"])) == []
            assert json.loads(str(recent[0]["open_questions_json"])) == []
        finally:
            store.close()

    def test_multiple_tracks_create_separate_rows(self, tmp_path: Path) -> None:
        """多次 track 创建独立行——不覆盖。"""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        assert store.conn is not None
        try:
            detector = SessionBoundaryDetector(
                store,
                Settings(session_boundary=SessionBoundaryConfig(enabled=True)),
            )
            r1 = SessionBoundaryResult(
                last_session_end=_BASE_TIME - 7200,
                last_session_id="sess-a",
                unfinished_intents=[{"id": 1}],
                open_questions=[],
            )
            r2 = SessionBoundaryResult(
                last_session_end=_BASE_TIME - 3600,
                last_session_id="sess-b",
                unfinished_intents=[{"id": 2}],
                open_questions=[],
            )
            detector.track_open_items(r1, session_id="sess-a", now=_BASE_TIME - 7200)
            detector.track_open_items(r2, session_id="sess-b", now=_BASE_TIME - 3600)

            recent = store.get_recent_session_summaries(5)
            assert len(recent) == 2
            # 最新在前
            assert recent[0]["session_id"] == "sess-b"
            assert recent[1]["session_id"] == "sess-a"
        finally:
            store.close()


# ═══════════════════════════════════════════════════════════════
# RegressionSummary 数据类 (Batch 2)
# ═══════════════════════════════════════════════════════════════


class TestRegressionSummary:
    """RegressionSummary 属性与默认值。"""

    def test_default_factories_are_empty(self) -> None:
        """所有字段有合理的默认值。"""
        s = RegressionSummary()
        assert s.previous_sessions == []
        assert s.ongoing_items == []
        assert s.resolved_items == []
        assert s.summary_text == ""

    def test_custom_values(self) -> None:
        """提供自定义值时正确存储。"""
        s = RegressionSummary(
            previous_sessions=[{"session_id": "s1"}],
            ongoing_items=[{"id": 1}],
            resolved_items=[{"id": 2}],
            summary_text="一切就绪。",
        )
        assert len(s.previous_sessions) == 1
        assert s.previous_sessions[0]["session_id"] == "s1"
        assert len(s.ongoing_items) == 1
        assert len(s.resolved_items) == 1
        assert s.summary_text == "一切就绪。"
