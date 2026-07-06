"""模型路由引擎——基于意图分类结果选择最优模型 + 失败回退。

简单意图（闲聊/澄清）→ 轻量模型节省成本
复杂意图（提问/指令/探索）→ 强模型保证质量
主模型失败（超时/4xx/5xx）→ 回退到备用模型，最多 1 次重试
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from src.config import settings
from src.logging import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


@dataclass(frozen=True)
class RoutingDecision:
    """一次路由决策的结果。

    Attributes:
        model: 选中的模型名。
        reason: 选择理由（人类可读，用于前端展示和调试）。
        intent_category: 触发决策的意图分类。
        complexity: ``"simple"`` 或 ``"complex"``。
        fallback_model: 主模型失败时的回退模型，``None`` 表示无回退。
    """

    model: str
    reason: str
    intent_category: str
    complexity: str  # "simple" | "complex"
    fallback_model: str | None = None


@dataclass(frozen=True)
class RoutingResult:
    """一次带路由的模型调用结果。

    Attributes:
        content: 模型返回的文本内容。
        model_used: 实际使用的模型名（回退触发时与 decision.model 不同）。
        fallback_triggered: 是否触发了回退逻辑。
        attempts: 总调用尝试次数（1 = 主模型直接成功，2 = 回退后成功）。
    """

    content: str
    model_used: str
    fallback_triggered: bool = False
    attempts: int = 1


class FallbackExhaustedError(RuntimeError):
    """主模型和回退模型均调用失败时抛出。

    Attributes:
        primary_model: 主模型名。
        fallback_model: 回退模型名。
        original_error: 回退模型抛出的原始异常（主模型异常可从 ``__cause__`` 链获取）。
    """

    def __init__(
        self,
        primary_model: str,
        fallback_model: str,
        original_error: Exception,
    ) -> None:
        self.primary_model = primary_model
        self.fallback_model = fallback_model
        self.original_error = original_error
        super().__init__(
            f"模型调用失败：主模型 {primary_model} 和回退模型 {fallback_model} 均不可用"
        )


class ModelRouter:
    """基于意图分类的模型路由器，含失败回退。

    规则链：intent → complexity → model。
    失败回退：主模型超时/4xx/5xx → 回退模型，最多 1 次重试。
    配置由 ``Settings`` 统一管理，feature flag 默认关闭。
    """

    # ── 路由决策 ──

    def decide(self, intent: str, user_msg: str = "") -> RoutingDecision:  # noqa: ARG002
        """根据意图分类决定使用哪个模型。

        Args:
            intent: 意图分类标签（提问/指令/探索/闲聊/澄清）。
            user_msg: 用户原始消息（预留，未来可用于复杂度估算）。

        Returns:
            RoutingDecision，包含选中的模型和决策理由。

        Raises:
            ValueError: intent 为空字符串时。
        """
        if not intent or not intent.strip():
            raise ValueError("intent 不能为空")

        if not settings.routing_enabled:
            return RoutingDecision(
                model=settings.llm_model,
                reason="路由未启用，使用默认模型",
                intent_category=intent,
                complexity="simple",
                fallback_model=None,
            )

        complexity = self._classify_complexity(intent)
        model = settings.complex_model if complexity == "complex" else settings.simple_model
        fallback = settings.simple_model if complexity == "complex" else settings.complex_model

        complexity_label = "复杂" if complexity == "complex" else "简单"
        reason = f"意图「{intent}」为{complexity_label}任务，选择 {model}"

        decision = RoutingDecision(
            model=model,
            reason=reason,
            intent_category=intent,
            complexity=complexity,
            fallback_model=fallback,
        )
        logger.debug("路由决策", extra={"decision": decision})
        return decision

    @staticmethod
    def _classify_complexity(intent: str) -> str:
        """将意图分类映射为复杂度级别。

        Args:
            intent: 意图分类标签。

        Returns:
            ``"simple"`` 或 ``"complex"``。
        """
        if intent in settings.simple_intents:
            return "simple"
        return "complex"

    # ── 失败回退 ──

    @staticmethod
    def is_retryable_error(exc: BaseException) -> bool:
        """判断异常是否应触发回退重试。

        认定可重试的情况：
        - 内置 ``TimeoutError``（网络超时）
        - 异常对象上有 ``status_code`` 属性且值 ≥ 400（HTTP 错误）
        - 异常对象上有 ``response`` 属性且 ``response.status_code`` ≥ 400
          （OpenAI SDK 的 ``APIStatusError`` 等异常）

        不可重试的情况（直接抛出，不回退）：
        - 值错误、类型错误等代码逻辑 bug
        - 认证失败（401 不应换模型重试，应修复 API key）

        Args:
            exc: 捕获到的异常。

        Returns:
            ``True`` 如果应尝试回退模型，``False`` 否则。
        """
        # 内置超时
        if isinstance(exc, TimeoutError):
            return True

        # 直接 status_code 属性（如 httpx.HTTPStatusError）
        status = getattr(exc, "status_code", None)
        if isinstance(status, int) and status >= 400:
            # 401 Unauthorized 不回退——换模型也解决不了 API key 问题
            if status == 401:
                return False
            return True

        # OpenAI SDK 风格：exc.response.status_code
        response = getattr(exc, "response", None)
        if response is not None:
            resp_status = getattr(response, "status_code", None)
            if isinstance(resp_status, int) and resp_status >= 400:
                if resp_status == 401:
                    return False
                return True

        return False

    def execute_with_fallback(
        self,
        decision: RoutingDecision,
        api_call: Callable[[str], T],
    ) -> RoutingResult:
        """执行模型调用，主模型失败时自动回退到备用模型。

        重试策略：最多 1 次回退（不退化为无限重试）。
        仅对可重试错误（超时/4xx/5xx，除 401）触发回退；
        代码逻辑错误直接向上抛出。

        Args:
            decision: ``decide()`` 返回的路由决策。
            api_call: 接受模型名、返回结果的 callable。
                示例：``lambda m: client.chat.completions.create(model=m, ...)``。

        Returns:
            RoutingResult，包含模型响应内容和回退元数据。

        Raises:
            FallbackExhaustedError: 主模型和回退模型均失败。
            Exception: 不可重试的异常直接向上抛出（不做回退）。
        """
        # 主模型调用
        try:
            result = api_call(decision.model)
            return RoutingResult(
                content=str(result),
                model_used=decision.model,
            )
        except Exception as exc:
            if not self.is_retryable_error(exc):
                raise
            if not decision.fallback_model:
                raise

            logger.warning(
                "主模型调用失败，尝试回退",
                extra={
                    "primary_model": decision.model,
                    "fallback_model": decision.fallback_model,
                    "error": str(exc)[:200],
                },
            )

        # 回退模型调用（仅 1 次，不退化为无限重试）
        try:
            result = api_call(decision.fallback_model)
            logger.info(
                "回退模型调用成功",
                extra={
                    "fallback_model": decision.fallback_model,
                    "primary_model": decision.model,
                },
            )
            return RoutingResult(
                content=str(result),
                model_used=decision.fallback_model,
                fallback_triggered=True,
                attempts=2,
            )
        except Exception as fallback_exc:
            logger.error(
                "回退模型也调用失败",
                extra={
                    "primary_model": decision.model,
                    "fallback_model": decision.fallback_model,
                    "error": str(fallback_exc)[:200],
                },
            )
            raise FallbackExhaustedError(
                primary_model=decision.model,
                fallback_model=decision.fallback_model,
                original_error=fallback_exc,
            ) from fallback_exc
