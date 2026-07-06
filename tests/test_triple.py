from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from src.memory.triple import Triple


class TestTripleCore:
    def test_content_format(self) -> None:
        t = Triple(subject="用户", relation="喜欢", object="布偶猫")
        assert t.content == "用户 — 喜欢 → 布偶猫"

    def test_predicate_key(self) -> None:
        t = Triple(subject="用户", relation="工作地点", object="北京")
        assert t.predicate_key == ("用户", "工作地点")

    def test_predicate_key_distinguishes_different_objects(self) -> None:
        """同主体同关系不同客体的 predicate_key 相同（用于冲突检测）。"""
        t1 = Triple(subject="用户", relation="工作地点", object="北京")
        t2 = Triple(subject="用户", relation="工作地点", object="上海")
        assert t1.predicate_key == t2.predicate_key

    def test_frozen(self) -> None:
        t = Triple(subject="用户", relation="喜欢", object="猫")
        with pytest.raises(FrozenInstanceError):
            t.subject = "别人"  # type: ignore

    def test_equality(self) -> None:
        t1 = Triple(subject="用户", relation="喜欢", object="猫")
        t2 = Triple(subject="用户", relation="喜欢", object="猫")
        t3 = Triple(subject="用户", relation="喜欢", object="狗")
        assert t1 == t2
        assert t1 != t3


class TestTripleFromContent:
    def test_roundtrip(self) -> None:
        original = Triple(subject="用户", relation="职业", object="软件工程师")
        parsed = Triple.from_content(original.content)
        assert parsed is not None
        assert parsed.subject == original.subject
        assert parsed.relation == original.relation
        assert parsed.object == original.object

    def test_old_format_returns_none(self) -> None:
        """旧数据（自由文本 "用户喜欢猫"）无法解析为 Triple，返回 None。"""
        assert Triple.from_content("用户喜欢猫") is None

    def test_partial_format_returns_none(self) -> None:
        """不完整的格式化字符串返回 None。"""
        assert Triple.from_content("用户 — 喜欢") is None

    def test_empty_string_returns_none(self) -> None:
        assert Triple.from_content("") is None
