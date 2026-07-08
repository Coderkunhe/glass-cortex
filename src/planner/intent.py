"""意图分类器——L1 意图识别（chat/recall/analyze/command）+ API 调用 + 回退解析。"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from openai import APIError, OpenAI

from src.config import settings
from src.logging import get_logger
from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.token_ledger import TokenLedger

logger = get_logger(__name__)

INTENT_CATEGORIES = ("提问", "指令", "探索", "闲聊", "澄清")

INTENT_COLORS: dict[str, str] = {
    "提问": "var(--gm-info)",
    "指令": "var(--gm-accent)",
    "探索": "var(--gm-success)",
    "闲聊": "var(--gm-text-muted)",
    "澄清": "var(--gm-warning)",
}

# ── 魔数常量 ──
_ERROR_MSG_MAX_LEN = 200  # 错误日志截断长度
_RAW_PREVIEW_MAX_LEN = 100  # 原始响应预览截断
_FALLBACK_CONFIDENCE = 0.3  # 分类失败时的兜底置信度
_DEFAULT_CONFIDENCE = 0.5  # 解析/正则匹配时的默认置信度
_CONFIDENCE_MIN = 0.0  # 置信度下界
_CONFIDENCE_MAX = 1.0  # 置信度上界


@dataclass(frozen=True)
class IntentResult:
    """意图分类结果。"""

    category: str
    confidence: float
    rationale: str


class PlannerEngine:
    """L1 意图分类引擎 — 将用户消息分类为 5 种对话意图。

    遵循 FactExtractor 模式：构造注入 + setter 注入 + LLM 调用 + ledger 记录。
    通过 set_plan_generator() 注入 L2 PlanGenerator 以启用任务规划。
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
        self._plan_generator: object | None = None  # PlanGenerator 实例（延迟注入）
        self._replan_detector: object | None = None  # ReplanDetector 实例（延迟注入）
        self._reflection_engine: object | None = None  # ReflectionEngine 实例（延迟注入）

    @property
    def client(self) -> OpenAI:
        if self._client is None:
            api_key = os.environ.get(settings.llm_api_key_env)
            if not api_key:
                raise RuntimeError(f"{settings.llm_api_key_env} 未设置，无法进行意图分类。")
            self._client = OpenAI(api_key=api_key, base_url=settings.llm_base_url)
        return self._client

    def set_ledger(self, ledger: TokenLedger) -> None:
        self._ledger = ledger

    def set_plan_generator(self, plan_gen: object) -> None:
        """Setter 注入 L2 PlanGenerator — 延迟导入以避免循环依赖。"""
        self._plan_generator = plan_gen

    def set_replan_detector(self, replan_detector: object) -> None:
        """Setter 注入 L2.5 ReplanDetector — 延迟导入以避免循环依赖。"""
        self._replan_detector = replan_detector

    def set_reflection_engine(self, reflection_engine: object) -> None:
        """Setter 注入 L3 ReflectionEngine — 延迟导入以避免循环依赖。"""
        self._reflection_engine = reflection_engine

    # ── L2 任务规划委托 ──

    def generate_plan(
        self,
        user_msg: str,
        intent_category: str = "提问",
        plan_history: object | None = None,
    ) -> tuple[object, dict[str, object]]:
        """委托 PlanGenerator 将用户消息分解为子任务 DAG。

        若 PlanGenerator 未注入则返回空计划。
        plan_history 为可选的历史计划检索结果（PlanHistoryResult），
        用于注入成功模板和失败模式以影响新计划生成。
        """
        if self._plan_generator is None:
            from src.planner.plan import PlanResult

            return PlanResult(rationale="PlanGenerator 未注入"), {}
        result: tuple[object, dict[str, object]] = self._plan_generator.generate_plan(  # type: ignore[attr-defined]  # DI-injected via bootstrap; not declared in __init__ type signature
            user_msg, intent_category, plan_history=plan_history
        )
        return result

    def detect_replan(
        self,
        original_user_msg: str,
        original_intent: str,
        original_plan: object,
        revised_user_msg: str,
    ) -> tuple[object, dict[str, object]]:
        """委托 ReplanDetector 检测意图漂移并生成修正计划。

        若 ReplanDetector 未注入则返回无漂移结果。
        """
        if self._replan_detector is None:
            from src.planner.replan import ReplanResult

            return ReplanResult(
                drift_detected=False,
                drift_reason="ReplanDetector 未注入",
                revised_intent=original_intent,
            ), {}
        return self._replan_detector.detect_replan(  # type: ignore[no-any-return,attr-defined]  # DI-injected delegate; return type Any from untyped interface
            original_user_msg, original_intent, original_plan, revised_user_msg
        )

    # ── L3 规划反思委托 ──

    def reflect(
        self,
        user_msg: str,
        intent_category: str,
        plan_result: object | None = None,
        conversation_summary: str = "",
    ) -> tuple[object, dict[str, object]]:
        """委托 ReflectionEngine 对已完成的规划过程进行反思。

        若 ReflectionEngine 未注入则返回空反思结果。
        """
        if self._reflection_engine is None:
            from src.planner.reflection import ReflectionResult

            return ReflectionResult(
                reflections=["ReflectionEngine 未注入"],
                improvement_suggestions=[],
            ), {}
        return self._reflection_engine.reflect(  # type: ignore[no-any-return,attr-defined]  # DI-injected delegate; return type Any from untyped interface
            user_msg, intent_category, plan_result, conversation_summary
        )

    # ── 公开入口 ──

    def classify_intent(self, user_msg: str) -> tuple[IntentResult, dict[str, object]]:
        """分类用户消息意图。返回 (IntentResult, trace_dict)。"""
        if not settings.planner_enabled:
            return IntentResult("提问", 0.0, "Planner 已禁用"), {}

        try:
            return self._classify_via_api(user_msg)
        except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "意图分类失败，使用默认分类",
                extra={"component": "planner", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
            )
            return IntentResult("提问", _FALLBACK_CONFIDENCE, "分类不可用"), {}

    # ── API 调用 ──

    def _classify_via_api(self, user_msg: str) -> tuple[IntentResult, dict[str, object]]:
        system_prompt = (
            "你是一个对话意图分类器。将用户消息精确分类为以下 5 种意图之一：\n"
            "\n"
            "1. 提问 — 询问事实、知识、解释或建议"
            "（例：「什么是量子计算？」「今天天气怎么样？」）\n"
            "2. 指令 — 要求执行操作、生成内容或完成任务"
            "（例：「帮我写一封邮件」「把这段代码改成 Python」）\n"
            "3. 探索 — 开放式探索、头脑风暴或深度讨论"
            "（例：「如果人类能永生会怎样？」）\n"
            "4. 闲聊 — 寒暄、情感表达、无明确信息目标的社交对话"
            "（例：「你好！」「今天真开心」）\n"
            "5. 澄清 — 对上一轮回复的追问、修正或细化"
            "（例：「你刚才说的第二点能再详细解释吗？」）\n"
            "\n"
            "响应格式（严格 JSON）：\n"
            '{"category":"<意图>","confidence":<0-1>,'
            '"rationale":"<一句话判断依据>"}'
        )

        api_trace: dict[str, object] = {
            "system_prompt": system_prompt,
            "user_prompt": user_msg,
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
            max_tokens=settings.planner_max_tokens,
            temperature=settings.planner_temperature,
        )
        if self._ledger is not None and response.usage is not None:
            self._ledger.record(
                "planner",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
            )
            api_trace["token_usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        raw = response.choices[0].message.content or ""
        api_trace["raw_response"] = raw
        result, parse_error = self._parse_intent(raw)
        if parse_error:
            api_trace["parse_error"] = parse_error
        return result, api_trace

    # ── 解析 ──

    @staticmethod
    def _parse_intent(raw: str) -> tuple[IntentResult, str | None]:
        """解析 LLM 返回的 JSON 为 IntentResult，容错处理。"""
        # 尝试 JSON 解析
        try:
            data = json.loads(raw)
            category = str(data.get("category", "提问"))
            confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
            rationale = str(data.get("rationale", ""))
            if category not in INTENT_CATEGORIES:
                category = "提问"
            return IntentResult(
                category=category,
                confidence=max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence)),
                rationale=rationale,
            ), None
        except json.JSONDecodeError, ValueError, TypeError:
            pass

        # 容错：尝试提取 {...} 之间的内容
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                category = str(data.get("category", "提问"))
                confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
                rationale = str(data.get("rationale", ""))
                if category not in INTENT_CATEGORIES:
                    category = "提问"
                return IntentResult(
                    category=category,
                    confidence=max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence)),
                    rationale=rationale,
                ), None
            except json.JSONDecodeError, ValueError, TypeError:
                pass

        # 容错：正则匹配中文意图名
        for cat in INTENT_CATEGORIES:
            if cat in raw:
                return IntentResult(
                    category=cat,
                    confidence=_DEFAULT_CONFIDENCE,
                    rationale=f"正则匹配: {raw[:_RAW_PREVIEW_MAX_LEN]}",
                ), None

        return (
            IntentResult("提问", _FALLBACK_CONFIDENCE, f"解析失败: {raw[:_RAW_PREVIEW_MAX_LEN]}"),
            f"JSON 解析失败，原始响应: {raw[:_ERROR_MSG_MAX_LEN]}",
        )
