"""ReflectionEngine 测试 — ReflectionResult dataclass + 三阶回退解析 + 错误恢复。"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.planner.reflection import (
    PostMortemDeviation,
    PostMortemResult,
    ReflectionEngine,
    ReflectionInsight,
    ReflectionResult,
)


def _dummy_embed(text: str) -> np.ndarray:
    return np.ones(384, dtype=np.float32)


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    s = MemoryStore(str(tmp_path / "test_reflection.db"))
    s.init_db()
    return s


@pytest.fixture
def idx() -> IndexManager:
    return IndexManager()


@pytest.fixture
def engine(store: MemoryStore, idx: IndexManager) -> ReflectionEngine:
    return ReflectionEngine(store, idx, _dummy_embed)


# ── ReflectionResult dataclass ──


class TestReflectionResult:
    """ReflectionResult 默认值与构造。"""

    def test_defaults(self) -> None:
        r = ReflectionResult()
        assert r.reflections == []
        assert r.improvement_suggestions == []
        assert r.plan_quality_score == 0.3
        assert r.confidence == 0.3

    def test_explicit_construction(self) -> None:
        r = ReflectionResult(
            reflections=["规划基本合理", "子任务粒度可细化"],
            improvement_suggestions=["建议增加校验步骤"],
            plan_quality_score=0.75,
            confidence=0.8,
        )
        assert len(r.reflections) == 2
        assert r.reflections[0] == "规划基本合理"
        assert len(r.improvement_suggestions) == 1
        assert r.plan_quality_score == 0.75
        assert r.confidence == 0.8


# ── _parse_reflection 三阶回退 ──


class TestParseReflection:
    """_parse_reflection 静态方法：JSON 解析 + block 提取 + 兜底。"""

    def test_valid_json(self) -> None:
        raw = (
            '{"reflections":["规划适当","粒度合理"],'
            '"improvement_suggestions":["加校验"],'
            '"plan_quality_score":0.85,'
            '"confidence":0.9}'
        )
        result, error = ReflectionEngine._parse_reflection(raw)
        assert error is None
        assert result.reflections == ["规划适当", "粒度合理"]
        assert result.improvement_suggestions == ["加校验"]
        assert result.plan_quality_score == 0.85
        assert result.confidence == 0.9

    def test_valid_json_minimal(self) -> None:
        """只有 reflections 字段，无 suggestions。"""
        raw = '{"reflections":["规划合理"],"plan_quality_score":0.7,"confidence":0.6}'
        result, error = ReflectionEngine._parse_reflection(raw)
        assert error is None
        assert result.reflections == ["规划合理"]
        assert result.improvement_suggestions == []
        assert result.plan_quality_score == 0.7
        assert result.confidence == 0.6

    def test_block_extract_fallback(self) -> None:
        """JSON 嵌入在 prose 文本中。"""
        raw = (
            "以下是对规划的反思：\n"
            '{"reflections":["还行"],"improvement_suggestions":[],'
            '"plan_quality_score":0.5,"confidence":0.5}\n'
            "以上是全部内容。"
        )
        result, error = ReflectionEngine._parse_reflection(raw)
        assert error is None
        assert result.reflections == ["还行"]
        assert result.plan_quality_score == 0.5

    def test_garbage_fallback(self) -> None:
        """完全无法解析的输入返回空反思。"""
        raw = "这不是 JSON 格式的输出"
        result, error = ReflectionEngine._parse_reflection(raw)
        assert error is not None
        assert "JSON 解析失败" in error
        assert result.reflections == []
        assert result.improvement_suggestions == []
        assert result.plan_quality_score == 0.3  # fallback

    def test_confidence_clamp(self) -> None:
        """分数超出 [0, 1] 范围时钳位。"""
        raw = '{"reflections":["超高分"],"plan_quality_score":2.5,"confidence":-0.5}'
        result, error = ReflectionEngine._parse_reflection(raw)
        assert error is None
        assert result.plan_quality_score == 1.0  # clamped to max
        assert result.confidence == 0.0  # clamped to min

    def test_malformed_fields_filtered(self) -> None:
        """reflections 数组中的非字符串元素被过滤。"""
        raw = (
            '{"reflections":["有效反思", 123, "", "  ", null],'
            '"improvement_suggestions":["建议1", 456],'
            '"plan_quality_score":0.5,'
            '"confidence":0.5}'
        )
        result, error = ReflectionEngine._parse_reflection(raw)
        assert error is None
        # 123 (int), "" (empty), "  " (whitespace-only), null → filtered
        assert result.reflections == ["有效反思"]
        # 456 (int) → filtered
        assert result.improvement_suggestions == ["建议1"]


# ── 错误恢复 ──


class TestReflectionErrorRecovery:
    """API 异常 → 优雅降级。"""

    def test_api_error_graceful(self, engine: ReflectionEngine) -> None:
        """模拟 API 异常，返回 fallback ReflectionResult。"""
        with patch.object(engine, "_reflect_via_api", side_effect=RuntimeError("API 超时")):
            result, trace = engine.reflect("帮我写邮件", "指令")
            assert len(result.reflections) == 1
            assert "API 超时" in result.reflections[0]
            assert result.improvement_suggestions == []
            assert trace == {}


# ── 禁用标志 ──


class TestReflectionDisabled:
    """plan_generation_enabled=False → 跳过反思。"""

    def test_disabled_returns_default(self, engine: ReflectionEngine) -> None:
        with patch("src.planner.reflection.settings") as mock_settings:
            mock_settings.plan_generation_enabled = False
            result, trace = engine.reflect("帮我写邮件", "指令")
            assert result.reflections == ["任务规划已禁用，跳过反思。"]
            assert result.improvement_suggestions == []
            assert trace == {}


# ── PostMortemResult / PostMortemDeviation dataclass ──


class TestPostMortemResult:
    """PostMortemResult 默认值与构造。"""

    def test_defaults(self) -> None:
        r = PostMortemResult()
        assert r.deviations == []
        assert r.improvement_suggestions == []
        assert r.plan_quality_score == 0.3
        assert r.confidence == 0.3

    def test_explicit_construction(self) -> None:
        d = PostMortemDeviation(
            subtask_id="1",
            description="部署服务",
            actual_status="failed",
            deviation_type="failed",
            detail="子任务「部署服务」执行失败",
        )
        r = PostMortemResult(
            deviations=[d],
            improvement_suggestions=["增加重试机制", "先验证环境配置"],
            plan_quality_score=0.4,
            confidence=0.85,
        )
        assert len(r.deviations) == 1
        assert r.deviations[0].deviation_type == "failed"
        assert len(r.improvement_suggestions) == 2
        assert r.plan_quality_score == 0.4
        assert r.confidence == 0.85


class TestPostMortemDeviation:
    """PostMortemDeviation 字段构造。"""

    def test_construct_failed(self) -> None:
        d = PostMortemDeviation(
            subtask_id="3",
            description="连接数据库",
            actual_status="failed",
            deviation_type="failed",
            detail="连接超时",
        )
        assert d.subtask_id == "3"
        assert d.deviation_type == "failed"
        assert d.actual_status == "failed"

    def test_default_values(self) -> None:
        d = PostMortemDeviation()
        assert d.subtask_id == ""
        assert d.deviation_type == ""
        assert d.detail == ""


# ── _extract_deviations 纯算法 ──


class TestExtractDeviations:
    """_extract_deviations 静态方法 — 零 LLM 调用。"""

    def test_all_succeeded_returns_empty(self) -> None:
        subtasks: list[dict[str, object]] = [
            {"subtask_id": "1", "description": "分析数据", "status": "succeeded"},
            {"subtask_id": "2", "description": "生成报告", "status": "succeeded"},
        ]
        deviations = ReflectionEngine._extract_deviations(subtasks)
        assert deviations == []

    def test_mixed_statuses(self) -> None:
        subtasks: list[dict[str, object]] = [
            {"subtask_id": "1", "description": "分析数据", "status": "succeeded"},
            {"subtask_id": "2", "description": "部署服务", "status": "failed"},
            {"subtask_id": "3", "description": "发送通知", "status": "pending"},
            {"subtask_id": "4", "description": "清理资源", "status": "skipped"},
            {"subtask_id": "5", "description": "运行测试", "status": "rejected"},
        ]
        deviations = ReflectionEngine._extract_deviations(subtasks)
        assert len(deviations) == 4
        dev_types = {d.deviation_type for d in deviations}
        assert dev_types == {"failed", "unexecuted", "skipped", "rejected"}

        # 验证各类型详情
        failed = [d for d in deviations if d.deviation_type == "failed"]
        assert len(failed) == 1
        assert "部署服务" in failed[0].detail

        unexecuted = [d for d in deviations if d.deviation_type == "unexecuted"]
        assert len(unexecuted) == 1
        assert "发送通知" in unexecuted[0].detail

    def test_empty_subtasks(self) -> None:
        deviations = ReflectionEngine._extract_deviations([])
        assert deviations == []

    def test_skips_non_dict_items(self) -> None:
        """列表中包含非 dict 元素时安全跳过。"""
        subtasks: list[dict[str, object]] = [
            {"subtask_id": "1", "description": "ok", "status": "succeeded"},
        ]
        deviations = ReflectionEngine._extract_deviations(subtasks)
        assert len(deviations) == 0


# ── _parse_post_mortem 三阶回退 ──


class TestParsePostMortem:
    """_parse_post_mortem 静态方法：JSON → block → 兜底。"""

    def test_valid_json(self) -> None:
        raw = (
            '{"improvement_suggestions":["加重试","先验证环境"],'
            '"plan_quality_score":0.35,'
            '"confidence":0.9}'
        )
        suggestions, quality, confidence, error = ReflectionEngine._parse_post_mortem(raw)
        assert error is None
        assert suggestions == ["加重试", "先验证环境"]
        assert quality == 0.35
        assert confidence == 0.9

    def test_block_extract_fallback(self) -> None:
        raw = (
            "以下是事后分析：\n"
            '{"improvement_suggestions":["改进1"],'
            '"plan_quality_score":0.6,"confidence":0.7}\n'
            "以上是全部内容。"
        )
        suggestions, quality, confidence, error = ReflectionEngine._parse_post_mortem(raw)
        assert error is None
        assert suggestions == ["改进1"]
        assert quality == 0.6

    def test_garbage_fallback(self) -> None:
        raw = "这不是 JSON 格式的输出"
        suggestions, quality, confidence, error = ReflectionEngine._parse_post_mortem(raw)
        assert error is not None
        assert "JSON 解析失败" in error
        assert suggestions == []
        assert quality == 0.3  # fallback
        assert confidence == 0.3  # fallback

    def test_confidence_clamp(self) -> None:
        raw = '{"improvement_suggestions":[],"plan_quality_score":2.5,"confidence":-0.5}'
        suggestions, quality, confidence, error = ReflectionEngine._parse_post_mortem(raw)
        assert error is None
        assert quality == 1.0  # clamped to max
        assert confidence == 0.0  # clamped to min


# ── post_mortem 集成 ──


class TestPostMortemIntegration:
    """post_mortem() 端到端集成测试 — 需要 store。"""

    def test_plan_not_found(self, store: MemoryStore, engine: ReflectionEngine) -> None:
        """plan_run_id 不存在 → 空结果。"""
        result, trace = engine.post_mortem(99999)
        assert isinstance(result, PostMortemResult)
        assert len(result.improvement_suggestions) == 1
        assert "不存在" in result.improvement_suggestions[0]

    def test_all_succeeded_no_llm(self, store: MemoryStore, engine: ReflectionEngine) -> None:
        """全部子任务 succeeded → 跳过 LLM，直接返回满分。"""
        from src.planner.plan import PlanResult

        plan = PlanResult(
            subtasks=[
                {"id": "1", "description": "分析数据", "depends_on": []},
                {"id": "2", "description": "生成报告", "depends_on": ["1"]},
            ],
            rationale="先分析后报告",
            confidence=0.9,
        )
        run_id = store.insert_plan("s1", "分析数据生成报告", "指令", plan)
        # 将子任务全部设为 succeeded
        store.update_subtask(run_id, "1", "succeeded")
        store.update_subtask(run_id, "2", "succeeded")

        result, trace = engine.post_mortem(run_id)
        assert result.deviations == []
        assert result.plan_quality_score == 1.0
        assert result.confidence == 1.0
        assert "所有子任务均已成功执行" in result.improvement_suggestions[0]

    def test_deviations_llm_fallback(self, store: MemoryStore, engine: ReflectionEngine) -> None:
        """有偏差但 LLM 不可用 → 返回偏差 + fallback 建议。"""
        from src.planner.plan import PlanResult

        plan = PlanResult(
            subtasks=[
                {"id": "1", "description": "分析数据", "depends_on": []},
                {"id": "2", "description": "部署", "depends_on": ["1"]},
            ],
            rationale="先分析后部署",
            confidence=0.8,
        )
        run_id = store.insert_plan("s2", "分析并部署", "指令", plan)
        store.update_subtask(run_id, "1", "succeeded")
        store.update_subtask(run_id, "2", "failed")

        # 模拟 LLM 不可用
        with patch.object(engine, "_post_mortem_via_api", side_effect=RuntimeError("API 超时")):
            result, trace = engine.post_mortem(run_id)
            assert len(result.deviations) == 1
            assert result.deviations[0].deviation_type == "failed"
            assert "部署" in result.deviations[0].detail
            # LLM 不可用时仍返回 fallback 建议
            assert len(result.improvement_suggestions) >= 1


class TestPostMortemDisabled:
    """plan_generation_enabled=False → 跳过事后总结。"""

    def test_disabled_returns_default(self, store: MemoryStore, engine: ReflectionEngine) -> None:
        with patch("src.planner.reflection.settings") as mock_settings:
            mock_settings.plan_generation_enabled = False
            result, trace = engine.post_mortem(42)
            assert len(result.improvement_suggestions) == 1
            assert "已禁用" in result.improvement_suggestions[0]
            assert result.deviations == []


# ── ReflectionInsight dataclass ──


class TestReflectionInsight:
    """ReflectionInsight 默认值与构造。"""

    def test_defaults(self) -> None:
        ri = ReflectionInsight()
        assert ri.insight_type == ""
        assert ri.title == ""
        assert ri.description == ""
        assert ri.source_plan_ids == []
        assert ri.confidence == 0.5
        assert ri.occurrence_count == 1

    def test_explicit_construction(self) -> None:
        ri = ReflectionInsight(
            insight_type="failure_pattern",
            title="部署前未验证环境配置",
            description="多项任务在部署阶段失败，根因是缺少环境配置预检步骤。",
            source_plan_ids=[1, 3, 5],
            confidence=0.85,
            occurrence_count=3,
        )
        assert ri.insight_type == "failure_pattern"
        assert ri.title == "部署前未验证环境配置"
        assert len(ri.source_plan_ids) == 3
        assert ri.confidence == 0.85
        assert ri.occurrence_count == 3


# ── _parse_meta_knowledge 三阶回退 ──


class TestParseMetaKnowledge:
    """_parse_meta_knowledge 静态方法：insights / templates 双格式 + 三阶回退。"""

    def test_valid_json_insights(self) -> None:
        raw = json.dumps(
            {
                "insights": [
                    {
                        "insight_type": "failure_pattern",
                        "title": "环境配置缺失",
                        "description": "缺少环境预检步骤导致部署失败。",
                        "confidence": 0.9,
                    },
                    {
                        "insight_type": "improvement_pattern",
                        "title": "增加重试机制",
                        "description": "对网络相关子任务增加指数退避重试。",
                        "confidence": 0.75,
                    },
                ]
            }
        )
        result, error = ReflectionEngine._parse_meta_knowledge(raw)
        assert error is None
        assert len(result) == 2
        assert result[0]["insight_type"] == "failure_pattern"
        assert result[0]["title"] == "环境配置缺失"
        assert result[0]["confidence"] == 0.9
        assert result[1]["insight_type"] == "improvement_pattern"
        assert result[1]["title"] == "增加重试机制"

    def test_valid_json_templates(self) -> None:
        """distill_plan_template 使用 "templates" 键。"""
        raw = json.dumps(
            {
                "templates": [
                    {
                        "insight_type": "best_practice",
                        "title": "部署三板斧",
                        "description": "预检→灰度→全量，步步验证。",
                        "confidence": 0.88,
                    },
                ]
            }
        )
        result, error = ReflectionEngine._parse_meta_knowledge(raw)
        assert error is None
        assert len(result) == 1
        assert result[0]["insight_type"] == "best_practice"
        assert result[0]["title"] == "部署三板斧"

    def test_block_extract_fallback(self) -> None:
        """JSON 嵌入在 prose 文本中。"""
        raw = (
            "以下是元知识分析：\n"
            + json.dumps(
                {
                    "insights": [
                        {
                            "insight_type": "failure_pattern",
                            "title": "测试覆盖不足",
                            "description": "缺少集成测试导致回归。",
                            "confidence": 0.7,
                        },
                    ]
                }
            )
            + "\n分析完毕。"
        )
        result, error = ReflectionEngine._parse_meta_knowledge(raw)
        assert error is None
        assert len(result) == 1
        assert result[0]["title"] == "测试覆盖不足"

    def test_garbage_fallback(self) -> None:
        """完全无法解析的输入返回空列表。"""
        raw = "这不是有效的 JSON"
        result, error = ReflectionEngine._parse_meta_knowledge(raw)
        assert error is not None
        assert "JSON 解析失败" in error
        assert result == []

    def test_empty_insights_key(self) -> None:
        """JSON 合法但 insights 为空数组。"""
        raw = '{"insights":[]}'
        result, error = ReflectionEngine._parse_meta_knowledge(raw)
        assert error is None
        assert result == []

    def test_malformed_fields_filtered(self) -> None:
        """数组中包含无 title 或非 dict 元素时过滤。"""
        raw = json.dumps(
            {
                "insights": [
                    {"title": "有效洞察", "description": "说明", "confidence": 0.8},
                    {"description": "无标题的项", "confidence": 0.5},  # 缺少 title
                    {"title": "", "description": "空标题", "confidence": 0.5},  # 空 title
                ]
            }
        )
        result, error = ReflectionEngine._parse_meta_knowledge(raw)
        assert error is None
        assert len(result) == 1
        assert result[0]["title"] == "有效洞察"


# ── extract_meta_knowledge 集成 ──


class TestExtractMetaKnowledge:
    """extract_meta_knowledge() 端到端集成测试。"""

    def test_no_plans_returns_empty(self, store: MemoryStore, engine: ReflectionEngine) -> None:
        """无计划记录 → 空结果。"""
        insights, trace = engine.extract_meta_knowledge(num_recent_plans=10)
        assert insights == []
        assert trace["total_plans"] == 0

    def test_all_succeeded_no_deviations(
        self, store: MemoryStore, engine: ReflectionEngine
    ) -> None:
        """所有计划全部成功 → 无偏差可提取 → 空结果。"""
        from src.planner.plan import PlanResult

        plan = PlanResult(
            subtasks=[
                {"id": "1", "description": "分析", "depends_on": []},
                {"id": "2", "description": "报告", "depends_on": ["1"]},
            ],
            rationale="先分析后报告",
            confidence=0.9,
        )
        run_id = store.insert_plan("s_mk", "分析生成报告", "指令", plan)
        store.update_subtask(run_id, "1", "succeeded")
        store.update_subtask(run_id, "2", "succeeded")

        insights, trace = engine.extract_meta_knowledge(num_recent_plans=10)
        assert insights == []

    def test_llm_returns_insights(self, store: MemoryStore, engine: ReflectionEngine) -> None:
        """有偏差的计划 → LLM 返回 insights → 正确解析 + 持久化。"""
        from src.planner.plan import PlanResult

        # 插入 2 个有偏差的计划
        p1 = PlanResult(
            subtasks=[
                {"id": "1", "description": "部署", "depends_on": []},
                {"id": "2", "description": "验证", "depends_on": ["1"]},
            ],
            rationale="部署后验证",
            confidence=0.8,
        )
        rid1 = store.insert_plan("s_mk2", "部署服务", "指令", p1)
        store.update_subtask(rid1, "1", "succeeded")
        store.update_subtask(rid1, "2", "failed")

        p2 = PlanResult(
            subtasks=[
                {"id": "1", "description": "备份", "depends_on": []},
                {"id": "2", "description": "迁移", "depends_on": ["1"]},
            ],
            rationale="先备份后迁移",
            confidence=0.7,
        )
        rid2 = store.insert_plan("s_mk3", "迁移数据库", "指令", p2)
        store.update_subtask(rid2, "1", "succeeded")
        store.update_subtask(rid2, "2", "failed")

        with patch.object(engine, "_meta_knowledge_via_api") as mock_api:
            mock_api.return_value = (
                [
                    ReflectionInsight(
                        insight_type="failure_pattern",
                        title="关键子任务缺少预检",
                        description="部署和迁移的第二步均在无环境预检时失败。",
                        source_plan_ids=[rid1, rid2],
                        confidence=0.85,
                    ),
                ],
                {"llm_called": True, "insights_extracted": 1},
            )
            insights, trace = engine.extract_meta_knowledge(num_recent_plans=10)
            assert len(insights) == 1
            assert insights[0].insight_type == "failure_pattern"
            assert insights[0].title == "关键子任务缺少预检"
            assert trace["llm_called"] is True or "llm_called" in str(trace)

    def test_llm_unavailable_fallback(self, store: MemoryStore, engine: ReflectionEngine) -> None:
        """有偏差但 LLM 不可用 → 返回空列表（不崩溃）。"""
        from src.planner.plan import PlanResult

        plan = PlanResult(
            subtasks=[
                {"id": "1", "description": "分析", "depends_on": []},
                {"id": "2", "description": "报告", "depends_on": ["1"]},
            ],
            rationale="分析后报告",
            confidence=0.8,
        )
        rid = store.insert_plan("s_mk4", "生成报告", "指令", plan)
        store.update_subtask(rid, "1", "succeeded")
        store.update_subtask(rid, "2", "failed")

        # 至少需要 2 个计划，再插一个
        store.insert_plan("s_mk5", "另一个任务", "指令", plan)

        with patch.object(engine, "_meta_knowledge_via_api", side_effect=RuntimeError("API 超时")):
            insights, trace = engine.extract_meta_knowledge(num_recent_plans=10)
            assert insights == []


# ── distill_plan_template 集成 ──


class TestDistillPlanTemplate:
    """distill_plan_template() 端到端集成测试。"""

    def test_no_successful_plans(self, store: MemoryStore, engine: ReflectionEngine) -> None:
        """无全部成功的计划 → 空结果。"""
        from src.planner.plan import PlanResult

        plan = PlanResult(
            subtasks=[
                {"id": "1", "description": "部署", "depends_on": []},
                {"id": "2", "description": "验证", "depends_on": ["1"]},
            ],
            rationale="部署后验证",
            confidence=0.8,
        )
        rid = store.insert_plan("s_dt1", "部署", "指令", plan)
        store.update_subtask(rid, "1", "succeeded")
        # subtask 2 stays pending — not all succeeded
        store.update_subtask(rid, "2", "pending")

        insights, trace = engine.distill_plan_template(limit=10)
        assert insights == []
        assert trace["successful_plans"] == 0

    def test_llm_returns_templates(self, store: MemoryStore, engine: ReflectionEngine) -> None:
        """有全部成功的计划 → LLM 返回模板 → 正确解析。"""
        from src.planner.plan import PlanResult

        plan = PlanResult(
            subtasks=[
                {"id": "1", "description": "分析数据", "depends_on": []},
                {"id": "2", "description": "生成报告", "depends_on": ["1"]},
            ],
            rationale="先分析后报告",
            confidence=0.9,
        )
        rid = store.insert_plan("s_dt2", "分析并生成报告", "指令", plan)
        store.update_subtask(rid, "1", "succeeded")
        store.update_subtask(rid, "2", "succeeded")

        with patch.object(engine, "_distill_via_api") as mock_api:
            mock_api.return_value = (
                [
                    ReflectionInsight(
                        insight_type="best_practice",
                        title="分析→报告两段式",
                        description="先数据收集分析，再汇总生成报告。",
                        source_plan_ids=[rid],
                        confidence=0.9,
                    ),
                ],
                {"llm_called": True, "templates_extracted": 1},
            )
            insights, trace = engine.distill_plan_template(limit=10)
            assert len(insights) == 1
            assert insights[0].insight_type == "best_practice"
            assert insights[0].title == "分析→报告两段式"

    def test_distill_llm_unavailable_fallback(
        self, store: MemoryStore, engine: ReflectionEngine
    ) -> None:
        """有成功计划但 LLM 不可用 → 返回空列表（不崩溃）。"""
        from src.planner.plan import PlanResult

        plan = PlanResult(
            subtasks=[
                {"id": "1", "description": "分析", "depends_on": []},
            ],
            rationale="简单分析",
            confidence=0.9,
        )
        rid = store.insert_plan("s_dt3", "数据分析", "指令", plan)
        store.update_subtask(rid, "1", "succeeded")

        with patch.object(engine, "_distill_via_api", side_effect=RuntimeError("API 超时")):
            insights, trace = engine.distill_plan_template(limit=10)
            assert insights == []


# ── MetaKnowledge 禁用标志 ──


class TestMetaKnowledgeDisabled:
    """plan_generation_enabled=False → 跳过元知识提取和计划蒸馏。"""

    def test_extract_meta_knowledge_disabled(self, engine: ReflectionEngine) -> None:
        with patch("src.planner.reflection.settings") as mock_settings:
            mock_settings.plan_generation_enabled = False
            insights, trace = engine.extract_meta_knowledge()
            assert insights == []
            assert trace == {}

    def test_distill_plan_template_disabled(self, engine: ReflectionEngine) -> None:
        with patch("src.planner.reflection.settings") as mock_settings:
            mock_settings.plan_generation_enabled = False
            insights, trace = engine.distill_plan_template()
            assert insights == []
            assert trace == {}


# ── ReflectionInsights Store CRUD ──


class TestReflectionInsightsStore:
    """MemoryStore 中 reflection_insights CRUD 方法。"""

    def test_insert_and_list(self, store: MemoryStore) -> None:
        """insert → list 往返正确。"""
        id1 = store.insert_reflection_insight(
            insight_type="failure_pattern",
            title="环境配置缺失",
            description="缺少环境预检步骤。",
            source_plan_ids=[1, 2],
            confidence=0.8,
            occurrence_count=2,
        )
        id2 = store.insert_reflection_insight(
            insight_type="best_practice",
            title="部署三板斧",
            description="预检→灰度→全量。",
            source_plan_ids=[3],
            confidence=0.9,
            occurrence_count=1,
        )
        assert id1 > 0
        assert id2 > 0

        all_insights = store.list_reflection_insights(limit=10)
        assert len(all_insights) >= 2

        # 按类型过滤
        bp_insights = store.list_reflection_insights(insight_type="best_practice", limit=10)
        assert len(bp_insights) >= 1
        assert bp_insights[0]["title"] == "部署三板斧"

    def test_get_by_id(self, store: MemoryStore) -> None:
        """单条查询返回字段完整。"""
        rid = store.insert_reflection_insight(
            insight_type="improvement_pattern",
            title="增加重试机制",
            description="对网络操作增加指数退避重试。",
            source_plan_ids=[5, 7],
            confidence=0.75,
        )
        insight = store.get_reflection_insight(rid)
        assert insight["insight_type"] == "improvement_pattern"
        assert insight["title"] == "增加重试机制"
        assert insight["confidence"] == 0.75

    def test_upsert_new_inserts(self, store: MemoryStore) -> None:
        """upsert 新建不存在的标题 → insert 行为。"""
        rid = store.upsert_reflection_insight(
            insight_type="failure_pattern",
            title="全新模式",
            description="第一次观测到。",
            source_plan_ids=[10],
            confidence=0.6,
        )
        assert rid > 0
        insight = store.get_reflection_insight(rid)
        assert insight["title"] == "全新模式"
        assert insight["occurrence_count"] == 1

    def test_upsert_existing_updates(self, store: MemoryStore) -> None:
        """upsert 匹配已有标题 → 累加计数 + 合并 source_ids + 平均置信度。"""
        # 先插入
        store.insert_reflection_insight(
            insight_type="failure_pattern",
            title="重复模式",
            description="第一次出现。",
            source_plan_ids=[1],
            confidence=0.6,
            occurrence_count=1,
        )
        # 再次 upsert 相同标题
        rid = store.upsert_reflection_insight(
            insight_type="failure_pattern",
            title="重复模式",
            description="第二次出现，更详细的描述。",
            source_plan_ids=[2, 3],
            confidence=0.8,
        )
        insight = store.get_reflection_insight(rid)
        assert insight["occurrence_count"] == 2
        # 置信度取平均: (0.6 + 0.8) / 2 = 0.7
        assert insight["confidence"] == 0.7
        # source_plan_ids 合并: [1, 2, 3]
        source_ids = json.loads(str(insight["source_plan_ids_json"]))
        assert sorted(source_ids) == [1, 2, 3]
        # 描述更新为新的
        assert "第二次" in str(insight["description"])
