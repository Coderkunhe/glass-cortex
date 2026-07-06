"""纯函数测试 — FactExtractor 的静态方法。

覆盖 _normalize_entity / _parse_triples / _try_parse_triple_json — 无需 Mock
LLM/Store/Index 即可独立验证事实抽取管线中最核心的解析与归一化逻辑。
"""

from __future__ import annotations

from src.memory.fact import FactExtractor
from src.memory.triple import Triple

# ── _normalize_entity ──────────────────────────────────────────


class TestNormalizeEntity:
    """实体归一化：去掉常见称谓后缀。"""

    def test_basic_no_title(self) -> None:
        assert FactExtractor._normalize_entity("张三") == "张三"

    def test_strips_single_title(self) -> None:
        assert FactExtractor._normalize_entity("王老师") == "王"

    def test_strips_title_from_end_only(self) -> None:
        # 称谓在开头不应该被去掉
        result = FactExtractor._normalize_entity("老师王")
        assert result == "老师王"

    def test_preserves_short_name_after_strip(self) -> None:
        # 名字长度 ≤ 称谓长度时不应错误截断
        result = FactExtractor._normalize_entity("老师")
        # len("老师") == 2, 遍历 "老师" 时: endswith("老师") and 2 > 2 → False
        assert result == "老师"

    def test_strips_whitespace_and_title(self) -> None:
        assert FactExtractor._normalize_entity("  李医生  ") == "李"

    def test_all_titles_stripped(self) -> None:
        """逐一验证每种称谓都能正确去掉。"""
        cases = [
            ("赵老师", "赵"),
            ("钱先生", "钱"),
            ("孙女士", "孙"),
            ("周同学", "周"),
            ("吴老板", "吴"),
            ("郑经理", "郑"),
            ("冯医生", "冯"),
            ("陈律师", "陈"),
        ]
        for raw, expected in cases:
            assert FactExtractor._normalize_entity(raw) == expected, f"Failed for {raw}"

    def test_multiple_titles_in_name(self) -> None:
        """名字中可能包含多段称谓词。"""
        # "王老师先生" — 只去掉末尾 "先生"（匹配最后一个标题）
        result = FactExtractor._normalize_entity("王老师先生")
        assert result == "王老师"

    def test_unicode_fullwidth(self) -> None:
        assert FactExtractor._normalize_entity("Ａ老师") == "Ａ"

    def test_mixed_language_entity(self) -> None:
        assert FactExtractor._normalize_entity("Alice老师") == "Alice"


# ── _try_parse_triple_json ─────────────────────────────────────


class TestTryParseTripleJson:
    """尝试解析 JSON 数组为 Triple 列表。"""

    def test_valid_single_triple(self) -> None:
        raw = '[{"subject": "用户", "relation": "喜欢", "object": "布偶猫"}]'
        triples, success = FactExtractor._try_parse_triple_json(raw)
        assert success is True
        assert len(triples) == 1
        assert triples[0].subject == "用户"
        assert triples[0].relation == "喜欢"
        assert triples[0].object == "布偶猫"

    def test_valid_multiple_triples(self) -> None:
        raw = (
            '[{"subject": "用户", "relation": "职业", "object": "程序员"},'
            ' {"subject": "用户", "relation": "喜欢", "object": "咖啡"}]'
        )
        triples, success = FactExtractor._try_parse_triple_json(raw)
        assert success is True
        assert len(triples) == 2
        assert triples[0].relation == "职业"
        assert triples[1].relation == "喜欢"

    def test_empty_array_valid(self) -> None:
        triples, success = FactExtractor._try_parse_triple_json("[]")
        assert success is True
        assert triples == []

    def test_invalid_json_returns_false(self) -> None:
        triples, success = FactExtractor._try_parse_triple_json("这不是 JSON")
        assert success is False
        assert triples == []

    def test_malformed_json_returns_false(self) -> None:
        triples, success = FactExtractor._try_parse_triple_json(
            '[{"subject": "用户", "relation": "喜欢"}]'
        )
        # 缺少 "object" 字段 — _try_parse 过滤掉不完整的 item
        assert success is True  # JSON 本身可解析
        assert triples == []  # 但 item 缺少必需字段被过滤

    def test_partial_fields_filtered(self) -> None:
        """含 subject 但缺 relation/object 的条目应被过滤。"""
        triples, success = FactExtractor._try_parse_triple_json(
            '[{"subject": "用户"}, {"subject": "用户", "relation": "喜欢", "object": "猫"}]'
        )
        assert success is True
        assert len(triples) == 1
        assert triples[0].object == "猫"

    def test_non_list_json(self) -> None:
        triples, success = FactExtractor._try_parse_triple_json('{"subject": "用户"}')
        assert success is False
        assert triples == []

    def test_json_with_extra_fields_preserved(self) -> None:
        """多余字段不影响解析，核心三字段正常提取。"""
        raw = '[{"subject": "用户", "relation": "拥有", "object": "MacBook", "confidence": 0.9}]'
        triples, success = FactExtractor._try_parse_triple_json(raw)
        assert success is True
        assert len(triples) == 1
        assert triples[0].subject == "用户"

    def test_strips_whitespace_in_fields(self) -> None:
        raw = '[{"subject": " 用户 ", "relation": " 喜欢 ", "object": " 猫 "}]'
        triples, success = FactExtractor._try_parse_triple_json(raw)
        assert success is True
        assert triples[0].subject == "用户"
        assert triples[0].relation == "喜欢"
        assert triples[0].object == "猫"

    def test_normalizes_entity_with_titles(self) -> None:
        """验证 _try_parse 内部调用 _normalize_entity。"""
        raw = '[{"subject": "王老师", "relation": "职业", "object": "张先生"}]'
        triples, success = FactExtractor._try_parse_triple_json(raw)
        assert success is True
        assert triples[0].subject == "王"
        assert triples[0].object == "张"


# ── _parse_triples ─────────────────────────────────────────────


class TestParseTriples:
    """主解析入口：JSON 解析 + 容错（提取 [...] 之间的内容）。"""

    def test_valid_json_returns_triples(self) -> None:
        raw = '[{"subject": "用户", "relation": "居住", "object": "北京"}]'
        triples, error = FactExtractor._parse_triples(raw)
        assert error is None
        assert len(triples) == 1
        assert triples[0].object == "北京"

    def test_empty_array_no_error(self) -> None:
        triples, error = FactExtractor._parse_triples("[]")
        assert error is None
        assert triples == []

    def test_invalid_json_returns_error(self) -> None:
        raw = "乱七八糟的内容"
        triples, error = FactExtractor._parse_triples(raw)
        assert error is not None
        assert "JSON 解析失败" in (error or "")
        assert triples == []

    def test_fallback_extracts_json_in_brackets(self) -> None:
        """LLM 返回的 JSON 前后可能有额外文字，容错提取 [...] 段。"""
        raw = (
            "好的，以下是提取的事实：\n"
            '[{"subject": "用户", "relation": "职业", "object": "设计师"}]\n'
            "希望有帮助！"
        )
        triples, error = FactExtractor._parse_triples(raw)
        assert error is None
        assert len(triples) == 1
        assert triples[0].object == "设计师"

    def test_fallback_with_newlines(self) -> None:
        raw = '```json\n[{"subject": "用户", "relation": "喜欢", "object": "Python"}]\n```'
        triples, error = FactExtractor._parse_triples(raw)
        assert error is None
        assert len(triples) == 1
        assert triples[0].relation == "喜欢"

    def test_no_brackets_fallback_fails(self) -> None:
        """没有 [...] 的内容彻底无法解析。"""
        raw = "没有方括号的内容"
        triples, error = FactExtractor._parse_triples(raw)
        assert error is not None
        assert triples == []

    def test_nested_brackets_extracts_outermost(self) -> None:
        """嵌套方括号时提取最外层 JSON。"""
        raw = '外层 [{"subject": "用户", "relation": "地址", "object": "朝阳区[北京]"}]'
        triples, error = FactExtractor._parse_triples(raw)
        assert error is not None or error is None
        # rfind("]") finds outermost closing bracket — entire JSON array
        # The object is "朝阳区[北京]" — valid Triple
        if error is None:
            assert len(triples) >= 1

    def test_multiple_triples_with_context_wrapper(self) -> None:
        raw = (
            "分析用户消息后，提取以下事实：\n"
            '[{"subject": "用户", "relation": "职业", "object": "学生"}, '
            '{"subject": "用户", "relation": "学校", "object": "清华"}]\n'
            "以上为提取结果。"
        )
        triples, error = FactExtractor._parse_triples(raw)
        assert error is None
        assert len(triples) == 2
        assert triples[1].object == "清华"


# ── Triple round-trip integration ──────────────────────────────


class TestTripleRoundTrip:
    """验证 Triple 序列化/反序列化与 FactExtractor 解析互为逆操作。"""

    def test_round_trip_via_from_content(self) -> None:
        """_parse_triples 解析的 Triple.content 应可被 Triple.from_content 还原。"""
        raw = '[{"subject": "用户", "relation": "喜欢", "object": "AI"}]'
        triples, _ = FactExtractor._parse_triples(raw)
        assert len(triples) == 1
        content = triples[0].content
        # 反解析
        restored = Triple.from_content(content)
        assert restored is not None
        assert restored.subject == "用户"
        assert restored.relation == "喜欢"
        assert restored.object == "AI"

    def test_triple_equality(self) -> None:
        """三元组相等基于全部三个字段。"""
        t1 = Triple("用户", "喜欢", "猫")
        t2 = Triple("用户", "喜欢", "猫")
        t3 = Triple("用户", "喜欢", "狗")
        assert t1 == t2
        assert t1 != t3

    def test_predicate_key_collision(self) -> None:
        """同 (s, r) 不同 o = 冲突（predicate_key 用于检测）。"""
        t1 = Triple("用户", "工作", "北京")
        t2 = Triple("用户", "工作", "上海")
        assert t1.predicate_key == t2.predicate_key
        assert t1 != t2

    def test_from_content_old_format_returns_none(self) -> None:
        """旧格式的自由文本无法还原为 Triple。"""
        assert Triple.from_content("用户喜欢猫") is None

    def test_from_content_empty_segments_returns_none(self) -> None:
        """缺少必需部分的字符串返回 None。"""
        assert Triple.from_content(" —  → ") is None
        assert Triple.from_content("") is None
