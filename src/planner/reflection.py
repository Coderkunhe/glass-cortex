"""L3 规划反思引擎 — 会话结束后对规划质量进行反思并生成改进建议。

ReflectionEngine 沿袭 ReplanDetector 模式：构造注入 + setter 注入 + LLM 调用 + 三阶回退解析。
反思结果用于前端 SidebarReflectionCard 展示，不驱动实际执行引擎。
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast

import numpy as np
from openai import APIError, OpenAI

from src.config import settings
from src.logging import get_logger
from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.planner.plan import PlanResult
from src.token_ledger import TokenLedger

logger = get_logger(__name__)

# ── 魔数常量 ──
_ERROR_MSG_MAX_LEN = 200
_FALLBACK_CONFIDENCE = 0.3
_DEFAULT_CONFIDENCE = 0.5
_CONFIDENCE_MIN = 0.0
_CONFIDENCE_MAX = 1.0
_REFLECTION_MAX_TOKENS = 256
_REFLECTION_TEMPERATURE = 0.3  # 反思需要适度创造性
_META_KNOWLEDGE_MAX_TOKENS = 512  # 元知识提取需要更多 token 来容纳多模式分析
_META_KNOWLEDGE_TEMPERATURE = 0.2  # 元知识提取更加保守，降低创造性
_MIN_META_PLANS = 2  # 至少需要 2 个计划才能进行跨计划模式提取


@dataclass(frozen=True)
class ReflectionResult:
    """规划反思结果 — 不可变数据类。

    Attributes:
        reflections: 2-3 句规划反思文本。
        improvement_suggestions: 改进建议列表。
        plan_quality_score: 规划质量评分 [0, 1]。
        confidence: 反思置信度 [0, 1]。
    """

    reflections: list[str] = field(default_factory=list)
    improvement_suggestions: list[str] = field(default_factory=list)
    plan_quality_score: float = _FALLBACK_CONFIDENCE
    confidence: float = _FALLBACK_CONFIDENCE


@dataclass(frozen=True)
class PostMortemDeviation:
    """事后偏差记录 — 计划子任务与实际执行的差异。

    Attributes:
        subtask_id: 对应 plan_subtasks.subtask_id。
        description: 子任务描述文本。
        actual_status: 数据库中该子任务的实际状态。
        deviation_type: 偏差类型 — "failed" / "unexecuted" / "skipped" / "rejected"。
        detail: 人类可读的偏差说明（一句中文）。
    """

    subtask_id: str = ""
    description: str = ""
    actual_status: str = ""
    deviation_type: str = ""
    detail: str = ""


@dataclass(frozen=True)
class PostMortemResult:
    """事后总结分析结果 — 对比计划与实际执行的完整分析。

    Attributes:
        deviations: 检测到的偏差列表（纯算法提取）。
        improvement_suggestions: 改进建议列表（LLM 生成）。
        plan_quality_score: 重新评定的规划质量 [0, 1]。
        confidence: 分析置信度 [0, 1]。
    """

    deviations: list[PostMortemDeviation] = field(default_factory=list)
    improvement_suggestions: list[str] = field(default_factory=list)
    plan_quality_score: float = _FALLBACK_CONFIDENCE
    confidence: float = _FALLBACK_CONFIDENCE


@dataclass(frozen=True)
class ReflectionInsight:
    """元知识洞察 — 从多次反思中提取的跨计划通用模式。

    extract_meta_knowledge() 从失败的 post_mortem 分析中提取 failure_pattern
    和 improvement_pattern；distill_plan_template() 从成功计划中提取 best_practice。

    Attributes:
        insight_type: 洞察类型 — "failure_pattern" / "improvement_pattern" / "best_practice"。
        title: 一句话概括（去重键）。
        description: 详细说明。
        source_plan_ids: 来源 plan_run id 列表。
        confidence: 置信度 [0, 1]。
        occurrence_count: 已观测到的出现次数。
    """

    insight_type: str = ""
    title: str = ""
    description: str = ""
    source_plan_ids: list[int] = field(default_factory=list)
    confidence: float = _DEFAULT_CONFIDENCE
    occurrence_count: int = 1


class ReflectionEngine:
    """规划反思引擎 — 对已完成的规划过程进行事后反思。

    构造注入 MemoryStore / IndexManager / embed_fn，
    setter 注入 TokenLedger 用于成本追踪。
    反思结果用于前端 SidebarReflectionCard 展示，不驱动实际执行。
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

    @property
    def client(self) -> OpenAI:
        """延迟初始化 OpenAI 客户端（遵循 PlannerEngine 模式）。"""
        if self._client is None:
            api_key = os.environ.get(settings.llm_api_key_env)
            if not api_key:
                raise RuntimeError(f"{settings.llm_api_key_env} 未设置，无法进行规划反思。")
            self._client = OpenAI(
                api_key=api_key, base_url=settings.llm_base_url, timeout=settings.llm_timeout
            )
        return self._client

    def set_ledger(self, ledger: TokenLedger) -> None:
        """Setter 注入 TokenLedger 用于反思调用的成本计量。"""
        self._ledger = ledger

    # ── 公开入口 ──

    def reflect(
        self,
        user_msg: str,
        intent_category: str,
        plan_result: PlanResult | None = None,
        conversation_summary: str = "",
    ) -> tuple[ReflectionResult, dict[str, object]]:
        """对已完成的规划过程进行反思，生成改进建议。

        Args:
            user_msg: 用户原始消息文本。
            intent_category: L1 意图分类结果。
            plan_result: 任务计划 PlanResult，无计划时为 None。
            conversation_summary: 对话摘要文本（可选）。

        Returns:
            (ReflectionResult, trace_dict) — trace_dict 包含 system_prompt / raw_response
            等调试信息，用于前端展示。
        """
        if not settings.plan_generation_enabled:
            return ReflectionResult(
                reflections=["任务规划已禁用，跳过反思。"],
                improvement_suggestions=[],
            ), {}

        plan = plan_result if plan_result is not None else PlanResult()
        try:
            return self._reflect_via_api(user_msg, intent_category, plan, conversation_summary)
        except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "规划反思失败",
                extra={"component": "reflection_engine", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
            )
            return (
                ReflectionResult(
                    reflections=[f"反思不可用: {str(exc)[:_ERROR_MSG_MAX_LEN]}"],
                    improvement_suggestions=[],
                ),
                {},
            )

    # ── API 调用 ──

    def _reflect_via_api(
        self,
        user_msg: str,
        intent_category: str,
        plan: PlanResult,
        conversation_summary: str,
    ) -> tuple[ReflectionResult, dict[str, object]]:
        """通过 LLM 调用对规划过程进行反思。"""
        # 构造计划摘要
        subtask_descs = [f"  {t.get('id', '?')}. {t.get('description', '')}" for t in plan.subtasks]
        plan_text = "\n".join(subtask_descs) if subtask_descs else "（无计划）"

        system_prompt = (
            "你是一个任务规划反思器。回顾刚刚完成的用户对话和规划过程，"
            "提炼关于规划质量的反思。\n"
            "\n"
            f"原始意图类别：{intent_category}\n"
            "\n"
            "生成的计划：\n"
            f"{plan_text}\n"
            "\n"
            "对话摘要：\n"
            f"{conversation_summary or '（无对话摘要）'}\n"
            "\n"
            "请从以下角度进行反思：\n"
            "1. 规划是否恰当 — 计划与实际对话走向是否一致？\n"
            "2. 有没有遗漏或多余 — 有没有该做但没做的步骤，或不该做但做了的步骤？\n"
            "3. 可改进之处 — 如果再来一次，规划应该有什么不同？\n"
            "\n"
            "响应格式（严格 JSON，不要包含其他文字）：\n"
            '{"reflections":["一句中文反思","另一句中文反思"],'
            '"improvement_suggestions":["一条改进建议"],'
            '"plan_quality_score":<0-1浮点数>,'
            '"confidence":<0-1浮点数>}'
        )

        api_trace: dict[str, object] = {
            "system_prompt": system_prompt,
            "user_msg": user_msg,
            "intent_category": intent_category,
            "raw_response": "",
            "parse_error": None,
            "token_usage": None,
        }

        response = self.client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=_REFLECTION_MAX_TOKENS,
            temperature=_REFLECTION_TEMPERATURE,
        )
        if self._ledger is not None and response.usage is not None:
            self._ledger.record(
                "reflection_engine",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
            )
            api_trace["token_usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        raw = response.choices[0].message.content or ""
        api_trace["raw_response"] = raw
        result, parse_error = self._parse_reflection(raw)
        if parse_error:
            api_trace["parse_error"] = parse_error
        return result, api_trace

    # ── 事后总结 (post_mortem) ──

    def post_mortem(
        self,
        plan_run_id: int,
    ) -> tuple[PostMortemResult, dict[str, object]]:
        """对已执行的规划进行事后总结，对比计划与实际执行偏差。

        两步管线：
        1. 纯算法提取偏差（_extract_deviations，零 LLM 调用）
        2. 若有偏差 → LLM 合成改进建议 + 质量重新评分
        3. 若无偏差 → 跳过 LLM，直接返回空 deviation 的 PostMortemResult

        Args:
            plan_run_id: 规划运行 id（plan_runs 主键）。

        Returns:
            (PostMortemResult, trace_dict) — deviations 包含逐子任务偏差记录，
            improvement_suggestions 为 LLM 生成的改进方向。
        """
        trace: dict[str, object] = {
            "plan_run_id": plan_run_id,
            "deviation_count": 0,
            "total_subtasks": 0,
            "llm_called": False,
        }

        if not settings.plan_generation_enabled:
            return PostMortemResult(
                improvement_suggestions=["任务规划已禁用，跳过后事总结。"],
            ), trace

        # Step 1: 获取计划数据
        plan_data = self._store.get_plan(plan_run_id)
        if not plan_data:
            return PostMortemResult(
                improvement_suggestions=[f"计划 {plan_run_id} 不存在。"],
            ), trace

        subtasks = plan_data.get("subtasks", [])
        if not isinstance(subtasks, list) or not subtasks:
            trace["total_subtasks"] = 0
            return PostMortemResult(
                improvement_suggestions=["该计划无子任务记录。"],
            ), trace

        trace["total_subtasks"] = len(subtasks)

        # Step 2: 纯算法提取偏差
        deviations = self._extract_deviations(subtasks)
        trace["deviation_count"] = len(deviations)

        if not deviations:
            # 全部成功——无需 LLM 合成
            return PostMortemResult(
                deviations=[],
                improvement_suggestions=["所有子任务均已成功执行，无需改进建议。"],
                plan_quality_score=1.0,
                confidence=1.0,
            ), trace

        # Step 3: LLM 合成改进建议
        try:
            return self._post_mortem_via_api(plan_data, deviations, trace)
        except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "事后总结 LLM 调用失败，仅返回偏差分析",
                extra={"component": "reflection_engine", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
            )
            return PostMortemResult(
                deviations=deviations,
                improvement_suggestions=[f"LLM 合成不可用: {str(exc)[:_ERROR_MSG_MAX_LEN]}"],
                plan_quality_score=_FALLBACK_CONFIDENCE,
            ), trace

    @staticmethod
    def _extract_deviations(
        subtasks: list[dict[str, object]],
    ) -> list[PostMortemDeviation]:
        """纯算法提取偏差——对比每个子任务的实际状态与预期"成功"状态。

        偏差分类：
        - "failed": 子任务执行失败
        - "unexecuted": 子任务从未执行（仍为 pending）
        - "skipped": 子任务被跳过
        - "rejected": 子任务被用户拒绝
        - "succeeded": 无偏差（预期结果，不加入返回列表）

        Args:
            subtasks: plan_subtasks 行列表，每项含 subtask_id / description / status。

        Returns:
            偏差列表，仅包含非成功状态的子任务。
        """
        deviations: list[PostMortemDeviation] = []
        for st in subtasks:
            if not isinstance(st, dict):
                continue
            status = str(st.get("status", "pending"))
            if status == "succeeded":
                continue

            st_id = str(st.get("subtask_id", "?"))
            desc = str(st.get("description", ""))

            if status == "failed":
                deviations.append(
                    PostMortemDeviation(
                        subtask_id=st_id,
                        description=desc,
                        actual_status=status,
                        deviation_type="failed",
                        detail=f"子任务「{desc}」执行失败",
                    )
                )
            elif status == "pending":
                deviations.append(
                    PostMortemDeviation(
                        subtask_id=st_id,
                        description=desc,
                        actual_status=status,
                        deviation_type="unexecuted",
                        detail=f"子任务「{desc}」未开始执行",
                    )
                )
            elif status == "skipped":
                deviations.append(
                    PostMortemDeviation(
                        subtask_id=st_id,
                        description=desc,
                        actual_status=status,
                        deviation_type="skipped",
                        detail=f"子任务「{desc}」被跳过",
                    )
                )
            elif status == "rejected":
                deviations.append(
                    PostMortemDeviation(
                        subtask_id=st_id,
                        description=desc,
                        actual_status=status,
                        deviation_type="rejected",
                        detail=f"子任务「{desc}」被用户拒绝",
                    )
                )
        return deviations

    def _post_mortem_via_api(
        self,
        plan_data: dict[str, object],
        deviations: list[PostMortemDeviation],
        trace: dict[str, object],
    ) -> tuple[PostMortemResult, dict[str, object]]:
        """通过 LLM 合成事后总结的改进建议和质量评分。"""
        user_msg = str(plan_data.get("user_msg", ""))
        intent_category = str(plan_data.get("intent_category", ""))
        rationale = str(plan_data.get("rationale", ""))
        subtask_count = cast(int, plan_data.get("subtask_count", 0))
        succeeded_count = subtask_count - len(deviations)

        # 构建偏差详情
        deviation_lines: list[str] = []
        for d in deviations:
            deviation_lines.append(f"  - [{d.deviation_type}] {d.detail}")
        deviation_text = "\n".join(deviation_lines)

        system_prompt = (
            "你是一个任务规划事后分析器。对比以下计划与实际执行情况，生成改进建议。\n"
            "\n"
            f"原始用户消息：{user_msg}\n"
            f"意图类别：{intent_category}\n"
            f"规划理由：{rationale}\n"
            "\n"
            f"总子任务数：{subtask_count}，成功：{succeeded_count}，"
            f"失败/未执行/跳过：{len(deviations)}\n"
            "\n"
            "执行偏差：\n"
            f"{deviation_text}\n"
            "\n"
            "请从以下角度分析：\n"
            "1. 规划质量 — 计划是否合理？执行偏差多是规划问题还是执行问题？\n"
            "2. 改进建议 — 下次遇到类似任务，规划应该怎么调整？\n"
            "3. 质量评分 — 结合执行结果，重新评定该计划的质量。\n"
            "\n"
            "响应格式（严格 JSON，不要包含其他文字）：\n"
            '{"improvement_suggestions":["建议1","建议2"],'
            '"plan_quality_score":<0-1>,'
            '"confidence":<0-1>}'
        )

        api_trace: dict[str, object] = {
            **trace,
            "system_prompt": system_prompt,
            "user_msg": user_msg,
            "intent_category": intent_category,
            "raw_response": "",
            "parse_error": None,
            "token_usage": None,
        }

        response = self.client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=_REFLECTION_MAX_TOKENS,
            temperature=_REFLECTION_TEMPERATURE,
        )
        if self._ledger is not None and response.usage is not None:
            self._ledger.record(
                "post_mortem",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
            )
            api_trace["token_usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        api_trace["llm_called"] = True
        raw = response.choices[0].message.content or ""
        api_trace["raw_response"] = raw
        suggestions, quality_score, confidence, parse_error = self._parse_post_mortem(raw)
        if parse_error:
            api_trace["parse_error"] = parse_error
        return PostMortemResult(
            deviations=deviations,
            improvement_suggestions=suggestions,
            plan_quality_score=quality_score,
            confidence=confidence,
        ), api_trace

    @staticmethod
    def _parse_post_mortem(
        raw: str,
    ) -> tuple[list[str], float, float, str | None]:
        """解析 LLM 返回的 JSON 为事后总结字段，三阶回退容错。

        1. 直接 JSON.parse → (suggestions, quality_score, confidence)
        2. 提取 {...} 块 → 同上
        3. 返回空建议 + fallback 分数（兜底）

        Returns:
            (improvement_suggestions, plan_quality_score, confidence, error_or_none)。
        """
        # ── 层级 1：严格 JSON 解析 ──
        try:
            data = json.loads(raw)
            suggestions_raw = data.get("improvement_suggestions", [])
            if not isinstance(suggestions_raw, list):
                suggestions_raw = []
            suggestions = [str(s) for s in suggestions_raw if isinstance(s, str) and s.strip()]
            quality_score = float(data.get("plan_quality_score", _DEFAULT_CONFIDENCE))
            quality_score = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, quality_score))
            confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
            confidence = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence))
            return suggestions, quality_score, confidence, None
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

        # ── 层级 2：提取 {...} 块 ──
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                suggestions_raw = data.get("improvement_suggestions", [])
                if not isinstance(suggestions_raw, list):
                    suggestions_raw = []
                suggestions = [str(s) for s in suggestions_raw if isinstance(s, str) and s.strip()]
                quality_score = float(data.get("plan_quality_score", _DEFAULT_CONFIDENCE))
                quality_score = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, quality_score))
                confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
                confidence = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence))
                return suggestions, quality_score, confidence, None
            except (json.JSONDecodeError, ValueError, TypeError):
                pass

        # ── 层级 3：兜底 — 返回空建议 ──
        return (
            [],
            _FALLBACK_CONFIDENCE,
            _FALLBACK_CONFIDENCE,
            (f"JSON 解析失败，原始响应: {raw[:_ERROR_MSG_MAX_LEN]}"),
        )

    # ── 元知识提取 (知识沉淀) ──

    def extract_meta_knowledge(
        self,
        num_recent_plans: int = 10,
    ) -> tuple[list[ReflectionInsight], dict[str, object]]:
        """从多次事后反思中提取跨计划的通用模式——知识沉淀。

        管道：
        1. 获取最近 num_recent_plans 个 plan_runs
        2. 对每个计划提取子任务偏差（纯算法，复用 _extract_deviations）
        3. 收集所有偏差 → LLM 提取跨计划共性模式
        4. 解析结果 → upsert 到 reflection_insights 表

        Args:
            num_recent_plans: 分析的最近计划数量上限。

        Returns:
            (insights, trace_dict) — insights 为提取到的元知识洞察列表。
        """
        if not settings.plan_generation_enabled:
            return [], {}

        trace: dict[str, object] = {
            "total_plans": 0,
            "plans_with_deviations": 0,
            "total_deviations": 0,
            "insights_extracted": 0,
            "llm_called": False,
        }

        # Step 1: 获取最近计划
        plans = self._store.list_plans(limit=num_recent_plans)
        trace["total_plans"] = len(plans)
        if len(plans) < _MIN_META_PLANS:
            return [], trace

        # Step 2: 收集所有计划的偏差摘要
        all_deviations: list[dict[str, object]] = []
        for plan in plans:
            subtasks = plan.get("subtasks")
            if not isinstance(subtasks, list):
                # list_plans 不含 subtasks，需要 get_plan
                plan_with_subs = self._store.get_plan(cast(int, plan["id"]))
                subtasks = plan_with_subs.get("subtasks", []) if plan_with_subs else []

            if not isinstance(subtasks, list) or not subtasks:
                continue

            deviations = self._extract_deviations(subtasks)
            if not deviations:
                continue

            trace["plans_with_deviations"] = cast(int, trace["plans_with_deviations"]) + 1
            trace["total_deviations"] = cast(int, trace["total_deviations"]) + len(deviations)
            all_deviations.append(
                {
                    "plan_run_id": plan["id"],
                    "user_msg": str(plan.get("user_msg", "")),
                    "intent_category": str(plan.get("intent_category", "")),
                    "deviations": [
                        {
                            "subtask_id": d.subtask_id,
                            "description": d.description,
                            "deviation_type": d.deviation_type,
                            "detail": d.detail,
                        }
                        for d in deviations
                    ],
                }
            )

        if not all_deviations:
            return [], trace

        # Step 3: LLM 提取跨计划共性模式
        try:
            return self._meta_knowledge_via_api(all_deviations, trace)
        except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "元知识提取 LLM 调用失败",
                extra={"component": "reflection_engine", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
            )
            return [], trace

    def _meta_knowledge_via_api(
        self,
        all_deviations: list[dict[str, object]],
        trace: dict[str, object],
    ) -> tuple[list[ReflectionInsight], dict[str, object]]:
        """通过 LLM 调用提取跨计划偏差中的共性模式。"""
        # 构建偏差摘要文本
        deviation_summary_parts: list[str] = []
        for plan_dev in all_deviations:
            pid = plan_dev["plan_run_id"]
            user_msg = str(plan_dev["user_msg"])[:100]
            intent = str(plan_dev["intent_category"])
            devs = plan_dev["deviations"]
            if not isinstance(devs, list):
                continue
            dev_lines = [
                f"    - [{d.get('deviation_type', '?')}] {d.get('detail', '')}"
                for d in devs
                if isinstance(d, dict)
            ]
            if dev_lines:
                deviation_summary_parts.append(
                    f"计划 #{pid} (意图: {intent}): {user_msg}\n" + "\n".join(dev_lines)
                )

        deviation_text = "\n\n".join(deviation_summary_parts)

        system_prompt = (
            "你是一个任务规划元知识分析器。分析以下多个历史计划的执行偏差，"
            "提取跨计划的共性模式。"
            "这些模式将作为'元知识'存储，帮助未来的计划避免重复犯同样的错误。\n"
            "\n"
            "执行偏差汇总：\n"
            f"{deviation_text}\n"
            "\n"
            "请从以下角度分析：\n"
            "1. 失败模式 (failure_pattern) — 反复出现的子任务失败类型，以及根因\n"
            "2. 改进模式 (improvement_pattern) — 从偏差中可提炼的通用改进策略\n"
            "\n"
            "每个模式需要：\n"
            "- 一句话标题（title）\n"
            "- 一段详细说明（description，说明模式是什么、为什么反复出现、如何应对）\n"
            "- 置信度（confidence，0-1 浮点数）\n"
            "\n"
            "响应格式（严格 JSON，不要包含其他文字）：\n"
            '{"insights":['
            '{"insight_type":"failure_pattern","title":"模式标题","description":"详细说明","confidence":0.8},'
            '{"insight_type":"improvement_pattern","title":"改进标题","description":"详细说明","confidence":0.7}'
            "]}"
        )

        api_trace: dict[str, object] = {
            **trace,
            "system_prompt": system_prompt,
            "raw_response": "",
            "parse_error": None,
            "token_usage": None,
        }

        response = self.client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "请提取跨计划的共性模式。"},
            ],
            max_tokens=_META_KNOWLEDGE_MAX_TOKENS,
            temperature=_META_KNOWLEDGE_TEMPERATURE,
        )
        if self._ledger is not None and response.usage is not None:
            self._ledger.record(
                "meta_knowledge",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
            )
            api_trace["token_usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        api_trace["llm_called"] = True
        raw = response.choices[0].message.content or ""
        api_trace["raw_response"] = raw

        insight_dicts, parse_error = self._parse_meta_knowledge(raw)
        if parse_error:
            api_trace["parse_error"] = parse_error

        # Step 4: 持久化并转换
        insights: list[ReflectionInsight] = []
        source_ids = [cast(int, d["plan_run_id"]) for d in all_deviations]
        for ind in insight_dicts:
            self._store.upsert_reflection_insight(
                insight_type=str(ind.get("insight_type", "")),
                title=str(ind.get("title", "")),
                description=str(ind.get("description", "")),
                source_plan_ids=source_ids,
                confidence=cast(float, ind.get("confidence", _DEFAULT_CONFIDENCE)),
            )
            insights.append(
                ReflectionInsight(
                    insight_type=str(ind.get("insight_type", "")),
                    title=str(ind.get("title", "")),
                    description=str(ind.get("description", "")),
                    source_plan_ids=source_ids,
                    confidence=cast(float, ind.get("confidence", _DEFAULT_CONFIDENCE)),
                    occurrence_count=1,
                )
            )

        api_trace["insights_extracted"] = len(insights)
        return insights, api_trace

    # ── 计划蒸馏 ──

    def distill_plan_template(
        self,
        min_quality_score: float = 0.7,
        limit: int = 10,
    ) -> tuple[list[ReflectionInsight], dict[str, object]]:
        """从高质量成功计划中蒸馏可复用的任务分解模板——计划蒸馏。

        管道：
        1. 获取最近的 plan_runs（含 subtasks）
        2. 筛选全部子任务 succeeded 的计划（高质量信号）
        3. LLM 分析成功计划的共性结构 → 提取 best_practice 模板
        4. 持久化到 reflection_insights 表

        Args:
            min_quality_score: 最低质量评分阈值（暂时由全部成功代替）。
            limit: 分析的最近计划数量上限。

        Returns:
            (insights, trace_dict) — insights 类型均为 "best_practice"。
        """
        if not settings.plan_generation_enabled:
            return [], {}

        trace: dict[str, object] = {
            "total_plans": 0,
            "successful_plans": 0,
            "templates_extracted": 0,
            "llm_called": False,
        }

        # Step 1: 获取最近计划并筛选成功计划
        all_plans = self._store.list_plans(limit=limit)
        trace["total_plans"] = len(all_plans)

        successful_plans: list[dict[str, object]] = []
        for plan in all_plans:
            subtasks = plan.get("subtasks")
            if not isinstance(subtasks, list):
                plan_with_subs = self._store.get_plan(cast(int, plan["id"]))
                subtasks = plan_with_subs.get("subtasks", []) if plan_with_subs else []

            if not isinstance(subtasks, list) or not subtasks:
                continue

            # 全部子任务 succeeded 视为高质量
            all_ok = all(
                isinstance(st, dict) and str(st.get("status", "")) == "succeeded" for st in subtasks
            )
            if all_ok:
                successful_plans.append(
                    {
                        "plan_run_id": plan["id"],
                        "user_msg": str(plan.get("user_msg", "")),
                        "intent_category": str(plan.get("intent_category", "")),
                        "rationale": str(plan.get("rationale", "")),
                        "subtask_count": cast(int, plan.get("subtask_count", 0)),
                        "subtasks": [
                            {
                                "subtask_id": str(st.get("subtask_id", st.get("id", "?"))),
                                "description": str(st.get("description", "")),
                            }
                            for st in subtasks
                            if isinstance(st, dict)
                        ],
                    }
                )

        trace["successful_plans"] = len(successful_plans)
        if not successful_plans:
            return [], trace

        # Step 2: LLM 蒸馏模板
        try:
            return self._distill_via_api(successful_plans, trace)
        except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "计划蒸馏 LLM 调用失败",
                extra={"component": "reflection_engine", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
            )
            return [], trace

    def _distill_via_api(
        self,
        successful_plans: list[dict[str, object]],
        trace: dict[str, object],
    ) -> tuple[list[ReflectionInsight], dict[str, object]]:
        """通过 LLM 调用从成功计划中提取最佳实践模板。"""
        # 构建成功计划摘要
        plan_summaries: list[str] = []
        for sp in successful_plans:
            pid = sp["plan_run_id"]
            user_msg = str(sp["user_msg"])[:100]
            intent = str(sp["intent_category"])
            rationale = str(sp["rationale"])[:150]
            subs = sp["subtasks"]
            if not isinstance(subs, list):
                continue
            sub_lines = [
                f"    {i + 1}. {st.get('description', '')}"
                for i, st in enumerate(subs)
                if isinstance(st, dict)
            ]
            plan_summaries.append(
                f"计划 #{pid} (意图: {intent})\n"
                f"用户消息: {user_msg}\n"
                f"规划理由: {rationale}\n"
                f"子任务结构:\n" + "\n".join(sub_lines)
            )

        plan_text = "\n\n".join(plan_summaries)

        system_prompt = (
            "你是一个任务规划最佳实践分析器。分析以下多个执行成功的计划，"
            "提取可复用的任务分解模板和最佳实践模式。"
            "这些模板将作为'元知识'存储，帮助未来的计划借鉴成功经验。\n"
            "\n"
            "成功计划汇总：\n"
            f"{plan_text}\n"
            "\n"
            "请提取：\n"
            "1. 任务分解模板 — 对常见任务类型（如'部署'、'分析'、'重构'）的通用子任务结构\n"
            "2. 最佳实践 — 从成功案例中提炼的规划策略（如'先验证环境再部署'）\n"
            "\n"
            "每个模板需要：\n"
            "- 一句话标题（title）\n"
            "- 一段详细说明（description，说明适用于什么场景、关键步骤是什么、为什么有效）\n"
            "- 置信度（confidence，0-1 浮点数）\n"
            "\n"
            "响应格式（严格 JSON，不要包含其他文字）：\n"
            '{"templates":['
            '{"insight_type":"best_practice","title":"模板标题","description":"详细说明","confidence":0.8}'
            "]}"
        )

        api_trace: dict[str, object] = {
            **trace,
            "system_prompt": system_prompt,
            "raw_response": "",
            "parse_error": None,
            "token_usage": None,
        }

        response = self.client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "请提取成功计划中的最佳实践模板。"},
            ],
            max_tokens=_META_KNOWLEDGE_MAX_TOKENS,
            temperature=_META_KNOWLEDGE_TEMPERATURE,
        )
        if self._ledger is not None and response.usage is not None:
            self._ledger.record(
                "plan_distill",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
            )
            api_trace["token_usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        api_trace["llm_called"] = True
        raw = response.choices[0].message.content or ""
        api_trace["raw_response"] = raw

        template_dicts, parse_error = self._parse_meta_knowledge(raw)
        if parse_error:
            api_trace["parse_error"] = parse_error

        # 持久化并转换
        insights: list[ReflectionInsight] = []
        source_ids = [cast(int, sp["plan_run_id"]) for sp in successful_plans]
        for td in template_dicts:
            # distill 的 JSON 用 "templates" 键，parser 统一解析为 insight dict
            self._store.upsert_reflection_insight(
                insight_type=str(td.get("insight_type", "best_practice")),
                title=str(td.get("title", "")),
                description=str(td.get("description", "")),
                source_plan_ids=source_ids,
                confidence=cast(float, td.get("confidence", _DEFAULT_CONFIDENCE)),
            )
            insights.append(
                ReflectionInsight(
                    insight_type=str(td.get("insight_type", "best_practice")),
                    title=str(td.get("title", "")),
                    description=str(td.get("description", "")),
                    source_plan_ids=source_ids,
                    confidence=cast(float, td.get("confidence", _DEFAULT_CONFIDENCE)),
                    occurrence_count=1,
                )
            )

        api_trace["templates_extracted"] = len(insights)
        return insights, api_trace

    @staticmethod
    def _parse_meta_knowledge(
        raw: str,
    ) -> tuple[list[dict[str, object]], str | None]:
        """解析 LLM 返回的 JSON 为元知识洞察字典列表，三阶回退容错。

        支持两种 JSON 格式：
        - {"insights": [...]} — extract_meta_knowledge 使用
        - {"templates": [...]} — distill_plan_template 使用

        1. 直接 JSON.parse → 提取 list
        2. 提取 {...} 块 → 同上
        3. 返回空列表 + 错误消息（兜底）

        Returns:
            (insight_dicts, error_or_none)。
        """

        def _extract_list(data: dict[str, object]) -> list[dict[str, object]]:
            """从解析后的 JSON 中提取 insights 或 templates 列表。"""
            for key in ("insights", "templates"):
                items = data.get(key)
                if isinstance(items, list):
                    return [
                        {
                            "insight_type": str(item.get("insight_type", "")),
                            "title": str(item.get("title", "")),
                            "description": str(item.get("description", "")),
                            "confidence": float(item.get("confidence", _DEFAULT_CONFIDENCE)),
                        }
                        for item in items
                        if isinstance(item, dict)
                        and isinstance(item.get("title"), str)
                        and item["title"].strip()
                    ]
            return []

        # ── 层级 1：严格 JSON 解析 ──
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and ("insights" in data or "templates" in data):
                result = _extract_list(data)
                return result, None
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

        # ── 层级 2：提取 {...} 块 ──
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                if isinstance(data, dict):
                    result = _extract_list(data)
                    if result:
                        return result, None
            except (json.JSONDecodeError, ValueError, TypeError):
                pass

        # ── 层级 3：兜底 ──
        return (
            [],
            f"JSON 解析失败，原始响应: {raw[:_ERROR_MSG_MAX_LEN]}",
        )

    # ── 解析 ──

    @staticmethod
    def _parse_reflection(raw: str) -> tuple[ReflectionResult, str | None]:
        """解析 LLM 返回的 JSON 为 ReflectionResult，三阶回退容错。

        1. 直接 JSON.parse → ReflectionResult
        2. 提取 {...} 块 → ReflectionResult
        3. 返回空反思（兜底）
        """
        # ── 层级 1：严格 JSON 解析 ──
        try:
            data = json.loads(raw)
            reflections_raw = data.get("reflections", [])
            if not isinstance(reflections_raw, list):
                reflections_raw = []
            reflections = [str(r) for r in reflections_raw if isinstance(r, str) and r.strip()]
            suggestions_raw = data.get("improvement_suggestions", [])
            if not isinstance(suggestions_raw, list):
                suggestions_raw = []
            suggestions = [str(s) for s in suggestions_raw if isinstance(s, str) and s.strip()]
            plan_quality_score = float(data.get("plan_quality_score", _DEFAULT_CONFIDENCE))
            plan_quality_score = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, plan_quality_score))
            confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
            confidence = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence))
            return ReflectionResult(
                reflections=reflections,
                improvement_suggestions=suggestions,
                plan_quality_score=plan_quality_score,
                confidence=confidence,
            ), None
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

        # ── 层级 2：提取 {...} 块 ──
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                reflections_raw = data.get("reflections", [])
                if not isinstance(reflections_raw, list):
                    reflections_raw = []
                reflections = [str(r) for r in reflections_raw if isinstance(r, str) and r.strip()]
                suggestions_raw = data.get("improvement_suggestions", [])
                if not isinstance(suggestions_raw, list):
                    suggestions_raw = []
                suggestions = [str(s) for s in suggestions_raw if isinstance(s, str) and s.strip()]
                plan_quality_score = float(data.get("plan_quality_score", _DEFAULT_CONFIDENCE))
                plan_quality_score = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, plan_quality_score))
                confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
                confidence = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence))
                return ReflectionResult(
                    reflections=reflections,
                    improvement_suggestions=suggestions,
                    plan_quality_score=plan_quality_score,
                    confidence=confidence,
                ), None
            except (json.JSONDecodeError, ValueError, TypeError):
                pass

        # ── 层级 3：兜底 — 返回空反思 ──
        return (
            ReflectionResult(
                reflections=[],
                improvement_suggestions=[],
            ),
            f"JSON 解析失败，原始响应: {raw[:_ERROR_MSG_MAX_LEN]}",
        )
