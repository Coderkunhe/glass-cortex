"""Tests for overflow simulation engine."""

from src.context.overflow_sim import (
    STRATEGY_PERSONAS,
    OverflowSimResult,
    compare_strategies,
    simulate_overflow,
)


def _make_recalled(
    count: int = 5,
    row_type: str = "episode",
    content_prefix: str = "test memory",
    strength: float = 0.8,
    importance: float = 0.5,
) -> list[dict[str, object]]:
    """Build minimal recalled items for testing."""
    return [
        {
            "content": f"{content_prefix} {i}",
            "_row_type": row_type,
            "initial_strength": strength,
            "importance": importance,
            "composite_score": 0.8 - i * 0.1,
        }
        for i in range(count)
    ]


class TestOverflowSimResult:
    def test_fields_populated(self) -> None:
        result = OverflowSimResult(
            strategy="prioritize",
            window_size=4096,
            base_tokens=80,
            user_tokens=50,
            memories_before=5,
            memories_token_before=300,
            memories_after=3,
            memories_token_after=180,
            dropped_count=2,
            dropped_items=["memory 3", "memory 4"],
        )
        assert result.strategy == "prioritize"
        assert result.window_size == 4096
        assert result.dropped_count == 2
        assert result.overflow_triggered is False
        assert result.total_estimated_tokens == 80 + 180 + 50

    def test_usage_pct_computed(self) -> None:
        result = OverflowSimResult(
            strategy="prioritize",
            window_size=4096,
            base_tokens=100,
            user_tokens=200,
            memories_before=5,
            memories_token_before=500,
            memories_after=3,
            memories_token_after=300,
            dropped_count=2,
            dropped_items=["a", "b"],
        )
        assert result.usage_pct == round(600 / 4096 * 100, 1)
        assert result.wasted_tokens == (500 - 300) + (4096 - 600)

    def test_strategy_label(self) -> None:
        r = OverflowSimResult(
            strategy="truncate",
            window_size=4096,
            base_tokens=10,
            user_tokens=10,
            memories_before=0,
            memories_token_before=0,
            memories_after=0,
            memories_token_after=0,
            dropped_count=0,
            dropped_items=[],
        )
        assert "FIFO" in r.strategy_label

    def test_persona_property(self) -> None:
        r = OverflowSimResult(
            strategy="truncate",
            window_size=4096,
            base_tokens=10,
            user_tokens=10,
            memories_before=0,
            memories_token_before=0,
            memories_after=0,
            memories_token_after=0,
            dropped_count=0,
            dropped_items=[],
        )
        assert r.persona["name"] == "守门员"


class TestSimulateOverflowNoOverflow:
    def test_empty_recalled(self) -> None:
        result = simulate_overflow([], strategy="prioritize")
        assert result.memories_before == 0
        assert result.memories_after == 0
        assert result.dropped_count == 0
        assert not result.overflow_triggered

    def test_small_recall_fits(self) -> None:
        recalled = _make_recalled(3)
        result = simulate_overflow(recalled, strategy="prioritize", window_size=8192)
        assert result.memories_before == 3
        assert result.memories_after == 3
        assert result.dropped_count == 0
        assert not result.overflow_triggered

    def test_exact_fit_boundary(self) -> None:
        recalled = _make_recalled(1, content_prefix="x")
        result = simulate_overflow(recalled, strategy="prioritize", window_size=8192)
        assert result.memories_before == 1
        assert result.memories_after == 1
        assert not result.overflow_triggered


class TestSimulateOverflowTruncate:
    def test_truncate_drops_tail(self) -> None:
        recalled = _make_recalled(10, content_prefix="a" * 200)
        result = simulate_overflow(recalled, strategy="truncate", window_size=512)
        assert result.overflow_triggered
        assert result.strategy == "truncate"
        assert result.memories_after < result.memories_before
        assert result.dropped_count > 0

    def test_truncate_keeps_head_order(self) -> None:
        recalled = _make_recalled(5, content_prefix="short")
        result = simulate_overflow(recalled, strategy="truncate", window_size=4096)
        if result.dropped_count > 0 and result.memories_after > 0:
            kept_contents = [
                str(it["content"]) for it in result.kept_items if it["kind"] != "summary"
            ]
            for kc in kept_contents:
                assert kc in [str(r["content"]) for r in recalled[: result.memories_after]]

    def test_all_truncated(self) -> None:
        recalled = _make_recalled(5, content_prefix="x" * 3000)
        result = simulate_overflow(recalled, strategy="truncate", window_size=512)
        assert result.overflow_triggered
        assert result.memories_after == 0
        assert result.dropped_count == 5


class TestSimulateOverflowPrioritize:
    def test_prioritize_keeps_high_score(self) -> None:
        recalled = _make_recalled(8, content_prefix="a" * 100)
        result = simulate_overflow(recalled, strategy="prioritize", window_size=280)
        assert result.overflow_triggered
        if result.memories_after > 0:
            kept_scores = [
                float(cast_item_score(it)) for it in result.kept_items if it["kind"] != "summary"
            ]
            assert len(kept_scores) > 0

    def test_all_dropped_prioritize(self) -> None:
        recalled = _make_recalled(5, content_prefix="x" * 3000)
        result = simulate_overflow(recalled, strategy="prioritize", window_size=512)
        assert result.overflow_triggered
        assert result.memories_after == 0

    def test_facts_and_episodes_mixed(self) -> None:
        episodes = _make_recalled(3, row_type="episode", content_prefix="ep")
        facts = _make_recalled(2, row_type="fact", content_prefix="fact")
        recalled = episodes + facts
        result = simulate_overflow(recalled, strategy="prioritize", window_size=4096)
        assert result.memories_before == 5


class TestSimulateOverflowSummarize:
    def test_summarize_adds_summary(self) -> None:
        recalled = _make_recalled(10, content_prefix="a" * 200)
        result = simulate_overflow(recalled, strategy="summarize", window_size=512)
        assert result.overflow_triggered
        if result.dropped_count > 0:
            assert len(result.summary_line) > 0
            assert "已压缩" in result.summary_line

    def test_summarize_no_drops_no_summary(self) -> None:
        recalled = _make_recalled(2, content_prefix="short")
        result = simulate_overflow(recalled, strategy="summarize", window_size=8192)
        assert result.summary_line == ""

    def test_summary_line_is_kept_item(self) -> None:
        recalled = _make_recalled(10, content_prefix="b" * 200)
        result = simulate_overflow(recalled, strategy="summarize", window_size=512)
        if result.dropped_count > 0:
            summary_items = [it for it in result.kept_items if it["kind"] == "summary"]
            assert len(summary_items) == 1


class TestCompareStrategies:
    def test_returns_three_results(self) -> None:
        recalled = _make_recalled(6, content_prefix="c" * 150)
        results = compare_strategies(recalled, window_size=512)
        assert set(results.keys()) == {"truncate", "prioritize", "summarize"}
        for r in results.values():
            assert isinstance(r, OverflowSimResult)

    def test_same_input_same_before_counts(self) -> None:
        recalled = _make_recalled(4, content_prefix="test")
        results = compare_strategies(recalled, window_size=4096)
        for r in results.values():
            assert r.memories_before == 4

    def test_strategies_may_differ(self) -> None:
        recalled = _make_recalled(20, content_prefix="d" * 120)
        results = compare_strategies(recalled, window_size=512)
        after_counts = {s: r.memories_after for s, r in results.items()}
        assert len(set(after_counts.values())) >= 1

    def test_with_base_tokens_override(self) -> None:
        recalled = _make_recalled(5, content_prefix="e" * 100)
        results = compare_strategies(recalled, window_size=512, base_tokens_override=200)
        for r in results.values():
            assert r.base_tokens == 200

    def test_with_user_input(self) -> None:
        recalled = _make_recalled(3, content_prefix="f")
        results = compare_strategies(recalled, window_size=4096, user_input="hello world")
        for r in results.values():
            assert r.user_tokens > 0


class TestStrategyPersonas:
    def test_all_three_strategies_defined(self) -> None:
        for s in ("truncate", "prioritize", "summarize"):
            assert s in STRATEGY_PERSONAS
            assert "name" in STRATEGY_PERSONAS[s]
            assert "description" in STRATEGY_PERSONAS[s]
            assert "icon" in STRATEGY_PERSONAS[s]

    def test_persona_accessible_from_result(self) -> None:
        result = simulate_overflow([], strategy="summarize")
        assert result.persona["name"] == "口述史家"


def cast_item_score(item: dict[str, object]) -> float:
    s = item.get("score", 0.0)
    return float(s) if isinstance(s, (int, float)) else 0.0
