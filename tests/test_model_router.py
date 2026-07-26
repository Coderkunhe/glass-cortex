"""ModelRouter 决策引擎测试——规则链 + 配置开关 + 边界条件 + 失败回退。"""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from src.chat.model_router import (
    FallbackExhaustedError,
    ModelRouter,
    RoutingDecision,
    RoutingResult,
)
from src.config import RouterConfig, Settings


@pytest.fixture
def router() -> ModelRouter:
    """创建 ModelRouter 实例。"""
    return ModelRouter()


@pytest.fixture
def enabled_settings() -> Settings:
    """创建启用了路由的 Settings 实例。"""
    return Settings(router=RouterConfig(routing_enabled=True))


class TestRoutingDecision:
    """RoutingDecision dataclass 构造和字段验证。"""

    def test_basic_construction(self) -> None:
        """所有字段可正常赋值和读取。"""
        d = RoutingDecision(
            model="deepseek-chat",
            reason="测试",
            intent_category="闲聊",
            complexity="simple",
            fallback_model=None,
        )
        assert d.model == "deepseek-chat"
        assert d.reason == "测试"
        assert d.intent_category == "闲聊"
        assert d.complexity == "simple"
        assert d.fallback_model is None

    def test_with_fallback(self) -> None:
        """复杂意图有回退模型。"""
        d = RoutingDecision(
            model="deepseek-reasoner",
            reason="复杂任务",
            intent_category="提问",
            complexity="complex",
            fallback_model="deepseek-chat",
        )
        assert d.fallback_model == "deepseek-chat"
        assert d.complexity == "complex"

    def test_frozen(self) -> None:
        """RoutingDecision 是不可变 dataclass。"""
        d = RoutingDecision(
            model="m",
            reason="r",
            intent_category="闲聊",
            complexity="simple",
        )
        with pytest.raises(FrozenInstanceError):
            d.model = "x"  # type: ignore[misc]


class TestModelRouterDisabled:
    """路由关闭时，始终返回默认模型。"""

    def test_disabled_returns_default(self, router: ModelRouter) -> None:
        """路由关闭时，decide() 返回 settings.llm_model。"""
        # 默认 Settings routing_enabled=False
        decision = router.decide("提问")
        assert decision.model == "deepseek-v4-flash"
        assert decision.reason == "路由未启用，使用默认模型"
        assert decision.complexity == "simple"

    def test_disabled_all_intents_same(self, router: ModelRouter) -> None:
        """路由关闭时，所有意图都返回默认模型。"""
        for intent in ("闲聊", "指令", "探索", "澄清", "提问"):
            assert router.decide(intent).model == "deepseek-v4-flash"


class TestModelRouterEnabled:
    """路由开启时，意图→复杂度→模型规则链。"""

    @pytest.fixture
    def enabled_router(self) -> ModelRouter:
        """创建 router 实例，配合 monkeypatch 修改 settings。"""
        return ModelRouter()

    def test_simple_intent_routes_to_simple_model(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """闲聊意图 → simple_model。"""
        monkeypatch.setattr(
            "src.chat.model_router.settings",
            Settings(router=RouterConfig(routing_enabled=True)),
        )
        router = ModelRouter()
        decision = router.decide("闲聊")
        assert decision.model == "deepseek-v4-flash"  # simple_model
        assert decision.complexity == "simple"
        assert "简单任务" in decision.reason

    def test_clarify_intent_is_simple(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """澄清意图 → simple_model。"""
        monkeypatch.setattr(
            "src.chat.model_router.settings",
            Settings(router=RouterConfig(routing_enabled=True)),
        )
        router = ModelRouter()
        decision = router.decide("澄清")
        assert decision.complexity == "simple"
        assert decision.model == "deepseek-v4-flash"

    def test_complex_intent_routes_to_complex_model(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """提问意图 → complex_model（deepseek-v4-pro）。"""
        monkeypatch.setattr(
            "src.chat.model_router.settings",
            Settings(router=RouterConfig(routing_enabled=True)),
        )
        router = ModelRouter()
        decision = router.decide("提问")
        assert decision.model == "deepseek-v4-pro"  # complex_model
        assert decision.complexity == "complex"
        assert "复杂任务" in decision.reason

    def test_command_intent_is_complex(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """指令意图 → complex。"""
        monkeypatch.setattr(
            "src.chat.model_router.settings",
            Settings(router=RouterConfig(routing_enabled=True)),
        )
        router = ModelRouter()
        decision = router.decide("指令")
        assert decision.complexity == "complex"
        assert decision.model == "deepseek-v4-pro"

    def test_explore_intent_is_complex(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """探索意图 → complex。"""
        monkeypatch.setattr(
            "src.chat.model_router.settings",
            Settings(router=RouterConfig(routing_enabled=True)),
        )
        router = ModelRouter()
        decision = router.decide("探索")
        assert decision.complexity == "complex"

    def test_complex_has_simple_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """复杂意图的回退模型是 simple_model。"""
        monkeypatch.setattr(
            "src.chat.model_router.settings",
            Settings(router=RouterConfig(routing_enabled=True)),
        )
        router = ModelRouter()
        decision = router.decide("指令")
        assert decision.fallback_model == "deepseek-v4-flash"

    def test_simple_has_complex_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """简单意图的回退模型是 complex_model。"""
        monkeypatch.setattr(
            "src.chat.model_router.settings",
            Settings(router=RouterConfig(routing_enabled=True)),
        )
        router = ModelRouter()
        decision = router.decide("闲聊")
        assert decision.fallback_model == "deepseek-v4-pro"

    def test_custom_simple_intents(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """自定义 simple_intents 配置生效。"""
        monkeypatch.setattr(
            "src.chat.model_router.settings",
            Settings(
                router=RouterConfig(
                    routing_enabled=True,
                    simple_intents=("闲聊", "澄清", "探索"),
                    simple_model="local-model",
                    complex_model="cloud-model",
                ),
            ),
        )
        router = ModelRouter()
        # 探索 现在是 simple
        assert router.decide("探索").complexity == "simple"
        assert router.decide("探索").model == "local-model"
        # 提问仍然是 complex
        assert router.decide("提问").complexity == "complex"
        assert router.decide("提问").model == "cloud-model"


class TestModelRouterEdgeCases:
    """边界条件和错误处理。"""

    def test_empty_intent_raises(self) -> None:
        """空字符串意图抛出 ValueError。"""
        router = ModelRouter()
        with pytest.raises(ValueError, match="intent 不能为空"):
            router.decide("")

    def test_whitespace_intent_raises(self) -> None:
        """纯空白意图抛出 ValueError。"""
        router = ModelRouter()
        with pytest.raises(ValueError, match="intent 不能为空"):
            router.decide("   ")

    def test_unknown_intent_goes_complex(self) -> None:
        """未知意图默认归类为 complex（安全侧）。"""
        router = ModelRouter()
        # routing_enabled=False 时总是默认模型
        decision = router.decide("未知类别")
        assert decision.model == "deepseek-v4-flash"


# ── Phase 55 Batch 3: 失败回退 ──


class TestIsRetryableError:
    """is_retryable_error 异常分类逻辑——哪些异常触发回退。"""

    def test_timeout_error_is_retryable(self) -> None:
        """内置 TimeoutError 应触发回退。"""
        assert ModelRouter.is_retryable_error(TimeoutError("connection timed out"))

    def test_http_500_via_status_code_attr(self) -> None:
        """status_code=500 的异常应触发回退。"""
        exc = Exception("server error")
        exc.status_code = 500  # type: ignore[attr-defined]
        assert ModelRouter.is_retryable_error(exc)

    def test_http_503_via_status_code_attr(self) -> None:
        """status_code=503 的异常应触发回退。"""
        exc = Exception("service unavailable")
        exc.status_code = 503  # type: ignore[attr-defined]
        assert ModelRouter.is_retryable_error(exc)

    def test_http_429_via_status_code_attr(self) -> None:
        """status_code=429 (rate limit) 应触发回退（换模型可能绕过限流）。"""
        exc = Exception("rate limited")
        exc.status_code = 429  # type: ignore[attr-defined]
        assert ModelRouter.is_retryable_error(exc)

    def test_http_401_not_retryable(self) -> None:
        """401 Unauthorized 不应回退——换模型解决不了 API key 问题。"""
        exc = Exception("unauthorized")
        exc.status_code = 401  # type: ignore[attr-defined]
        assert not ModelRouter.is_retryable_error(exc)

    def test_http_400_via_status_code_attr(self) -> None:
        """status_code=400 应触发回退。"""
        exc = Exception("bad request")
        exc.status_code = 400  # type: ignore[attr-defined]
        assert ModelRouter.is_retryable_error(exc)

    def test_openai_style_response_status_code(self) -> None:
        """OpenAI SDK 风格异常（exc.response.status_code）应正确检测。"""
        exc = Exception("api error")

        class FakeResponse:
            status_code = 500

        exc.response = FakeResponse()  # type: ignore[attr-defined]
        assert ModelRouter.is_retryable_error(exc)

    def test_openai_style_401_not_retryable(self) -> None:
        """OpenAI SDK 异常 response.status_code=401 不回退。"""
        exc = Exception("unauthorized")

        class FakeResponse:
            status_code = 401

        exc.response = FakeResponse()  # type: ignore[attr-defined]
        assert not ModelRouter.is_retryable_error(exc)

    def test_value_error_not_retryable(self) -> None:
        """代码逻辑错误（ValueError）不应触发回退。"""
        assert not ModelRouter.is_retryable_error(ValueError("bad value"))

    def test_type_error_not_retryable(self) -> None:
        """代码逻辑错误（TypeError）不应触发回退。"""
        assert not ModelRouter.is_retryable_error(TypeError("bad type"))

    def test_runtime_error_not_retryable(self) -> None:
        """普通 RuntimeError（无 status_code）不应触发回退。"""
        assert not ModelRouter.is_retryable_error(RuntimeError("something broke"))

    def test_none_status_is_not_retryable(self) -> None:
        """status_code=None（而非 int）不应视为 retryable。"""
        exc = Exception("weird")
        exc.status_code = None  # type: ignore[attr-defined]
        assert not ModelRouter.is_retryable_error(exc)

    def test_status_300_not_retryable(self) -> None:
        """3xx 重定向不应触发回退。"""
        exc = Exception("redirect")
        exc.status_code = 302  # type: ignore[attr-defined]
        assert not ModelRouter.is_retryable_error(exc)


class TestRoutingResult:
    """RoutingResult dataclass 构造和字段。"""

    def test_primary_success_result(self) -> None:
        """主模型直接成功：fallback_triggered=False, attempts=1。"""
        r = RoutingResult(content="hello", model_used="deepseek-chat")
        assert r.content == "hello"
        assert r.model_used == "deepseek-chat"
        assert r.fallback_triggered is False
        assert r.attempts == 1

    def test_fallback_success_result(self) -> None:
        """回退后成功：fallback_triggered=True, attempts=2。"""
        r = RoutingResult(
            content="hello from fallback",
            model_used="deepseek-reasoner",
            fallback_triggered=True,
            attempts=2,
        )
        assert r.fallback_triggered is True
        assert r.attempts == 2
        assert r.model_used == "deepseek-reasoner"

    def test_frozen(self) -> None:
        """RoutingResult 是不可变 dataclass。"""
        r = RoutingResult(content="x", model_used="m")
        with pytest.raises(FrozenInstanceError):
            r.content = "y"  # type: ignore[misc]


class TestExecuteWithFallback:
    """execute_with_fallback 回退执行逻辑。"""

    @pytest.fixture
    def router(self) -> ModelRouter:
        return ModelRouter()

    @pytest.fixture
    def simple_decision(self) -> RoutingDecision:
        """简单意图的决策（主: chat, 回退: reasoner）。"""
        return RoutingDecision(
            model="deepseek-chat",
            reason="简单任务",
            intent_category="闲聊",
            complexity="simple",
            fallback_model="deepseek-reasoner",
        )

    @pytest.fixture
    def no_fallback_decision(self) -> RoutingDecision:
        """无回退模型的决策（路由关闭时）。"""
        return RoutingDecision(
            model="deepseek-chat",
            reason="路由未启用",
            intent_category="提问",
            complexity="simple",
            fallback_model=None,
        )

    def test_primary_succeeds(self, router: ModelRouter, simple_decision: RoutingDecision) -> None:
        """主模型成功 → 返回 RoutingResult（fallback_triggered=False）。"""

        def api_call(model: str) -> str:
            return f"response from {model}"

        result = router.execute_with_fallback(simple_decision, api_call)
        assert result.content == "response from deepseek-chat"
        assert result.model_used == "deepseek-chat"
        assert result.fallback_triggered is False
        assert result.attempts == 1

    def test_primary_fails_fallback_succeeds(
        self, router: ModelRouter, simple_decision: RoutingDecision
    ) -> None:
        """主模型 500 → 回退模型成功 → fallback_triggered=True, attempts=2。"""
        call_count = 0

        def api_call(model: str) -> str:
            nonlocal call_count
            call_count += 1
            if model == "deepseek-chat":
                exc = RuntimeError("server error")
                exc.status_code = 500  # type: ignore[attr-defined]
                raise exc
            return f"response from {model}"

        result = router.execute_with_fallback(simple_decision, api_call)
        assert result.content == "response from deepseek-reasoner"
        assert result.model_used == "deepseek-reasoner"
        assert result.fallback_triggered is True
        assert result.attempts == 2
        assert call_count == 2

    def test_primary_fails_no_fallback_raises(
        self, router: ModelRouter, no_fallback_decision: RoutingDecision
    ) -> None:
        """主模型失败且无回退模型 → 直接向上抛原异常。"""

        def api_call(model: str) -> str:
            exc = RuntimeError("server error")
            exc.status_code = 503  # type: ignore[attr-defined]
            raise exc

        with pytest.raises(RuntimeError, match="server error"):
            router.execute_with_fallback(no_fallback_decision, api_call)

    def test_non_retryable_error_raises_immediately(
        self, router: ModelRouter, simple_decision: RoutingDecision
    ) -> None:
        """不可重试错误（如 ValueError）→ 直接抛出，不尝试回退。"""
        call_count = 0

        def api_call(model: str) -> str:
            nonlocal call_count
            call_count += 1
            raise ValueError("bad input")

        with pytest.raises(ValueError, match="bad input"):
            router.execute_with_fallback(simple_decision, api_call)
        # 只调用了 1 次（主模型），没有重试
        assert call_count == 1

    def test_timeout_triggers_fallback(
        self, router: ModelRouter, simple_decision: RoutingDecision
    ) -> None:
        """TimeoutError 触发回退。"""
        call_count = 0

        def api_call(model: str) -> str:
            nonlocal call_count
            call_count += 1
            if model == "deepseek-chat":
                raise TimeoutError("request timed out")
            return f"fallback: {model}"

        result = router.execute_with_fallback(simple_decision, api_call)
        assert result.fallback_triggered is True
        assert result.model_used == "deepseek-reasoner"
        assert call_count == 2

    def test_both_fail_raises_fallback_exhausted(
        self, router: ModelRouter, simple_decision: RoutingDecision
    ) -> None:
        """主模型和回退模型均失败 → FallbackExhaustedError。"""

        def api_call(model: str) -> str:
            exc = RuntimeError(f"{model} failed")
            exc.status_code = 500  # type: ignore[attr-defined]
            raise exc

        with pytest.raises(FallbackExhaustedError) as exc_info:
            router.execute_with_fallback(simple_decision, api_call)
        err = exc_info.value
        assert err.primary_model == "deepseek-chat"
        assert err.fallback_model == "deepseek-reasoner"
        assert isinstance(err.original_error, RuntimeError)
        assert "deepseek-reasoner" in str(err.original_error)

    def test_fallback_exhausted_chains_cause(
        self, router: ModelRouter, simple_decision: RoutingDecision
    ) -> None:
        """FallbackExhaustedError 的 __cause__ 链接到回退模型的异常。"""

        def api_call(model: str) -> str:
            exc = RuntimeError(f"{model} failed")
            exc.status_code = 500  # type: ignore[attr-defined]
            raise exc

        with pytest.raises(FallbackExhaustedError) as exc_info:
            router.execute_with_fallback(simple_decision, api_call)
        cause = exc_info.value.__cause__
        assert cause is not None
        assert "deepseek-reasoner" in str(cause)
        # original_error 属性直接持有回退模型的异常
        assert exc_info.value.original_error is cause

    def test_api_call_receives_correct_model_name(self, router: ModelRouter) -> None:
        """验证 api_call 收到的模型名参数正确。"""
        decision = RoutingDecision(
            model="model-a",
            reason="test",
            intent_category="指令",
            complexity="complex",
            fallback_model="model-b",
        )
        received: list[str] = []

        def api_call(model: str) -> str:
            received.append(model)
            if model == "model-a":
                exc = RuntimeError("fail")
                exc.status_code = 500  # type: ignore[attr-defined]
                raise exc
            return "ok"

        router.execute_with_fallback(decision, api_call)
        assert received == ["model-a", "model-b"]


class TestFallbackExhaustedError:
    """FallbackExhaustedError 自定义异常的构造。"""

    def test_construction(self) -> None:
        """基础构造和属性读取。"""
        orig = RuntimeError("fallback model also failed")
        err = FallbackExhaustedError(
            primary_model="gpt-4",
            fallback_model="gpt-3.5",
            original_error=orig,
        )
        assert err.primary_model == "gpt-4"
        assert err.fallback_model == "gpt-3.5"
        assert err.original_error is orig
        assert "gpt-4" in str(err)
        assert "gpt-3.5" in str(err)
