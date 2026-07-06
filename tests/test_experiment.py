"""A/B 实验框架测试。"""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from pathlib import Path
from unittest.mock import patch

import pytest

from src.config import RecallConfig, Settings
from src.experiment import (
    EXPERIMENT_PRESETS,
    ExperimentDiff,
    ExperimentResult,
    ExperimentRunner,
    _build_settings,
    _direction_for_delta,
    _jaccard_similarity,
    compare_results,
)


class TestExperimentResult:
    """ExperimentResult 数据模型测试。"""

    def test_creates_with_defaults(self) -> None:
        r = ExperimentResult(label="A", settings=Settings())
        assert r.label == "A"
        assert r.recalled_count == 0
        assert r.recalled_contents == []
        assert r.response_text == ""
        assert r.response_length == 0

    def test_creates_with_full_data(self) -> None:
        r = ExperimentResult(
            label="B",
            settings=Settings(recall=RecallConfig(recall_top_k=10)),
            recalled_count=5,
            recalled_contents=["记忆1", "记忆2"],
            response_text="你好！",
            response_length=3,
            chat_total_tokens=150,
            facts_extracted=2,
        )
        assert r.recalled_count == 5
        assert r.response_text == "你好！"
        assert r.chat_total_tokens == 150
        assert r.facts_extracted == 2

    def test_frozen_immutable(self) -> None:
        r = ExperimentResult(label="A", settings=Settings())
        with pytest.raises(FrozenInstanceError):
            r.label = "X"  # type: ignore[misc]

    def test_recalled_contents_default_is_shared(self) -> None:
        """验证默认 list 字段使用 field(default_factory) 而非可变默认值。"""
        r1 = ExperimentResult(label="A", settings=Settings())
        r2 = ExperimentResult(label="B", settings=Settings())
        assert r1.recalled_contents is not r2.recalled_contents


class TestExperimentDiff:
    """ExperimentDiff 数据模型测试。"""

    def test_creates_basic_diff(self) -> None:
        d = ExperimentDiff(
            dimension="recall_count",
            label_a="A",
            label_b="B",
            value_a=3,
            value_b=5,
            delta="+2",
            direction="b_better",
        )
        assert d.dimension == "recall_count"
        assert d.direction == "b_better"
        assert d.detail is None

    def test_creates_with_detail(self) -> None:
        d = ExperimentDiff(
            dimension="token_usage",
            label_a="A",
            label_b="B",
            value_a=100,
            value_b=80,
            delta="-20",
            direction="a_better",
            detail="B 比 A 少用了 20 tokens",
        )
        assert d.detail == "B 比 A 少用了 20 tokens"


class TestCompareResults:
    """compare_results 函数测试。"""

    def _make_result(self, label: str, **overrides: object) -> ExperimentResult:
        kwargs: dict[str, object] = {
            "label": label,
            "settings": Settings(),
            "recalled_count": 3,
            "recalled_contents": ["内容A", "内容B", "内容C"],
            "response_text": "你好",
            "response_length": 2,
            "chat_total_tokens": 100,
            "chat_prompt_tokens": 60,
            "chat_completion_tokens": 40,
            "fact_total_tokens": 50,
            "fact_prompt_tokens": 30,
            "fact_completion_tokens": 20,
            "facts_extracted": 2,
            "fact_contents": ["事实1", "事实2"],
        }
        kwargs.update(overrides)
        return ExperimentResult(**kwargs)  # type: ignore[arg-type]

    def test_returns_all_dimensions(self) -> None:
        a = self._make_result("A")
        b = self._make_result("B")
        diffs = compare_results(a, b)
        dimensions = {d.dimension for d in diffs}
        assert "recall_count" in dimensions
        assert "recall_overlap" in dimensions
        assert "chat_token_usage" in dimensions
        assert "fact_token_usage" in dimensions
        assert "fact_count" in dimensions
        assert "response_length" in dimensions

    def test_recall_count_diff(self) -> None:
        a = self._make_result("A", recalled_count=3)
        b = self._make_result("B", recalled_count=7)
        diffs = compare_results(a, b)
        recall_diff = next(d for d in diffs if d.dimension == "recall_count")
        assert recall_diff.delta == "+4"
        assert recall_diff.direction == "b_better"

    def test_recall_count_equal(self) -> None:
        a = self._make_result("A", recalled_count=5)
        b = self._make_result("B", recalled_count=5)
        diffs = compare_results(a, b)
        recall_diff = next(d for d in diffs if d.dimension == "recall_count")
        assert recall_diff.delta == "+0"
        assert recall_diff.direction == "neutral"

    def test_recall_overlap_full(self) -> None:
        a = self._make_result("A", recalled_contents=["猫 布偶 可爱"])
        b = self._make_result("B", recalled_contents=["猫 布偶 可爱"])
        diffs = compare_results(a, b)
        overlap = next(d for d in diffs if d.dimension == "recall_overlap")
        assert float(overlap.delta.strip("%")) == pytest.approx(100.0)

    def test_recall_overlap_none(self) -> None:
        a = self._make_result("A", recalled_contents=["猫"])
        b = self._make_result("B", recalled_contents=["狗"])
        diffs = compare_results(a, b)
        overlap = next(d for d in diffs if d.dimension == "recall_overlap")
        assert float(overlap.delta.strip("%")) == pytest.approx(0.0)

    def test_chat_token_usage_lower_is_better(self) -> None:
        a = self._make_result("A", chat_total_tokens=200)
        b = self._make_result("B", chat_total_tokens=100)
        diffs = compare_results(a, b)
        token_diff = next(d for d in diffs if d.dimension == "chat_token_usage")
        assert token_diff.delta == "-100"
        assert token_diff.direction == "b_better"

    def test_fact_count_higher_is_better(self) -> None:
        a = self._make_result("A", facts_extracted=1)
        b = self._make_result("B", facts_extracted=5)
        diffs = compare_results(a, b)
        fact_diff = next(d for d in diffs if d.dimension == "fact_count")
        assert fact_diff.delta == "+4"
        assert fact_diff.direction == "b_better"

    def test_empty_results(self) -> None:
        a = ExperimentResult(label="A", settings=Settings())
        b = ExperimentResult(label="B", settings=Settings())
        diffs = compare_results(a, b)
        assert len(diffs) == 6
        for d in diffs:
            assert d.direction == "neutral"

    def test_response_length_diff(self) -> None:
        a = self._make_result("A", response_length=50)
        b = self._make_result("B", response_length=100)
        diffs = compare_results(a, b)
        len_diff = next(d for d in diffs if d.dimension == "response_length")
        assert len_diff.delta == "+50"


class TestHelpers:
    """内部辅助函数测试。"""

    def test_jaccard_empty_both(self) -> None:
        assert _jaccard_similarity([], []) == 1.0

    def test_jaccard_one_empty(self) -> None:
        assert _jaccard_similarity(["猫"], []) == 0.0

    def test_jaccard_identical(self) -> None:
        assert _jaccard_similarity(["猫 狗"], ["猫 狗"]) == 1.0

    def test_jaccard_half_overlap(self) -> None:
        sim = _jaccard_similarity(["猫 狗"], ["猫 鱼"])
        assert 0.0 < sim < 1.0

    def test_direction_higher_is_better_positive(self) -> None:
        assert _direction_for_delta(5, higher_is_better=True) == "b_better"

    def test_direction_higher_is_better_negative(self) -> None:
        assert _direction_for_delta(-3, higher_is_better=True) == "a_better"

    def test_direction_lower_is_better_positive(self) -> None:
        assert _direction_for_delta(10, higher_is_better=False) == "a_better"

    def test_direction_lower_is_better_negative(self) -> None:
        assert _direction_for_delta(-8, higher_is_better=False) == "b_better"

    def test_direction_zero_neutral(self) -> None:
        assert _direction_for_delta(0, higher_is_better=True) == "neutral"
        assert _direction_for_delta(0, higher_is_better=False) == "neutral"


class TestBuildSettings:
    """_build_settings 辅助函数测试。"""

    def test_overrides_single_field(self) -> None:
        s = _build_settings({"recall_top_k": 10})
        assert s.recall_top_k == 10
        assert s.embed_dim == 384  # 默认值不变

    def test_overrides_multiple_fields(self) -> None:
        s = _build_settings({"recall_top_k": 7, "recall_threshold": 0.5})
        assert s.recall_top_k == 7
        assert s.recall_threshold == 0.5

    def test_none_values_skipped(self) -> None:
        s = _build_settings({"recall_top_k": None, "embed_dim": 256})
        assert s.recall_top_k == 5  # 默认值
        assert s.embed_dim == 256


class TestPresets:
    """预设定义测试。"""

    def test_all_presets_valid(self) -> None:
        for _key, preset in EXPERIMENT_PRESETS.items():
            settings_a = _build_settings(preset["settings_a"])  # type: ignore[arg-type]
            settings_b = _build_settings(preset["settings_b"])  # type: ignore[arg-type]
            assert isinstance(settings_a, Settings)
            assert isinstance(settings_b, Settings)
            assert settings_a != settings_b

    def test_preset_merges_with_defaults(self) -> None:
        preset = EXPERIMENT_PRESETS["recall_top_k_3_vs_7"]
        s = _build_settings(preset["settings_a"])  # type: ignore[arg-type]
        assert s.embed_dim == 384
        assert s.embed_model == "all-MiniLM-L6-v2"


class TestExperimentRunner:
    """ExperimentRunner 集成测试。"""

    @patch(
        "src.chat.engine.ChatEngine.generate",
        return_value=("你好！我是 AI 助手。", {}, {}),
    )
    def test_run_returns_two_results(self, _mock_generate: object, tmp_path: Path) -> None:
        runner = ExperimentRunner()
        a_settings = Settings.from_flat(data_dir=tmp_path, recall_top_k=5)
        b_settings = Settings.from_flat(data_dir=tmp_path, recall_top_k=7)

        result_a, result_b = runner.run(
            user_input="我喜欢猫",
            settings_a=a_settings,
            settings_b=b_settings,
            label_a="Baseline",
            label_b="Variant",
        )
        assert result_a.label == "Baseline"
        assert result_b.label == "Variant"
        assert isinstance(result_a, ExperimentResult)
        assert isinstance(result_b, ExperimentResult)

    @patch(
        "src.chat.engine.ChatEngine.generate",
        return_value=("回复", {}, {}),
    )
    def test_run_recall_empty_for_fresh_db(self, _mock_generate: object, tmp_path: Path) -> None:
        runner = ExperimentRunner()
        s = Settings.from_flat(data_dir=tmp_path)
        result_a, result_b = runner.run("测试", s, s, "A", "B")
        # 空数据库召回为 0
        assert result_a.recalled_count == 0
        assert result_b.recalled_count == 0

    @patch(
        "src.chat.engine.ChatEngine.generate",
        return_value=("OK", {}, {}),
    )
    def test_run_stores_user_message(self, _mock_generate: object, tmp_path: Path) -> None:
        runner = ExperimentRunner()
        s = Settings.from_flat(data_dir=tmp_path)
        result_a, result_b = runner.run("Hello", s, s, "A", "B")
        # 用户消息已存储，响应也应存储
        assert result_a.response_text == "OK"
        assert result_b.response_text == "OK"

    @patch(
        "src.chat.engine.ChatEngine.generate",
        return_value=("回复", {}, {}),
    )
    def test_run_different_settings_produce_results(
        self, _mock_generate: object, tmp_path: Path
    ) -> None:
        runner = ExperimentRunner()
        a_settings = Settings.from_flat(data_dir=tmp_path, recall_top_k=3)
        b_settings = Settings.from_flat(data_dir=tmp_path, recall_top_k=10)
        result_a, result_b = runner.run("测试", a_settings, b_settings)
        # 两个结果关联的 Settings 不同
        assert result_a.settings.recall_top_k == 3
        assert result_b.settings.recall_top_k == 10

    @patch(
        "src.chat.engine.ChatEngine.generate",
        return_value=("测试回复", {}, {}),
    )
    def test_run_records_chat_tokens(self, _mock_generate: object, tmp_path: Path) -> None:
        runner = ExperimentRunner()
        s = Settings.from_flat(data_dir=tmp_path)
        result_a, _ = runner.run("测试", s, s, "A", "B")
        assert result_a.response_text == "测试回复"
        # token 数据来自 mock（usage 为 None 时 ledger 不记录）
        # 此处仅验证不崩溃

    @patch(
        "src.chat.engine.ChatEngine.generate",
        side_effect=RuntimeError("API key 缺失"),
    )
    def test_run_graceful_on_api_error(self, _mock_generate: object, tmp_path: Path) -> None:
        runner = ExperimentRunner()
        s = Settings.from_flat(data_dir=tmp_path)
        result_a, result_b = runner.run("测试", s, s, "A", "B")
        # API 错误时返回空响应而非崩溃
        assert result_a.response_text == ""
        assert result_b.response_text == ""

    @patch(
        "src.chat.engine.ChatEngine.generate",
        return_value=("OK", {}, {}),
    )
    def test_run_compare_identical_settings(self, _mock_generate: object, tmp_path: Path) -> None:
        runner = ExperimentRunner()
        s = Settings.from_flat(data_dir=tmp_path)
        result_a, result_b = runner.run("测试", s, s, "A", "B")
        diffs = compare_results(result_a, result_b)
        # 相同 Settings，相同输入 → 召回数相同 → 所有 diff neutral
        for d in diffs:
            if d.dimension == "recall_count":
                assert d.direction == "neutral"
