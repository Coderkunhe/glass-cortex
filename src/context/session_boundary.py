"""会话边界检测引擎——识别上次会话结束点、未完成意图、打开问题。

从 pipeline_trace / plan_runs / episodes 三张表中提取边界信号，
产出 SessionBoundaryResult 供回归摘要和待办跟踪消费。
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from src.config import Settings, settings

if TYPE_CHECKING:
    from src.memory.store import MemoryStore

logger = logging.getLogger(__name__)


@dataclass
class SessionBoundaryResult:
    """会话边界检测结果。

    包含上次会话的结束时间、未完成意图、打开问题。
    is_first_session 为 True 时，其他字段为空/None——
    系统视此为新用户首次使用，无需回归摘要。

    Attributes:
        last_session_end: 上次会话最后活动时间戳（None = 首次会话）。
        last_session_id: 上次会话 ID（None = 首次会话）。
        unfinished_intents: 未完成意图列表，每项含 plan_runs 字段 + subtasks 子列表。
        open_questions: 可能未回答的用户问句列表（episodes 中含 ?/? 的行）。
    """

    last_session_end: float | None
    last_session_id: str | None
    unfinished_intents: list[dict[str, object]] = field(default_factory=list)
    open_questions: list[dict[str, object]] = field(default_factory=list)

    @property
    def is_first_session(self) -> bool:
        """无历史 session 记录 = 首次会话。"""
        return self.last_session_end is None


@dataclass
class RegressionSummary:
    """回归摘要——用户回归时生成的上下文回顾。

    对比当前会话边界的开放项与历史 session_summaries，
    产出跨会话持续项、已解决项和人类可读摘要文本。

    Attributes:
        previous_sessions: 最近 N 个 session_summaries 行（最新在前）。
        ongoing_items: 跨多会话仍未解决的项。
        resolved_items: 在上次会话后已解决的项。
        summary_text: 人类可读摘要。
    """

    previous_sessions: list[dict[str, object]] = field(default_factory=list)
    ongoing_items: list[dict[str, object]] = field(default_factory=list)
    resolved_items: list[dict[str, object]] = field(default_factory=list)
    summary_text: str = ""


class SessionBoundaryDetector:
    """会话边界检测器——识别"上次聊到哪"。

    检测三件事：
    1. 上次会话结束时间（pipeline_trace → plan_runs → episodes 三级回退）
    2. 未完成意图（plan_runs JOIN plan_subtasks，status IN pending/running）
    3. 打开问题（episodes 中以 ? 或 ？结尾的行）

    设计遵循 ConsolidationCore 模式：构造函数注入 store + config，
    公共方法接受可注入 now 参数以支持测试。
    """

    def __init__(self, store: MemoryStore, config: Settings | None = None) -> None:
        """初始化检测器。

        Args:
            store: MemoryStore 实例，用于查询 pipeline_trace/plan_runs/episodes。
            config: Settings 实例，None 时使用模块级单例 settings。
        """
        self._store = store
        self._config = config or settings

    # ── 公共接口 ──────────────────────────────────────────────

    def detect(self, now: float | None = None) -> SessionBoundaryResult | None:
        """执行会话边界检测。

        通过 feature flag (session_boundary_enabled) 门控——
        关闭时返回 None，调用方据此跳过边界处理。

        Args:
            now: 当前时间戳（注入点，默认 time.time()）。

        Returns:
            SessionBoundaryResult 如果启用且检测到跨会话边界；
            None 如果 feature flag 关闭，或未检测到会话间隔
            （仍在同一会话内，间隔 < session_boundary_session_gap_seconds）。
        """
        if not self._config.session_boundary_enabled:
            return None

        now = now or time.time()
        last_end, last_sid = self._detect_last_session()

        if last_end is None:
            return SessionBoundaryResult(
                last_session_end=None,
                last_session_id=None,
            )

        # 检查会话间隔——未超过 gap 说明仍在同一会话
        gap = now - last_end
        if gap < self._config.session_boundary_session_gap_seconds:
            return None

        unfinished = self._detect_unfinished_intents(since=last_end)
        questions = self._detect_open_questions(since=last_end)

        return SessionBoundaryResult(
            last_session_end=last_end,
            last_session_id=last_sid,
            unfinished_intents=unfinished,
            open_questions=questions,
        )

    # ── 私有检测方法 ──────────────────────────────────────────

    def _detect_last_session(self) -> tuple[float | None, str | None]:
        """从持久化表中检测最后一次活动时间与 session_id。

        三级回退策略——全部通过 MemoryStore 公共 API：
        1. pipeline_trace — 最精确（每个管道步骤都记录）
        2. plan_runs — 次选（有规划就有 session）
        3. episodes — 兜底（只拿时间戳，无 session_id）

        Returns:
            (timestamp, session_id) 或 (None, None)。
        """
        # 一级：pipeline_trace
        try:
            row = self._store.get_latest_trace()
            if row is not None:
                return float(row["created_at"]), str(row["session_id"])  # type: ignore[arg-type]
        except Exception:
            pass

        # 二级：plan_runs
        try:
            row = self._store.get_latest_plan_run()
            if row is not None:
                return float(row["created_at"]), str(row["session_id"])  # type: ignore[arg-type]
        except Exception:
            pass

        # 三级：episodes（无 session_id 可用）
        try:
            ts = self._store.get_max_episode_timestamp()
            if ts is not None:
                return ts, None
        except Exception:
            pass

        return None, None

    def _detect_unfinished_intents(self, since: float) -> list[dict[str, object]]:
        """查询自 ``since`` 以来有非终态子任务的 Plan。

        委托 MemoryStore.get_unfinished_plans_since()——
        一次 store 调用完成 JOIN + subtask 组装，消除原来的 N+1 循环。

        Args:
            since: 上次会话结束时间戳，只查此时间之后的 plan。

        Returns:
            未完成意图列表，每个元素含 plan_runs 全部字段 +
            ``subtasks`` 列表（仅含非终态子任务）。
        """
        try:
            return self._store.get_unfinished_plans_since(since)
        except Exception:
            return []

    def _detect_open_questions(self, since: float) -> list[dict[str, object]]:
        """从 episodes 表中查找上次会话以来的潜在问句。

        委托 MemoryStore.get_episodes_with_questions_since()——
        启发式：内容含 ``?`` 或 ``？``。

        Args:
            since: 上次会话结束时间戳。

        Returns:
            匹配行列表，每行为完整的 episodes 字典。
        """
        try:
            return self._store.get_episodes_with_questions_since(since)  # type: ignore[return-value]
        except Exception:
            return []

    # ── 回归摘要 + 待办跟踪 (Batch 2) ──────────────────────────

    def generate_regression_summary(
        self,
        result: SessionBoundaryResult,
        num_sessions: int | None = None,
    ) -> RegressionSummary:
        """生成回归摘要——对比当前边界结果与历史会话快照。

        查询最近 N 个 session_summaries，将当前 result 中的
        unfinished_intents + open_questions 与历史对比，
        识别跨会话持续项和已解决项，生成人类可读摘要。

        Args:
            result: detect() 返回的会话边界结果。
            num_sessions: 回顾的会话数，None 时使用 config 默认值。

        Returns:
            RegressionSummary 包含历史快照、持续项、已解决项和摘要文本。
        """
        n = num_sessions if num_sessions is not None else self._config.num_sessions_for_regression
        recent = self._store.get_recent_session_summaries(n)

        # 构建当前开放项的索引
        current_intent_ids: set[str] = set()
        for item in result.unfinished_intents:
            pid = str(item.get("id", ""))
            if pid:
                current_intent_ids.add(pid)

        current_question_texts: set[str] = set()
        for item in result.open_questions:
            qt = str(item.get("content", ""))
            if qt:
                current_question_texts.add(qt)

        ongoing: list[dict[str, object]] = []
        resolved: list[dict[str, object]] = []

        seen_ongoing_ids: set[str] = set()
        seen_resolved_ids: set[str] = set()

        for prev in recent:
            prev_intents_raw = str(prev.get("unfinished_intents_json", "[]"))
            prev_questions_raw = str(prev.get("open_questions_json", "[]"))
            try:
                prev_intents: list[dict[str, object]] = json.loads(prev_intents_raw)
            except json.JSONDecodeError, TypeError:
                prev_intents = []
            try:
                prev_questions: list[dict[str, object]] = json.loads(prev_questions_raw)
            except json.JSONDecodeError, TypeError:
                prev_questions = []

            for intent in prev_intents:
                intent_id = str(intent.get("id", ""))
                if intent_id and intent_id in current_intent_ids:
                    if intent_id not in seen_ongoing_ids:
                        ongoing.append(intent)
                        seen_ongoing_ids.add(intent_id)
                elif intent_id and intent_id not in seen_resolved_ids:
                    resolved.append(intent)
                    seen_resolved_ids.add(intent_id)

            for q in prev_questions:
                q_text = str(q.get("content", ""))
                if q_text and q_text in current_question_texts:
                    if q_text not in seen_ongoing_ids:
                        ongoing.append(q)
                        seen_ongoing_ids.add(q_text)
                elif q_text and q_text not in seen_resolved_ids:
                    resolved.append(q)
                    seen_resolved_ids.add(q_text)

        summary_text = self._build_summary_text(ongoing, resolved, result)

        return RegressionSummary(
            previous_sessions=recent,
            ongoing_items=ongoing,
            resolved_items=resolved,
            summary_text=summary_text,
        )

    def track_open_items(
        self,
        result: SessionBoundaryResult,
        session_id: str,
        now: float | None = None,
    ) -> int:
        """持久化会话边界的开放项快照——供未来回归摘要对比。

        将 SessionBoundaryResult 中的 unfinished_intents +
        open_questions 写入 session_summaries 表。
        应在 detect() 返回非 None 后、generate_regression_summary()
        之前调用，确保当前边界状态入库后再做历史对比。

        Args:
            result: detect() 返回的会话边界结果。
            session_id: 当前会话 ID（通常来自 result.last_session_id）。
            now: 写入时间戳，None 时使用 SQLite 默认值。

        Returns:
            新 session_summaries 行的 id。
        """
        return self._store.save_session_summary(
            session_id=session_id,
            last_activity_at=result.last_session_end or 0.0,
            unfinished_intents=result.unfinished_intents,
            open_questions=result.open_questions,
            created_at=now,
        )

    @staticmethod
    def _build_summary_text(
        ongoing: list[dict[str, object]],
        resolved: list[dict[str, object]],
        result: SessionBoundaryResult,
    ) -> str:
        """构建人类可读的回归摘要文本。

        Args:
            ongoing: 跨会话持续未解决的项。
            resolved: 已解决的项。
            result: 当前边界结果（用于提取会话数上下文）。

        Returns:
            单行中文摘要文本。
        """
        parts: list[str] = []

        if result.is_first_session:
            return "这是首次会话，没有历史上下文。"

        unfinished_count = len(result.unfinished_intents)
        questions_count = len(result.open_questions)

        if unfinished_count:
            parts.append(f"{unfinished_count} 个未完成意图")
        if questions_count:
            parts.append(f"{questions_count} 个打开问题")

        if not parts:
            return "上次会话没有遗留开放项。"

        prefix = "自上次会话以来："
        if ongoing:
            prefix += f" {len(ongoing)} 项持续未解决；"
        if resolved:
            prefix += f" {len(resolved)} 项已解决。"

        return prefix + " " + "，".join(parts) + "。"
