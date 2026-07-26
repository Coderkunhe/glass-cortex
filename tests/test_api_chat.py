"""API tests — /chat endpoint (full conversation pipeline)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from .helpers import _mock_api_trace, _mock_context_meta, build_mock_engines, make_client


class TestChat:
    """POST /chat — full conversation pipeline."""

    def test_chat_success(self) -> None:
        recall = MagicMock()
        recall.recall.return_value = [
            {"id": 1, "content": "prior context", "composite_score": 0.9},
        ]

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "Hello! How can I help?",
            42,
            {
                "window_size": 4096,
                "base_tokens": 200,
                "memories_before": 1,
                "memories_token_before": 50,
                "memories_after": 1,
                "overflow_applied": False,
                "strategy": "prioritize",
                "dropped_count": 0,
                "dropped_items": [],
                "user_message_tokens": 10,
                "total_estimated_tokens": 260,
            },
            {
                "caller": "chat",
                "model": "deepseek-chat",
                "temperature": 0.7,
                "max_tokens": 1024,
                "elapsed_ms": 350.0,
                "prompt_tokens": 260,
                "completion_tokens": 25,
            },
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="提问",
                confidence=0.95,
                rationale="User is asking a question",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(engines) as client:
                resp = client.post("/chat", json={"user_input": "Hello"})
                assert resp.status_code == 200
                data = resp.json()
                assert data["response_text"] == "Hello! How can I help?"
                assert data["episode_id"] == 42
                assert data["intent"]["category"] == "提问"
                assert data["intent"]["confidence"] == 0.95
                assert len(data["recall_items"]) == 1
                assert data["context_meta"]["window_size"] == 4096

    def test_chat_validation_error_empty_input(self) -> None:
        with make_client() as client:
            resp = client.post("/chat", json={"user_input": ""})
            assert resp.status_code == 422

    def test_chat_llm_unavailable(self) -> None:
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.side_effect = RuntimeError("API key not set")

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="闲聊",
                confidence=0.5,
                rationale="casual",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(engines) as client:
                resp = client.post("/chat", json={"user_input": "Hello"})
                assert resp.status_code == 503
                data = resp.json()
                assert data["error"] == "llm_unavailable"

    def test_chat_intent_failure_graceful(self) -> None:
        """If planner fails, chat should still proceed."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "Response",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        planner.classify_intent.side_effect = RuntimeError("Planner crashed")

        engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
        with make_client(engines) as client:
            resp = client.post("/chat", json={"user_input": "Hello"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["intent"] is None  # gracefully degraded
            assert data["response_text"] == "Response"

    def test_chat_recall_failure(self) -> None:
        recall = MagicMock()
        recall.recall.side_effect = RuntimeError("Recall engine down")

        engines = build_mock_engines(recall=recall)
        with make_client(engines) as client:
            resp = client.post("/chat", json={"user_input": "Hello"})
            assert resp.status_code == 500
            data = resp.json()
            assert "Recall engine down" in data["detail"]

    def test_chat_custom_window_params(self) -> None:
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "OK",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="闲聊",
                confidence=0.5,
                rationale="",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(engines) as client:
                resp = client.post(
                    "/chat",
                    json={
                        "user_input": "Hello",
                        "context_window_size": 2048,
                        "context_overflow_strategy": "truncate",
                        "model": "deepseek-reasoner",
                        "temperature": 0.3,
                        "max_tokens": 512,
                    },
                )
                assert resp.status_code == 200
                chat_engine.generate_and_store.assert_called_once_with(
                    user_input="Hello",
                    recalled=[],
                    context_window_size=2048,
                    context_overflow_strategy="truncate",
                    model="deepseek-reasoner",
                    temperature=0.3,
                    max_tokens=512,
                    skip_fact_extraction=False,
                    session_id=None,
                )

    def test_chat_include_system_prompt(self) -> None:
        """include_system_prompt=True includes system_prompt in response."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        context_meta = _mock_context_meta()
        context_meta["system_prompt"] = "你是一个有记忆的 AI 助手。\\n## 对话记忆\\n..."
        chat_engine.generate_and_store.return_value = (
            "OK",
            1,
            context_meta,
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="闲聊",
                confidence=0.5,
                rationale="",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(engines) as client:
                # Default: no system_prompt
                resp = client.post("/chat", json={"user_input": "Hello"})
                assert resp.status_code == 200
                data = resp.json()
                assert data["system_prompt"] is None

                # Request with include_system_prompt
                resp = client.post(
                    "/chat",
                    json={"user_input": "Hello", "include_system_prompt": True},
                )
                assert resp.status_code == 200
                data = resp.json()
                assert data["system_prompt"] is not None
                assert "你是一个有记忆的 AI 助手" in data["system_prompt"]

    def test_routing_disabled_by_default(self) -> None:
        """Routing off by default — uses default model when user doesn't specify."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "OK",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="提问",
                confidence=0.95,
                rationale="question",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(
                engines,
                routing_enabled=False,
                llm_model="deepseek-chat",
                llm_max_tokens=1024,
                llm_temperature=0.7,
                llm_base_url="https://api.deepseek.com",
                llm_api_key_env="DEEPSEEK_API_KEY",
            ) as client:
                resp = client.post("/chat", json={"user_input": "Hello"})
                assert resp.status_code == 200
                chat_engine.generate_and_store.assert_called_once()
                call_model = chat_engine.generate_and_store.call_args[1]["model"]
                assert call_model is None

    def test_routing_simple_intent_selects_simple_model(self) -> None:
        """Routing on + simple intent → simple_model (deepseek-chat)."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "OK",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="闲聊",
                confidence=0.8,
                rationale="casual",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(
                engines,
                routing_enabled=True,
                simple_model="deepseek-chat",
                complex_model="deepseek-reasoner",
                simple_intents=("闲聊", "澄清"),
                llm_model="deepseek-chat",
                llm_max_tokens=1024,
                llm_temperature=0.7,
                llm_base_url="https://api.deepseek.com",
                llm_api_key_env="DEEPSEEK_API_KEY",
            ) as client:
                resp = client.post("/chat", json={"user_input": "你好"})
                assert resp.status_code == 200
                call_model = chat_engine.generate_and_store.call_args[1]["model"]
                assert call_model == "deepseek-v4-flash"

    def test_routing_user_override_takes_precedence(self) -> None:
        """User explicit model → routing bypassed."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "OK",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="指令",
                confidence=0.9,
                rationale="command",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(
                engines,
                routing_enabled=True,
                simple_model="deepseek-chat",
                complex_model="deepseek-reasoner",
                simple_intents=("闲聊", "澄清"),
                llm_model="deepseek-chat",
                llm_max_tokens=1024,
                llm_temperature=0.7,
                llm_base_url="https://api.deepseek.com",
                llm_api_key_env="DEEPSEEK_API_KEY",
            ) as client:
                resp = client.post(
                    "/chat",
                    json={"user_input": "帮我做X", "model": "deepseek-chat"},
                )
                assert resp.status_code == 200
                call_model = chat_engine.generate_and_store.call_args[1]["model"]
                assert call_model == "deepseek-chat"

    def test_routing_intent_failure_graceful(self) -> None:
        """Intent classification fails → routing not triggered, uses default."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "OK",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        planner.classify_intent.side_effect = RuntimeError("Planner crash")

        engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
        with make_client(
            engines,
            routing_enabled=True,
            llm_model="deepseek-chat",
            llm_max_tokens=1024,
            llm_temperature=0.7,
            llm_base_url="https://api.deepseek.com",
            llm_api_key_env="DEEPSEEK_API_KEY",
        ) as client:
            resp = client.post("/chat", json={"user_input": "Hello"})
            assert resp.status_code == 200
            call_model = chat_engine.generate_and_store.call_args[1]["model"]
            assert call_model is None

    def test_routing_field_in_response_when_enabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Routing on + simple intent → ChatResponse.routing non-null."""
        monkeypatch.setattr(
            "src.chat.model_router.settings",
            __import__("src.config", fromlist=["Settings", "RouterConfig"]).Settings(
                router=__import__("src.config", fromlist=["RouterConfig"]).RouterConfig(
                    routing_enabled=True
                )
            ),
        )

        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "OK",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="闲聊",
                confidence=0.8,
                rationale="chat",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(
                engines,
                routing_enabled=True,
                llm_model="deepseek-chat",
                llm_max_tokens=1024,
                llm_temperature=0.7,
                llm_base_url="https://api.deepseek.com",
                llm_api_key_env="DEEPSEEK_API_KEY",
            ) as client:
                resp = client.post("/chat", json={"user_input": "你好"})
                assert resp.status_code == 200
                data = resp.json()
                assert "routing" in data
                routing = data["routing"]
                assert routing is not None
                assert routing["model"] == "deepseek-v4-flash"
                assert routing["complexity"] == "simple"
                assert routing["intent_category"] == "闲聊"
                assert "简单任务" in routing["reason"]
                assert routing["fallback_model"] == "deepseek-v4-pro"
                assert routing["fallback_triggered"] is False
                assert routing["attempts"] == 1

    def test_routing_field_null_when_disabled(self) -> None:
        """Routing off → ChatResponse.routing is null."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "OK",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="提问",
                confidence=0.9,
                rationale="question",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(
                engines,
                routing_enabled=False,
                llm_model="deepseek-chat",
                llm_max_tokens=1024,
                llm_temperature=0.7,
                llm_base_url="https://api.deepseek.com",
                llm_api_key_env="DEEPSEEK_API_KEY",
            ) as client:
                resp = client.post("/chat", json={"user_input": "Hello"})
                assert resp.status_code == 200
                data = resp.json()
                assert data["routing"] is None

    def test_routing_field_null_when_user_overrides_model(self) -> None:
        """User explicit model → routing is null (bypass auto-routing)."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "OK",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(
                category="提问",
                confidence=0.9,
                rationale="question",
            )
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)
            with make_client(
                engines,
                routing_enabled=True,
                llm_model="deepseek-chat",
                llm_max_tokens=1024,
                llm_temperature=0.7,
                llm_base_url="https://api.deepseek.com",
                llm_api_key_env="DEEPSEEK_API_KEY",
            ) as client:
                resp = client.post(
                    "/chat",
                    json={"user_input": "复杂问题", "model": "deepseek-reasoner"},
                )
                assert resp.status_code == 200
                data = resp.json()
                assert data["routing"] is None
                call_model = chat_engine.generate_and_store.call_args[1]["model"]
                assert call_model == "deepseek-reasoner"

    # ── Phase 62: semantic response cache integration tests ──

    def test_chat_cache_hit_bypasses_pipeline(self) -> None:
        """Cache hit bypasses entire pipeline, returns cached response directly."""
        import numpy as np

        recall = MagicMock()
        chat_engine = MagicMock()
        planner = MagicMock()

        engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)

        from src.cache.semantic_cache import CachedResponse

        mock_cached = CachedResponse(
            query_text="Hello",
            query_embedding=np.ones(384, dtype=np.float32),
            response_text="Cached response!",
            episode_id=-1,
            context_meta={
                "window_size": 4096,
                "base_tokens": 0,
                "memories_before": 0,
                "memories_token_before": 0,
                "memories_after": 0,
                "overflow_applied": False,
                "strategy": "prioritize",
                "dropped_count": 0,
                "dropped_items": [],
                "user_message_tokens": 10,
                "total_estimated_tokens": 10,
            },
            api_trace={
                "caller": "cache",
                "model": "cached",
                "temperature": 0.0,
                "max_tokens": 0,
                "elapsed_ms": 0.0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
            },
            recall_items=[],
            intent={"category": "闲聊", "confidence": 0.9, "rationale": "cached"},
            system_prompt=None,
            routing=None,
            cold_start_profile=None,
        )

        with make_client(engines, response_cache_enabled=True) as client:
            with patch("src.cache.semantic_cache.get_response_cache") as mock_get_cache:
                mock_cache = MagicMock()
                mock_cache.check.return_value = (mock_cached, 0.98)
                mock_get_cache.return_value = mock_cache

                resp = client.post("/chat", json={"user_input": "Hello"})
                assert resp.status_code == 200
                data = resp.json()
                assert data["from_cache"] is True
                assert data["cache_hit_score"] == 0.98
                assert data["response_text"] == "Cached response!"
                assert data["episode_id"] == -1
                recall.recall.assert_not_called()
                chat_engine.generate_and_store.assert_not_called()

    def test_chat_cache_miss_continues_pipeline(self) -> None:
        """Cache miss → normal pipeline execution, from_cache=False."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "Fresh response",
            42,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(category="提问", confidence=0.95, rationale="question")
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)

            with make_client(engines, response_cache_enabled=True) as client:
                with patch("src.cache.semantic_cache.get_response_cache") as mock_get_cache:
                    mock_cache = MagicMock()
                    mock_cache.check.return_value = (None, 0.72)
                    mock_get_cache.return_value = mock_cache

                    resp = client.post("/chat", json={"user_input": "New question"})
                    assert resp.status_code == 200
                    data = resp.json()
                    assert data["from_cache"] is False
                    assert data["cache_hit_score"] is None
                    assert data["response_text"] == "Fresh response"
                    chat_engine.generate_and_store.assert_called_once()
                    mock_cache.store.assert_called_once()

    def test_chat_cache_disabled_skips_check(self) -> None:
        """response_cache_enabled=False (default) → zero cache interaction."""
        recall = MagicMock()
        recall.recall.return_value = []

        chat_engine = MagicMock()
        chat_engine.generate_and_store.return_value = (
            "Normal response",
            1,
            _mock_context_meta(),
            _mock_api_trace(),
        )

        planner = MagicMock()
        with patch("src.planner.IntentResult") as mock_ir:
            mock_ir.return_value = MagicMock(category="闲聊", confidence=0.5, rationale="casual")
            planner.classify_intent.return_value = (mock_ir.return_value, {})

            engines = build_mock_engines(recall=recall, chat=chat_engine, planner=planner)

            # No response_cache_enabled — defaults to False
            with make_client(engines) as client:
                resp = client.post("/chat", json={"user_input": "Hello"})
                assert resp.status_code == 200
                data = resp.json()
                assert data.get("from_cache", False) is False
                chat_engine.generate_and_store.assert_called_once()
