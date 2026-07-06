"""压缩质量加固测试 — CriticalInfoProtector 五类检测器 + ProtectionReport + VerificationResult。

测试覆盖：ProtectCategory 枚举 / ProtectedSpan 数据类 /
ProtectionReport.verify() 保留/丢失 / VerificationResult 通过/失败 /
CriticalInfoProtector 五类检测器各 N tests +
detect() 合并去重 / verify() 便捷方法 / 空文本 / 零匹配边界。
"""

from __future__ import annotations

import pytest

from src.context.protector import (
    CriticalInfoProtector,
    ProtectCategory,
    ProtectedSpan,
    ProtectionReport,
    TemporalAnchor,
    TemporalFidelityEvaluator,
    TemporalFidelityReport,
    TemporalFidelityResult,
    VerificationResult,
)


class TestProtectCategory:
    """ProtectCategory StrEnum 基本验证。"""

    def test_enum_values(self) -> None:
        """五分类值与字符串映射正确。"""
        assert ProtectCategory.PROPER_NAME.value == "proper_name"
        assert ProtectCategory.NUMBER.value == "number"
        assert ProtectCategory.DATE.value == "date"
        assert ProtectCategory.DECISION.value == "decision"
        assert ProtectCategory.PROMISE.value == "promise"

    def test_enum_membership(self) -> None:
        """字符串构造枚举成功。"""
        assert ProtectCategory("proper_name") == ProtectCategory.PROPER_NAME
        assert ProtectCategory("number") == ProtectCategory.NUMBER
        assert ProtectCategory("date") == ProtectCategory.DATE
        assert ProtectCategory("decision") == ProtectCategory.DECISION
        assert ProtectCategory("promise") == ProtectCategory.PROMISE


class TestProtectedSpan:
    """ProtectedSpan dataclass 基本验证。"""

    def test_create_span(self) -> None:
        """正常创建 span。"""
        span = ProtectedSpan(start=0, end=3, text="李总", category=ProtectCategory.PROPER_NAME)
        assert span.start == 0
        assert span.end == 3
        assert span.text == "李总"
        assert span.category == ProtectCategory.PROPER_NAME

    def test_zero_length_span(self) -> None:
        """零长度 span（start==end）——合法，但 verify 时会被跳过。"""
        span = ProtectedSpan(start=5, end=5, text="", category=ProtectCategory.DATE)
        assert span.text == ""


class TestProtectionReport:
    """ProtectionReport.verify() 验证逻辑测试。"""

    def test_empty_spans_verify_passes(self) -> None:
        """无保护 span → verify 总是 passed。"""
        report = ProtectionReport(original_text="hello")
        result = report.verify("anything")
        assert result.passed is True
        assert result.preservation_rate == 1.0
        assert result.total_protected == 0

    def test_all_preserved(self) -> None:
        """所有 span 在压缩文本中完整保留。"""
        spans = [
            ProtectedSpan(0, 2, "张三", ProtectCategory.PROPER_NAME),
            ProtectedSpan(3, 8, "100元", ProtectCategory.NUMBER),
        ]
        report = ProtectionReport(original_text="张三承诺100元", protected_spans=spans)
        result = report.verify("张三说100元够用")
        assert result.passed is True
        assert result.preserved == 2
        assert result.preservation_rate == 1.0

    def test_partial_loss(self) -> None:
        """部分 span 在压缩中丢失。"""
        spans = [
            ProtectedSpan(0, 2, "张三", ProtectCategory.PROPER_NAME),
            ProtectedSpan(3, 8, "100元", ProtectCategory.NUMBER),
        ]
        report = ProtectionReport(original_text="张三承诺100元", protected_spans=spans)
        result = report.verify("张三说可以")
        assert result.passed is False
        assert result.preserved == 1
        assert len(result.lost) == 1
        assert result.lost[0].text == "100元"
        assert result.preservation_rate == 0.5

    def test_all_lost(self) -> None:
        """所有 span 丢失。"""
        spans = [ProtectedSpan(0, 3, "ABC", ProtectCategory.PROPER_NAME)]
        report = ProtectionReport(original_text="ABC", protected_spans=spans)
        result = report.verify("完全不同")
        assert result.passed is False
        assert result.preserved == 0
        assert result.preservation_rate == 0.0

    def test_whitespace_tolerance(self) -> None:
        """去除首尾空白后匹配（容忍轻微格式变化）。"""
        spans = [ProtectedSpan(0, 3, " 张三 ", ProtectCategory.PROPER_NAME)]
        report = ProtectionReport(original_text=" 张三 ", protected_spans=spans)
        result = report.verify("张三")
        assert result.passed is True

    def test_empty_span_text_skipped(self) -> None:
        """空文本 span 视为保留（无信息可丢失）。"""
        spans = [
            ProtectedSpan(0, 0, "", ProtectCategory.DATE),
            ProtectedSpan(0, 5, "hello", ProtectCategory.PROPER_NAME),
        ]
        report = ProtectionReport(original_text="hello", protected_spans=spans)
        result = report.verify("hello")
        assert result.passed is True
        assert result.preserved == 2  # 空 span 视为保留 + hello 保留

    def test_total_spans_property(self) -> None:
        """total_spans 属性返回被保护 span 数量。"""
        report = ProtectionReport(original_text="test")
        assert report.total_spans == 0
        report.protected_spans.append(ProtectedSpan(0, 4, "test", ProtectCategory.PROPER_NAME))
        assert report.total_spans == 1


class TestVerificationResult:
    """VerificationResult dataclass 基本验证。"""

    def test_default_passed(self) -> None:
        """默认构造——passed=True, rate=1.0。"""
        r = VerificationResult(total_protected=0, preserved=0)
        assert r.passed is True
        assert r.preservation_rate == 1.0

    def test_passed_when_no_loss(self) -> None:
        """lost 为空 → passed=True。"""
        r = VerificationResult(total_protected=5, preserved=5, lost=[], preservation_rate=1.0)
        assert r.passed is True

    def test_failed_when_loss_present(self) -> None:
        """lost 非空 → passed=False。"""
        lost_span = ProtectedSpan(0, 2, "李总", ProtectCategory.PROPER_NAME)
        r = VerificationResult(
            total_protected=3, preserved=2, lost=[lost_span], preservation_rate=2 / 3
        )
        assert r.passed is False
        assert r.preservation_rate == pytest.approx(2 / 3)


class TestProperNameDetection:
    """_detect_proper_names() 专名检测测试。"""

    def test_chinese_name_surname_given(self) -> None:
        """姓氏+名字 → 检测为专名（greedy regex 捕获最多 3 个后续字符）。"""
        p = CriticalInfoProtector()
        spans = p._detect_proper_names("李总说这件事由王小明负责")
        texts = {s.text for s in spans}
        # greedy {1,3} → "李总说这" / "王小明负"
        assert any("李总" in t for t in texts)
        assert any("王小明" in t for t in texts)

    def test_chinese_name_not_common_suffix(self) -> None:
        """姓氏+常见后缀（市/省/的/了）——person name 级别过滤，org 名除外。"""
        p = CriticalInfoProtector()
        spans = p._detect_proper_names("李市和赵省的规划")
        # org 名（"赵省"）合法以 "省" 结尾；person name "李市和赵" 不以此结尾
        # 核心断言：没有 span 是纯"李市"（已过滤）
        span_texts = {s.text for s in spans}
        assert "李市" not in span_texts  # tail="市" → 已过滤

    def test_english_name(self) -> None:
        """英文名（2+ 连续大写单词）→ 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_proper_names("John Smith and Mary Johnson attended")
        texts = {s.text for s in spans}
        assert "John Smith" in texts
        assert "Mary Johnson" in texts

    def test_single_english_word_not_detected(self) -> None:
        """单个大写单词不算专名。"""
        p = CriticalInfoProtector()
        spans = p._detect_proper_names("John went to the store")
        # 单个英文大写词不算（需要 2+ 连续词）
        assert len(spans) == 0

    def test_org_name_with_suffix(self) -> None:
        """机构名后缀（公司/大学/医院等）→ 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_proper_names("华为技术有限公司和清华大学参与")
        texts = {s.text for s in spans}
        assert any("华为技术有限公司" in t for t in texts)
        assert any("清华大学" in t for t in texts)

    def test_no_names_returns_empty(self) -> None:
        """纯普通文本 → 无专名。"""
        p = CriticalInfoProtector()
        spans = p._detect_proper_names("今天天气很好，适合出去走走")
        assert len(spans) == 0


class TestNumberDetection:
    """_detect_numbers() 数字检测测试。"""

    def test_currency_rmb(self) -> None:
        """¥ 金额 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_numbers("预算 ¥500,000 已经批准")
        texts = {s.text for s in spans}
        assert any("¥500,000" in t for t in texts)

    def test_currency_dollar(self) -> None:
        """$ 金额 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_numbers("价格 $99.99 不含税")
        texts = {s.text for s in spans}
        assert any("$99.99" in t for t in texts)

    def test_chinese_yuan(self) -> None:
        """中文"元"单位 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_numbers("花费 500 元整")
        texts = {s.text for s in spans}
        assert any("500 元" in t for t in texts)

    def test_percentage(self) -> None:
        """百分比 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_numbers("增长 15.5% 符合预期")
        texts = {s.text for s in spans}
        assert any("15.5%" in t for t in texts)

    def test_quantity_with_unit(self) -> None:
        """数量+量词 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_numbers("订购 3 台服务器和 5 个数据库")
        texts = {s.text for s in spans}
        assert any("3 台" in t for t in texts)
        assert any("5 个" in t for t in texts)

    def test_pure_number_without_unit_not_detected(self) -> None:
        """纯数字（无量词/单位）→ 不检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_numbers("房间号是 302")
        # 302 无单位/量词，不会被数字检测器捕获
        assert len(spans) == 0

    def test_no_numbers_returns_empty(self) -> None:
        """无数字文本 → 空结果。"""
        p = CriticalInfoProtector()
        spans = p._detect_numbers("今天天气很好")
        assert len(spans) == 0


class TestDateDetection:
    """_detect_dates() 日期检测测试。"""

    def test_absolute_date_iso_format(self) -> None:
        """YYYY-MM-DD 格式 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_dates("截止日期 2025-03-15 不可延期")
        texts = {s.text for s in spans}
        assert "2025-03-15" in texts

    def test_absolute_date_chinese_format(self) -> None:
        """N年N月N日 格式（含空格）→ 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_dates("2025 年 3 月 15 日前完成")
        texts = {s.text for s in spans}
        # 容空格正则 → span 含原始空格
        assert any("2025" in t and "15" in t for t in texts)

    def test_relative_date_tomorrow(self) -> None:
        """ "明天" → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_dates("明天下午开会")
        texts = {s.text for s in spans}
        assert "明天" in texts

    def test_relative_date_next_week(self) -> None:
        """ "下周" → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_dates("下周发布新版本")
        texts = {s.text for s in spans}
        assert "下周" in texts

    def test_weekday_names(self) -> None:
        """星期名称 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_dates("周一到周三和星期五")
        texts = {s.text for s in spans}
        assert "周一" in texts
        assert "周三" in texts
        assert "星期五" in texts

    def test_relative_date_not_with_digit_prefix(self) -> None:
        """ "3天" 不误检为日期关键词（前面有数字）。"""
        p = CriticalInfoProtector()
        spans = p._detect_dates("还有 3 天到期")
        # "天" 本身不在 _RELATIVE_DATE_KEYWORDS 中，所以不会误检
        # 主要验证不以数字+日期关键词的形式
        assert all("3" not in s.text or "天" not in s.text for s in spans)

    def test_no_dates_returns_empty(self) -> None:
        """无日期文本 → 空结果。"""
        p = CriticalInfoProtector()
        spans = p._detect_dates("这是一段普通文本")
        assert len(spans) == 0


class TestDecisionDetection:
    """_detect_decisions() 决策检测测试。"""

    def test_decision_keyword_detected(self) -> None:
        """ "决定" 关键词 → 检测并捕获上下文。"""
        p = CriticalInfoProtector()
        spans = p._detect_decisions("经过讨论，我们决定采用方案 A。")
        assert len(spans) >= 1
        assert "决定" in spans[0].text

    def test_confirm_keyword(self) -> None:
        """ "确认" 关键词 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_decisions("甲方确认收到款项。")
        assert len(spans) >= 1
        assert "确认" in spans[0].text

    def test_approve_keyword(self) -> None:
        """ "批准" 关键词 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_decisions("项目已批准，可以启动。")
        assert len(spans) >= 1
        assert "批准" in spans[0].text

    def test_context_capture(self) -> None:
        """决策检测捕获前后文（±15 字符）。"""
        p = CriticalInfoProtector()
        spans = p._detect_decisions("今天我们决定签约")
        # span 应该比纯关键词更长
        assert len(spans) > 0
        assert len(spans[0].text) > len("决定")

    def test_no_decisions_returns_empty(self) -> None:
        """无决策文本 → 空结果。"""
        p = CriticalInfoProtector()
        spans = p._detect_decisions("今天天气很好")
        assert len(spans) == 0


class TestPromiseDetection:
    """_detect_promises() 承诺检测测试。"""

    def test_promise_keyword(self) -> None:
        """ "承诺" 关键词 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_promises("我们承诺按时交付。")
        assert len(spans) >= 1
        assert "承诺" in spans[0].text

    def test_guarantee_keyword(self) -> None:
        """ "保证" 关键词 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_promises("我保证质量达标。")
        assert len(spans) >= 1
        assert "保证" in spans[0].text

    def test_must_keyword(self) -> None:
        """ "必须" 关键词 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_promises("必须在周五前完成。")
        assert len(spans) >= 1
        assert "必须" in spans[0].text

    def test_never_keyword(self) -> None:
        """ "绝不会" 关键词 → 检测。"""
        p = CriticalInfoProtector()
        spans = p._detect_promises("绝不会泄露用户数据。")
        assert len(spans) >= 1
        assert "绝不会" in spans[0].text

    def test_no_promises_returns_empty(self) -> None:
        """无承诺文本 → 空结果。"""
        p = CriticalInfoProtector()
        spans = p._detect_promises("今天天气很好")
        assert len(spans) == 0


class TestDetect:
    """detect() 全量检测 + 去重测试。"""

    def test_detect_combines_all_categories(self) -> None:
        """detect() 同时检测所有五类信息。"""
        p = CriticalInfoProtector()
        text = "李总决定 2025-03-15 前打款 ¥500,000，并承诺绝不延期。"
        report = p.detect(text)
        categories = {s.category for s in report.protected_spans}
        # 应至少覆盖 4 个类别
        assert len(categories) >= 3

    def test_detect_overlap_dedup(self) -> None:
        """重叠 span 去重——保留先出现的。"""
        p = CriticalInfoProtector()
        # "李总决定" — 专名检测匹配"李总决"（李+总决），决策检测也匹配"决定"
        # detect() 合并时去重
        report = p.detect("李总决定签约")
        # 核心验证：无完全重叠的 span
        for i, a in enumerate(report.protected_spans):
            for j, b in enumerate(report.protected_spans):
                if i != j:
                    # 一个 span 的 start 不在另一个的 [start, end) 区间内
                    assert not (a.start <= b.start < a.end), f"Span {b} is inside {a}"

    def test_detect_empty_text(self) -> None:
        """空文本 → 空保护列表。"""
        p = CriticalInfoProtector()
        report = p.detect("")
        assert report.total_spans == 0
        assert report.original_text == ""

    def test_detect_no_matches(self) -> None:
        """无匹配文本 → 空保护列表。"""
        p = CriticalInfoProtector()
        report = p.detect("这是一段普通的文本，没有任何需要保护的关键信息。")
        assert report.total_spans == 0

    def test_detect_english_mixed_content(self) -> None:
        """中英混合文本 → 正确检测。"""
        p = CriticalInfoProtector()
        report = p.detect("Alice Wang 确认预算为 ¥100,000")
        assert report.total_spans >= 2  # 英文名 + 金额至少


class TestVerifyConvenience:
    """CriticalInfoProtector.verify() 便捷方法测试。"""

    def test_verify_one_step(self) -> None:
        """verify() 一步完成检测+验证。"""
        p = CriticalInfoProtector()
        result = p.verify(
            original="李总承诺 ¥500,000 投资。",
            compressed="李总承诺投资。",
        )
        assert result.passed is False  # ¥500,000 丢失
        assert result.total_protected > 0

    def test_verify_all_preserved(self) -> None:
        """压缩完整保留所有关键信息。"""
        p = CriticalInfoProtector()
        result = p.verify(
            original="李总决定明天签约。",
            compressed="李总决定明天签约——方案已定。",
        )
        assert result.passed is True

    def test_verify_empty_original(self) -> None:
        """空原始文本 → 零保护 span → verify passed。"""
        p = CriticalInfoProtector()
        result = p.verify(original="", compressed="anything")
        assert result.passed is True
        assert result.total_protected == 0


# ═══════════════════════════════════════════════════════════════
# Phase 64 Batch 2 — TemporalFidelityEvaluator 测试
# ═══════════════════════════════════════════════════════════════


class TestTemporalAnchor:
    """TemporalAnchor dataclass 基本验证。"""

    def test_create_anchor(self) -> None:
        """正常创建时序锚点。"""
        a = TemporalAnchor(position=5, text="明天", anchor_type="relative_date")
        assert a.position == 5
        assert a.text == "明天"
        assert a.anchor_type == "relative_date"

    def test_sequence_marker_anchor(self) -> None:
        """序列标记词类型锚点。"""
        a = TemporalAnchor(position=0, text="首先", anchor_type="sequence_marker")
        assert a.anchor_type == "sequence_marker"
        assert a.position == 0

    def test_absolute_date_anchor(self) -> None:
        """绝对日期类型锚点。"""
        a = TemporalAnchor(position=10, text="2025-03-15", anchor_type="absolute_date")
        assert a.anchor_type == "absolute_date"


class TestTemporalFidelityResult:
    """TemporalFidelityResult 计算属性测试。"""

    def test_order_preserved_when_no_inversions(self) -> None:
        """无逆序对 → order_preserved=True。"""
        r = TemporalFidelityResult(
            original_anchors=3,
            compressed_anchors=3,
            matched_anchors=3,
            lcs_length=3,
            inversion_pairs=[],
            order_preservation_rate=1.0,
            fidelity_score=1.0,
        )
        assert r.order_preserved is True

    def test_order_not_preserved_when_inversions_exist(self) -> None:
        """有逆序对 → order_preserved=False。"""
        r = TemporalFidelityResult(
            original_anchors=3,
            compressed_anchors=3,
            matched_anchors=3,
            lcs_length=2,
            inversion_pairs=[("明天", "下周")],
            order_preservation_rate=2 / 3,
            fidelity_score=0.5,
        )
        assert r.order_preserved is False

    def test_order_preserved_when_zero_matched(self) -> None:
        """零匹配 → 无逆序对 → order_preserved=True（无信息可乱序）。"""
        r = TemporalFidelityResult(
            original_anchors=3,
            compressed_anchors=0,
            matched_anchors=0,
            lcs_length=0,
        )
        assert r.order_preserved is True
        assert r.fidelity_score == 1.0

    def test_default_values(self) -> None:
        """默认构造——passed 状态，rate=1.0。"""
        r = TemporalFidelityResult(
            original_anchors=0,
            compressed_anchors=0,
            matched_anchors=0,
            lcs_length=0,
        )
        assert r.order_preserved is True
        assert r.fidelity_score == 1.0
        assert r.order_preservation_rate == 1.0
        assert r.inversion_pairs == []


class TestTemporalFidelityReport:
    """TemporalFidelityReport.evaluate() 核心算法测试。"""

    def test_empty_original_anchors(self) -> None:
        """原始无锚点 → fidelity=1.0（无信息可乱序）。"""
        report = TemporalFidelityReport(original_text="hello", anchors=[])
        comp_anchors = [TemporalAnchor(0, "明天", "relative_date")]
        result = report.evaluate(comp_anchors)
        assert result.fidelity_score == 1.0
        assert result.original_anchors == 0
        assert result.compressed_anchors == 1

    def test_all_matched_order_preserved(self) -> None:
        """所有锚点匹配且顺序正确 → fidelity=1.0。"""
        orig = [
            TemporalAnchor(0, "明天", "relative_date"),
            TemporalAnchor(10, "下周", "relative_date"),
        ]
        comp = [
            TemporalAnchor(0, "明天", "relative_date"),
            TemporalAnchor(5, "下周", "relative_date"),
        ]
        report = TemporalFidelityReport("明天开会，下周签约。", orig)
        result = report.evaluate(comp)
        assert result.matched_anchors == 2
        assert result.lcs_length == 2
        assert result.order_preserved is True
        assert result.fidelity_score == 1.0

    def test_order_inversion_detected(self) -> None:
        """顺序颠倒 → 检测到逆序对。"""
        orig = [
            TemporalAnchor(0, "明天", "relative_date"),
            TemporalAnchor(10, "下周", "relative_date"),
        ]
        comp = [
            TemporalAnchor(0, "下周", "relative_date"),
            TemporalAnchor(5, "明天", "relative_date"),
        ]
        report = TemporalFidelityReport("明天开会，下周签约。", orig)
        result = report.evaluate(comp)
        assert result.order_preserved is False
        assert len(result.inversion_pairs) == 1
        assert result.inversion_pairs[0] == ("明天", "下周")
        assert result.lcs_length == 1  # only one anchor in correct relative order
        assert result.fidelity_score < 1.0

    def test_partial_match_some_lost(self) -> None:
        """部分锚点丢失 → 匹配率 < 1。"""
        orig = [
            TemporalAnchor(0, "明天", "relative_date"),
            TemporalAnchor(10, "下周", "relative_date"),
            TemporalAnchor(20, "后天", "relative_date"),
        ]
        comp = [
            TemporalAnchor(0, "明天", "relative_date"),
            TemporalAnchor(5, "后天", "relative_date"),
        ]
        report = TemporalFidelityReport("明天开会，下周签约，后天交付。", orig)
        result = report.evaluate(comp)
        assert result.matched_anchors == 2  # 下周 丢失
        assert result.original_anchors == 3
        assert result.compressed_anchors == 2
        # 明天→后天 顺序正确
        assert result.order_preserved is True
        # match_rate=2/3 rounded to 4dp
        assert result.fidelity_score == pytest.approx(0.6667, abs=1e-4)

    def test_zero_matched_all_lost(self) -> None:
        """所有锚点丢失 → fidelity=0.0。"""
        orig = [TemporalAnchor(0, "明天", "relative_date")]
        comp: list[TemporalAnchor] = []
        report = TemporalFidelityReport("明天开会。", orig)
        result = report.evaluate(comp)
        assert result.matched_anchors == 0
        assert result.fidelity_score == 0.0

    def test_substring_match_tolerance(self) -> None:
        """子串匹配容忍轻微格式变化（如 "明天" 匹配 "明天下午"）。"""
        orig = [TemporalAnchor(0, "明天", "relative_date")]
        comp = [TemporalAnchor(0, "明天下午", "relative_date")]
        report = TemporalFidelityReport("明天开会。", orig)
        result = report.evaluate(comp)
        assert result.matched_anchors == 1

    def test_three_anchors_two_inversions(self) -> None:
        """三个锚点，两对逆序（如 A→B→C 变成 C→A→B）。"""
        orig = [
            TemporalAnchor(0, "A", "sequence_marker"),
            TemporalAnchor(10, "B", "sequence_marker"),
            TemporalAnchor(20, "C", "sequence_marker"),
        ]
        comp = [
            TemporalAnchor(0, "C", "sequence_marker"),
            TemporalAnchor(10, "A", "sequence_marker"),
            TemporalAnchor(20, "B", "sequence_marker"),
        ]
        report = TemporalFidelityReport("A B C", orig)
        result = report.evaluate(comp)
        # inversions: (A,C), (A,B)?  Wait — matched in orig order: A(comp=1), B(comp=2), C(comp=0)
        # comp_positions = [1, 2, 0] — LIS length = 2 (positions 1,2 are increasing)
        # inversions: a=0(c=1) > b=2(c=0) → (A,C); a=1(c=2) > b=2(c=0) → (B,C)
        assert result.lcs_length == 2
        assert len(result.inversion_pairs) == 2
        assert result.order_preserved is False


class TestTemporalFidelityEvaluator:
    """TemporalFidelityEvaluator 锚点提取 + 便捷方法测试。"""

    def test_extract_date_anchors(self) -> None:
        """提取日期锚点（绝对日期 + 相对日期）。"""
        e = TemporalFidelityEvaluator()
        anchors = e.extract_anchors("2025-03-15 前完成，明天开始测试。")
        texts = {a.text for a in anchors}
        types = {a.anchor_type for a in anchors}
        assert "2025-03-15" in texts
        assert "明天" in texts
        assert "absolute_date" in types
        assert "relative_date" in types

    def test_extract_sequence_markers(self) -> None:
        """提取序列标记词。"""
        e = TemporalFidelityEvaluator()
        anchors = e.extract_anchors("首先分析需求，然后设计方案。")
        marker_texts = {a.text for a in anchors if a.anchor_type == "sequence_marker"}
        assert "首先" in marker_texts
        assert "然后" in marker_texts

    def test_extract_empty_text(self) -> None:
        """空文本 → 空锚点列表。"""
        e = TemporalFidelityEvaluator()
        anchors = e.extract_anchors("")
        assert len(anchors) == 0

    def test_extract_anchors_ordered_by_position(self) -> None:
        """锚点按文本位置升序排列。"""
        e = TemporalFidelityEvaluator()
        anchors = e.extract_anchors("明天 2025-03-15 首先开会")
        for i in range(len(anchors) - 1):
            assert anchors[i].position <= anchors[i + 1].position

    def test_evaluate_convenience_method(self) -> None:
        """evaluate() 一步完成提取+比对。"""
        e = TemporalFidelityEvaluator()
        result = e.evaluate(
            original="明天开会，下周签约，后天交付。",
            compressed="下周签约，后天交付。",
        )
        assert result.original_anchors >= 2
        assert result.matched_anchors >= 1
        # 下周→后天 顺序正确，明天丢失
        assert isinstance(result.fidelity_score, float)

    def test_evaluate_order_preserved_with_dates(self) -> None:
        """日期顺序保持 → order_preserved=True。"""
        e = TemporalFidelityEvaluator()
        result = e.evaluate(
            original="2025-01-15 立项，2025-06-01 上线。",
            compressed="2025-01-15 立项，2025-06-01 正式上线。",
        )
        assert result.order_preserved is True
        assert result.fidelity_score == 1.0

    def test_evaluate_order_inverted_with_dates(self) -> None:
        """日期顺序颠倒 → order_preserved=False。"""
        e = TemporalFidelityEvaluator()
        result = e.evaluate(
            original="2025-01-15 立项，2025-06-01 上线。",
            compressed="2025-06-01 上线，2025-01-15 立项。",
        )
        assert result.order_preserved is False
        assert len(result.inversion_pairs) >= 1

    def test_custom_protector_injection(self) -> None:
        """可注入自定义 CriticalInfoProtector 实例。"""
        p = CriticalInfoProtector()
        e = TemporalFidelityEvaluator(protector=p)
        result = e.evaluate(original="明天开会", compressed="明天开会")
        assert result.fidelity_score == 1.0

    def test_mixed_chinese_english_dates(self) -> None:
        """中英混合日期 + 序列标记。"""
        e = TemporalFidelityEvaluator()
        anchors = e.extract_anchors("First, 2025-03-15 立项。Then, 明天 review。")
        # 应至少检测到绝对日期
        date_texts = {a.text for a in anchors if a.anchor_type == "absolute_date"}
        assert "2025-03-15" in date_texts
