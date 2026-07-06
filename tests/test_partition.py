"""Tests for context partition computation and recall item summarization."""

from src.context.partition import ZonePartition, compute_partitions, summarize_recall_item


def _base_meta(**overrides: object) -> dict[str, object]:
    """Build a minimal valid context_meta dict for testing."""
    meta: dict[str, object] = {
        "window_size": 4096,
        "base_tokens": 80,
        "memories_before": 5,
        "memories_token_before": 300,
        "memories_after": 5,
        "overflow_applied": False,
        "strategy": "prioritize",
        "dropped_count": 0,
        "dropped_items": [],
        "user_message_tokens": 50,
        "total_estimated_tokens": 430,
        "system_prompt": (
            "你是一个有记忆的 AI 助手。\n\n## 对话记忆\n- test content\n\n请参考这些记忆..."
        ),
    }
    meta.update(overrides)
    return meta


def _make_recalled(
    count: int = 3,
    row_type: str = "episode",
) -> list[dict[str, object]]:
    """Build minimal recalled items for testing."""
    return [
        {
            "content": f"test memory {i}",
            "_row_type": row_type,
            "composite_score": 0.8 - i * 0.1,
        }
        for i in range(count)
    ]


class TestComputePartitionsNormal:
    def test_basic_four_zones(self) -> None:
        meta = _base_meta()
        recalled = _make_recalled()
        result = compute_partitions(meta, recalled_items=recalled, user_input="hello")

        assert not result.is_empty
        assert len(result.zones) == 4
        assert result.window_size == 4096
        assert result.total_tokens == 430

        zone_keys = [z.zone_key for z in result.zones]
        assert zone_keys == ["system", "recalled", "history", "tools"]

    def test_percentages_sum_to_usage(self) -> None:
        meta = _base_meta()
        result = compute_partitions(meta, user_input="hello")

        zone_pct_sum = sum(z.percentage for z in result.zones)
        assert abs(zone_pct_sum - result.usage_pct) < 1.0

    def test_total_matches_sum_of_zones(self) -> None:
        meta = _base_meta()
        result = compute_partitions(meta)

        zone_total = sum(z.tokens for z in result.zones)
        assert zone_total == result.total_tokens

    def test_overflow_flag_false_when_no_overflow(self) -> None:
        meta = _base_meta(overflow_applied=False)
        result = compute_partitions(meta)

        assert not result.overflow_occurred
        assert result.overflow_details == ""

    def test_overflow_flag_true_with_details(self) -> None:
        meta = _base_meta(
            overflow_applied=True,
            dropped_count=3,
            strategy="prioritize",
            total_estimated_tokens=380,
        )
        result = compute_partitions(meta)

        assert result.overflow_occurred
        assert "舍弃 3 条" in result.overflow_details
        assert "prioritize" in result.overflow_details


class TestComputePartitionsEmpty:
    def test_none_meta_returns_empty(self) -> None:
        result = compute_partitions(None)
        assert result.is_empty
        assert result.total_tokens == 0

    def test_empty_dict_returns_empty(self) -> None:
        result = compute_partitions({})
        assert result.is_empty

    def test_zero_total_returns_empty(self) -> None:
        meta = _base_meta(total_estimated_tokens=0)
        result = compute_partitions(meta)
        assert result.is_empty


class TestComputePartitionsEdgeCases:
    def test_tools_zone_always_zero(self) -> None:
        meta = _base_meta()
        result = compute_partitions(meta)

        tools = next(z for z in result.zones if z.zone_key == "tools")
        assert tools.tokens == 0
        assert tools.is_empty

    def test_recalled_tokens_derived_correctly(self) -> None:
        # total_estimated = base + recalled_kept + user, so recalled = total - base - user
        meta = _base_meta(
            base_tokens=100,
            user_message_tokens=60,
            total_estimated_tokens=400,
        )
        result = compute_partitions(meta)

        recalled = next(z for z in result.zones if z.zone_key == "recalled")
        assert recalled.tokens == 240  # 400 - 100 - 60

    def test_recalled_floor_at_zero(self) -> None:
        # If total < base + user (shouldn't happen but be safe)
        meta = _base_meta(
            base_tokens=100,
            user_message_tokens=60,
            total_estimated_tokens=100,
        )
        result = compute_partitions(meta)

        recalled = next(z for z in result.zones if z.zone_key == "recalled")
        assert recalled.tokens == 0
        assert recalled.is_empty


class TestComputePartitionsDetailItems:
    def test_system_zone_has_prompt(self) -> None:
        meta = _base_meta(system_prompt="test system prompt text")
        result = compute_partitions(meta)

        sys_zone = next(z for z in result.zones if z.zone_key == "system")
        assert len(sys_zone.items) == 1
        assert sys_zone.items[0]["content"] == "test system prompt text"
        assert sys_zone.items[0]["kind"] == "text"

    def test_history_zone_has_user_input(self) -> None:
        meta = _base_meta()
        result = compute_partitions(meta, user_input="hello world")

        hist_zone = next(z for z in result.zones if z.zone_key == "history")
        assert len(hist_zone.items) == 1
        assert hist_zone.items[0]["content"] == "hello world"

    def test_history_zone_empty_when_no_input(self) -> None:
        meta = _base_meta()
        result = compute_partitions(meta, user_input="")

        hist_zone = next(z for z in result.zones if z.zone_key == "history")
        assert len(hist_zone.items) == 0

    def test_tools_zone_empty_items(self) -> None:
        meta = _base_meta()
        result = compute_partitions(meta)

        tools_zone = next(z for z in result.zones if z.zone_key == "tools")
        assert tools_zone.items == []

    def test_recalled_detail_with_kept_items(self) -> None:
        meta = _base_meta(overflow_applied=False, dropped_items=[])
        recalled = _make_recalled(count=3)
        result = compute_partitions(meta, recalled_items=recalled)

        rec_zone = next(z for z in result.zones if z.zone_key == "recalled")
        assert len(rec_zone.items) == 3
        assert all(item["kept"] for item in rec_zone.items)

    def test_recalled_detail_marks_dropped(self) -> None:
        dropped_preview = "dropped memory testi"
        meta = _base_meta(
            overflow_applied=True,
            dropped_count=1,
            dropped_items=[dropped_preview],
        )
        recalled = [
            {
                "content": "dropped memory testing something long",
                "_row_type": "episode",
                "composite_score": 0.1,
            },
            {"content": "kept memory alpha", "_row_type": "episode", "composite_score": 0.9},
        ]
        result = compute_partitions(meta, recalled_items=recalled)

        rec_zone = next(z for z in result.zones if z.zone_key == "recalled")
        # Sorted by score descending: kept (0.9) then dropped (0.1)
        assert rec_zone.items[0]["kept"] is True
        assert rec_zone.items[1]["kept"] is False

    def test_recalled_detail_sorted_by_score(self) -> None:
        meta = _base_meta()
        recalled = [
            {"content": "low score", "_row_type": "episode", "composite_score": 0.3},
            {"content": "high score", "_row_type": "fact", "composite_score": 0.9},
            {"content": "mid score", "_row_type": "episode", "composite_score": 0.6},
        ]
        result = compute_partitions(meta, recalled_items=recalled)

        rec_zone = next(z for z in result.zones if z.zone_key == "recalled")
        scores = [
            float(s) if isinstance(s, (int, float)) else 0.0
            for s in (item["score"] for item in rec_zone.items)
        ]
        assert scores == sorted(scores, reverse=True)

    def test_empty_recalled_items(self) -> None:
        meta = _base_meta()
        result = compute_partitions(meta, recalled_items=None)

        rec_zone = next(z for z in result.zones if z.zone_key == "recalled")
        assert rec_zone.items == []


class TestZonePartitionFields:
    def test_fields_assigned(self) -> None:
        zone = ZonePartition(
            zone_key="system",
            label="系统提示",
            tokens=100,
            percentage=25.0,
            color="var(--gm-info)",
            emoji="⚙️",
        )
        assert zone.zone_key == "system"
        assert zone.tokens == 100
        assert zone.is_empty is False

    def test_empty_when_zero_tokens(self) -> None:
        zone = ZonePartition(
            zone_key="tools",
            label="工具定义",
            tokens=0,
            percentage=0.0,
            color="var(--gm-text-muted)",
            emoji="🛠️",
        )
        assert zone.is_empty is True


class TestSummarizeRecallItem:
    """Tests for summarize_recall_item — 召回条目一行摘要提取。"""

    # ── 事实 (fact) 摘要 ──

    def test_fact_structured_triple(self) -> None:
        """事实优先使用 subject/relation/object 结构化字段。"""
        item: dict[str, object] = {
            "_row_type": "fact",
            "content": "用户偏好 — 编辑器 → VS Code",
            "subject": "用户偏好",
            "relation": "编辑器",
            "object": "VS Code",
        }
        result = summarize_recall_item(item)
        assert result == "用户偏好 — 编辑器 → VS Code"

    def test_fact_missing_structured_fallback_to_content(self) -> None:
        """事实缺少 subject/relation/object 时回退到 content。"""
        item: dict[str, object] = {
            "_row_type": "fact",
            "content": "some fallback content",
            "subject": "",
            "relation": "",
            "object": "",
        }
        result = summarize_recall_item(item)
        assert result == "some fallback content"

    def test_fact_partial_structured(self) -> None:
        """事实只有部分结构化字段时回退到 content。"""
        item: dict[str, object] = {
            "_row_type": "fact",
            "content": "full content here",
            "subject": "用户",
            "relation": "",
            "object": "",
        }
        result = summarize_recall_item(item)
        assert result == "full content here"

    # ── 情节 (episode) 摘要 ──

    def test_episode_parses_triple_format(self) -> None:
        """情节 content 符合 Triple 格式时解析为摘要。"""
        item: dict[str, object] = {
            "_row_type": "episode",
            "content": "用户 — 喜欢 → Python 类型提示",
        }
        result = summarize_recall_item(item)
        assert result == "用户 — 喜欢 → Python 类型提示"

    def test_episode_free_text_uses_content(self) -> None:
        """情节 content 不符合 Triple 格式时使用原文。"""
        item: dict[str, object] = {
            "_row_type": "episode",
            "content": "用户昨天讨论了关于 FastAPI 框架的优缺点",
        }
        result = summarize_recall_item(item)
        assert result == "用户昨天讨论了关于 FastAPI 框架的优缺点"

    def test_episode_default_row_type(self) -> None:
        """缺少 _row_type 时默认视为 episode。"""
        item: dict[str, object] = {
            "content": "默认类型的记忆内容",
        }
        result = summarize_recall_item(item)
        assert result == "默认类型的记忆内容"

    # ── 截断行为 ──

    def test_truncation_long_content(self) -> None:
        """超过 max_len 时截断并加省略号。"""
        item: dict[str, object] = {
            "_row_type": "episode",
            "content": (
                "这是一段非常长的记忆内容，包含了大量细节信息，"
                "用户详细描述了关于项目的各种技术决策和设计思路"
            ),
        }
        result = summarize_recall_item(item, max_len=30)
        assert len(result) <= 30
        assert result.endswith("…")

    def test_no_truncation_short_content(self) -> None:
        """未超过 max_len 时不截断。"""
        item: dict[str, object] = {
            "_row_type": "episode",
            "content": "简短内容",
        }
        result = summarize_recall_item(item, max_len=80)
        assert result == "简短内容"
        assert "…" not in result

    def test_exact_max_len_no_truncation(self) -> None:
        """恰好等于 max_len 时不截断。"""
        exact = "a" * 40
        item: dict[str, object] = {"_row_type": "episode", "content": exact}
        result = summarize_recall_item(item, max_len=40)
        assert result == exact
        assert "…" not in result

    def test_truncation_handles_multibyte_chars(self) -> None:
        """截断正确处理多字节字符（中文 3 字节/char）。"""
        item: dict[str, object] = {
            "_row_type": "episode",
            "content": "你好世界甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥",
        }
        result = summarize_recall_item(item, max_len=10)
        # 10 chars: 9 content chars + "…"
        assert len(result) <= 10
        assert result.endswith("…")

    def test_custom_max_len(self) -> None:
        """支持自定义 max_len。"""
        item: dict[str, object] = {
            "_row_type": "episode",
            "content": "a" * 150,
        }
        result = summarize_recall_item(item, max_len=50)
        assert len(result) <= 50
        assert result.endswith("…")

    # ── 边界与空值 ──

    def test_empty_content(self) -> None:
        """空 content 返回空字符串。"""
        item: dict[str, object] = {"_row_type": "episode", "content": ""}
        result = summarize_recall_item(item)
        assert result == ""

    def test_missing_content_key(self) -> None:
        """缺少 content 键返回空字符串。"""
        item: dict[str, object] = {"_row_type": "episode"}
        result = summarize_recall_item(item)
        assert result == ""

    def test_fact_with_all_missing(self) -> None:
        """事实既无结构化字段也无 content——返回空字符串。"""
        item: dict[str, object] = {"_row_type": "fact"}
        result = summarize_recall_item(item)
        assert result == ""

    def test_truncation_minimal_max_len(self) -> None:
        """极小 max_len=1 时只返回省略号。"""
        item: dict[str, object] = {"_row_type": "episode", "content": "something"}
        result = summarize_recall_item(item, max_len=1)
        assert result == "…"

    def test_fact_triple_long_truncated(self) -> None:
        """事实三元组摘要过长时也截断。"""
        long_subject = "非常长的主题文本" * 5
        long_relation = "非常长的关系文本" * 5
        long_object = "非常长的客体文本" * 5
        item: dict[str, object] = {
            "_row_type": "fact",
            "content": "ignored because structured wins",
            "subject": long_subject,
            "relation": long_relation,
            "object": long_object,
        }
        result = summarize_recall_item(item, max_len=40)
        assert len(result) <= 40
        assert result.endswith("…")

    def test_fact_structured_exact_max_len(self) -> None:
        """事实三元组摘要恰好等于 max_len。"""
        s = "S" * 10
        r = "R" * 10
        o = "O" * 12  # total = 10 + 3(" — ") + 10 + 3(" → ") + 12 = 38
        # Actually let's compute: s + " — " + r + " → " + o, total = 10+3+10+3+12 = 38
        item: dict[str, object] = {
            "_row_type": "fact",
            "subject": s,
            "relation": r,
            "object": o,
        }
        result = summarize_recall_item(item, max_len=38)
        assert len(result) == 38
        assert "…" not in result
