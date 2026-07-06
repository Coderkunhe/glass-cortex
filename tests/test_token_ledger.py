from __future__ import annotations

from src.token_ledger import StepRecord, TokenLedger, TokenUsage


class TestTokenUsage:
    def test_fields(self) -> None:
        u = TokenUsage(call_point="chat", prompt_tokens=100, completion_tokens=50, timestamp=1.0)
        assert u.call_point == "chat"
        assert u.prompt_tokens == 100
        assert u.completion_tokens == 50
        assert u.total_tokens == 150


class TestTokenLedgerRecord:
    def test_single_record(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 100, 50)
        usage = ledger.last_usage
        assert usage is not None
        assert usage.call_point == "chat"
        assert usage.total_tokens == 150

    def test_last_usage_returns_latest(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 10, 5)
        ledger.record("fact_extraction", 200, 100)
        assert ledger.last_usage is not None
        assert ledger.last_usage.call_point == "fact_extraction"

    def test_last_usage_empty_returns_none(self) -> None:
        ledger = TokenLedger()
        assert ledger.last_usage is None

    def test_multiple_records_all_stored(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 10, 5)
        ledger.record("chat", 20, 10)
        ledger.record("fact_extraction", 30, 15)
        s = ledger.summary()
        assert s["chat"]["count"] == 2
        assert s["fact_extraction"]["count"] == 1
        assert s["total"]["count"] == 3


class TestTokenLedgerSummary:
    def test_empty_summary(self) -> None:
        s = TokenLedger().summary()
        assert s["total"]["count"] == 0
        assert s["total"]["prompt_tokens"] == 0
        assert s["total"]["completion_tokens"] == 0
        assert s["total"]["total_tokens"] == 0

    def test_aggregates_by_call_point(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 100, 50)
        ledger.record("chat", 200, 100)
        ledger.record("fact_extraction", 300, 150)
        s = ledger.summary()
        assert s["chat"]["count"] == 2
        assert s["chat"]["prompt_tokens"] == 300
        assert s["chat"]["completion_tokens"] == 150
        assert s["chat"]["total_tokens"] == 450
        assert s["fact_extraction"]["count"] == 1
        assert s["fact_extraction"]["prompt_tokens"] == 300
        assert s["total"]["total_tokens"] == 900

    def test_unknown_call_point_in_summary(self) -> None:
        """未记录过的 call_point 不在 summary 中出现（除 total）。"""
        s = TokenLedger().summary()
        assert "unknown" not in s
        assert "total" in s


class TestTokenLedgerCacheHit:
    def test_record_cache_hit_preserves_call_point(self) -> None:
        ledger = TokenLedger()
        ledger.record_cache_hit("fact_extraction", 500)
        assert ledger.last_usage is not None
        assert ledger.last_usage.call_point == "fact_extraction"
        assert ledger.last_usage.prompt_tokens == 500
        assert ledger.last_usage.completion_tokens == 0

    def test_cache_hit_appears_under_original_call_point(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 100, 50)
        ledger.record_cache_hit("fact_extraction", 300)
        s = ledger.summary()
        assert "fact_extraction" in s
        assert s["fact_extraction"]["prompt_tokens"] == 300
        assert s["fact_extraction"]["completion_tokens"] == 0
        assert s["fact_extraction"]["total_tokens"] == 300

    def test_multiple_cache_hits_by_call_point(self) -> None:
        ledger = TokenLedger()
        ledger.record_cache_hit("embedding", 100)
        ledger.record_cache_hit("fact_extraction", 200)
        s = ledger.summary()
        # 不同来源的 cache hit 归入各自的 call_point，不再合并
        assert s["embedding"]["prompt_tokens"] == 100
        assert s["embedding"]["count"] == 1
        assert s["fact_extraction"]["prompt_tokens"] == 200
        assert s["fact_extraction"]["count"] == 1

    def test_cache_hit_does_not_affect_step_records(self) -> None:
        """Cache hit 记录（token）与 step 计时记录互不干扰。"""
        ledger = TokenLedger()
        ledger.record_cache_hit("fact_extraction", 100)
        ledger.record_step("decay", 1.5)
        assert ledger.last_usage is not None
        assert ledger.last_usage.call_point == "fact_extraction"
        assert ledger.last_step is not None
        assert ledger.last_step.step_name == "decay"

    # ── 69C: compression_savings ──

    def test_record_compression_savings_uses_correct_call_point(self) -> None:
        ledger = TokenLedger()
        ledger.record_compression_savings(150)
        assert ledger.last_usage is not None
        assert ledger.last_usage.call_point == "compression_savings"
        assert ledger.last_usage.prompt_tokens == 150
        assert ledger.last_usage.completion_tokens == 0
        assert ledger.last_usage.total_tokens == 150

    def test_compression_savings_appears_in_summary(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 100, 50)
        ledger.record_compression_savings(200)
        s = ledger.summary()
        assert "compression_savings" in s
        assert s["compression_savings"]["prompt_tokens"] == 200
        assert s["compression_savings"]["total_tokens"] == 200

    def test_multiple_compression_savings_accumulate(self) -> None:
        ledger = TokenLedger()
        ledger.record_compression_savings(100)
        ledger.record_compression_savings(200)
        s = ledger.summary()
        assert s["compression_savings"]["prompt_tokens"] == 300
        assert s["compression_savings"]["count"] == 2


class TestTokenLedgerRecordCount:
    def test_empty(self) -> None:
        assert TokenLedger().record_count == 0

    def test_increments_with_records(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 10, 5)
        assert ledger.record_count == 1
        ledger.record("fact_extraction", 20, 10)
        assert ledger.record_count == 2

    def test_cache_hit_increments_count(self) -> None:
        ledger = TokenLedger()
        ledger.record_cache_hit("embedding", 100)
        assert ledger.record_count == 1


class TestTokenLedgerGetRange:
    def test_empty_range(self) -> None:
        assert TokenLedger().get_range(0, 0) == []

    def test_partial_range(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 10, 5)
        ledger.record("fact_extraction", 20, 10)
        ledger.record("chat", 30, 15)
        items = ledger.get_range(1, 3)
        assert len(items) == 2
        assert items[0].call_point == "fact_extraction"
        assert items[1].call_point == "chat"

    def test_full_range(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 10, 5)
        ledger.record("chat", 20, 10)
        items = ledger.get_range(0, ledger.record_count)
        assert len(items) == 2

    def test_snapshot_pattern(self) -> None:
        """快照 + 差分：先记快照，再写新记录，get_range 仅返回增量。"""
        ledger = TokenLedger()
        ledger.record("chat", 10, 5)
        snapshot = ledger.record_count
        ledger.record("fact_extraction", 20, 10)
        ledger.record("compression", 30, 15)
        new_items = ledger.get_range(snapshot, ledger.record_count)
        assert len(new_items) == 2
        assert new_items[0].call_point == "fact_extraction"
        assert new_items[1].call_point == "compression"


class TestTokenLedgerTotalTokens:
    def test_accumulates_across_calls(self) -> None:
        ledger = TokenLedger()
        ledger.record("chat", 100, 50)
        ledger.record("fact_extraction", 200, 100)
        assert ledger.total_tokens == 450


class TestStepRecord:
    def test_fields(self) -> None:
        r = StepRecord(
            step_name="decay",
            elapsed_ms=1.5,
            status="ok",
            metrics={"total": 42},
            timestamp=100.0,
        )
        assert r.step_name == "decay"
        assert r.elapsed_ms == 1.5
        assert r.status == "ok"
        assert r.metrics == {"total": 42}
        assert r.timestamp == 100.0

    def test_defaults(self) -> None:
        r = StepRecord(step_name="embed", elapsed_ms=0.0)
        assert r.status == "ok"
        assert r.metrics == {}
        assert r.timestamp > 0


class TestTokenLedgerRecordStep:
    def test_single_step(self) -> None:
        ledger = TokenLedger()
        ledger.record_step("decay", 2.3, metrics={"count": 5})
        last = ledger.last_step
        assert last is not None
        assert last.step_name == "decay"
        assert last.elapsed_ms == 2.3
        assert last.status == "ok"
        assert last.metrics == {"count": 5}

    def test_last_step_returns_latest(self) -> None:
        ledger = TokenLedger()
        ledger.record_step("decay", 1.0)
        ledger.record_step("embed", 2.0)
        assert ledger.last_step is not None
        assert ledger.last_step.step_name == "embed"

    def test_last_step_none_when_empty(self) -> None:
        assert TokenLedger().last_step is None

    def test_step_alongside_token_records(self) -> None:
        """Step 记录与 token 记录互不干扰。"""
        ledger = TokenLedger()
        ledger.record("chat", 100, 50)
        ledger.record_step("decay", 1.5)
        assert ledger.last_usage is not None
        assert ledger.last_usage.call_point == "chat"
        assert ledger.last_step is not None
        assert ledger.last_step.step_name == "decay"


class TestTokenLedgerStepSummary:
    def test_empty(self) -> None:
        s = TokenLedger().step_summary()
        assert s == {}

    def test_aggregates_by_step_name(self) -> None:
        ledger = TokenLedger()
        ledger.record_step("decay", 1.0)
        ledger.record_step("decay", 3.0)
        ledger.record_step("embed", 2.0)
        s = ledger.step_summary()
        assert s["decay"]["count"] == 2
        assert s["decay"]["total_ms"] == 4.0
        assert s["decay"]["avg_ms"] == 2.0
        assert s["decay"]["min_ms"] == 1.0
        assert s["decay"]["max_ms"] == 3.0
        assert s["embed"]["count"] == 1
        assert s["embed"]["total_ms"] == 2.0
