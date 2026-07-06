"""Shared test fixtures and helpers for API tests.

Provides build_mock_engines, make_client, and helper factories
used across all domain-specific API test files.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from api.main import app
from src.bootstrap import EngineBundle


def build_mock_engines(
    store: MagicMock | None = None,
    idx: MagicMock | None = None,
    recall: MagicMock | None = None,
    forget: MagicMock | None = None,
    chat: MagicMock | None = None,
    ledger: MagicMock | None = None,
    planner: MagicMock | None = None,
) -> EngineBundle:
    """Build a mock 7-engine NamedTuple with sensible defaults.

    Each unspecified engine gets a fresh MagicMock().
    Pass named arguments to replace specific positions.
    """
    _store = store if store is not None else MagicMock()
    _idx = idx if idx is not None else MagicMock()
    _recall = recall if recall is not None else MagicMock()
    _forget = forget if forget is not None else MagicMock()
    _chat = chat if chat is not None else MagicMock()
    _ledger = ledger if ledger is not None else MagicMock()
    _planner = planner if planner is not None else MagicMock()
    return EngineBundle(_store, _idx, _recall, _forget, _chat, _ledger, _planner)


@contextmanager
def make_client(
    engines: EngineBundle | None = None,
    **settings_overrides: Any,
) -> Generator[TestClient]:
    """Create a TestClient with mocked engine initialization.

    Patches src.bootstrap.init_engines so the lifespan uses mocks
    instead of real engines (no SQLite/FAISS/LLM needed).

    Pass settings_overrides as keyword arguments to customize the
    mock Settings object (e.g. data_dir, user_profile).
    """
    if engines is None:
        engines = build_mock_engines()

    mock_settings = MagicMock()
    mock_settings.log_level = "WARNING"
    mock_settings.profile_data_dir = MagicMock()
    mock_settings.user_profile = "default"

    for key, value in settings_overrides.items():
        setattr(mock_settings, key, value)

    with (
        patch("src.bootstrap.init_engines", return_value=engines),
        patch("src.config.settings", mock_settings),
        patch("src.logging.setup_logging"),
        patch("src.embed.embed"),
    ):
        # Clear any stale state from previous tests
        for attr in ("engines", "settings", "store"):
            try:
                delattr(app.state, attr)
            except AttributeError, KeyError:
                pass

        app.state.engines = engines
        app.state.settings = mock_settings

        client = TestClient(app)
        yield client

    # Clean up after test
    for attr in ("engines", "settings", "store"):
        try:
            delattr(app.state, attr)
        except AttributeError, KeyError:
            pass


def _mock_context_meta() -> dict[str, object]:
    """Build minimal context_meta dict (conforms to ContextMeta model)."""
    return {
        "window_size": 4096,
        "base_tokens": 200,
        "memories_before": 0,
        "memories_token_before": 0,
        "memories_after": 0,
        "overflow_applied": False,
        "strategy": "prioritize",
        "dropped_count": 0,
        "dropped_items": [],
        "user_message_tokens": 10,
        "total_estimated_tokens": 210,
    }


def _mock_api_trace() -> dict[str, object]:
    """Build minimal api_trace dict (conforms to ApiTrace model)."""
    return {
        "caller": "chat",
        "model": "deepseek-chat",
        "temperature": 0.7,
        "max_tokens": 1024,
        "elapsed_ms": 100.0,
        "prompt_tokens": 200,
        "completion_tokens": 50,
    }
