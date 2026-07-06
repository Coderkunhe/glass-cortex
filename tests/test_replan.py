"""ReplanDetector 测试 — ReplanResult dataclass + DAG 推导 + 三阶回退解析 + 错误恢复。"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.planner.plan import PlanResult
from src.planner.replan import (
    PartialReplanResult,
    PlanStepRecord,
    ReplanDetector,
    ReplanResult,
    StepStatus,
    _generate_diff_summary,
)


def _dummy_embed(text: str) -> np.ndarray:
    return np.ones(384, dtype=np.float32)


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    s = MemoryStore(str(tmp_path / "test_replan.db"))
    s.init_db()
    return s


@pytest.fixture
def idx() -> IndexManager:
    return IndexManager()


@pytest.fixture
def detector(store: MemoryStore, idx: IndexManager) -> ReplanDetector:
    return ReplanDetector(store, idx, _dummy_embed)


# ── ReplanResult dataclass ──


class TestReplanResult:
    """ReplanResult 默认值与构造。"""

    def test_defaults(self) -> None:
        r = ReplanResult()
        assert r.drift_detected is False
        assert r.drift_reason == ""
        assert r.revised_intent == ""
        assert isinstance(r.revised_plan, PlanResult)
        assert r.diff_summary == ""
        assert r.confidence == 0.3

    def test_explicit_construction(self) -> None:
        plan = PlanResult(
            subtasks=[{"id": "1", "description": "测试步骤"}],
            rationale="修正后的计划",
            confidence=0.85,
        )
        r = ReplanResult(
            drift_detected=True,
            drift_reason="用户修改了需求范围",
            revised_intent="指令",
            revised_plan=plan,
            diff_summary="新增1步; 删除0步",
            confidence=0.85,
        )
        assert r.drift_detected is True
        assert r.drift_reason == "用户修改了需求范围"
        assert r.revised_intent == "指令"
        assert r.revised_plan.subtasks == plan.subtasks
        assert r.diff_summary == "新增1步; 删除0步"


# ── _generate_diff_summary ──


class TestGenerateDiffSummary:
    """差异摘要生成 — 纯函数测试。"""

    def test_no_changes(self) -> None:
        orig: list[dict[str, object]] = [{"id": "1", "description": "写邮件"}]
        rev: list[dict[str, object]] = [{"id": "1", "description": "写邮件"}]
        result = _generate_diff_summary(orig, rev)
        assert "无显著变化" in result

    def test_added_steps(self) -> None:
        orig: list[dict[str, object]] = [{"id": "1", "description": "写邮件"}]
        rev: list[dict[str, object]] = [
            {"id": "1", "description": "写邮件"},
            {"id": "2", "description": "预览确认"},
        ]
        result = _generate_diff_summary(orig, rev)
        assert "新增 1 步" in result
        assert "预览确认" in result

    def test_removed_steps(self) -> None:
        orig: list[dict[str, object]] = [
            {"id": "1", "description": "写邮件"},
            {"id": "2", "description": "发送确认"},
        ]
        rev: list[dict[str, object]] = [{"id": "1", "description": "写邮件"}]
        result = _generate_diff_summary(orig, rev)
        assert "删除 1 步" in result
        assert "发送确认" in result

    def test_count_change(self) -> None:
        orig: list[dict[str, object]] = [{"id": "1", "description": "A"}]
        rev: list[dict[str, object]] = [
            {"id": "1", "description": "B"},
            {"id": "2", "description": "C"},
        ]
        result = _generate_diff_summary(orig, rev)
        assert "1→2" in result

    def test_empty_inputs(self) -> None:
        result = _generate_diff_summary([], [])
        assert "无显著变化" in result

    def test_missing_description_field(self) -> None:
        orig: list[dict[str, object]] = [{"id": "1"}]  # no description
        rev: list[dict[str, object]] = [{"id": "1", "description": "test"}]
        result = _generate_diff_summary(orig, rev)
        assert "新增 1 步" in result


# ── _parse_replan 三阶回退 ──


class TestParseReplan:
    """静态方法 _parse_replan — 三阶容错解析。"""

    def test_valid_json_no_drift(self) -> None:
        raw = json.dumps(
            {
                "drift_detected": False,
                "revised_intent": "提问",
                "subtasks": [],
                "rationale": "无变化",
                "confidence": 0.9,
            }
        )
        result, error = ReplanDetector._parse_replan(raw, "提问")
        assert error is None
        assert result.drift_detected is False
        assert result.revised_intent == "提问"
        assert result.confidence == 0.9

    def test_valid_json_drift_detected(self) -> None:
        raw = json.dumps(
            {
                "drift_detected": True,
                "drift_reason": "用户从提问切换为指令",
                "revised_intent": "指令",
                "subtasks": [
                    {"id": "1", "description": "检索相关对话"},
                    {"id": "2", "description": "生成回复", "depends_on": ["1"]},
                ],
                "rationale": "需要先检索再生成",
                "confidence": 0.88,
            }
        )
        result, error = ReplanDetector._parse_replan(raw, "提问")
        assert error is None
        assert result.drift_detected is True
        assert result.drift_reason == "用户从提问切换为指令"
        assert result.revised_intent == "指令"
        assert len(result.revised_plan.subtasks) == 2
        assert len(result.revised_plan.dag_edges) == 1
        assert result.confidence == 0.88

    def test_block_extract_fallback(self) -> None:
        raw = (
            "好的，检测结果如下：\n"
            '{"drift_detected": true, "drift_reason": "意图变化",'
            '"revised_intent": "探索", "subtasks": [],'
            '"rationale": "test", "confidence": 0.7}\n'
            "以上是结果。"
        )
        result, error = ReplanDetector._parse_replan(raw, "提问")
        assert error is None
        assert result.drift_detected is True
        assert result.drift_reason == "意图变化"
        assert result.revised_intent == "探索"

    def test_garbage_fallback(self) -> None:
        result, error = ReplanDetector._parse_replan("这不是有效的 JSON", "提问")
        assert error is not None
        assert "JSON 解析失败" in error
        assert result.drift_detected is False
        assert result.revised_intent == "提问"  # fallback to original

    def test_confidence_clamp(self) -> None:
        raw = json.dumps(
            {
                "drift_detected": True,
                "drift_reason": "test",
                "revised_intent": "指令",
                "subtasks": [],
                "rationale": "",
                "confidence": 3.7,  # > 1.0 → clamp to 1.0
            }
        )
        result, _ = ReplanDetector._parse_replan(raw, "提问")
        assert result.confidence == 1.0

        raw2 = json.dumps(
            {
                "drift_detected": True,
                "drift_reason": "test",
                "revised_intent": "指令",
                "subtasks": [],
                "rationale": "",
                "confidence": -0.5,  # < 0.0 → clamp to 0.0
            }
        )
        result2, _ = ReplanDetector._parse_replan(raw2, "提问")
        assert result2.confidence == 0.0

    def test_truncation_8_max(self) -> None:
        subtasks = [{"id": str(i), "description": f"步骤{i}"} for i in range(1, 12)]
        raw = json.dumps(
            {
                "drift_detected": True,
                "drift_reason": "长计划",
                "revised_intent": "指令",
                "subtasks": subtasks,
                "rationale": "",
                "confidence": 0.5,
            }
        )
        result, _ = ReplanDetector._parse_replan(raw, "提问")
        assert len(result.revised_plan.subtasks) == 8  # truncated

    def test_malformed_subtask_skipped(self) -> None:
        raw = json.dumps(
            {
                "drift_detected": True,
                "drift_reason": "test",
                "revised_intent": "指令",
                "subtasks": [
                    {"id": "1", "description": "good"},
                    {"no_id": True},  # missing required fields → skip
                    {"id": "3", "description": "also good"},
                ],
                "rationale": "",
                "confidence": 0.5,
            }
        )
        result, _ = ReplanDetector._parse_replan(raw, "提问")
        assert len(result.revised_plan.subtasks) == 2


# ── 错误恢复 ──


class TestReplanErrorRecovery:
    """API 调用失败时优雅降级。"""

    def test_api_error_graceful(self, detector: ReplanDetector) -> None:
        detector._client = MagicMock()
        detector._client.chat.completions.create.side_effect = RuntimeError("API 不可用")
        original_plan = PlanResult()
        result, trace = detector.detect_replan(
            "帮我写邮件", "指令", original_plan, "算了，先查下资料"
        )
        assert result.drift_detected is False
        assert "检测不可用" in result.drift_reason
        assert result.revised_intent == "指令"


# ── 禁用状态 ──


class TestReplanDisabled:
    """plan_generation_enabled=False 时跳过检测。"""

    def test_disabled_returns_no_drift(self, detector: ReplanDetector) -> None:
        with patch("src.planner.replan.settings") as mock_settings:
            mock_settings.plan_generation_enabled = False
            original_plan = PlanResult()
            result, trace = detector.detect_replan("原始消息", "提问", original_plan, "修正消息")
            assert result.drift_detected is False
            assert "已禁用" in result.drift_reason


# ── Phase 57 B1: StepStatus + PlanStepRecord + 步骤监控 ──


class TestStepStatus:
    """StepStatus 枚举值完整性。"""

    def test_all_statuses_exist(self) -> None:
        assert StepStatus.PENDING.value == "pending"
        assert StepStatus.RUNNING.value == "running"
        assert StepStatus.SUCCESS.value == "success"
        assert StepStatus.FAILED.value == "failed"
        assert StepStatus.SKIPPED.value == "skipped"

    def test_terminal_statuses(self) -> None:
        """SUCCESS / FAILED / SKIPPED 为终态。"""
        terminal = {StepStatus.SUCCESS, StepStatus.FAILED, StepStatus.SKIPPED}
        assert StepStatus.RUNNING not in terminal
        assert StepStatus.PENDING not in terminal


class TestPlanStepRecord:
    """PlanStepRecord 数据类默认值与构造。"""

    def test_defaults(self) -> None:
        rec = PlanStepRecord(step_id="1", description="写邮件")
        assert rec.step_id == "1"
        assert rec.description == "写邮件"
        assert rec.status == StepStatus.PENDING
        assert rec.started_at is None
        assert rec.completed_at is None
        assert rec.output_summary == ""
        assert rec.error_message == ""
        assert rec.retry_count == 0

    def test_full_construction(self) -> None:
        rec = PlanStepRecord(
            step_id="2",
            description="发送确认",
            status=StepStatus.SUCCESS,
            started_at=1000.0,
            completed_at=1005.5,
            output_summary="邮件已发送",
            error_message="",
            retry_count=1,
        )
        assert rec.step_id == "2"
        assert rec.status == StepStatus.SUCCESS
        assert rec.started_at == 1000.0
        assert rec.completed_at == 1005.5
        assert rec.output_summary == "邮件已发送"
        assert rec.retry_count == 1

    def test_mutable_status_transition(self) -> None:
        """PlanStepRecord 为非 frozen dataclass，允许状态转换。"""
        rec = PlanStepRecord(step_id="1", description="检索")
        assert rec.status == StepStatus.PENDING
        rec.status = StepStatus.RUNNING
        rec.started_at = 2000.0
        assert rec.status == StepStatus.RUNNING
        rec.status = StepStatus.SUCCESS
        rec.completed_at = 2003.0
        rec.output_summary = "检索完成"
        assert rec.status == StepStatus.SUCCESS


class TestMonitorStep:
    """monitor_step() 钩子 — 记录与更新步骤状态。"""

    def test_new_step_pending(self, detector: ReplanDetector) -> None:
        rec = detector.monitor_step("1", StepStatus.PENDING, description="检索资料")
        assert rec.step_id == "1"
        assert rec.status == StepStatus.PENDING
        assert len(detector._step_records) == 1

    def test_new_step_running_sets_started_at(self, detector: ReplanDetector) -> None:
        rec = detector.monitor_step("1", StepStatus.RUNNING, description="检索资料")
        assert rec.status == StepStatus.RUNNING
        assert rec.started_at is not None

    def test_new_step_terminal_sets_completed_at(self, detector: ReplanDetector) -> None:
        rec = detector.monitor_step(
            "1", StepStatus.SUCCESS, description="检索资料", output_summary="找到 5 条"
        )
        assert rec.status == StepStatus.SUCCESS
        assert rec.completed_at is not None
        assert rec.output_summary == "找到 5 条"

    def test_new_step_failed_with_error(self, detector: ReplanDetector) -> None:
        rec = detector.monitor_step(
            "1", StepStatus.FAILED, description="发送请求", error_message="Connection timeout"
        )
        assert rec.status == StepStatus.FAILED
        assert rec.completed_at is not None
        assert rec.error_message == "Connection timeout"

    def test_status_transition_pending_to_success(self, detector: ReplanDetector) -> None:
        detector.monitor_step("1", StepStatus.PENDING, description="写代码")
        rec = detector.monitor_step("1", StepStatus.SUCCESS, output_summary="代码已生成")
        assert rec.status == StepStatus.SUCCESS
        assert rec.completed_at is not None
        assert rec.output_summary == "代码已生成"
        # 只应有一条记录（更新而非新建）
        assert len(detector._step_records) == 1

    def test_status_transition_running_to_failed(self, detector: ReplanDetector) -> None:
        detector.monitor_step("3", StepStatus.RUNNING, description="部署")
        rec = detector.monitor_step("3", StepStatus.FAILED, error_message="部署超时")
        assert rec.status == StepStatus.FAILED
        assert rec.started_at is not None  # 保留 RUNNING 时设置的时间
        assert rec.completed_at is not None
        assert rec.error_message == "部署超时"
        assert len(detector._step_records) == 1

    def test_multiple_steps_independent(self, detector: ReplanDetector) -> None:
        detector.monitor_step("1", StepStatus.SUCCESS, description="检索")
        detector.monitor_step("2", StepStatus.RUNNING, description="分析")
        detector.monitor_step("3", StepStatus.FAILED, description="生成", error_message="OOM")
        assert len(detector._step_records) == 3

    def test_description_not_overwritten_on_update(self, detector: ReplanDetector) -> None:
        detector.monitor_step("1", StepStatus.PENDING, description="原始描述")
        rec = detector.monitor_step("1", StepStatus.SUCCESS, output_summary="done")
        # 更新时不传 description（空字符串），应保留已有值
        assert rec.description == "原始描述"


class TestGetStepSummary:
    """get_step_summary() — 按状态聚合计数。"""

    def test_empty_summary(self, detector: ReplanDetector) -> None:
        s = detector.get_step_summary()
        assert s == {"pending": 0, "running": 0, "success": 0, "failed": 0, "skipped": 0}

    def test_mixed_status_summary(self, detector: ReplanDetector) -> None:
        detector.monitor_step("1", StepStatus.SUCCESS, description="a")
        detector.monitor_step("2", StepStatus.SUCCESS, description="b")
        detector.monitor_step("3", StepStatus.FAILED, description="c", error_message="err")
        detector.monitor_step("4", StepStatus.PENDING, description="d")
        detector.monitor_step("5", StepStatus.RUNNING, description="e")
        s = detector.get_step_summary()
        assert s["success"] == 2
        assert s["failed"] == 1
        assert s["pending"] == 1
        assert s["running"] == 1
        assert s["skipped"] == 0

    def test_summary_reflects_transitions(self, detector: ReplanDetector) -> None:
        detector.monitor_step("1", StepStatus.PENDING, description="x")
        assert detector.get_step_summary()["pending"] == 1
        detector.monitor_step("1", StepStatus.SUCCESS)
        # PENDING → SUCCESS，pending 减 1，success 加 1
        s = detector.get_step_summary()
        assert s["pending"] == 0
        assert s["success"] == 1


class TestResetMonitor:
    """reset_monitor() — 清空所有步骤记录。"""

    def test_reset_clears_records(self, detector: ReplanDetector) -> None:
        detector.monitor_step("1", StepStatus.SUCCESS, description="a")
        detector.monitor_step("2", StepStatus.FAILED, description="b", error_message="err")
        assert len(detector._step_records) == 2

        detector.reset_monitor()
        assert len(detector._step_records) == 0
        s = detector.get_step_summary()
        assert s["success"] == 0
        assert s["failed"] == 0

    def test_reset_then_new_plan(self, detector: ReplanDetector) -> None:
        detector.monitor_step("1", StepStatus.SUCCESS, description="旧计划步骤")
        detector.reset_monitor()
        detector.monitor_step("1", StepStatus.PENDING, description="新计划步骤")
        assert len(detector._step_records) == 1
        assert detector._step_records[0].description == "新计划步骤"


# ── Phase 57 B2: PartialReplanResult + generate_partial_replan ──


class TestPartialReplanResult:
    """PartialReplanResult 数据类默认值与构造。"""

    def test_defaults(self) -> None:
        r = PartialReplanResult()
        assert isinstance(r.revised_plan, PlanResult)
        assert r.kept_step_ids == []
        assert r.replaced_step_ids == []
        assert r.no_replan_needed is False

    def test_no_replan_needed_flag(self) -> None:
        plan = PlanResult(subtasks=[{"id": "1", "description": "检索"}])
        r = PartialReplanResult(
            revised_plan=plan,
            kept_step_ids=["1"],
            replaced_step_ids=[],
            no_replan_needed=True,
        )
        assert r.no_replan_needed is True
        assert r.kept_step_ids == ["1"]
        assert r.replaced_step_ids == []

    def test_partial_replan_with_replacements(self) -> None:
        plan = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索（保留）"},
                {"id": "2", "description": "分析（替换）"},
            ],
            rationale="局部重规划",
            confidence=0.8,
        )
        r = PartialReplanResult(
            revised_plan=plan,
            kept_step_ids=["1"],
            replaced_step_ids=["2"],
        )
        assert len(r.revised_plan.subtasks) == 2
        assert r.kept_step_ids == ["1"]
        assert r.replaced_step_ids == ["2"]


class TestGeneratePartialReplan:
    """generate_partial_replan() — 局部重规划主入口。"""

    def test_all_success_no_replan_needed(self, detector: ReplanDetector) -> None:
        """所有步骤成功 → no_replan_needed=True，不做 LLM 调用。"""
        detector.monitor_step("1", StepStatus.SUCCESS, description="检索", output_summary="找到3条")
        detector.monitor_step(
            "2", StepStatus.SUCCESS, description="分析", output_summary="分析完成"
        )
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索"},
                {"id": "2", "description": "分析"},
            ]
        )
        result, trace = detector.generate_partial_replan(original)
        assert result.no_replan_needed is True
        assert result.kept_step_ids == ["1", "2"]
        assert result.replaced_step_ids == []
        # 不应调用 LLM
        assert trace == {}

    def test_skipped_steps_treated_as_kept(self, detector: ReplanDetector) -> None:
        """SKIPPED 步骤视为保留（用户主动跳过）。"""
        detector.monitor_step("1", StepStatus.SUCCESS, description="检索")
        detector.monitor_step("2", StepStatus.SKIPPED, description="分析")
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索"},
                {"id": "2", "description": "分析"},
            ]
        )
        result, _ = detector.generate_partial_replan(original)
        assert result.no_replan_needed is True
        assert result.kept_step_ids == ["1", "2"]

    def test_no_monitor_data_returns_original(self, detector: ReplanDetector) -> None:
        """无监控数据 → 无法判断，返回原始计划。"""
        original = PlanResult(subtasks=[{"id": "1", "description": "检索"}])
        result, _ = detector.generate_partial_replan(original)
        assert result.no_replan_needed is True

    def test_disabled_returns_original_with_ids(self, detector: ReplanDetector) -> None:
        """plan_generation_enabled=False → 返回原始计划 + kept/replaced id 列表。"""
        detector.monitor_step("1", StepStatus.SUCCESS, description="检索")
        detector.monitor_step("2", StepStatus.FAILED, description="分析", error_message="超时")
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索"},
                {"id": "2", "description": "分析"},
            ]
        )
        with patch("src.planner.replan.settings") as mock_settings:
            mock_settings.plan_generation_enabled = False
            result, _ = detector.generate_partial_replan(original)
        assert result.no_replan_needed is True
        assert result.kept_step_ids == ["1"]
        assert result.replaced_step_ids == ["2"]

    def test_api_error_fallback(self, detector: ReplanDetector) -> None:
        """LLM 调用失败 → 返回原始计划 + 错误 trace。"""
        detector.monitor_step("1", StepStatus.SUCCESS, description="检索")
        detector.monitor_step("2", StepStatus.FAILED, description="分析", error_message="超时")
        detector._client = MagicMock()
        detector._client.chat.completions.create.side_effect = RuntimeError("API 不可用")
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索"},
                {"id": "2", "description": "分析"},
            ]
        )
        result, trace = detector.generate_partial_replan(original)
        assert result.no_replan_needed is True
        assert result.kept_step_ids == ["1"]
        assert result.replaced_step_ids == ["2"]
        assert "error" in trace

    def test_llm_success_path(self, detector: ReplanDetector) -> None:
        """LLM 返回有效 JSON → 合并保留+替换步骤。"""
        detector.monitor_step("1", StepStatus.SUCCESS, description="检索", output_summary="找到3条")
        detector.monitor_step("2", StepStatus.FAILED, description="分析", error_message="超时")
        detector.monitor_step("3", StepStatus.PENDING, description="生成报告")
        # Mock LLM response
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps(
                        {
                            "subtasks": [
                                {"id": "2", "description": "简化分析", "depends_on": ["1"]},
                                {"id": "3", "description": "简化报告", "depends_on": ["2"]},
                            ],
                            "rationale": "失败步骤降级处理",
                            "confidence": 0.75,
                        }
                    )
                )
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=100, completion_tokens=50)
        detector._client = MagicMock()
        detector._client.chat.completions.create.return_value = mock_response
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索"},
                {"id": "2", "description": "分析"},
                {"id": "3", "description": "生成报告"},
            ]
        )
        result, trace = detector.generate_partial_replan(original)
        assert result.no_replan_needed is False
        assert result.kept_step_ids == ["1"]
        assert result.replaced_step_ids == ["2", "3"]
        # 合并后应有 3 个步骤：1(保留) + 2(替换) + 3(替换)
        assert len(result.revised_plan.subtasks) == 3
        # 步骤1 应保留原始描述
        kept_descs = [t["description"] for t in result.revised_plan.subtasks if t["id"] == "1"]
        assert "检索" in kept_descs
        # 步骤2/3 应为替换描述
        replaced_descs = [
            t["description"] for t in result.revised_plan.subtasks if t["id"] in ("2", "3")
        ]
        assert "简化分析" in replaced_descs
        assert "简化报告" in replaced_descs
        # trace 应包含 LLM 响应信息
        assert "raw_response" in trace
        assert "token_usage" in trace

    def test_with_user_context(self, detector: ReplanDetector) -> None:
        """user_context 传入时 prompt 应包含反馈。"""
        detector.monitor_step("1", StepStatus.SUCCESS, description="检索", output_summary="ok")
        detector.monitor_step("2", StepStatus.FAILED, description="分析", error_message="慢")
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps(
                        {
                            "subtasks": [{"id": "2", "description": "用缓存加速分析"}],
                            "rationale": "根据用户反馈优化",
                            "confidence": 0.8,
                        }
                    )
                )
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=80, completion_tokens=30)
        detector._client = MagicMock()
        detector._client.chat.completions.create.return_value = mock_response
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索"},
                {"id": "2", "description": "分析"},
            ]
        )
        result, trace = detector.generate_partial_replan(original, user_context="太慢了，用缓存")
        assert result.no_replan_needed is False
        # 验证 prompt 包含了 user_context
        assert "太慢了，用缓存" in str(trace["system_prompt"])


class TestMergePartialPlan:
    """_merge_partial_plan() — 合并保留步骤与替换步骤。"""

    def test_keep_all(self) -> None:
        """全部保留，无替换。"""
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索"},
                {"id": "2", "description": "分析"},
            ]
        )
        result = ReplanDetector._merge_partial_plan(original, ["1", "2"], [])
        assert len(result.subtasks) == 2
        assert result.subtasks[0]["id"] == "1"
        assert result.subtasks[1]["id"] == "2"

    def test_keep_some_replace_some(self) -> None:
        """保留步骤1，替换步骤2。"""
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索"},
                {"id": "2", "description": "分析"},
            ]
        )
        replacements: list[dict[str, object]] = [
            {"id": "2", "description": "简化分析", "depends_on": ["1"]},
        ]
        result = ReplanDetector._merge_partial_plan(original, ["1"], replacements)
        assert len(result.subtasks) == 2
        # 步骤1 来自保留
        assert result.subtasks[0]["id"] == "1"
        assert result.subtasks[0]["description"] == "检索"
        # 步骤2 来自替换
        assert result.subtasks[1]["id"] == "2"
        assert result.subtasks[1]["description"] == "简化分析"
        # DAG 边应包含 1→2
        assert ("1", "2") in result.dag_edges

    def test_replace_multiple_with_new_deps(self) -> None:
        """替换多个步骤，保留步骤间依赖。"""
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索"},
                {"id": "2", "description": "分析"},
                {"id": "3", "description": "生成报告"},
            ]
        )
        replacements: list[dict[str, object]] = [
            {"id": "2", "description": "简化分析", "depends_on": ["1"]},
            {"id": "3", "description": "简化报告", "depends_on": ["2"]},
        ]
        result = ReplanDetector._merge_partial_plan(original, ["1"], replacements)
        assert len(result.subtasks) == 3
        assert ("1", "2") in result.dag_edges
        assert ("2", "3") in result.dag_edges

    def test_original_not_mutated(self) -> None:
        """合并不应修改原始 PlanResult。"""
        original = PlanResult(
            subtasks=[
                {"id": "1", "description": "检索", "extra": "保留字段"},
            ]
        )
        replacements: list[dict[str, object]] = [
            {"id": "2", "description": "新步骤"},
        ]
        result = ReplanDetector._merge_partial_plan(original, ["1"], replacements)
        # 原始未变
        assert original.subtasks[0]["description"] == "检索"
        # 合并结果独立
        assert result.subtasks[0]["description"] == "检索"
        result.subtasks[0]["description"] = "修改后"
        assert original.subtasks[0]["description"] == "检索"  # 原始不受影响


class TestBuildPartialReplanPrompt:
    """_build_partial_replan_prompt() — LLM prompt 构建。"""

    def test_prompt_contains_kept_and_failed(self) -> None:
        prompt = ReplanDetector._build_partial_replan_prompt(
            kept_summaries=["  1. 检索 — 找到3条"],
            failed_summaries=["  2. 分析 — 失败: 超时"],
            user_context="",
        )
        assert "检索 — 找到3条" in prompt
        assert "分析 — 失败: 超时" in prompt
        assert "不可改动" in prompt
        assert "需要替换" in prompt

    def test_prompt_includes_user_context(self) -> None:
        prompt = ReplanDetector._build_partial_replan_prompt(
            kept_summaries=["  1. 检索 — 完成"],
            failed_summaries=["  2. 分析 — 失败: OOM"],
            user_context="分析太慢了，简化",
        )
        assert "分析太慢了，简化" in prompt
        assert "用户反馈" in prompt

    def test_prompt_empty_kept(self) -> None:
        prompt = ReplanDetector._build_partial_replan_prompt(
            kept_summaries=[],
            failed_summaries=["  1. 检索 — 未开始"],
            user_context="",
        )
        assert "无已完成步骤" in prompt


class TestParsePartialReplanResponse:
    """_parse_partial_replan_response() — 二阶回退解析。"""

    def test_valid_json(self) -> None:
        raw = json.dumps(
            {
                "subtasks": [
                    {"id": "2", "description": "简化分析", "depends_on": ["1"]},
                    {"id": "3", "description": "生成报告"},
                ],
                "rationale": "合并冗余步骤",
                "confidence": 0.85,
            }
        )
        subtasks, error = ReplanDetector._parse_partial_replan_response(raw)
        assert error is None
        assert len(subtasks) == 2
        assert subtasks[0]["id"] == "2"
        assert subtasks[1]["id"] == "3"

    def test_block_extract_fallback(self) -> None:
        raw = (
            '前言\n{"subtasks": [{"id": "2", "description": "重试分析"}],'
            '"rationale": "test", "confidence": 0.6}\n后记'
        )
        subtasks, error = ReplanDetector._parse_partial_replan_response(raw)
        assert error is None
        assert len(subtasks) == 1
        assert subtasks[0]["id"] == "2"

    def test_garbage_fallback(self) -> None:
        subtasks, error = ReplanDetector._parse_partial_replan_response("这不是 JSON")
        assert error is not None
        assert "JSON 解析失败" in error
        assert subtasks == []

    def test_empty_subtasks(self) -> None:
        raw = json.dumps({"subtasks": [], "rationale": "无需替换", "confidence": 1.0})
        subtasks, error = ReplanDetector._parse_partial_replan_response(raw)
        assert error is None
        assert subtasks == []

    def test_malformed_subtasks_skipped(self) -> None:
        raw = json.dumps(
            {
                "subtasks": [
                    {"id": "2", "description": "good"},
                    {"no_id": True},
                    {"id": "4", "description": "also good"},
                ],
                "rationale": "test",
                "confidence": 0.5,
            }
        )
        subtasks, error = ReplanDetector._parse_partial_replan_response(raw)
        assert error is None
        assert len(subtasks) == 2

    def test_truncation_8_max(self) -> None:
        raw_subtasks = [{"id": str(i), "description": f"s{i}"} for i in range(1, 12)]
        raw = json.dumps({"subtasks": raw_subtasks, "rationale": "", "confidence": 0.5})
        subtasks, _ = ReplanDetector._parse_partial_replan_response(raw)
        assert len(subtasks) == 8
