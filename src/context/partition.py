"""上下文窗口分区计算——四区 Token 拆解 + 召回条目概要化。

系统提示 / 记忆召回 / 对话历史 / 工具定义 / 一行摘要
"""

from dataclasses import dataclass, field
from typing import cast

_ZONE_DEFS: list[dict[str, str]] = [
    {"key": "system", "label": "系统提示", "color": "var(--gm-info)", "emoji": "⚙️"},
    {"key": "recalled", "label": "记忆召回", "color": "var(--gm-success)", "emoji": "🧠"},
    {"key": "history", "label": "对话历史", "color": "var(--gm-brand)", "emoji": "💬"},
    {"key": "tools", "label": "工具定义", "color": "var(--gm-text-muted)", "emoji": "🛠️"},
]


@dataclass
class ZonePartition:
    """上下文窗口单分区——zone_key/标签/token 数/占比/颜色/emoji。"""

    zone_key: str
    label: str
    tokens: int
    percentage: float
    color: str
    emoji: str
    items: list[dict[str, object]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.is_empty = self.tokens == 0


@dataclass
class ContextPartitions:
    """上下文窗口分区集合——四区（system/recalled/history/tools）+ 溢出状态。"""

    zones: list[ZonePartition]
    total_tokens: int
    window_size: int
    usage_pct: float
    overflow_occurred: bool
    overflow_details: str
    is_empty: bool
    recalled_tokens_before: int = 0  # 优化前 recalled zone token 数（压缩/截断前）


def compute_partitions(
    context_meta: dict[str, object] | None,
    recalled_items: list[dict[str, object]] | None = None,
    user_input: str = "",
    recalled_tokens_before: int = 0,
) -> ContextPartitions:
    """从 ChatEngine 上下文元数据计算四区 Token 分区。

    Zone mapping:
      system   → base_tokens (system prompt overhead)
      recalled → memories kept after overflow (derived)
      history  → user_message_tokens (current input)
      tools    → 0 (no tool definitions)
    """
    if not context_meta:
        return _empty()

    base = cast(int, context_meta.get("base_tokens", 0))
    user = cast(int, context_meta.get("user_message_tokens", 0))
    total = cast(int, context_meta.get("total_estimated_tokens", 0))
    window = cast(int, context_meta.get("window_size", 4096))

    if total == 0:
        return _empty()

    recalled_tokens = max(0, total - base - user)
    tokens_by_key = {
        "system": base,
        "recalled": recalled_tokens,
        "history": user,
        "tools": 0,
    }

    recalled_detail = _build_recalled_detail(recalled_items, context_meta)
    overflow = cast(bool, context_meta.get("overflow_applied", False))

    zones: list[ZonePartition] = []
    for zd in _ZONE_DEFS:
        key = zd["key"]
        t = tokens_by_key[key]
        pct = (t / window * 100) if window > 0 else 0.0
        items: list[dict[str, object]] = []
        if key == "system":
            sp = str(context_meta.get("system_prompt", ""))
            if sp:
                items = [{"kind": "text", "content": sp}]
        elif key == "recalled":
            items = recalled_detail
        elif key == "history":
            if user_input:
                items = [{"kind": "text", "content": user_input}]
        zones.append(
            ZonePartition(
                zone_key=key,
                label=zd["label"],
                tokens=t,
                percentage=round(pct, 1),
                color=zd["color"],
                emoji=zd["emoji"],
                items=items,
            )
        )

    usage_pct = round(total / window * 100, 1) if window > 0 else 0.0
    overflow_details = ""
    if overflow:
        dropped_count = cast(int, context_meta.get("dropped_count", 0))
        strategy = str(context_meta.get("strategy", ""))
        overflow_details = f"{strategy} 策略触发，舍弃 {dropped_count} 条记忆"

    return ContextPartitions(
        zones=zones,
        total_tokens=total,
        window_size=window,
        usage_pct=usage_pct,
        overflow_occurred=overflow,
        overflow_details=overflow_details,
        is_empty=False,
        recalled_tokens_before=recalled_tokens_before,
    )


def _empty() -> ContextPartitions:
    zones = [
        ZonePartition(
            zone_key=zd["key"],
            label=zd["label"],
            tokens=0,
            percentage=0.0,
            color=zd["color"],
            emoji=zd["emoji"],
        )
        for zd in _ZONE_DEFS
    ]
    return ContextPartitions(
        zones=zones,
        total_tokens=0,
        window_size=0,
        usage_pct=0.0,
        overflow_occurred=False,
        overflow_details="",
        is_empty=True,
        recalled_tokens_before=0,
    )


def _build_recalled_detail(
    recalled_items: list[dict[str, object]] | None,
    context_meta: dict[str, object],
) -> list[dict[str, object]]:
    """为召回分区构建详情项列表。"""
    if not recalled_items:
        return []

    dropped_raw = context_meta.get("dropped_items", [])
    if isinstance(dropped_raw, list):
        dropped_prefixes: set[str] = {str(d) for d in dropped_raw}
    else:
        dropped_prefixes = set()

    items: list[dict[str, object]] = []
    for r in recalled_items:
        content = str(r.get("content", ""))
        row_type = str(r.get("_row_type", "episode"))
        score_raw = r.get("composite_score", 0)
        score = float(score_raw) if isinstance(score_raw, (int, float)) else 0.0

        is_dropped = content[:20] in dropped_prefixes if dropped_prefixes else False
        is_truncated = bool(r.get("_truncated", False))

        items.append(
            {
                "kind": row_type if row_type in ("episode", "fact") else "episode",
                "content": content,
                "score": round(score, 4),
                "kept": not is_dropped and not is_truncated,
            }
        )

    items.sort(key=lambda x: float(cast(float, x["score"])), reverse=True)
    return items


def summarize_recall_item(item: dict[str, object], max_len: int = 80) -> str:
    """从 RecallItem 提取一行摘要——主体+谓词+宾语，超过 max_len 截断。

    将召回条目压缩为可扫描的一行摘要，用于两阶段上下文注入的 Stage 1。
    事实优先使用结构化三元组字段；情节尝试解析 "subject — relation → object" 格式，
    回退到原文前段。

    与 src.memory.triple.Triple 保持相同的序列化格式，但不导入 Triple
    以避免 through-cache 循环导入。

    Args:
        item: 召回条目 dict，至少包含 content 字段。
              facts 可额外携带 subject/relation/object 结构化字段。
        max_len: 最大字符数（含末尾省略号 "…"），默认 80。

    Returns:
        一行摘要字符串，超出 max_len 时截断并以 "…" 结尾。
        空条目返回空字符串。
    """
    content = str(item.get("content", ""))
    row_type = str(item.get("_row_type", "episode"))

    # ── 事实：优先结构化三元组字段 ──
    if row_type == "fact":
        subject = str(item.get("subject", ""))
        relation = str(item.get("relation", ""))
        obj = str(item.get("object", ""))
        if subject and relation and obj:
            summary = f"{subject} — {relation} → {obj}"
        else:
            summary = content
    else:
        # ── 情节：尝试解析 "subject — relation → object" 格式 ──
        summary = _parse_triple_content(content) or content

    # ── 截断到 max_len ──
    if not summary:
        return ""
    if len(summary) <= max_len:
        return summary
    return summary[: max_len - 1] + "…"


def _parse_triple_content(content: str) -> str | None:
    """尝试从 content 解析 Triple 格式，与 src.memory.triple.Triple 一致。

    格式：subject — relation → object
    无法解析返回 None（调用方回退到原始 content）。
    """
    sep = " — "
    arrow = " → "
    sep_pos = content.find(sep)
    if sep_pos == -1:
        return None
    arrow_pos = content.find(arrow, sep_pos + len(sep))
    if arrow_pos == -1:
        return None
    subject = content[:sep_pos]
    relation = content[sep_pos + len(sep) : arrow_pos]
    obj = content[arrow_pos + len(arrow) :]
    if not subject or not relation or not obj:
        return None
    return f"{subject}{sep}{relation}{arrow}{obj}"
