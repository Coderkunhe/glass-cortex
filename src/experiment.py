"""A/B 实验框架 — 同一输入跑两套 Settings，量化对比差异。

数据模型 (ExperimentResult / ExperimentDiff) + 比较器 + ExperimentRunner。
"""

from __future__ import annotations

import tempfile
import uuid
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import cast

from src.config import Settings
from src.embed import embed


@dataclass(frozen=True)
class ExperimentResult:
    """一次实验运行的结果快照。"""

    label: str
    settings: Settings
    recalled_count: int = 0
    recalled_contents: list[str] = field(default_factory=list)
    response_text: str = ""
    response_length: int = 0
    chat_prompt_tokens: int = 0
    chat_completion_tokens: int = 0
    chat_total_tokens: int = 0
    fact_prompt_tokens: int = 0
    fact_completion_tokens: int = 0
    fact_total_tokens: int = 0
    facts_extracted: int = 0
    fact_contents: list[str] = field(default_factory=list)
    db_path: str = ""


@dataclass(frozen=True)
class ExperimentDiff:
    """单个维度的 A/B 差异。"""

    dimension: str
    label_a: str
    label_b: str
    value_a: object
    value_b: object
    delta: str
    direction: str  # "a_better" | "b_better" | "neutral"
    detail: str | None = None


def compare_results(result_a: ExperimentResult, result_b: ExperimentResult) -> list[ExperimentDiff]:
    """对比两个实验结果，返回各维度差异列表。"""
    diffs: list[ExperimentDiff] = []

    # 召回数量
    recall_diff = result_b.recalled_count - result_a.recalled_count
    diffs.append(
        ExperimentDiff(
            dimension="recall_count",
            label_a=result_a.label,
            label_b=result_b.label,
            value_a=result_a.recalled_count,
            value_b=result_b.recalled_count,
            delta=f"{recall_diff:+d}",
            direction=_direction_for_delta(recall_diff, higher_is_better=True),
            detail=f"A 召回 {result_a.recalled_count} 条，B 召回 {result_b.recalled_count} 条",
        )
    )

    # 召回重叠度 (Jaccard)
    jaccard = _jaccard_similarity(result_a.recalled_contents, result_b.recalled_contents)
    diffs.append(
        ExperimentDiff(
            dimension="recall_overlap",
            label_a=result_a.label,
            label_b=result_b.label,
            value_a=None,
            value_b=None,
            delta=f"{jaccard:.0%}",
            direction="neutral",
            detail=f"召回内容 Jaccard 重叠度: {jaccard:.0%}",
        )
    )

    # 聊天 Token 消耗
    chat_delta = result_b.chat_total_tokens - result_a.chat_total_tokens
    diffs.append(
        ExperimentDiff(
            dimension="chat_token_usage",
            label_a=result_a.label,
            label_b=result_b.label,
            value_a=result_a.chat_total_tokens,
            value_b=result_b.chat_total_tokens,
            delta=f"{chat_delta:+d}",
            direction=_direction_for_delta(chat_delta, higher_is_better=False),
            detail=(
                f"A: prompt={result_a.chat_prompt_tokens} "
                f"completion={result_a.chat_completion_tokens} | "
                f"B: prompt={result_b.chat_prompt_tokens} "
                f"completion={result_b.chat_completion_tokens}"
            ),
        )
    )

    # 事实抽取 Token 消耗
    fact_delta = result_b.fact_total_tokens - result_a.fact_total_tokens
    diffs.append(
        ExperimentDiff(
            dimension="fact_token_usage",
            label_a=result_a.label,
            label_b=result_b.label,
            value_a=result_a.fact_total_tokens,
            value_b=result_b.fact_total_tokens,
            delta=f"{fact_delta:+d}",
            direction=_direction_for_delta(fact_delta, higher_is_better=False),
            detail=(
                f"A: prompt={result_a.fact_prompt_tokens} "
                f"completion={result_a.fact_completion_tokens} | "
                f"B: prompt={result_b.fact_prompt_tokens} "
                f"completion={result_b.fact_completion_tokens}"
            ),
        )
    )

    # 事实数量
    fact_diff = result_b.facts_extracted - result_a.facts_extracted
    diffs.append(
        ExperimentDiff(
            dimension="fact_count",
            label_a=result_a.label,
            label_b=result_b.label,
            value_a=result_a.facts_extracted,
            value_b=result_b.facts_extracted,
            delta=f"{fact_diff:+d}",
            direction=_direction_for_delta(fact_diff, higher_is_better=True),
            detail=(
                f"A 提取 {result_a.facts_extracted} 条事实，"
                f"B 提取 {result_b.facts_extracted} 条事实"
            ),
        )
    )

    # 响应长度
    len_diff = result_b.response_length - result_a.response_length
    diffs.append(
        ExperimentDiff(
            dimension="response_length",
            label_a=result_a.label,
            label_b=result_b.label,
            value_a=result_a.response_length,
            value_b=result_b.response_length,
            delta=f"{len_diff:+d}",
            direction="neutral",
            detail=f"A: {result_a.response_length} 字符，B: {result_b.response_length} 字符",
        )
    )

    return diffs


def _jaccard_similarity(items_a: list[str], items_b: list[str]) -> float:
    """计算两组文本的 Jaccard 相似度（基于词汇集合）。"""
    if not items_a and not items_b:
        return 1.0
    words_a = set(" ".join(items_a).split())
    words_b = set(" ".join(items_b).split())
    if not words_a and not words_b:
        return 1.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union) if union else 0.0


def _direction_for_delta(delta: int, *, higher_is_better: bool) -> str:
    """根据 delta 和优化方向判断哪个更好。"""
    if delta == 0:
        return "neutral"
    if higher_is_better:
        return "b_better" if delta > 0 else "a_better"
    return "a_better" if delta > 0 else "b_better"


# ── 实验预设 ──

EXPERIMENT_PRESETS: dict[str, dict[str, object]] = {
    "recall_top_k_3_vs_7": {
        "label_a": "top_k=3 (保守)",
        "label_b": "top_k=7 (激进)",
        "settings_a": {"recall_top_k": 3},
        "settings_b": {"recall_top_k": 7},
    },
    "boost_0.1_vs_0.5": {
        "label_a": "boost=0.1 (慢增强)",
        "label_b": "boost=0.5 (快增强)",
        "settings_a": {"strengthen_boost": 0.1},
        "settings_b": {"strengthen_boost": 0.5},
    },
    "threshold_0.05_vs_0.3": {
        "label_a": "threshold=0.05 (宽松)",
        "label_b": "threshold=0.3 (严格)",
        "settings_a": {"recall_threshold": 0.05},
        "settings_b": {"recall_threshold": 0.3},
    },
    "search_k_10_vs_40": {
        "label_a": "search_k=10",
        "label_b": "search_k=40",
        "settings_a": {"recall_search_k": 10},
        "settings_b": {"recall_search_k": 40},
    },
}


def _build_settings(overrides: dict[str, object]) -> Settings:
    """用 override dict 构造 Settings 实例，未指定的字段使用默认值。

    B77: 委托到 Settings.from_flat()，字段路由由 Settings 集中管理。
    """
    return Settings.from_flat(**{k: v for k, v in overrides.items() if v is not None})


# ── 实验运行器 ──


class ExperimentRunner:
    """A/B 实验执行器 — 同一输入在两套 Settings 下各跑一次完整管线。"""

    def run(
        self,
        user_input: str,
        settings_a: Settings,
        settings_b: Settings,
        label_a: str = "A",
        label_b: str = "B",
    ) -> tuple[ExperimentResult, ExperimentResult]:
        """执行 A/B 实验，返回两个实验结果。"""
        result_a = self._run_single_pipeline(
            user_input=user_input,
            settings_override=settings_a,
            label=label_a,
        )
        result_b = self._run_single_pipeline(
            user_input=user_input,
            settings_override=settings_b,
            label=label_b,
        )
        return result_a, result_b

    @staticmethod
    def _run_single_pipeline(
        user_input: str,
        settings_override: Settings,
        label: str,
    ) -> ExperimentResult:
        """在指定 Settings 下运行完整管线，返回结果快照。

        管线顺序与 app.py 一致：decay → recall → store user msg →
        generate & store response → extract facts。

        每次调用创建独立的临时数据目录，确保 A/B 运行互不污染。
        """
        from src.bootstrap import init_engines

        # 隔离数据目录：A/B 不能共享 DB，否则后运行的会看到先运行的数据
        tmp_root = Path(tempfile.gettempdir()) / "memory_experiments"
        tmp_root.mkdir(parents=True, exist_ok=True)
        iso_dir = tmp_root / f"{label}_{uuid.uuid4().hex[:8]}"
        iso_dir.mkdir(parents=True, exist_ok=True)
        iso_settings = replace(
            settings_override,
            paths=replace(settings_override.paths, data_dir=iso_dir),
        )

        engines = init_engines(settings_override=iso_settings)
        store, idx, recall_engine, forgetting, chat, ledger, _planner = engines

        try:
            # 1. 遗忘衰减
            forgetting.decay_all()

            # 2. 召回
            recalled = recall_engine.recall(user_input)

            # 3. 存储用户消息（与 app.py Storage Phase S1-S3 一致）
            user_vec = embed(user_input)
            faiss_ids = idx.add(user_vec.reshape(1, -1))
            store.add_episode(
                content=user_input,
                importance=settings_override.default_importance,
                faiss_id=faiss_ids[0],
            )

            # 4. 生成回复 + 存储 AI 回复 + 事实抽取（generate_and_store 一步完成）
            try:
                response_text, _eid, _ctx, _trace = chat.generate_and_store(user_input, recalled)
            except RuntimeError:
                response_text = ""

            # 5. 收集 token 数据
            token_summary = ledger.summary()
            chat_tokens = token_summary.get("chat", {})
            fact_tokens = token_summary.get("fact_extraction", {})

            # 6. 收集事实内容
            all_facts = store.get_all_facts()
            fact_contents = [f["content"] for f in all_facts]

            # 7. 收集召回内容
            recalled_contents = [cast(str, r.get("content", "")) for r in recalled]

            return ExperimentResult(
                label=label,
                settings=settings_override,
                recalled_count=len(recalled),
                recalled_contents=recalled_contents,
                response_text=response_text,
                response_length=len(response_text),
                chat_prompt_tokens=chat_tokens.get("prompt_tokens", 0),
                chat_completion_tokens=chat_tokens.get("completion_tokens", 0),
                chat_total_tokens=chat_tokens.get("total_tokens", 0),
                fact_prompt_tokens=fact_tokens.get("prompt_tokens", 0),
                fact_completion_tokens=fact_tokens.get("completion_tokens", 0),
                fact_total_tokens=fact_tokens.get("total_tokens", 0),
                facts_extracted=len(fact_contents),
                fact_contents=fact_contents,
                db_path=str(iso_settings.resolved_db_path),
            )
        finally:
            try:
                idx.save(str(iso_settings.resolved_index_path))
            except OSError, RuntimeError:
                pass
            store.close()
