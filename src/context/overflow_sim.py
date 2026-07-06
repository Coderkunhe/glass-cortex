"""上下文溢出模拟引擎——ChatEngine 溢出逻辑的纯函数复现。

Produces structured OverflowSimResult for each strategy without touching
the production chat pipeline. Used by the lab sandbox and nutrition label.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import cast

STRATEGY_PERSONAS: dict[str, dict[str, str]] = {
    "truncate": {
        "name": "守门员",
        "subtitle": "严格先到先出",
        "icon": "ri-door-line",
        "description": (
            "按时间顺序保留记忆，最早进入的先被丢弃。简单粗暴，不偏不倚——"
            "但重要的旧记忆可能被不重要的新记忆挤掉。"
        ),
        "color": "var(--gm-info)",
    },
    "prioritize": {
        "name": "策展人",
        "subtitle": "只留最好的",
        "icon": "ri-vip-crown-line",
        "description": (
            "按相关度排序，只保留与当前话题最相关的记忆。低相关度的内容会被丢弃——"
            "保证窗口里每条记忆都是精选，但可能丢失多样性。"
        ),
        "color": "var(--gm-success)",
    },
    "summarize": {
        "name": "口述史家",
        "subtitle": "保留故事线",
        "icon": "ri-quill-pen-line",
        "description": (
            "相关度排序 + 高相关保留 + 低相关压缩为一句话摘要。"
            "尽力保留信息完整性，但摘要可能丢失细节。"
        ),
        "color": "var(--gm-accent)",
    },
}

_OVERFLOW_LABELS: dict[str, str] = {
    "truncate": "FIFO 截断",
    "prioritize": "按相关度优先",
    "summarize": "压缩摘要",
}


def estimate_tokens(text: str) -> int:
    """字符级启发式 token 估算（公开 API）。

    使用 CJK 4 字符/token + ASCII 3 字符/token 的启发式规则，
    与真实 BPE tokenizer（tiktoken 等）偏差约 10-20%。
    用于溢出模拟和成本估算，不适用于精确 token 计数。
    """
    if not text:
        return 1
    cjk = sum(1 for c in text if "一" <= c <= "鿿")
    other = len(text) - cjk
    tokens = math.ceil(cjk / 4) + math.ceil(other / 3)
    return max(1, tokens)


@dataclass
class OverflowSimResult:
    """单个策略的溢出模拟输出结果。"""

    strategy: str
    window_size: int
    base_tokens: int
    user_tokens: int
    memories_before: int
    memories_token_before: int
    memories_after: int
    memories_token_after: int
    dropped_count: int
    dropped_items: list[str]
    kept_items: list[dict[str, object]] = field(default_factory=list)
    overflow_triggered: bool = False
    total_estimated_tokens: int = 0
    usage_pct: float = 0.0
    wasted_tokens: int = 0
    summary_line: str = ""

    def __post_init__(self) -> None:
        available = max(0, self.window_size - self.base_tokens)
        self.available_tokens = available
        self.total_estimated_tokens = (
            self.base_tokens + self.memories_token_after + self.user_tokens
        )
        self.usage_pct = (
            round(self.total_estimated_tokens / self.window_size * 100, 1)
            if self.window_size > 0
            else 0.0
        )
        self.wasted_tokens = (self.memories_token_before - self.memories_token_after) + max(
            0, self.window_size - self.total_estimated_tokens
        )

    @property
    def strategy_label(self) -> str:
        return _OVERFLOW_LABELS.get(self.strategy, self.strategy)

    @property
    def persona(self) -> dict[str, str]:
        return STRATEGY_PERSONAS.get(self.strategy, STRATEGY_PERSONAS["prioritize"])


def simulate_overflow(
    recalled: list[dict[str, object]],
    strategy: str = "prioritize",
    window_size: int = 4096,
    user_input: str = "",
    base_tokens_override: int | None = None,
) -> OverflowSimResult:
    """模拟指定策略下的上下文窗口溢出行为。

    Pure function — replicates the overflow logic from
    ChatEngine._build_system_prompt() without building the final prompt.

    Args:
        recalled: Recall results (dicts with content, initial_strength/confidence,
                  importance, _row_type keys).
        strategy: "truncate" | "prioritize" | "summarize"
        window_size: Context window token capacity.
        user_input: User message text (for token estimation).
        base_tokens_override: If set, use this as fixed overhead instead of
                              auto-computing from the recalled items.

    Returns:
        OverflowSimResult with full breakdown.
    """
    user_tokens = estimate_tokens(user_input)

    if not recalled:
        base = (
            base_tokens_override
            if base_tokens_override is not None
            else estimate_tokens(
                "你是一个有记忆的 AI 助手。你正在和一个真实用户对话。用自然、友好的方式回复。"
            )
        )
        return OverflowSimResult(
            strategy=strategy,
            window_size=window_size,
            base_tokens=base,
            user_tokens=user_tokens,
            memories_before=0,
            memories_token_before=0,
            memories_after=0,
            memories_token_after=0,
            dropped_count=0,
            dropped_items=[],
            overflow_triggered=False,
            total_estimated_tokens=base + user_tokens,
        )

    episodes: list[dict[str, object]] = []
    facts: list[dict[str, object]] = []
    for r in recalled:
        if r.get("_row_type") == "fact":
            facts.append(r)
        else:
            episodes.append(r)

    base_header = "你是一个有记忆的 AI 助手。"
    closing = (
        "请参考这些记忆和事实与用户自然地交流。如果某些信息与当前话题相关，"
        "可以在回复中自然地提及，但不要生硬地逐条复述。"
    )
    ep_header = "## 对话记忆"
    fact_header = "## 已知事实"

    # 固定开销：base + closing + section headers + 换行
    fixed_overhead = estimate_tokens(base_header) + estimate_tokens(closing)
    fixed_overhead += estimate_tokens(ep_header) if episodes else 0
    fixed_overhead += estimate_tokens(fact_header) if facts else 0
    fixed_overhead += 3

    base_tokens = base_tokens_override if base_tokens_override is not None else fixed_overhead

    # 构建 memory items（传播 _ref_id 以支持两阶段注入引用追踪）
    memory_items: list[dict[str, object]] = []
    for ep in episodes:
        content = str(ep["content"])
        strength = cast(float, ep.get("initial_strength", 0.5))
        importance = cast(float, ep.get("importance", 0.5))
        line = f"- [强度: {strength:.2f}] {content}"
        item: dict[str, object] = {
            "line": line,
            "content": content,
            "tokens": estimate_tokens(line),
            "score": strength * importance,
            "kind": "episode",
        }
        if "_ref_id" in ep:
            item["_ref_id"] = ep["_ref_id"]
        memory_items.append(item)
    for fact in facts:
        content = str(fact["content"])
        confidence = cast(float, fact.get("confidence", 0.5))
        line = f"- [置信度: {confidence:.2f}] {content}"
        fitem: dict[str, object] = {
            "line": line,
            "content": content,
            "tokens": estimate_tokens(line),
            "score": confidence,
            "kind": "fact",
        }
        if "_ref_id" in fact:
            fitem["_ref_id"] = fact["_ref_id"]
        memory_items.append(fitem)

    memories_before = len(memory_items)
    memories_token_before = sum(cast(int, item["tokens"]) for item in memory_items)
    available = max(0, window_size - base_tokens)

    dropped_items: list[str] = []
    kept: list[dict[str, object]] = []
    overflow_triggered = False
    summary_line = ""

    if available <= 0:
        dropped_items = [str(item["content"])[:20] for item in memory_items]
        overflow_triggered = True
    else:
        total_mem_tokens = sum(cast(int, item["tokens"]) for item in memory_items)
        if total_mem_tokens <= available:
            kept = list(memory_items)
        elif strategy == "truncate":
            acc = 0
            for item in memory_items:
                t = cast(int, item["tokens"])
                if acc + t <= available:
                    kept.append(item)
                    acc += t
                else:
                    dropped_items.append(str(item["content"])[:20])
            overflow_triggered = True
        elif strategy == "summarize":
            sorted_items = sorted(memory_items, key=lambda x: cast(float, x["score"]), reverse=True)
            acc = 0
            for item in sorted_items:
                t = cast(int, item["tokens"])
                if acc + t <= available:
                    kept.append(item)
                    acc += t
                else:
                    dropped_items.append(str(item["content"])[:20])
            if dropped_items:
                preview = "、".join(d for d in dropped_items[:3])
                summary_line = f"[已压缩] 还有 {len(dropped_items)} 条相关记忆：{preview}"
                kept.append(
                    {
                        "line": summary_line,
                        "content": summary_line,
                        "tokens": estimate_tokens(summary_line),
                        "score": 0.0,
                        "kind": "summary",
                    }
                )
            overflow_triggered = True
        else:
            # 优先保留高价值记忆（默认策略）
            sorted_items = sorted(memory_items, key=lambda x: cast(float, x["score"]), reverse=True)
            acc = 0
            for item in sorted_items:
                t = cast(int, item["tokens"])
                if acc + t <= available:
                    kept.append(item)
                    acc += t
                else:
                    dropped_items.append(str(item["content"])[:20])
            overflow_triggered = True

    memories_after = len(kept)
    memories_token_after = sum(cast(int, item["tokens"]) for item in kept)

    return OverflowSimResult(
        strategy=strategy,
        window_size=window_size,
        base_tokens=base_tokens,
        user_tokens=user_tokens,
        memories_before=memories_before,
        memories_token_before=memories_token_before,
        memories_after=memories_after,
        memories_token_after=memories_token_after,
        dropped_count=len(dropped_items),
        dropped_items=dropped_items,
        kept_items=kept,
        overflow_triggered=overflow_triggered,
        summary_line=summary_line,
    )


def compare_strategies(
    recalled: list[dict[str, object]],
    window_size: int = 4096,
    user_input: str = "",
    base_tokens_override: int | None = None,
) -> dict[str, OverflowSimResult]:
    """对同一组数据运行全部三种溢出策略并对比结果。

    Returns dict keyed by strategy name ("truncate" / "prioritize" / "summarize").
    """
    results: dict[str, OverflowSimResult] = {}
    for strategy in ("truncate", "prioritize", "summarize"):
        results[strategy] = simulate_overflow(
            recalled=recalled,
            strategy=strategy,
            window_size=window_size,
            user_input=user_input,
            base_tokens_override=base_tokens_override,
        )
    return results
