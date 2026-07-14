"""L2 任务规划器 — 将用户意图分解为子任务 DAG。

PlanGenerator 沿袭 PlannerEngine 模式：构造注入 + setter 注入 + LLM 调用 + 三阶回退解析。
生成的任务 DAG 用于 ProcessDrawer 可视化展示，不实际驱动执行引擎。
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import numpy as np
from openai import APIError, OpenAI

from src.config import settings
from src.logging import get_logger
from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.token_ledger import TokenLedger

if TYPE_CHECKING:
    from src.planner.plan_history import PlanHistoryResult

logger = get_logger(__name__)

# ── 魔数常量 ──
_ERROR_MSG_MAX_LEN = 200
_RAW_PREVIEW_MAX_LEN = 100
_FALLBACK_CONFIDENCE = 0.3
_DEFAULT_CONFIDENCE = 0.5
_CONFIDENCE_MIN = 0.0
_CONFIDENCE_MAX = 1.0
_PLAN_MAX_TOKENS = 256  # 任务规划比意图分类需要更多 token
_PLAN_TEMPERATURE = 0.2  # 略高温度以产生多样化的子任务分解
_MAX_SUBTASKS = 8  # 最多子任务数，防止 LLM 过度分解


@dataclass(frozen=True)
class PlanResult:
    """L2 任务规划结果 — 不可变数据类。

    Attributes:
        subtasks: 子任务列表，每项含 id/description/depends_on。
        dag_edges: 从 depends_on 推导的有向边列表 [(from_id, to_id), ...]。
        rationale: LLM 给出的规划理由（一句中文）。
        confidence: 规划置信度 [0, 1]。
    """

    subtasks: list[dict[str, object]] = field(default_factory=list)
    dag_edges: list[tuple[str, str]] = field(default_factory=list)
    rationale: str = ""
    confidence: float = _FALLBACK_CONFIDENCE


def _derive_dag_edges(subtasks: list[dict[str, object]]) -> list[tuple[str, str]]:
    """从子任务列表的 depends_on 字段推导 DAG 有向边列表。

    对每条 depends_on 引用生成一条 (前置任务 id, 当前任务 id) 边。
    忽略指向不存在任务的无效引用。
    """
    task_ids = {t["id"] for t in subtasks if "id" in t}
    edges: list[tuple[str, str]] = []
    for task in subtasks:
        target = task.get("id")
        deps = task.get("depends_on", [])
        if isinstance(deps, list) and target is not None:
            for dep in deps:
                if isinstance(dep, str) and dep in task_ids:
                    edges.append((dep, str(target)))
    return edges


class PlanGenerator:
    """L2 任务规划引擎 — 将用户意图分解为子任务 DAG。

    构造注入 MemoryStore / IndexManager / embed_fn，
    setter 注入 TokenLedger 用于成本追踪。
    规划结果用于 ProcessDrawer 的「任务规划」section 展示，
    不驱动实际的任务执行。
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
                raise RuntimeError(f"{settings.llm_api_key_env} 未设置，无法进行任务规划。")
            self._client = OpenAI(
                api_key=api_key, base_url=settings.llm_base_url, timeout=settings.llm_timeout
            )
        return self._client

    def set_ledger(self, ledger: TokenLedger) -> None:
        """Setter 注入 TokenLedger 用于规划调用的成本计量。"""
        self._ledger = ledger

    # ── 公开入口 ──

    def generate_plan(
        self,
        user_msg: str,
        intent_category: str = "提问",
        plan_history: PlanHistoryResult | None = None,
    ) -> tuple[PlanResult, dict[str, object]]:
        """将用户消息分解为子任务 DAG。

        Args:
            user_msg: 用户原始消息文本。
            intent_category: L1 意图分类结果（用于调整分解粒度）。
            plan_history: 可选的历史计划检索结果，用于注入成功模板和
                          失败模式以影响新计划生成。

        Returns:
            (PlanResult, trace_dict) — trace_dict 包含 system_prompt / raw_response
            等调试信息，用于前端 ProcessDrawer 展示。
        """
        if not settings.plan_generation_enabled:
            return PlanResult(rationale="任务规划已禁用"), {}

        try:
            return self._generate_via_api(user_msg, intent_category, plan_history)
        except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "任务规划失败，返回空计划",
                extra={"component": "plan_generator", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
            )
            return PlanResult(rationale=f"规划不可用: {str(exc)[:_ERROR_MSG_MAX_LEN]}"), {}

    @staticmethod
    def _build_history_enriched_prompt(
        base_prompt: str,
        plan_history: PlanHistoryResult | None,
    ) -> str:
        """将历史成败模式注入系统提示词，引导 LLM 复用成功模板、规避失败模式。

        纯函数——零副作用，仅做字符串拼接。plan_history 为 None 或无有效
        模式时返回原始 base_prompt。

        Args:
            base_prompt: 原始系统提示词。
            plan_history: PlanHistoryRetriever.retrieve() 的结果。

        Returns:
            可能追加了历史模式上下文的系统提示词。
        """
        if plan_history is None:
            return base_prompt

        success_templates = plan_history.success_templates
        failure_patterns = plan_history.failure_patterns

        if not success_templates and not failure_patterns:
            return base_prompt

        parts: list[str] = [base_prompt, "", "---", "## 历史计划参考（来自相似计划的成败模式）"]

        if success_templates:
            parts.append("")
            parts.append("### 成功模板（以下子任务分解模式曾在相似场景中全部成功）")
            for i, tmpl in enumerate(success_templates[:3], 1):  # 最多 3 个模板
                user_msg = str(tmpl.get("user_msg", ""))
                descs = tmpl.get("subtask_descriptions", [])
                if isinstance(descs, list):
                    desc_list = " → ".join(str(d) for d in descs if isinstance(d, str))
                    parts.append(f"{i}. 用户消息「{user_msg}」→ 子任务：{desc_list}")

        if failure_patterns:
            parts.append("")
            parts.append("### 失败模式（以下子任务类型曾反复失败，请避免或添加验证步骤）")
            for i, fp in enumerate(failure_patterns[:3], 1):  # 最多 3 个模式
                pattern = str(fp.get("pattern", ""))
                occurrences = fp.get("occurrences", 0)
                parts.append(
                    f"{i}. 失败模式「{pattern}」— 出现 {occurrences} 次，请避免此模式或添加验证步骤"
                )

        parts.append("")
        parts.append(
            "请参考以上历史模式调整子任务分解，但不要机械照搬——根据当前消息的具体需求做出判断。"
        )

        return "\n".join(parts)

    # ── API 调用 ──

    def _generate_via_api(
        self,
        user_msg: str,
        intent_category: str,
        plan_history: PlanHistoryResult | None = None,
    ) -> tuple[PlanResult, dict[str, object]]:
        """通过 LLM 调用生成任务规划 DAG，可选注入历史成败模式。"""
        base_system_prompt = (
            "你是一个任务规划器。将用户的消息分解为可执行的子任务，"
            "并标注子任务之间的依赖关系。\n"
            "\n"
            f"当前意图类别：{intent_category}。请根据意图类型调整分解粒度：\n"
            "- 「指令」类型：通常需要多步骤执行，分解为 3-6 个子任务\n"
            "- 「提问」类型：通常只需信息检索和综合，分解为 1-3 个子任务\n"
            "- 「探索」类型：开放式，可能需要多角度分析，分解为 2-5 个子任务\n"
            "- 「闲聊」/「澄清」类型：通常不需要任务分解，返回 1 个子任务即可\n"
            "\n"
            "每个子任务描述应简洁（≤30 字），依赖关系用任务 id 引用。\n"
            "\n"
            "响应格式（严格 JSON，不要包含其他文字）：\n"
            '{"subtasks":[{"id":"1","description":"子任务描述"},'
            '{"id":"2","description":"另一个子任务","depends_on":["1"]}],'
            '"rationale":"<一句规划理由>","confidence":<0-1>}'
        )
        system_prompt = self._build_history_enriched_prompt(base_system_prompt, plan_history)

        api_trace: dict[str, object] = {
            "system_prompt": system_prompt,
            "user_prompt": user_msg,
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
            max_tokens=_PLAN_MAX_TOKENS,
            temperature=_PLAN_TEMPERATURE,
        )
        if self._ledger is not None and response.usage is not None:
            self._ledger.record(
                "plan_generator",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
            )
            api_trace["token_usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        raw = response.choices[0].message.content or ""
        api_trace["raw_response"] = raw
        result, parse_error = self._parse_plan(raw)
        if parse_error:
            api_trace["parse_error"] = parse_error
        return result, api_trace

    # ── 解析 ──

    @staticmethod
    def _parse_plan(raw: str) -> tuple[PlanResult, str | None]:
        """解析 LLM 返回的 JSON 为 PlanResult，三阶回退容错。

        1. 直接 JSON.parse → PlanResult
        2. 提取 {...} 块 → PlanResult
        3. 返回空 PlanResult（兜底）
        """
        # ── 层级 1：严格 JSON 解析 ──
        try:
            data = json.loads(raw)
            subtasks_raw = data.get("subtasks", [])
            if not isinstance(subtasks_raw, list):
                subtasks_raw = []
            # 过滤 + 截断
            subtasks: list[dict[str, object]] = []
            for t in subtasks_raw[:_MAX_SUBTASKS]:
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
            confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
            rationale = str(data.get("rationale", ""))
            return PlanResult(
                subtasks=subtasks,
                dag_edges=_derive_dag_edges(subtasks),
                rationale=rationale,
                confidence=max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence)),
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
                parsed: list[dict[str, object]] = []
                for t in subtasks_raw[:_MAX_SUBTASKS]:
                    if isinstance(t, dict) and "id" in t and "description" in t:
                        parsed.append(
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
                confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
                rationale = str(data.get("rationale", ""))
                return PlanResult(
                    subtasks=parsed,
                    dag_edges=_derive_dag_edges(parsed),
                    rationale=rationale,
                    confidence=max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence)),
                ), None
            except json.JSONDecodeError, ValueError, TypeError:
                pass

        # ── 层级 3：兜底 — 返回空计划 ──
        return (
            PlanResult(rationale=f"解析失败，原始响应: {raw[:_RAW_PREVIEW_MAX_LEN]}"),
            f"JSON 解析失败，原始响应: {raw[:_ERROR_MSG_MAX_LEN]}",
        )
