"""L2.5 重规划检测器 — 检测意图漂移并生成修正计划 + 步骤执行监控。

ReplanDetector 沿袭 PlanGenerator 模式：构造注入 + setter 注入 + LLM 调用 + 三阶回退解析。
检测结果用于 Lab ReplanComparePanel 并排展示，不驱动实际执行引擎。

Phase 57 B1 新增：StepStatus 枚举 + PlanStepRecord 数据类
+ monitor_step/get_step_summary/reset_monitor
三个钩子方法，为 B2 局部重规划和 B3 用户干预提供步骤级执行追踪基础。
Phase 57 B2 新增：PartialReplanResult + generate_partial_replan() 局部重规划——
仅替换失败/未完成步骤，保留成功步骤，基于 B1 步骤监控数据驱动。
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum

import numpy as np
from openai import APIError, OpenAI

from src.config import settings
from src.logging import get_logger
from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.planner.plan import PlanResult, _derive_dag_edges
from src.token_ledger import TokenLedger

logger = get_logger(__name__)

# ── 魔数常量 ──
_ERROR_MSG_MAX_LEN = 200
_RAW_PREVIEW_MAX_LEN = 100
_FALLBACK_CONFIDENCE = 0.3
_DEFAULT_CONFIDENCE = 0.5
_CONFIDENCE_MIN = 0.0
_CONFIDENCE_MAX = 1.0
_REPLAN_MAX_TOKENS = 256
_REPLAN_TEMPERATURE = 0.0  # 检测任务需要确定性


class StepStatus(Enum):
    """子任务执行状态枚举。

    用于 monitor_step() 钩子追踪每个计划子任务的执行生命周期。
    PENDING → RUNNING → SUCCESS/FAILED，或 PENDING → SKIPPED。
    """

    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class PlanStepRecord:
    """子任务执行记录 — 单步执行追踪数据类。

    Attributes:
        step_id: 对应 PlanResult.subtasks 中的子任务 id.
        description: 子任务描述文本.
        status: 当前执行状态.
        started_at: 步骤开始时间戳（秒），None 表示尚未开始.
        completed_at: 步骤完成时间戳（秒），None 表示尚未完成.
        output_summary: 步骤输出摘要（成功时填充）.
        error_message: 错误信息（失败时填充）.
        retry_count: 重试次数.
    """

    step_id: str
    description: str
    status: StepStatus = StepStatus.PENDING
    started_at: float | None = None
    completed_at: float | None = None
    output_summary: str = ""
    error_message: str = ""
    retry_count: int = 0


@dataclass(frozen=True)
class ReplanResult:
    """重规划检测结果 — 不可变数据类。

    Attributes:
        drift_detected: 是否检测到意图漂移。
        drift_reason: 漂移原因（一句中文），未检测到时为空。
        revised_intent: 修正后的意图类别，未检测到时与原始意图相同。
        revised_plan: 修正后的任务计划（复用 PlanResult）。
        diff_summary: 差异摘要（新增/删除/重排子任务）。
        confidence: 检测置信度 [0, 1]。
    """

    drift_detected: bool = False
    drift_reason: str = ""
    revised_intent: str = ""
    revised_plan: PlanResult = field(default_factory=PlanResult)
    diff_summary: str = ""
    confidence: float = _FALLBACK_CONFIDENCE


@dataclass(frozen=True)
class PartialReplanResult:
    """局部重规划结果 — 仅替换失败/未完成步骤，保留成功步骤。

    与 ReplanResult（全量漂移检测）互补：ReplanResult 用于用户修改消息后的全量重规划，
    PartialReplanResult 用于执行过程中基于步骤监控数据的局部调整。

    Attributes:
        revised_plan: 合并后的修正计划（成功步骤 + 替换步骤）。
        kept_step_ids: 保留的成功步骤 id 列表。
        replaced_step_ids: 被替换的失败/未完成步骤 id 列表。
        no_replan_needed: True 表示所有步骤已成功，无需重规划。
    """

    revised_plan: PlanResult = field(default_factory=PlanResult)
    kept_step_ids: list[str] = field(default_factory=list)
    replaced_step_ids: list[str] = field(default_factory=list)
    no_replan_needed: bool = False


def _generate_diff_summary(
    original: list[dict[str, object]], revised: list[dict[str, object]]
) -> str:
    """生成原始计划与修正计划之间的差异摘要文本。

    对比子任务描述集合，识别新增、删除、保留的步骤。
    """
    orig_descs = {str(t.get("description", "")) for t in original if "description" in t}
    rev_descs = {str(t.get("description", "")) for t in revised if "description" in t}
    added = rev_descs - orig_descs
    removed = orig_descs - rev_descs
    parts: list[str] = []
    if added:
        parts.append(f"新增 {len(added)} 步: {', '.join(sorted(added))}")
    if removed:
        parts.append(f"删除 {len(removed)} 步: {', '.join(sorted(removed))}")
    if not parts:
        parts.append("子任务结构无显著变化")
    if len(original) != len(revised):
        parts.insert(0, f"子任务数 {len(original)}→{len(revised)}")
    return "; ".join(parts)


class ReplanDetector:
    """重规划检测引擎 — 检测意图漂移 + 步骤执行监控。

    构造注入 MemoryStore / IndexManager / embed_fn，
    setter 注入 TokenLedger 用于成本追踪。
    检测结果用于 Lab ReplanComparePanel 展示，不驱动实际执行。

    Phase 57 B1 新增步骤监控能力：monitor_step() 记录每步执行状态，
    get_step_summary() 聚合统计，reset_monitor() 清空记录。
    Phase 57 B2 新增局部重规划：generate_partial_replan() 基于步骤监控数据，
    仅替换失败/未完成步骤，保留已成功步骤。
    """

    def __init__(
        self,
        store: MemoryStore,
        index: IndexManager,
        embed_fn: Callable[[str], np.ndarray],
    ) -> None:
        self._store = store
        self._index = index
        self._embed = embed_fn
        self._client: OpenAI | None = None
        self._ledger: TokenLedger | None = None
        self._step_records: list[PlanStepRecord] = []

    @property
    def client(self) -> OpenAI:
        """延迟初始化 OpenAI 客户端（遵循 PlannerEngine 模式）。"""
        if self._client is None:
            api_key = os.environ.get(settings.llm_api_key_env)
            if not api_key:
                raise RuntimeError(f"{settings.llm_api_key_env} 未设置，无法进行重规划检测。")
            self._client = OpenAI(
                api_key=api_key, base_url=settings.llm_base_url, timeout=settings.llm_timeout
            )
        return self._client

    def set_ledger(self, ledger: TokenLedger) -> None:
        """Setter 注入 TokenLedger 用于重规划检测调用的成本计量。"""
        self._ledger = ledger

    # ── 步骤监控 (Phase 57 B1) ──

    def monitor_step(
        self,
        step_id: str,
        status: StepStatus,
        description: str = "",
        output_summary: str = "",
        error_message: str = "",
    ) -> PlanStepRecord:
        """记录子任务执行状态 — 执行引擎每步完成后调用的钩子。

        若 step_id 已有记录则更新（支持 PENDING→RUNNING→SUCCESS/FAILED 状态转换），
        否则创建新记录。RUNNING 状态自动设置 started_at，终态自动设置 completed_at。

        Args:
            step_id: 对应 PlanResult.subtasks 中的子任务 id。
            status: 当前执行状态。
            description: 子任务描述（首次记录时写入，更新时保留已有值）。
            output_summary: 步骤输出摘要（成功时填充）。
            error_message: 错误信息（失败时填充）。

        Returns:
            更新或新建的 PlanStepRecord。
        """
        # 查找已有记录（支持状态转换）
        existing: PlanStepRecord | None = None
        for rec in self._step_records:
            if rec.step_id == step_id:
                existing = rec
                break

        now = time.time()
        if existing is not None:
            # 可变更新 — PlanStepRecord 非 frozen，允许状态转换
            existing.status = status
            if status == StepStatus.RUNNING and existing.started_at is None:
                existing.started_at = now
            if status in (StepStatus.SUCCESS, StepStatus.FAILED, StepStatus.SKIPPED):
                existing.completed_at = now
            if output_summary:
                existing.output_summary = output_summary
            if error_message:
                existing.error_message = error_message
            return existing

        # 新建记录
        terminal_statuses = {StepStatus.SUCCESS, StepStatus.FAILED, StepStatus.SKIPPED}
        record = PlanStepRecord(
            step_id=step_id,
            description=description,
            status=status,
            started_at=now if status == StepStatus.RUNNING else None,
            completed_at=now if status in terminal_statuses else None,
            output_summary=output_summary,
            error_message=error_message,
        )
        self._step_records.append(record)
        logger.debug(
            "步骤监控: %s → %s",
            step_id,
            status.value,
            extra={"component": "replan_detector"},
        )
        return record

    def get_step_summary(self) -> dict[str, int]:
        """返回按状态分组的步骤计数摘要。

        Returns:
            Dict 如 {'pending': 2, 'running': 1, 'success': 3, 'failed': 1, 'skipped': 0}。
        """
        summary: dict[str, int] = {s.value: 0 for s in StepStatus}
        for rec in self._step_records:
            summary[rec.status.value] += 1
        return summary

    def reset_monitor(self) -> None:
        """清空所有步骤记录，为新计划执行做准备。"""
        self._step_records.clear()
        logger.debug(
            "步骤监控已重置",
            extra={"component": "replan_detector"},
        )

    # ── 局部重规划 (Phase 57 B2) ──

    def generate_partial_replan(
        self,
        original_plan: PlanResult,
        user_context: str = "",
    ) -> tuple[PartialReplanResult, dict[str, object]]:
        """基于步骤监控数据生成局部重规划——仅替换失败/未完成步骤。

        从 _step_records 读取每步执行状态，保留 SUCCESS/SKIPPED 步骤，
        仅为 FAILED/PENDING/RUNNING 步骤生成替换。若所有步骤已成功则跳过 LLM 调用。

        Args:
            original_plan: 原始任务计划。
            user_context: 可选的用户反馈文本（如"分析太慢了，简化一下"），
                          用于指导重规划方向。

        Returns:
            (PartialReplanResult, trace_dict) — trace_dict 含 system_prompt/raw_response
            等调试信息。
        """
        summary = self.get_step_summary()
        total_failed = summary.get(StepStatus.FAILED.value, 0)
        total_pending = summary.get(StepStatus.PENDING.value, 0)
        total_running = summary.get(StepStatus.RUNNING.value, 0)
        needs_replan = total_failed + total_pending + total_running

        # 全成功 → 无需重规划
        if needs_replan == 0 and len(self._step_records) > 0:
            return PartialReplanResult(
                revised_plan=original_plan,
                kept_step_ids=[r.step_id for r in self._step_records],
                replaced_step_ids=[],
                no_replan_needed=True,
            ), {}

        # 无监控数据 → 无法做局部判断，返回原始计划
        if not self._step_records:
            return PartialReplanResult(
                revised_plan=original_plan,
                no_replan_needed=True,
            ), {}

        # 分离保留/替换步骤
        kept_ids: list[str] = []
        replaced_ids: list[str] = []
        kept_summaries: list[str] = []
        failed_summaries: list[str] = []

        for rec in self._step_records:
            if rec.status in (StepStatus.SUCCESS, StepStatus.SKIPPED):
                kept_ids.append(rec.step_id)
                if rec.output_summary:
                    kept_summaries.append(
                        f"  {rec.step_id}. {rec.description} — {rec.output_summary}"
                    )
                else:
                    kept_summaries.append(f"  {rec.step_id}. {rec.description} — 已完成")
            else:
                replaced_ids.append(rec.step_id)
                if rec.status == StepStatus.FAILED:
                    err_text = rec.error_message or "未知错误"
                    failed_summaries.append(
                        f"  {rec.step_id}. {rec.description} — 失败: {err_text}"
                    )
                elif rec.status == StepStatus.RUNNING:
                    failed_summaries.append(f"  {rec.step_id}. {rec.description} — 中断（运行中）")
                else:
                    failed_summaries.append(f"  {rec.step_id}. {rec.description} — 未开始")

        if not settings.plan_generation_enabled:
            return PartialReplanResult(
                revised_plan=original_plan,
                kept_step_ids=kept_ids,
                replaced_step_ids=replaced_ids,
                no_replan_needed=True,
            ), {}

        try:
            return self._call_partial_replan_api(
                original_plan,
                kept_summaries,
                failed_summaries,
                kept_ids,
                replaced_ids,
                user_context,
            )
        except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "局部重规划失败",
                extra={"component": "replan_detector", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
            )
            return (
                PartialReplanResult(
                    revised_plan=original_plan,
                    kept_step_ids=kept_ids,
                    replaced_step_ids=replaced_ids,
                    no_replan_needed=True,
                ),
                {"error": str(exc)[:_ERROR_MSG_MAX_LEN]},
            )

    def _call_partial_replan_api(
        self,
        original_plan: PlanResult,
        kept_summaries: list[str],
        failed_summaries: list[str],
        kept_ids: list[str],
        replaced_ids: list[str],
        user_context: str,
    ) -> tuple[PartialReplanResult, dict[str, object]]:
        """调用 LLM 为失败/未完成步骤生成替换子任务。"""
        system_prompt = self._build_partial_replan_prompt(
            kept_summaries, failed_summaries, user_context
        )

        api_trace: dict[str, object] = {
            "system_prompt": system_prompt,
            "kept_step_ids": kept_ids,
            "replaced_step_ids": replaced_ids,
            "raw_response": "",
            "parse_error": None,
            "token_usage": None,
        }

        response = self.client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "请生成替换子任务。"},
            ],
            max_tokens=_REPLAN_MAX_TOKENS,
            temperature=_REPLAN_TEMPERATURE,
        )
        if self._ledger is not None and response.usage is not None:
            self._ledger.record(
                "partial_replan",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
            )
            api_trace["token_usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        raw = response.choices[0].message.content or ""
        api_trace["raw_response"] = raw

        replacements, parse_error = self._parse_partial_replan_response(raw)
        if parse_error:
            api_trace["parse_error"] = parse_error

        revised_plan = self._merge_partial_plan(original_plan, kept_ids, replacements)
        return PartialReplanResult(
            revised_plan=revised_plan,
            kept_step_ids=kept_ids,
            replaced_step_ids=replaced_ids,
        ), api_trace

    @staticmethod
    def _build_partial_replan_prompt(
        kept_summaries: list[str],
        failed_summaries: list[str],
        user_context: str,
    ) -> str:
        """构建局部重规划的 LLM system prompt。

        告知 LLM 哪些步骤已成功（不可改动）、哪些步骤失败/未完成（需要替换），
        以及可选的用户反馈来指导替换方向。
        """
        kept_text = "\n".join(kept_summaries) if kept_summaries else "（无已完成步骤）"
        failed_text = "\n".join(failed_summaries) if failed_summaries else "（无失败步骤）"
        context_line = f"\n用户反馈: {user_context}\n" if user_context else ""

        return (
            "你是一个任务规划修复器。以下计划的部分步骤已成功执行，"
            "部分步骤失败或未完成。请仅对失败/未完成步骤生成替换子任务。\n"
            "\n"
            "已成功步骤（不可改动）：\n"
            f"{kept_text}\n"
            "\n"
            "失败/未完成步骤（需要替换）：\n"
            f"{failed_text}\n"
            f"{context_line}\n"
            "要求：\n"
            "- 仅生成替换失败/未完成步骤的子任务，不要包含已成功的步骤\n"
            "- 每个替换子任务需要 id/description，可选 depends_on\n"
            "- depends_on 可以引用已成功步骤的 id 或其他替换步骤的 id\n"
            "- 如果原步骤因过于复杂而失败，考虑拆分为更小的步骤\n"
            "- 如果提供了用户反馈，将其作为重规划方向指引\n"
            "\n"
            "响应格式（严格 JSON，不要包含其他文字）：\n"
            '{"subtasks":[{"id":"<原步骤id>","description":"<替换描述>",'
            '"depends_on":["<前置id>"]},...],'
            '"rationale":"<一句重规划理由>",'
            '"confidence":<0-1>}'
        )

    @staticmethod
    def _parse_partial_replan_response(raw: str) -> tuple[list[dict[str, object]], str | None]:
        """解析 LLM 返回的局部重规划 JSON，提取替换子任务列表。

        二阶回退（相比 _parse_replan 的三阶少一阶——无 drift_detected 字段需要解析）：
        1. 直接 JSON.parse → 提取 subtasks
        2. 提取 {...} 块 → 提取 subtasks → 返回空列表（兜底）
        """
        # ── 层级 1：严格 JSON 解析 ──
        try:
            data = json.loads(raw)
            subtasks_raw = data.get("subtasks", [])
            if not isinstance(subtasks_raw, list):
                subtasks_raw = []
            subtasks: list[dict[str, object]] = []
            for t in subtasks_raw[:8]:
                if isinstance(t, dict) and "id" in t and "description" in t:
                    subtasks.append(
                        {
                            "id": str(t["id"]),
                            "description": str(t["description"]),
                            "depends_on": (
                                [str(d) for d in t["depends_on"]]
                                if isinstance(t.get("depends_on"), list)
                                else []
                            ),
                        }
                    )
            return subtasks, None
        except json.JSONDecodeError, ValueError, TypeError:
            pass

        # ── 层级 2：提取 {...} 块 ──
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                subtasks_raw = data.get("subtasks", [])
                if not isinstance(subtasks_raw, list):
                    subtasks_raw = []
                subtasks = []
                for t in subtasks_raw[:8]:
                    if isinstance(t, dict) and "id" in t and "description" in t:
                        subtasks.append(
                            {
                                "id": str(t["id"]),
                                "description": str(t["description"]),
                                "depends_on": (
                                    [str(d) for d in t["depends_on"]]
                                    if isinstance(t.get("depends_on"), list)
                                    else []
                                ),
                            }
                        )
                return subtasks, None
            except json.JSONDecodeError, ValueError, TypeError:
                pass

        # ── 层级 3：兜底 — 返回空列表 ──
        return [], f"JSON 解析失败，原始响应: {raw[:_ERROR_MSG_MAX_LEN]}"

    @staticmethod
    def _merge_partial_plan(
        original_plan: PlanResult,
        kept_ids: list[str],
        replacements: list[dict[str, object]],
    ) -> PlanResult:
        """合并保留的成功步骤与 LLM 生成的替换步骤为完整计划。

        保留步骤从 original_plan.subtasks 中按 id 提取并保持原样，
        替换步骤来自 LLM 响应，与保留步骤合并后重新计算 DAG 边。

        Args:
            original_plan: 原始计划（含全部子任务）。
            kept_ids: 需要保留的成功步骤 id 列表。
            replacements: LLM 生成的替换子任务列表。

        Returns:
            合并后的 PlanResult。
        """
        # 从原始计划中提取保留步骤
        kept_subtasks: list[dict[str, object]] = []
        for t in original_plan.subtasks:
            tid = str(t.get("id", ""))
            if tid in kept_ids:
                kept_subtasks.append(dict(t))  # 浅拷贝避免修改原始数据

        # 合并：保留步骤 + 替换步骤
        merged = kept_subtasks + replacements

        # 提取 rationale 和 confidence（从第一个替换步骤的上下文无法获取，使用默认值）
        return PlanResult(
            subtasks=merged,
            dag_edges=_derive_dag_edges(merged),
            rationale="局部重规划：保留成功步骤，替换失败步骤",
            confidence=_DEFAULT_CONFIDENCE,
        )

    # ── 公开入口 ──

    def detect_replan(
        self,
        original_user_msg: str,
        original_intent: str,
        original_plan: PlanResult,
        revised_user_msg: str,
    ) -> tuple[ReplanResult, dict[str, object]]:
        """检测用户消息修正是否导致意图漂移，并生成修正计划。

        Args:
            original_user_msg: 用户原始消息文本。
            original_intent: 原始 L1 意图分类结果。
            original_plan: 原始任务计划 PlanResult。
            revised_user_msg: 用户修正后的消息文本。

        Returns:
            (ReplanResult, trace_dict) — trace_dict 包含 system_prompt / raw_response
            等调试信息，用于前端 ReplanComparePanel 展示。
        """
        if not settings.plan_generation_enabled:
            return ReplanResult(
                drift_detected=False,
                drift_reason="任务规划已禁用",
                revised_intent=original_intent,
            ), {}

        try:
            result, trace = self._detect_via_api(
                original_user_msg, original_intent, original_plan, revised_user_msg
            )
            # 若检测到漂移，补充差异摘要
            if result.drift_detected and result.revised_plan.subtasks:
                # 使用 object.__setattr__ 写入 frozen dataclass（解析阶段允许）
                object.__setattr__(
                    result,
                    "diff_summary",
                    _generate_diff_summary(original_plan.subtasks, result.revised_plan.subtasks),
                )
            return result, trace
        except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "重规划检测失败",
                extra={"component": "replan_detector", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
            )
            return (
                ReplanResult(
                    drift_detected=False,
                    drift_reason=f"检测不可用: {str(exc)[:_ERROR_MSG_MAX_LEN]}",
                    revised_intent=original_intent,
                ),
                {},
            )

    # ── API 调用 ──

    def _detect_via_api(
        self,
        original_user_msg: str,
        original_intent: str,
        original_plan: PlanResult,
        revised_user_msg: str,
    ) -> tuple[ReplanResult, dict[str, object]]:
        """通过 LLM 调用检测意图漂移并生成修正计划。"""
        # 构造原始计划摘要
        orig_subtask_descs = [
            f"  {t.get('id', '?')}. {t.get('description', '')}" for t in original_plan.subtasks
        ]
        orig_plan_text = "\n".join(orig_subtask_descs) if orig_subtask_descs else "（无原始计划）"

        system_prompt = (
            "你是一个任务规划漂移检测器。比较用户的原始消息和修正消息，"
            "判断任务意图是否发生实质性变化。\n"
            "\n"
            f"原始意图类别：{original_intent}\n"
            "\n"
            "原始计划：\n"
            f"{orig_plan_text}\n"
            "\n"
            "判断标准：\n"
            "- 如果修正消息只是原始消息的细化/澄清 → drift_detected=false\n"
            "- 如果修正消息改变了任务范围、目标或约束 → drift_detected=true\n"
            "- 如果修正消息完全推翻了原始意图 → drift_detected=true\n"
            "\n"
            "若检测到漂移，生成修正后的子任务计划（JSON 格式，"
            "每个子任务含 id/description/可选的 depends_on）。\n"
            "\n"
            "响应格式（严格 JSON，不要包含其他文字）：\n"
            '{"drift_detected":true/false,'
            '"drift_reason":"<一句漂移原因>",'
            '"revised_intent":"<修正后意图类别>",'
            '"subtasks":[{"id":"1","description":"子任务描述"},...],'
            '"rationale":"<一句规划理由>",'
            '"confidence":<0-1>}'
        )

        api_trace: dict[str, object] = {
            "system_prompt": system_prompt,
            "original_user_msg": original_user_msg,
            "revised_user_msg": revised_user_msg,
            "original_intent": original_intent,
            "raw_response": "",
            "parse_error": None,
            "token_usage": None,
        }

        response = self.client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": (f"原始消息: {original_user_msg}\n修正消息: {revised_user_msg}"),
                },
            ],
            max_tokens=_REPLAN_MAX_TOKENS,
            temperature=_REPLAN_TEMPERATURE,
        )
        if self._ledger is not None and response.usage is not None:
            self._ledger.record(
                "replan_detector",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
            )
            api_trace["token_usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        raw = response.choices[0].message.content or ""
        api_trace["raw_response"] = raw
        result, parse_error = self._parse_replan(raw, original_intent)
        if parse_error:
            api_trace["parse_error"] = parse_error
        return result, api_trace

    # ── 解析 ──

    @staticmethod
    def _parse_replan(raw: str, fallback_intent: str) -> tuple[ReplanResult, str | None]:
        """解析 LLM 返回的 JSON 为 ReplanResult，三阶回退容错。

        1. 直接 JSON.parse → ReplanResult
        2. 提取 {...} 块 → ReplanResult
        3. 返回 drift_detected=False（兜底）
        """
        # ── 层级 1：严格 JSON 解析 ──
        try:
            data = json.loads(raw)
            subtasks_raw = data.get("subtasks", [])
            if not isinstance(subtasks_raw, list):
                subtasks_raw = []
            subtasks: list[dict[str, object]] = []
            for t in subtasks_raw[:8]:
                if isinstance(t, dict) and "id" in t and "description" in t:
                    subtasks.append(
                        {
                            "id": str(t["id"]),
                            "description": str(t["description"]),
                            "depends_on": (
                                [str(d) for d in t["depends_on"]]
                                if isinstance(t.get("depends_on"), list)
                                else []
                            ),
                        }
                    )
            drift_detected = bool(data.get("drift_detected", False))
            drift_reason = str(data.get("drift_reason", "")) if drift_detected else ""
            revised_intent = str(data.get("revised_intent", fallback_intent))
            confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
            confidence = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence))
            rationale = str(data.get("rationale", ""))
            revised_plan = PlanResult(
                subtasks=subtasks,
                dag_edges=_derive_dag_edges(subtasks),
                rationale=rationale,
                confidence=confidence,
            )
            return ReplanResult(
                drift_detected=drift_detected,
                drift_reason=drift_reason,
                revised_intent=revised_intent,
                revised_plan=revised_plan,
                confidence=confidence,
            ), None
        except json.JSONDecodeError, ValueError, TypeError:
            pass

        # ── 层级 2：提取 {...} 块 ──
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                subtasks_raw = data.get("subtasks", [])
                if not isinstance(subtasks_raw, list):
                    subtasks_raw = []
                subtasks = []
                for t in subtasks_raw[:8]:
                    if isinstance(t, dict) and "id" in t and "description" in t:
                        subtasks.append(
                            {
                                "id": str(t["id"]),
                                "description": str(t["description"]),
                                "depends_on": (
                                    [str(d) for d in t["depends_on"]]
                                    if isinstance(t.get("depends_on"), list)
                                    else []
                                ),
                            }
                        )
                drift_detected = bool(data.get("drift_detected", False))
                drift_reason = str(data.get("drift_reason", "")) if drift_detected else ""
                revised_intent = str(data.get("revised_intent", fallback_intent))
                confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
                confidence = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence))
                rationale = str(data.get("rationale", ""))
                revised_plan = PlanResult(
                    subtasks=subtasks,
                    dag_edges=_derive_dag_edges(subtasks),
                    rationale=rationale,
                    confidence=confidence,
                )
                return ReplanResult(
                    drift_detected=drift_detected,
                    drift_reason=drift_reason,
                    revised_intent=revised_intent,
                    revised_plan=revised_plan,
                    confidence=confidence,
                ), None
            except json.JSONDecodeError, ValueError, TypeError:
                pass

        # ── 层级 3：兜底 — 返回无漂移 ──
        return (
            ReplanResult(
                drift_detected=False,
                drift_reason=f"解析失败，原始响应: {raw[:_RAW_PREVIEW_MAX_LEN]}",
                revised_intent=fallback_intent,
            ),
            f"JSON 解析失败，原始响应: {raw[:_ERROR_MSG_MAX_LEN]}",
        )
