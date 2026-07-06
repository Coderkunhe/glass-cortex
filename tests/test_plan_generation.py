"""PlanGenerator 单元测试 — L2 任务规划引擎。

覆盖：PlanResult 数据类、DAG 边推导、三阶 JSON 解析回退、
TokenLedger 记录、API 错误优雅降级、空消息处理。
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.planner.plan import PlanGenerator, PlanResult, _derive_dag_edges
from src.token_ledger import TokenLedger


def _dummy_embed(text: str) -> np.ndarray:
    return np.ones(384, dtype=np.float32)


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    s = MemoryStore(str(tmp_path / "test_plan.db"))
    s.init_db()
    return s


@pytest.fixture
def idx() -> IndexManager:
    return IndexManager()


@pytest.fixture
def plan_gen(store: MemoryStore, idx: IndexManager) -> PlanGenerator:
    return PlanGenerator(store, idx, _dummy_embed)


# ── PlanResult ──────────────────────────────────────────────────────────


class TestPlanResult:
    """PlanResult 数据类基本行为。"""

    def test_defaults(self) -> None:
        r = PlanResult()
        assert r.subtasks == []
        assert r.dag_edges == []
        assert r.rationale == ""
        assert r.confidence == 0.3

    def test_full_construction(self) -> None:
        r = PlanResult(
            subtasks=[{"id": "1", "description": "分析数据"}],
            dag_edges=[],
            rationale="简单任务无需分解",
            confidence=0.9,
        )
        assert len(r.subtasks) == 1
        assert r.confidence == 0.9


# ── DAG 边推导 ─────────────────────────────────────────────────────────


class TestDeriveDagEdges:
    """_derive_dag_edges 函数测试。"""

    def test_no_dependencies(self) -> None:
        subtasks: list[dict[str, object]] = [
            {"id": "1", "description": "task 1"},
            {"id": "2", "description": "task 2"},
        ]
        edges = _derive_dag_edges(subtasks)
        assert edges == []

    def test_single_dependency(self) -> None:
        subtasks: list[dict[str, object]] = [
            {"id": "1", "description": "first"},
            {"id": "2", "description": "second", "depends_on": ["1"]},
        ]
        edges = _derive_dag_edges(subtasks)
        assert ("1", "2") in edges
        assert len(edges) == 1

    def test_diamond_dependency(self) -> None:
        subtasks: list[dict[str, object]] = [
            {"id": "1", "description": "start"},
            {"id": "2", "description": "branch a", "depends_on": ["1"]},
            {"id": "3", "description": "branch b", "depends_on": ["1"]},
            {"id": "4", "description": "merge", "depends_on": ["2", "3"]},
        ]
        edges = _derive_dag_edges(subtasks)
        assert len(edges) == 4
        assert ("1", "2") in edges
        assert ("1", "3") in edges
        assert ("2", "4") in edges
        assert ("3", "4") in edges

    def test_ignores_missing_dep_target(self) -> None:
        subtasks: list[dict[str, object]] = [
            {"id": "1", "description": "only task", "depends_on": ["999"]},
        ]
        edges = _derive_dag_edges(subtasks)
        assert edges == []  # 引用不存在的任务，安全忽略

    def test_empty_subtasks(self) -> None:
        assert _derive_dag_edges([]) == []

    def test_depends_on_not_a_list(self) -> None:
        subtasks: list[dict[str, object]] = [
            {"id": "1", "description": "task", "depends_on": "not_a_list"},
        ]
        edges = _derive_dag_edges(subtasks)
        assert edges == []  # 非列表 depends_on 安全忽略


# ── _parse_plan 解析 ────────────────────────────────────────────────────


class TestParsePlan:
    """三阶回退解析测试。"""

    def test_parses_valid_json(self) -> None:
        raw = (
            '{"subtasks":[{"id":"1","description":"获取数据"},'
            '{"id":"2","description":"分析","depends_on":["1"]}],'
            '"rationale":"先取数据再分析","confidence":0.9}'
        )
        result, error = PlanGenerator._parse_plan(raw)
        assert error is None
        assert len(result.subtasks) == 2
        assert result.rationale == "先取数据再分析"
        assert result.confidence == 0.9

    def test_fallback_extract_json_block(self) -> None:
        raw = (
            '前缀文本 {"subtasks":[{"id":"1","description":"单任务"}],'
            '"rationale":"简单","confidence":0.8} 后缀文本'
        )
        result, error = PlanGenerator._parse_plan(raw)
        assert error is None
        assert len(result.subtasks) == 1
        assert result.confidence == 0.8

    def test_fallback_on_garbage(self) -> None:
        raw = "asdfghjkl"
        result, error = PlanGenerator._parse_plan(raw)
        assert error is not None
        assert result.subtasks == []
        assert result.confidence == 0.3

    def test_clamps_confidence_0_1(self) -> None:
        raw = '{"subtasks":[],"rationale":"test","confidence":2.5}'
        result, _ = PlanGenerator._parse_plan(raw)
        assert result.confidence == 1.0

        raw = '{"subtasks":[],"rationale":"test","confidence":-0.5}'
        result, _ = PlanGenerator._parse_plan(raw)
        assert result.confidence == 0.0

    def test_truncates_excess_subtasks(self) -> None:
        """超过 _MAX_SUBTASKS 的子任务被截断。"""
        tasks = [{"id": str(i), "description": f"task {i}"} for i in range(20)]
        raw = f'{{"subtasks":{tasks},"rationale":"many","confidence":0.7}}'
        result, _ = PlanGenerator._parse_plan(raw)
        assert len(result.subtasks) <= 8  # _MAX_SUBTASKS

    def test_skips_malformed_subtasks(self) -> None:
        """缺少 id 或 description 的子任务被跳过。"""
        raw = (
            '{"subtasks":['
            '{"no_id":"x","description":"bad"},'
            '{"id":"1","description":"good"},'
            '{"id":"2"}'
            '],"rationale":"mixed","confidence":0.6}'
        )
        result, _ = PlanGenerator._parse_plan(raw)
        assert len(result.subtasks) == 1
        assert result.subtasks[0]["id"] == "1"

    def test_empty_json_object(self) -> None:
        result, _ = PlanGenerator._parse_plan("{}")
        assert result.subtasks == []
        assert result.rationale == ""
        assert result.confidence == 0.5  # _DEFAULT_CONFIDENCE


# ── Ledger 记录 ───────────────────────────────────────────────────────


class TestPlanLedger:
    """TokenLedger 集成测试。"""

    def test_records_tokens_to_ledger(self, store: MemoryStore, idx: IndexManager) -> None:
        ledger = TokenLedger()
        pg = PlanGenerator(store, idx, _dummy_embed)
        pg.set_ledger(ledger)

        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content='{"subtasks":[{"id":"1","description":"test"}],'
                    '"rationale":"ok","confidence":0.9}'
                )
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=100, completion_tokens=30, total_tokens=130)
        pg._client = MagicMock()
        pg._client.chat.completions.create.return_value = mock_response

        result, trace = pg.generate_plan("测试消息")
        assert len(result.subtasks) == 1
        usage = ledger.last_usage
        assert usage is not None
        assert usage.call_point == "plan_generator"
        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 30


# ── 错误恢复 ─────────────────────────────────────────────────────────


class TestPlanErrorRecovery:
    """API 失败时优雅降级测试。"""

    def test_returns_empty_plan_on_api_error(self, store: MemoryStore, idx: IndexManager) -> None:
        pg = PlanGenerator(store, idx, _dummy_embed)
        pg._client = MagicMock()
        pg._client.chat.completions.create.side_effect = RuntimeError("API error")

        result, trace = pg.generate_plan("测试")
        assert result.subtasks == []
        assert result.confidence == 0.3
        assert "API error" in result.rationale or "规划不可用" in result.rationale

    def test_returns_empty_plan_on_no_client(self, store: MemoryStore, idx: IndexManager) -> None:
        pg = PlanGenerator(store, idx, _dummy_embed)
        pg._client = MagicMock()
        pg._client.chat.completions.create.side_effect = RuntimeError("API unavailable")

        result, trace = pg.generate_plan("测试")
        assert result.subtasks == []


# ── Planner 禁用 ─────────────────────────────────────────────────────


class TestPlanDisabled:
    """planner_enabled=False 时跳过规划。"""

    @patch("src.planner.plan.settings")
    def test_skips_when_disabled(
        self, mock_settings: MagicMock, store: MemoryStore, idx: IndexManager
    ) -> None:
        mock_settings.plan_generation_enabled = False
        pg = PlanGenerator(store, idx, _dummy_embed)
        result, trace = pg.generate_plan("测试")
        assert result.subtasks == []
        assert result.rationale == "任务规划已禁用"


# ── 意图类别调节 ───────────────────────────────────────────────────


class TestIntentCategoryModulation:
    """不同意图类别影响规划行为（通过 prompt 调节，验证可正常调用）。"""

    def test_instruction_intent_generates_plan(self, store: MemoryStore, idx: IndexManager) -> None:
        pg = PlanGenerator(store, idx, _dummy_embed)
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content='{"subtasks":[{"id":"1","description":"获取数据"},'
                    '{"id":"2","description":"分析数据"},'
                    '{"id":"3","description":"输出结果"}],'
                    '"rationale":"指令型需多步","confidence":0.9}'
                )
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=80, completion_tokens=40, total_tokens=120)
        pg._client = MagicMock()
        pg._client.chat.completions.create.return_value = mock_response

        result, trace = pg.generate_plan("帮我写一份报告", intent_category="指令")
        assert len(result.subtasks) == 3

    def test_chitchat_intent_minimal_plan(self, store: MemoryStore, idx: IndexManager) -> None:
        pg = PlanGenerator(store, idx, _dummy_embed)
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content='{"subtasks":[{"id":"1","description":"打招呼"}],'
                    '"rationale":"闲聊无需分解","confidence":0.95}'
                )
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=50, completion_tokens=20, total_tokens=70)
        pg._client = MagicMock()
        pg._client.chat.completions.create.return_value = mock_response

        result, trace = pg.generate_plan("你好！", intent_category="闲聊")
        assert len(result.subtasks) == 1
        assert "打招呼" in str(result.subtasks[0]["description"])


# ── 历史模式注入 (Phase 60 B3) ──────────────────────────────────────────


class TestBuildHistoryEnrichedPrompt:
    """_build_history_enriched_prompt 纯函数测试 — 无 store 依赖。"""

    def test_none_returns_base_unchanged(self) -> None:
        base = "原始提示词"
        result = PlanGenerator._build_history_enriched_prompt(base, None)
        assert result == base

    def test_empty_plan_history_returns_base_unchanged(self) -> None:
        """无模板且无失败模式 → 返回原提示词。"""
        from src.planner.plan_history import PlanHistoryResult

        base = "原始提示词"
        empty_history = PlanHistoryResult(
            success_templates=[],
            failure_patterns=[],
        )
        result = PlanGenerator._build_history_enriched_prompt(base, empty_history)
        assert result == base

    def test_success_templates_enrich_prompt(self) -> None:
        """成功模板被注入到提示词中。"""
        from src.planner.plan_history import PlanHistoryResult

        base = "原始提示词"
        history = PlanHistoryResult(
            success_templates=[
                {
                    "user_msg": "分析数据",
                    "subtask_descriptions": ["连接数据库", "执行查询", "生成图表"],
                },
            ],
            failure_patterns=[],
        )
        result = PlanGenerator._build_history_enriched_prompt(base, history)
        assert "成功模板" in result
        assert "分析数据" in result
        assert "连接数据库 → 执行查询 → 生成图表" in result
        assert base in result  # base prompt is preserved

    def test_failure_patterns_enrich_prompt(self) -> None:
        """失败模式被注入到提示词中。"""
        from src.planner.plan_history import PlanHistoryResult

        base = "原始提示词"
        history = PlanHistoryResult(
            success_templates=[],
            failure_patterns=[
                {
                    "pattern": "连接数据库超时",
                    "occurrences": 3,
                    "examples": ["连接数据库超时", "DB连接超时"],
                },
            ],
        )
        result = PlanGenerator._build_history_enriched_prompt(base, history)
        assert "失败模式" in result
        assert "连接数据库超时" in result
        assert "3" in result  # occurrence count
        assert base in result

    def test_both_templates_and_patterns(self) -> None:
        """同时有模板和模式 → 两者都注入。"""
        from src.planner.plan_history import PlanHistoryResult

        base = "原始提示词"
        history = PlanHistoryResult(
            success_templates=[
                {
                    "user_msg": "部署服务",
                    "subtask_descriptions": ["构建镜像", "推送仓库", "滚动更新"],
                },
            ],
            failure_patterns=[
                {
                    "pattern": "权限不足",
                    "occurrences": 2,
                    "examples": ["权限不足"],
                },
            ],
        )
        result = PlanGenerator._build_history_enriched_prompt(base, history)
        assert "成功模板" in result
        assert "失败模式" in result
        assert "部署服务" in result
        assert "权限不足" in result


class TestPlanGenerationWithHistory:
    """generate_plan 接收 plan_history 参数的集成测试。"""

    def test_generate_plan_with_history_injects_enriched_prompt(
        self, store: MemoryStore, idx: IndexManager
    ) -> None:
        """plan_history 非空时 → 系统提示词包含历史模式。"""
        from src.planner.plan_history import PlanHistoryResult

        pg = PlanGenerator(store, idx, _dummy_embed)
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content='{"subtasks":[{"id":"1","description":"分析数据"},'
                    '{"id":"2","description":"生成报告"}],'
                    '"rationale":"基于历史模板","confidence":0.85}'
                )
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=120, completion_tokens=35, total_tokens=155)
        pg._client = MagicMock()
        pg._client.chat.completions.create.return_value = mock_response

        history = PlanHistoryResult(
            success_templates=[
                {
                    "user_msg": "分析数据",
                    "subtask_descriptions": ["获取数据", "执行分析", "输出结果"],
                },
            ],
            failure_patterns=[],
        )
        result, trace = pg.generate_plan("分析数据", plan_history=history)
        assert len(result.subtasks) == 2
        # Verify the LLM was called with enriched prompt
        call_args = pg._client.chat.completions.create.call_args
        system_msg = call_args[1]["messages"][0]["content"]
        assert "成功模板" in system_msg
        assert "分析数据" in system_msg

    def test_generate_plan_with_none_history_uses_base_prompt(
        self, store: MemoryStore, idx: IndexManager
    ) -> None:
        """plan_history=None → 系统提示词不含历史模式。"""
        pg = PlanGenerator(store, idx, _dummy_embed)
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content='{"subtasks":[{"id":"1","description":"单个任务"}],'
                    '"rationale":"简单","confidence":0.8}'
                )
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=60, completion_tokens=15, total_tokens=75)
        pg._client = MagicMock()
        pg._client.chat.completions.create.return_value = mock_response

        result, trace = pg.generate_plan("测试", plan_history=None)
        assert len(result.subtasks) == 1
        call_args = pg._client.chat.completions.create.call_args
        system_msg = call_args[1]["messages"][0]["content"]
        assert "成功模板" not in system_msg
        assert "失败模式" not in system_msg
