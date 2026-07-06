"""PlanHistoryRetriever tests — Phase 60 Memory-Guided Planning Batch 1.

Follows test_consolidate.py pattern: no pytest fixtures, each test
constructs MemoryStore + try/finally close, avoiding fixture coupling.
"""

from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest

from src.config import PlanHistoryConfig, Settings
from src.memory.store import MemoryStore
from src.planner.plan import PlanResult
from src.planner.plan_history import (
    PatternReport,
    PlanHistoryResult,
    PlanHistoryRetriever,
)


def _seed_plan(
    store: MemoryStore,
    session_id: str,
    user_msg: str,
    intent: str,
    subtask_specs: list[dict[str, object]],
    *,
    confidence: float = 0.8,
) -> int:
    """Insert a plan_run + subtasks into store for testing.

    Each spec in subtask_specs should have keys: "id", "desc", "status",
    and optionally "depends_on".
    """
    subtasks_for_result: list[dict[str, object]] = []
    for s in subtask_specs:
        subtasks_for_result.append(
            {
                "id": str(s["id"]),
                "description": str(s["desc"]),
                "depends_on": (
                    [str(d) for d in cast(list[object], s.get("depends_on", []))]
                    if isinstance(s.get("depends_on"), list)
                    else []
                ),
            }
        )
    result = PlanResult(
        subtasks=subtasks_for_result,
        rationale="test rationale",
        confidence=confidence,
    )
    run_id = store.insert_plan(session_id, user_msg, intent, result)
    # Update subtask statuses (insert_plan defaults to "pending")
    assert store.conn is not None
    for s in subtask_specs:
        store.conn.execute(
            "UPDATE plan_subtasks SET status=? WHERE plan_run_id=? AND subtask_id=?",
            (str(s.get("status", "pending")), run_id, str(s["id"])),
        )
    store.conn.commit()
    return run_id


class TestExtractEntities:
    """Unit tests for _extract_entities — no store needed."""

    def test_chinese_text(self) -> None:
        entities = PlanHistoryRetriever._extract_entities("帮我分析数据生成报告")
        # Non-overlapping 2-4 char runs: 帮我分析, 数据生成, 报告
        assert "帮我分析" in entities or "数据生成" in entities
        assert len(entities) > 0

    def test_mixed_chinese_and_tech(self) -> None:
        entities = PlanHistoryRetriever._extract_entities("部署到 https://example.com v2.3.1 版本")
        assert "https://example.com" in entities
        assert "v2.3.1" in entities

    def test_empty_text(self) -> None:
        entities = PlanHistoryRetriever._extract_entities("")
        assert entities == set()

    def test_english_only(self) -> None:
        entities = PlanHistoryRetriever._extract_entities("deploy the app")
        # No Chinese chars, no URLs, no file paths, no version numbers
        assert entities == set()


class TestJaccardSimilarity:
    """Unit tests for _jaccard_similarity — pure function, no store."""

    def test_identical(self) -> None:
        s = {"a", "b", "c"}
        assert PlanHistoryRetriever._jaccard_similarity(s, s) == 1.0

    def test_disjoint(self) -> None:
        assert PlanHistoryRetriever._jaccard_similarity({"a"}, {"b"}) == 0.0

    def test_partial_overlap(self) -> None:
        score = PlanHistoryRetriever._jaccard_similarity({"a", "b"}, {"b", "c"})
        # intersection=1, union=3 -> 1/3
        assert score == 1.0 / 3.0

    def test_both_empty(self) -> None:
        assert PlanHistoryRetriever._jaccard_similarity(set(), set()) == 0.0

    def test_one_empty(self) -> None:
        assert PlanHistoryRetriever._jaccard_similarity({"a"}, set()) == 0.0


class TestScorePlan:
    """Tests for _score_plan — needs store with a plan_run."""

    def test_entity_overlap_scoring(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _seed_plan(
                store,
                "s1",
                "分析数据生成报告",
                "指令",
                [
                    {"id": "1", "desc": "分析数据", "status": "succeeded"},
                ],
            )
            retriever = PlanHistoryRetriever(store)
            plans = store.list_plans(limit=5)
            assert len(plans) == 1
            current = PlanHistoryRetriever._extract_entities("分析数据")
            score = retriever._score_plan(plans[0], current)
            assert score > 0.4  # intent match bonus
        finally:
            store.close()

    def test_no_entity_overlap_has_baseline(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _seed_plan(
                store,
                "s1",
                "分析数据",
                "指令",
                [
                    {"id": "1", "desc": "分析", "status": "succeeded"},
                ],
            )
            retriever = PlanHistoryRetriever(store)
            plans = store.list_plans(limit=5)
            # Current entities have no overlap with plan
            current = PlanHistoryRetriever._extract_entities("部署服务")
            score = retriever._score_plan(plans[0], current)
            # Should still have intent bonus (0.4) but no entity bonus
            assert score == 0.4
        finally:
            store.close()


class TestRetrieve:
    """Integration tests for retrieve() — pipeline from store to PlanHistoryResult."""

    def test_empty_db_returns_empty_result(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            retriever = PlanHistoryRetriever(store)
            result = retriever.retrieve("分析数据", intent_category="指令")
            assert isinstance(result, PlanHistoryResult)
            assert result.historical_plans == []
            assert result.total_candidates == 0
        finally:
            store.close()

    def test_exact_intent_match_retrieved(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _seed_plan(
                store,
                "s1",
                "分析数据生成报告",
                "指令",
                [
                    {"id": "1", "desc": "分析数据", "status": "succeeded"},
                ],
            )
            retriever = PlanHistoryRetriever(store)
            result = retriever.retrieve("分析数据", intent_category="指令")
            assert len(result.historical_plans) == 1
            hp = result.historical_plans[0]
            assert hp.intent_category == "指令"
            assert "分析数据" in hp.user_msg
            assert hp.similarity_score > 0.4
            assert len(hp.subtasks) == 1
        finally:
            store.close()

    def test_different_intent_filtered_out(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _seed_plan(
                store,
                "s1",
                "分析数据",
                "指令",
                [
                    {"id": "1", "desc": "分析", "status": "succeeded"},
                ],
            )
            retriever = PlanHistoryRetriever(store)
            # Current intent is "提问", but historical plan is "指令"
            result = retriever.retrieve("分析数据", intent_category="提问")
            assert result.historical_plans == []
            assert result.total_candidates == 1
        finally:
            store.close()

    def test_ranked_by_similarity(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _seed_plan(
                store,
                "s1",
                "部署服务到生产环境",
                "指令",
                [
                    {"id": "1", "desc": "部署", "status": "succeeded"},
                ],
            )
            _seed_plan(
                store,
                "s2",
                "分析数据生成报告",
                "指令",
                [
                    {"id": "1", "desc": "分析", "status": "succeeded"},
                ],
            )
            retriever = PlanHistoryRetriever(store)
            result = retriever.retrieve("分析数据日志", intent_category="指令")
            assert len(result.historical_plans) >= 1
            # "分析数据生成报告" should rank higher than "部署服务"
            top = result.historical_plans[0]
            assert "分析" in top.user_msg
        finally:
            store.close()

    def test_respects_top_k(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            for i in range(5):
                _seed_plan(
                    store,
                    f"s{i}",
                    f"分析数据任务{i}",
                    "指令",
                    [
                        {"id": "1", "desc": f"任务{i}", "status": "succeeded"},
                    ],
                )
            # Use config with top_k=2
            cfg = Settings(plan_history=PlanHistoryConfig(plan_history_top_k=2))
            retriever = PlanHistoryRetriever(store, config=cfg)
            result = retriever.retrieve("分析数据", intent_category="指令")
            assert len(result.historical_plans) <= 2
        finally:
            store.close()


class TestNormalizeDescription:
    """Tests for _normalize_description — pure function, no store."""

    def test_removes_punctuation_and_whitespace(self) -> None:
        """Spaces and punctuation stripped, lowercased."""
        result = PlanHistoryRetriever._normalize_description("获取 数据")
        assert result == "获取数据"

    def test_chinese_punctuation_removed(self) -> None:
        """Chinese punctuation marks removed, text concatenated."""
        result = PlanHistoryRetriever._normalize_description("分析，数据！报告。")
        assert result == "分析数据报告"


class TestExtractPatterns:
    """Integration tests for extract_patterns() — needs store with plan data."""

    def test_empty_db_returns_empty_report(self, tmp_path: Path) -> None:
        """No plans → PatternReport with zeros."""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            retriever = PlanHistoryRetriever(store)
            report = retriever.extract_patterns()
            assert isinstance(report, PatternReport)
            assert report.total_plans_analyzed == 0
            assert report.success_templates == []
            assert report.failure_patterns == []
            assert report.success_rate == 0.0
        finally:
            store.close()

    def test_all_succeeded_extracts_templates(self, tmp_path: Path) -> None:
        """All subtasks succeeded → success_templates populated, 100% rate."""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _seed_plan(
                store,
                "s1",
                "分析数据生成报告",
                "指令",
                [
                    {"id": "1", "desc": "分析数据", "status": "succeeded"},
                    {"id": "2", "desc": "生成报告", "status": "succeeded"},
                ],
            )
            _seed_plan(
                store,
                "s2",
                "部署到生产环境",
                "指令",
                [
                    {"id": "1", "desc": "部署", "status": "succeeded"},
                ],
            )
            retriever = PlanHistoryRetriever(store)
            report = retriever.extract_patterns()
            assert report.total_plans_analyzed == 2
            assert len(report.success_templates) == 2
            assert report.success_rate == 1.0
            # Verify template content
            tmpl = report.success_templates[0]
            assert tmpl["plan_run_id"] is not None
            assert isinstance(tmpl["subtask_descriptions"], list)
        finally:
            store.close()

    def test_repeated_failures_extract_patterns(self, tmp_path: Path) -> None:
        """Same failure ≥2 times → recorded as failure pattern."""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            # Two plans with the same failed subtask description
            _seed_plan(
                store,
                "s1",
                "分析数据",
                "指令",
                [
                    {"id": "1", "desc": "连接数据库超时", "status": "failed"},
                    {"id": "2", "desc": "分析", "status": "succeeded"},
                ],
            )
            _seed_plan(
                store,
                "s2",
                "生成报告",
                "指令",
                [
                    {"id": "1", "desc": "连接数据库超时", "status": "failed"},
                ],
            )
            retriever = PlanHistoryRetriever(store)
            report = retriever.extract_patterns()
            assert report.total_plans_analyzed == 2
            assert len(report.failure_patterns) >= 1
            fp = report.failure_patterns[0]
            assert cast(int, fp["occurrences"]) >= 2
            assert "examples" in fp
        finally:
            store.close()

    def test_mixed_success_and_failure(self, tmp_path: Path) -> None:
        """Mix of succeeded and failed plans → correct rate and both lists."""
        store = MemoryStore(str(tmp_path / "test.db"))
        store.init_db()
        try:
            _seed_plan(
                store,
                "s1",
                "分析数据",
                "指令",
                [
                    {"id": "1", "desc": "分析", "status": "succeeded"},
                ],
            )
            _seed_plan(
                store,
                "s2",
                "部署服务",
                "指令",
                [
                    {"id": "1", "desc": "部署失败", "status": "failed"},
                ],
            )
            _seed_plan(
                store,
                "s3",
                "测试代码",
                "指令",
                [
                    {"id": "1", "desc": "测试失败", "status": "failed"},
                ],
            )
            retriever = PlanHistoryRetriever(store)
            report = retriever.extract_patterns()
            assert report.total_plans_analyzed == 3
            assert len(report.success_templates) == 1
            assert report.success_rate == pytest.approx(1.0 / 3.0, abs=1e-4)
            # Two plans have failures, but descriptions differ → no pattern (each < 2)
            # unless "测试失败" appears ≥2 times, which it doesn't here
        finally:
            store.close()
