from __future__ import annotations

import inspect
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from src.config import (
    BudgetConfig,
    ConsolidationConfig,
    FactExtractionConfig,
    PlanHistoryConfig,
    RecallConfig,
    SessionBoundaryConfig,
    Settings,
    TierConfig,
    settings,
)


class TestSettingsDefaults:
    """默认值验证——确保不改动破坏生产默认行为。"""

    def test_default_paths(self) -> None:
        s = Settings()
        assert s.data_dir == Path("data")
        assert s.resolved_db_path == Path("data") / "default" / "memory.db"
        assert s.resolved_index_path == Path("data") / "default" / "index.faiss"
        assert s.env_file == Path(".env")

    def test_default_embedding(self) -> None:
        s = Settings()
        assert s.embed_model == "all-MiniLM-L6-v2"
        assert s.embed_dim == 384
        assert s.embed_device == "cpu"

    def test_default_llm(self) -> None:
        s = Settings()
        assert s.llm_model == "deepseek-chat"
        assert s.llm_base_url == "https://api.deepseek.com"
        assert s.llm_api_key_env == "DEEPSEEK_API_KEY"
        assert s.llm_max_tokens == 1024
        assert s.fact_extraction_max_tokens == 512

    def test_default_recall(self) -> None:
        s = Settings()
        assert s.recall_search_k == 20
        assert s.recall_top_k == 5
        assert s.recall_threshold == 0.1
        assert s.recall_truncation_threshold == 0.0
        assert s.compress_threshold == 500

    def test_default_memory_params(self) -> None:
        s = Settings()
        assert s.default_importance == 0.5
        assert s.default_decay_lambda == 0.1
        assert s.default_confidence == 0.5
        assert s.assistant_importance == 0.4

    def test_default_forgetting(self) -> None:
        s = Settings()
        assert s.strengthen_boost == 0.3
        assert s.strength_cap == 1.0

    def test_default_fact(self) -> None:
        s = Settings()
        assert s.dedup_threshold == 0.85
        assert s.fact_delta_base == 0.05
        assert s.fact_delta_sim_multiplier == 0.1
        assert s.fact_initial_confidence == 0.6
        assert s.conflict_confidence_penalty == 0.2
        assert s.loss_detection_enabled is True

    def test_module_singleton_has_defaults(self) -> None:
        """模块级 settings 单例使用默认值。"""
        assert settings.embed_dim == 384
        assert settings.llm_max_tokens == 1024


class TestSettingsCustom:
    """自定义覆盖——A/B 实验场景。"""

    def test_explicit_paths_override_resolved(self) -> None:
        s = Settings.from_flat(db_path=Path("/tmp/test.db"), index_path=Path("/tmp/test.faiss"))
        assert s.resolved_db_path == Path("/tmp/test.db")
        assert s.resolved_index_path == Path("/tmp/test.faiss")

    def test_resolved_paths_use_data_dir(self) -> None:
        s = Settings.from_flat(data_dir=Path("/custom/data"))
        assert s.resolved_db_path == Path("/custom/data") / "default" / "memory.db"
        assert s.resolved_index_path == Path("/custom/data") / "default" / "index.faiss"

    def test_ab_experiment_two_instances(self) -> None:
        """A/B 实验：同一代码两套配置。"""
        baseline = Settings(recall=RecallConfig(recall_top_k=5, recall_search_k=20))
        experiment = Settings(recall=RecallConfig(recall_top_k=10, recall_search_k=40))
        assert baseline.recall_top_k == 5
        assert experiment.recall_top_k == 10
        assert baseline.recall_search_k == 20
        assert experiment.recall_search_k == 40
        # 未覆盖的字段保持默认
        assert experiment.embed_dim == 384

    def test_ab_experiment_fact_triple(self) -> None:
        """三元组抽取 A/B：不同冲突惩罚力度。"""
        baseline = Settings(fact_extraction=FactExtractionConfig(conflict_confidence_penalty=0.2))
        experiment = Settings(fact_extraction=FactExtractionConfig(conflict_confidence_penalty=0.4))
        assert baseline.conflict_confidence_penalty == 0.2
        assert experiment.conflict_confidence_penalty == 0.4
        # 其他事实字段不变
        assert experiment.fact_initial_confidence == 0.6
        assert experiment.loss_detection_enabled is True

    def test_frozen_dataclass(self) -> None:
        s = Settings()
        with pytest.raises(FrozenInstanceError):
            s.embed_dim = 768  # type: ignore

    def test_extra_field_present(self) -> None:
        s = Settings(extra={"experiment_id": "exp-001"})
        assert s.extra["experiment_id"] == "exp-001"


class TestSettingsIntegration:
    """验证所有引擎从 settings 单例读取值（不 mock，直接导入）。"""

    def test_embed_uses_settings(self) -> None:
        from src.embed import _EMBEDDING_DIM, _MODEL_NAME

        assert _MODEL_NAME == settings.embed_model
        assert _EMBEDDING_DIM == settings.embed_dim

    def test_index_uses_settings(self) -> None:
        from src.memory.index import IndexManager

        idx = IndexManager()
        assert idx.dimension == settings.embed_dim

    def test_store_uses_settings(self) -> None:
        from src.memory.store import MemoryStore

        # 只验证默认参数签名，不实际 init_db
        sig = inspect.signature(MemoryStore.__init__)
        default = sig.parameters["db_path"].default
        assert default == str(settings.resolved_db_path)

    def test_forget_uses_settings(self) -> None:
        from src.memory.forget import ForgettingEngine

        # strengthen 用默认 boost
        result = ForgettingEngine.strengthen(0.5)
        assert result == min(settings.strength_cap, 0.5 + settings.strengthen_boost)
        assert result == 0.8  # 0.5 + 0.3

    def test_recall_uses_settings(self) -> None:
        from src.memory.recall import RecallEngine

        sig = inspect.signature(RecallEngine.recall)
        assert sig.parameters["top_k"].default == settings.recall_top_k
        assert sig.parameters["search_k"].default == settings.recall_search_k
        assert sig.parameters["threshold"].default == settings.recall_threshold

    def test_default_l5_model_inference(self) -> None:
        s = Settings()
        assert s.llm_temperature == 0.7
        assert s.available_models == ("deepseek-chat", "deepseek-reasoner")
        assert "deepseek-chat" in s.available_models

    def test_l5_ab_experiment_two_instances(self) -> None:
        a = Settings()
        b = Settings.from_flat(llm_temperature=1.5, llm_max_tokens=2048)
        assert a.llm_temperature == 0.7
        assert b.llm_temperature == 1.5
        assert a.llm_max_tokens == 1024
        assert b.llm_max_tokens == 2048

    def test_default_planner(self) -> None:
        s = Settings()
        assert s.planner_enabled is True
        assert s.planner_max_tokens == 128
        assert s.planner_temperature == 0.1


class TestSettingsPostInitValidation:
    """__post_init__ 验证——非法值组合应在构造时立即报错。"""

    # ── Tier 阈值反转 ──

    def test_tier_hot_gt_warm_default_passes(self) -> None:
        """默认值 hot=0.7 > warm=0.3 通过验证。"""
        s = Settings()  # 不抛异常
        assert s.tier_hot_threshold > s.tier_warm_threshold

    def test_tier_hot_equal_warm_raises(self) -> None:
        """hot == warm → 所有记忆评分永远同时命中两层，语义错误。"""
        with pytest.raises(ValueError, match="tier_hot_threshold"):
            Settings(tier=TierConfig(tier_hot_threshold=0.5, tier_warm_threshold=0.5))

    def test_tier_hot_lt_warm_raises(self) -> None:
        """hot < warm → 阈值反转，永远无法进入 hot 层。"""
        with pytest.raises(ValueError, match="tier_hot_threshold"):
            Settings(tier=TierConfig(tier_hot_threshold=0.3, tier_warm_threshold=0.7))

    # ── 预算百分比乱序 ──

    def test_budget_ordering_default_passes(self) -> None:
        """默认值 light=0.10 < medium=0.40 < heavy=0.60 通过验证。"""
        s = Settings()
        assert s.light_budget_pct < s.medium_budget_pct < s.heavy_budget_pct

    def test_budget_medium_gt_heavy_raises(self) -> None:
        """medium > heavy → 中查询比深查询分配更多预算，语义矛盾。"""
        with pytest.raises(ValueError, match="Budget percentages"):
            Settings(budget=BudgetConfig(light_pct=0.1, medium_pct=0.8, heavy_pct=0.5))

    def test_budget_light_gt_medium_raises(self) -> None:
        """light > medium → 浅查询比中查询分配更多预算。"""
        with pytest.raises(ValueError, match="Budget percentages"):
            Settings(budget=BudgetConfig(light_pct=0.5, medium_pct=0.3, heavy_pct=0.6))

    def test_budget_out_of_range_raises(self) -> None:
        """预算百分比超出 [0,1] 范围。"""
        with pytest.raises(ValueError, match="Budget percentages"):
            Settings(budget=BudgetConfig(light_pct=-0.1, medium_pct=0.4, heavy_pct=0.6))

    # ── 召回容量 ──

    def test_recall_search_lt_top_raises(self) -> None:
        """search_k < top_k → 候选不足，永远无法返回足够结果。"""
        with pytest.raises(ValueError, match="recall_search_k"):
            Settings(recall=RecallConfig(recall_search_k=3, recall_top_k=10))

    def test_recall_search_eq_top_passes(self) -> None:
        """search_k == top_k → 合法边界。"""
        s = Settings(recall=RecallConfig(recall_search_k=5, recall_top_k=5))
        assert s.recall_search_k == s.recall_top_k

    # ── 历史计划容量 ──

    def test_plan_history_search_lt_top_raises(self) -> None:
        with pytest.raises(ValueError, match="plan_history_search_limit"):
            Settings(
                plan_history=PlanHistoryConfig(plan_history_search_limit=2, plan_history_top_k=5)
            )

    # ── 正数约束 ──

    def test_negative_consolidation_interval_raises(self) -> None:
        with pytest.raises(ValueError, match="consolidation_interval_seconds"):
            Settings(consolidation=ConsolidationConfig(consolidation_interval_seconds=-1.0))

    def test_zero_consolidation_interval_raises(self) -> None:
        with pytest.raises(ValueError, match="consolidation_interval_seconds"):
            Settings(consolidation=ConsolidationConfig(consolidation_interval_seconds=0.0))

    def test_negative_grace_period_raises(self) -> None:
        with pytest.raises(ValueError, match="consolidation_grace_period_hours"):
            Settings(consolidation=ConsolidationConfig(consolidation_grace_period_hours=-1.0))

    def test_negative_session_gap_raises(self) -> None:
        with pytest.raises(ValueError, match="session_boundary_session_gap_seconds"):
            Settings(session_boundary=SessionBoundaryConfig(session_gap_seconds=-1.0))

    def test_zero_num_sessions_raises(self) -> None:
        with pytest.raises(ValueError, match="num_sessions_for_regression"):
            Settings(session_boundary=SessionBoundaryConfig(num_sessions_for_regression=0))

    # ── 合法自定义组合 ──

    def test_valid_custom_tier_thresholds(self) -> None:
        """自定义但合法的分层阈值应通过验证。"""
        s = Settings(tier=TierConfig(tier_hot_threshold=0.9, tier_warm_threshold=0.5))
        assert s.tier_hot_threshold == 0.9
        assert s.tier_warm_threshold == 0.5

    def test_valid_custom_budgets(self) -> None:
        """自定义但合法的预算分配应通过验证。"""
        s = Settings(budget=BudgetConfig(light_pct=0.2, medium_pct=0.5, heavy_pct=0.8))
        assert s.light_budget_pct == 0.2

    def test_all_defaults_pass_validation(self) -> None:
        """完整默认 Settings 通过所有 __post_init__ 验证。"""
        s = Settings()  # 不抛异常 = 通过
        assert s.embed_dim == 384  # 抽样确认默认值未被篡改
