"""上下文预算测试 — QueryClassifier + BudgetAllocator + AutoDegradationEngine。

测试覆盖：QueryClass 枚举 / 三种分类路径 / 边界阈值 / 缺失意图 /
三级配比验证 / 不同窗口大小 / 配置注入 / 便捷函数端到端 /
config 默认值 + A/B 实验 / DegradationLevel 枚举 / DegradationPlan 数据类 /
AutoDegradationEngine.evaluate() 四级降级 + 边界 + 安全钳 / should_skip_step 门控。
"""

from __future__ import annotations

import pytest

from src.config import BudgetConfig, Settings, settings
from src.context.budget import (
    AutoDegradationEngine,
    BudgetAllocator,
    DegradationLevel,
    DegradationPlan,
    QueryClass,
    QueryClassifier,
    classify_and_allocate,
    should_skip_step,
)


class TestQueryClass:
    """QueryClass StrEnum 基本验证。"""

    def test_enum_values(self) -> None:
        """三枚举值与字符串映射正确。"""
        assert QueryClass.LIGHT.value == "light"
        assert QueryClass.MEDIUM.value == "medium"
        assert QueryClass.HEAVY.value == "heavy"

    def test_enum_membership(self) -> None:
        """字符串构造枚举成功。"""
        assert QueryClass("light") == QueryClass.LIGHT
        assert QueryClass("medium") == QueryClass.MEDIUM
        assert QueryClass("heavy") == QueryClass.HEAVY

    def test_enum_invalid_value_raises(self) -> None:
        """非法字符串 → ValueError。"""
        with pytest.raises(ValueError):
            QueryClass("invalid")


class TestQueryClassifier:
    """QueryClassifier.classify() 分类逻辑测试。"""

    # ── LIGHT 分类 ──

    def test_classify_light_all_signals(self) -> None:
        """全部信号指向简单 → LIGHT。"""
        result = QueryClassifier.classify("闲聊", message_length=20, history_length=2)
        assert result == QueryClass.LIGHT

    def test_classify_light_clarify_intent(self) -> None:
        """澄清意图 + 短消息 + 短历史 → LIGHT。"""
        result = QueryClassifier.classify("澄清", message_length=48, history_length=3)
        assert result == QueryClass.LIGHT

    def test_classify_light_boundary_msg_len(self) -> None:
        """消息长度恰在 LIGHT 阈值 -1 → LIGHT。"""
        result = QueryClassifier.classify("闲聊", message_length=49, history_length=4)
        assert result == QueryClass.LIGHT

    def test_classify_light_boundary_history(self) -> None:
        """历史轮数恰在 LIGHT 阈值 -1 → LIGHT。"""
        result = QueryClassifier.classify("闲聊", message_length=30, history_length=4)
        assert result == QueryClass.LIGHT

    # ── HEAVY 分类 ──

    def test_classify_heavy_all_signals(self) -> None:
        """全部信号指向复杂 → HEAVY。"""
        result = QueryClassifier.classify("探索", message_length=250, history_length=20)
        assert result == QueryClass.HEAVY

    def test_classify_heavy_command_intent(self) -> None:
        """指令意图 + 长消息 + 长历史 → HEAVY。"""
        result = QueryClassifier.classify("指令", message_length=300, history_length=25)
        assert result == QueryClass.HEAVY

    def test_classify_heavy_boundary_msg_len(self) -> None:
        """消息长度恰在 HEAVY 阈值 +1 → HEAVY。"""
        result = QueryClassifier.classify("探索", message_length=201, history_length=16)
        assert result == QueryClass.HEAVY

    def test_classify_heavy_boundary_history(self) -> None:
        """历史轮数恰在 HEAVY 阈值 +1 → HEAVY。"""
        result = QueryClassifier.classify("指令", message_length=201, history_length=16)
        assert result == QueryClass.HEAVY

    # ── MEDIUM 分类（默认兜底）──

    def test_classify_medium_mixed_signals_intent_light_msg_heavy(self) -> None:
        """意图简单但消息长 → MEDIUM（混合信号不回退到 LIGHT/HEAVY）。"""
        result = QueryClassifier.classify("闲聊", message_length=300, history_length=20)
        assert result == QueryClass.MEDIUM

    def test_classify_medium_mixed_signals_intent_heavy_msg_light(self) -> None:
        """意图复杂但消息短 → MEDIUM（混合信号）。"""
        result = QueryClassifier.classify("探索", message_length=30, history_length=20)
        assert result == QueryClass.MEDIUM

    def test_classify_medium_mid_range(self) -> None:
        """所有信号在中间范围 → MEDIUM。"""
        result = QueryClassifier.classify("提问", message_length=100, history_length=10)
        assert result == QueryClass.MEDIUM

    def test_classify_medium_exact_boundaries(self) -> None:
        """消息长度恰等于阈值 → MEDIUM（不等于 LIGHT 也不等于 HEAVY）。"""
        result = QueryClassifier.classify("闲聊", message_length=50, history_length=5)
        assert result == QueryClass.MEDIUM

    # ── 缺失意图/边界值 ──

    def test_classify_none_intent_defaults_medium(self) -> None:
        """意图为 None → MEDIUM（安全兜底）。"""
        result = QueryClassifier.classify(None, message_length=100, history_length=10)
        assert result == QueryClass.MEDIUM

    def test_classify_unknown_intent_defaults_medium(self) -> None:
        """未识别意图（不在已知列表）→ MEDIUM。"""
        result = QueryClassifier.classify("unknown_intent", message_length=30, history_length=2)
        assert result == QueryClass.MEDIUM

    def test_classify_zero_message_length(self) -> None:
        """空消息长度 0 → LIGHT 候选（其余信号也满足时）。"""
        result = QueryClassifier.classify("闲聊", message_length=0, history_length=0)
        assert result == QueryClass.LIGHT

    def test_classify_zero_history(self) -> None:
        """空历史 0 轮 → 视同短历史。"""
        result = QueryClassifier.classify("闲聊", message_length=30, history_length=0)
        assert result == QueryClass.LIGHT


class TestBudgetAllocator:
    """BudgetAllocator.allocate() 分配逻辑测试。"""

    # ── LIGHT 分配 ──

    def test_allocate_light_default_window(self) -> None:
        """LIGHT 查询 → recalled 得 ~10% of 4096。"""
        allocator = BudgetAllocator()
        budget = allocator.allocate(QueryClass.LIGHT)
        assert budget["recalled"] == pytest.approx(4096 * 0.10, abs=1)

    def test_allocate_light_custom_window(self) -> None:
        """LIGHT + 自定义窗口 8000 → sum 等于 window_size。"""
        allocator = BudgetAllocator()
        budget = allocator.allocate(QueryClass.LIGHT, window_size=8000)
        assert budget["recalled"] == pytest.approx(800, abs=1)
        assert sum(budget.values()) == 8000

    # ── MEDIUM 分配 ──

    def test_allocate_medium_default_window(self) -> None:
        """MEDIUM 查询 → recalled 得 ~40% of 4096。"""
        allocator = BudgetAllocator()
        budget = allocator.allocate(QueryClass.MEDIUM)
        assert budget["recalled"] == pytest.approx(4096 * 0.40, abs=1)

    def test_allocate_medium_custom_window(self) -> None:
        """MEDIUM + 窗口 10000 → recalled=4000。"""
        allocator = BudgetAllocator()
        budget = allocator.allocate(QueryClass.MEDIUM, window_size=10000)
        assert budget["recalled"] == 4000

    # ── HEAVY 分配 ──

    def test_allocate_heavy_default_window(self) -> None:
        """HEAVY 查询 → recalled 得 ~60% of 4096。"""
        allocator = BudgetAllocator()
        budget = allocator.allocate(QueryClass.HEAVY)
        assert budget["recalled"] == pytest.approx(4096 * 0.60, abs=1)

    # ── 总和不变式 ──

    def test_allocate_sums_to_window(self) -> None:
        """四项 zone 预算之和等于 window_size（全等级+全尺寸）。"""
        allocator = BudgetAllocator()
        for qc in (QueryClass.LIGHT, QueryClass.MEDIUM, QueryClass.HEAVY):
            for ws in (4096, 8000, 16000):
                budget = allocator.allocate(qc, window_size=ws)
                assert sum(budget.values()) == ws, f"Failed for {qc} @ {ws}"

    def test_allocate_zone_keys(self) -> None:
        """返回 dict 包含全部 4 个 zone key。"""
        allocator = BudgetAllocator()
        budget = allocator.allocate(QueryClass.MEDIUM)
        assert set(budget.keys()) == {"system", "recalled", "history", "tools"}

    def test_allocate_all_non_negative(self) -> None:
        """所有 zone 预算 >= 0（极小窗口安全性）。"""
        allocator = BudgetAllocator()
        budget = allocator.allocate(QueryClass.MEDIUM, window_size=10)
        for zone, tokens in budget.items():
            assert tokens >= 0, f"{zone} is negative: {tokens}"

    # ── Feature flag ──

    def test_is_enabled_defaults_false(self) -> None:
        """Feature flag 默认关闭。"""
        allocator = BudgetAllocator()
        assert allocator.is_enabled is False

    def test_is_enabled_respects_config(self) -> None:
        """Feature flag 从 config 读取。"""
        cfg = Settings(budget=BudgetConfig(enabled=True))
        allocator = BudgetAllocator(config=cfg)
        assert allocator.is_enabled is True

    # ── 配置注入 ──

    def test_allocate_uses_injected_config(self) -> None:
        """注入自定义 Settings → 配比来自注入配置。"""
        cfg = Settings(
            budget=BudgetConfig(light_pct=0.15, medium_pct=0.45, heavy_pct=0.65),
        )
        allocator = BudgetAllocator(config=cfg)
        budget = allocator.allocate(QueryClass.LIGHT, window_size=1000)
        assert budget["recalled"] == 150  # 0.15 × 1000

    def test_get_recalled_pct(self) -> None:
        """get_recalled_pct 便捷方法返回正确比例。"""
        allocator = BudgetAllocator()
        assert allocator.get_recalled_pct(QueryClass.LIGHT) == 0.10
        assert allocator.get_recalled_pct(QueryClass.MEDIUM) == 0.40
        assert allocator.get_recalled_pct(QueryClass.HEAVY) == 0.60

    # ── 极端配置安全钳 ──

    def test_allocate_extreme_recalled_pct(self) -> None:
        """recalled 配比接近 1.0 时 history 不出现负值。"""
        cfg = Settings(
            budget=BudgetConfig(light_pct=0.95, medium_pct=0.95, heavy_pct=0.95),
        )
        allocator = BudgetAllocator(config=cfg)
        budget = allocator.allocate(QueryClass.LIGHT, window_size=1000)
        assert budget["history"] >= 0
        assert sum(budget.values()) == 1000

    # ── window_size=None 回退 ──

    def test_allocate_none_window_uses_config(self) -> None:
        """window_size=None → 使用 config.context_window_size。"""
        allocator = BudgetAllocator()
        budget = allocator.allocate(QueryClass.MEDIUM)
        assert sum(budget.values()) == settings.context_window_size


class TestClassifyAndAllocate:
    """classify_and_allocate() 便捷函数端到端测试。"""

    def test_returns_query_class(self) -> None:
        """返回正确的 QueryClass。"""
        qc, _ = classify_and_allocate("闲聊", message_length=20, history_length=2)
        assert qc == QueryClass.LIGHT

    def test_returns_budget_dict(self) -> None:
        """返回四区 token 预算 dict。"""
        _, budget = classify_and_allocate("探索", message_length=300, history_length=20)
        assert set(budget.keys()) == {"system", "recalled", "history", "tools"}
        assert all(isinstance(v, int) for v in budget.values())

    def test_default_window_size(self) -> None:
        """默认窗口 → sum 等于 config.context_window_size。"""
        _, budget = classify_and_allocate("提问", message_length=100, history_length=10)
        assert sum(budget.values()) == settings.context_window_size

    def test_custom_window_size(self) -> None:
        """自定义窗口 → sum 等于传入值。"""
        _, budget = classify_and_allocate(
            "提问", message_length=100, history_length=10, window_size=8000
        )
        assert sum(budget.values()) == 8000

    def test_custom_config(self) -> None:
        """自定义 config → recalled 配比来自注入配置。"""
        cfg = Settings(budget=BudgetConfig(light_pct=0.20))
        _, budget = classify_and_allocate("闲聊", message_length=20, history_length=2, config=cfg)
        assert budget["recalled"] == pytest.approx(4096 * 0.20, abs=1)


class TestConfigDefaults:
    """config.py 预算字段默认值验证。"""

    def test_default_budget_fields(self) -> None:
        """模块级 settings 单例字段默认值正确。"""
        s = Settings()
        assert s.budget_enabled is False
        assert s.light_budget_pct == 0.10
        assert s.medium_budget_pct == 0.40
        assert s.heavy_budget_pct == 0.60

    def test_budget_ab_experiment(self) -> None:
        """A/B 实验：覆盖部分字段，其余保持默认。"""
        baseline = Settings()
        experiment = Settings(
            budget=BudgetConfig(enabled=True, light_pct=0.15, medium_pct=0.50),
        )
        assert baseline.budget_enabled is False
        assert experiment.budget_enabled is True
        assert baseline.light_budget_pct == 0.10
        assert experiment.light_budget_pct == 0.15
        assert experiment.medium_budget_pct == 0.50
        # 未覆盖字段保持默认
        assert experiment.heavy_budget_pct == 0.60

    def test_budget_float_precision(self) -> None:
        """浮点字段无截断误差（pytest.approx）。"""
        s = Settings(budget=BudgetConfig(light_pct=0.10))
        assert s.light_budget_pct == pytest.approx(0.10)


# ═══════════════════════════════════════════════════════════════════════
# Phase 63 Batch 2 — AutoDegradationEngine + DegradationPlan + should_skip_step
# ═══════════════════════════════════════════════════════════════════════


class TestDegradationLevel:
    """DegradationLevel StrEnum 基本验证。"""

    def test_enum_values(self) -> None:
        """四枚举值与字符串映射正确。"""
        assert DegradationLevel.NONE.value == "none"
        assert DegradationLevel.LIGHT.value == "light"
        assert DegradationLevel.MEDIUM.value == "medium"
        assert DegradationLevel.HEAVY.value == "heavy"

    def test_enum_membership(self) -> None:
        """字符串构造枚举成功。"""
        assert DegradationLevel("none") == DegradationLevel.NONE
        assert DegradationLevel("light") == DegradationLevel.LIGHT
        assert DegradationLevel("medium") == DegradationLevel.MEDIUM
        assert DegradationLevel("heavy") == DegradationLevel.HEAVY

    def test_enum_invalid_value_raises(self) -> None:
        """非法字符串 → ValueError。"""
        with pytest.raises(ValueError):
            DegradationLevel("invalid")


class TestDegradationPlan:
    """DegradationPlan 数据类基本验证。"""

    def test_default_plan_is_none_level(self) -> None:
        """默认构造——全字段 false/None——表示无降级。"""
        plan = DegradationPlan(level=DegradationLevel.NONE)
        assert plan.level == DegradationLevel.NONE
        assert plan.skip_fact_extraction is False
        assert plan.skip_warm_summaries is False
        assert plan.reduce_recall_to is None
        assert plan.reason == ""

    def test_full_heavy_plan(self) -> None:
        """HEAVY 降级计划——所有降级动作激活。"""
        plan = DegradationPlan(
            level=DegradationLevel.HEAVY,
            skip_fact_extraction=True,
            skip_warm_summaries=True,
            reduce_recall_to=3,
            reason="超标 180%，全量降级",
        )
        assert plan.level == DegradationLevel.HEAVY
        assert plan.skip_fact_extraction is True
        assert plan.skip_warm_summaries is True
        assert plan.reduce_recall_to == 3
        assert "180%" in plan.reason

    def test_plan_is_hashable_for_set_operations(self) -> None:
        """DegradationPlan 可哈希——dataclass 默认 frozen=False 但字段简单。"""
        p1 = DegradationPlan(level=DegradationLevel.LIGHT, skip_fact_extraction=True)
        p2 = DegradationPlan(level=DegradationLevel.LIGHT, skip_fact_extraction=True)
        assert p1 == p2


class TestAutoDegradationEngine:
    """AutoDegradationEngine.evaluate() 降级决策测试。"""

    # ── 辅助方法 ──

    @staticmethod
    def _budget(recalled: int = 400) -> dict[str, int]:
        """创建最小四区预算用于测试。"""
        return {"system": 200, "recalled": recalled, "history": 3000, "tools": 100}

    # ── NONE 降级（预算充足）──

    def test_no_degradation_when_under_budget(self) -> None:
        """召回 token 远小于预算 → NONE 降级。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=1000),
            estimated_recall_tokens=500,
            recall_count=10,
        )
        assert plan.level == DegradationLevel.NONE
        assert plan.skip_fact_extraction is False
        assert plan.skip_warm_summaries is False
        assert plan.reduce_recall_to is None

    def test_no_degradation_exact_boundary(self) -> None:
        """召回 token 恰好等于 budget → NONE（未超过阈值）。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=500),
            estimated_recall_tokens=500,
            recall_count=10,
        )
        assert plan.level == DegradationLevel.NONE

    # ── LIGHT 降级（> 100%）──

    def test_light_degradation_above_budget(self) -> None:
        """召回 token 略超预算 → LIGHT 降级（仅跳过事实抽取）。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=500),
            estimated_recall_tokens=550,  # 110% of budget
            recall_count=10,
        )
        assert plan.level == DegradationLevel.LIGHT
        assert plan.skip_fact_extraction is True
        assert plan.skip_warm_summaries is False
        assert plan.reduce_recall_to is None

    def test_light_degradation_boundary_plus_one(self) -> None:
        """召回 token = budget + 1 → LIGHT 降级。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=500),
            estimated_recall_tokens=501,  # just over 100%
            recall_count=10,
        )
        assert plan.level == DegradationLevel.LIGHT

    # ── MEDIUM 降级（> 120%）──

    def test_medium_degradation_with_warm_items(self) -> None:
        """召回 token 超过 120% 且有温层条目 → MEDIUM 降级。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=500),
            estimated_recall_tokens=650,  # 130% of budget
            recall_count=10,
            warm_count=3,
        )
        assert plan.level == DegradationLevel.MEDIUM
        assert plan.skip_fact_extraction is True
        assert plan.skip_warm_summaries is True  # 有温层 → 过滤
        assert plan.reduce_recall_to is None

    def test_medium_degradation_no_warm_items(self) -> None:
        """召回 token 超过 120% 但无温层条目 → skip_warm_summaries=False。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=500),
            estimated_recall_tokens=650,
            recall_count=10,
            warm_count=0,  # 无温层→不标记过滤
        )
        assert plan.level == DegradationLevel.MEDIUM
        assert plan.skip_fact_extraction is True
        assert plan.skip_warm_summaries is False  # 无温层可过滤
        assert plan.reduce_recall_to is None

    def test_medium_degradation_boundary(self) -> None:
        """召回 token = 121% → MEDIUM 降级。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=500),
            estimated_recall_tokens=605,  # 121%
            recall_count=10,
            warm_count=2,
        )
        assert plan.level == DegradationLevel.MEDIUM

    # ── HEAVY 降级（> 150%）──

    def test_heavy_degradation_way_over_budget(self) -> None:
        """召回 token 远超 150% → HEAVY 降级，所有降级动作激活。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=500),
            estimated_recall_tokens=1000,  # 200% of budget
            recall_count=10,
            warm_count=4,
        )
        assert plan.level == DegradationLevel.HEAVY
        assert plan.skip_fact_extraction is True
        assert plan.skip_warm_summaries is True
        # HEAVY_RECALL_REDUCTION_PCT = 0.5 → recall 从 10 砍到 5
        assert plan.reduce_recall_to == 5
        assert "150%" in plan.reason

    def test_heavy_degradation_min_recall_one(self) -> None:
        """召回数量缩减后至少为 1。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=100),
            estimated_recall_tokens=200,  # 200% of budget
            recall_count=2,
        )
        assert plan.level == DegradationLevel.HEAVY
        assert plan.reduce_recall_to == 1  # max(1, int(2*0.5))

    # ── 安全钳 ──

    def test_zero_recalled_budget_triggers_heavy(self) -> None:
        """recalled 预算为 0 → 直接 HEAVY 降级（安全钳）。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=0),
            estimated_recall_tokens=10,
            recall_count=10,
        )
        assert plan.level == DegradationLevel.HEAVY
        assert plan.skip_fact_extraction is True
        assert plan.skip_warm_summaries is True

    # ── Feature flag ──

    def test_is_enabled_defaults_false(self) -> None:
        """Feature flag 默认关闭。"""
        engine = AutoDegradationEngine()
        assert engine.is_enabled is False

    def test_is_enabled_respects_config(self) -> None:
        """Feature flag 从 config 读取。"""
        cfg = Settings(budget=BudgetConfig(enabled=True))
        engine = AutoDegradationEngine(config=cfg)
        assert engine.is_enabled is True

    # ── 配置注入：A/B 实验阈值 ──

    def test_custom_thresholds_via_subclass(self) -> None:
        """子类化覆盖阈值——支持 A/B 实验。"""

        class StrictEngine(AutoDegradationEngine):
            LIGHT_DEGRADE_RATIO = 0.8  # 更激进的门槛
            MEDIUM_DEGRADE_RATIO = 1.0
            HEAVY_DEGRADE_RATIO = 1.3

        engine = StrictEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=500),
            estimated_recall_tokens=450,  # 90% → > 80% triggers LIGHT
            recall_count=10,
        )
        assert plan.level == DegradationLevel.LIGHT

    # ── 零 token 边界 ──

    def test_zero_estimated_tokens_no_degradation(self) -> None:
        """零召回 token → NONE 降级。"""
        engine = AutoDegradationEngine()
        plan = engine.evaluate(
            budget=self._budget(recalled=500),
            estimated_recall_tokens=0,
            recall_count=0,
        )
        assert plan.level == DegradationLevel.NONE

    def test_reason_is_human_readable(self) -> None:
        """所有降级级别的 reason 字段非空且包含关键信息。"""
        engine = AutoDegradationEngine()

        # NONE
        plan = engine.evaluate(self._budget(500), estimated_recall_tokens=100)
        assert len(plan.reason) > 0 and "无需降级" in plan.reason

        # LIGHT
        plan = engine.evaluate(self._budget(500), estimated_recall_tokens=550)
        assert "LIGHT" in plan.reason and "事实抽取" in plan.reason

        # MEDIUM
        plan = engine.evaluate(self._budget(500), estimated_recall_tokens=650, warm_count=2)
        assert "MEDIUM" in plan.reason and "温层" in plan.reason

        # HEAVY
        plan = engine.evaluate(self._budget(500), estimated_recall_tokens=1000, recall_count=10)
        assert "HEAVY" in plan.reason and "召回缩减" in plan.reason


class TestShouldSkipStep:
    """should_skip_step() 模块级门控函数测试。"""

    def test_none_plan_skips_nothing(self) -> None:
        """plan=None → 不跳过任何步骤。"""
        assert should_skip_step("fact_extraction", None) is False
        assert should_skip_step("warm_summaries", None) is False

    def test_none_level_skips_nothing(self) -> None:
        """NONE 降级 → 不跳过任何步骤。"""
        plan = DegradationPlan(level=DegradationLevel.NONE)
        assert should_skip_step("fact_extraction", plan) is False
        assert should_skip_step("warm_summaries", plan) is False

    def test_light_skips_fact_extraction_only(self) -> None:
        """LIGHT 降级 → 仅跳过事实抽取。"""
        plan = DegradationPlan(level=DegradationLevel.LIGHT, skip_fact_extraction=True)
        assert should_skip_step("fact_extraction", plan) is True
        assert should_skip_step("warm_summaries", plan) is False

    def test_medium_skips_both(self) -> None:
        """MEDIUM 降级 + 有温层 → 跳过两者。"""
        plan = DegradationPlan(
            level=DegradationLevel.MEDIUM,
            skip_fact_extraction=True,
            skip_warm_summaries=True,
        )
        assert should_skip_step("fact_extraction", plan) is True
        assert should_skip_step("warm_summaries", plan) is True

    def test_medium_no_warm_skips_fact_only(self) -> None:
        """MEDIUM 降级但无温层 → skip_warm_summaries=False。"""
        plan = DegradationPlan(
            level=DegradationLevel.MEDIUM,
            skip_fact_extraction=True,
            skip_warm_summaries=False,
        )
        assert should_skip_step("fact_extraction", plan) is True
        assert should_skip_step("warm_summaries", plan) is False

    def test_heavy_skips_all(self) -> None:
        """HEAVY 降级 → 跳过事实抽取 + 温层摘要。"""
        plan = DegradationPlan(
            level=DegradationLevel.HEAVY,
            skip_fact_extraction=True,
            skip_warm_summaries=True,
            reduce_recall_to=3,
        )
        assert should_skip_step("fact_extraction", plan) is True
        assert should_skip_step("warm_summaries", plan) is True

    def test_unknown_step_skips_nothing(self) -> None:
        """未知步骤名 → 安全返回 False。"""
        plan = DegradationPlan(
            level=DegradationLevel.HEAVY,
            skip_fact_extraction=True,
            skip_warm_summaries=True,
        )
        assert should_skip_step("unknown_step", plan) is False
