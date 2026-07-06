"""敏感信息本地分流测试 — SensitiveInfoDetector 七类检测器 + route_local() 路由决策。

测试覆盖：SensitiveCategory 枚举 / SensitiveMatch 数据类 /
SensitiveInfoResult 数据类 / SensitiveInfoDetector 七类检测器各 N tests /
detect() 全类别扫描 / LocalRouteDecision 数据类 /
route_local() 正常/敏感/空记忆/自定义检测器 / 边界条件 / 性能。
"""

from __future__ import annotations

import pytest

from src.chat.local_router import (
    LocalRouteDecision,
    SensitiveCategory,
    SensitiveInfoDetector,
    SensitiveInfoResult,
    SensitiveMatch,
    route_local,
)

# ── SensitiveCategory ──


class TestSensitiveCategory:
    """SensitiveCategory StrEnum 基本验证。"""

    def test_enum_values(self) -> None:
        """七分类值与字符串映射正确。"""
        assert SensitiveCategory.ID_CARD.value == "id_card"
        assert SensitiveCategory.PHONE.value == "phone"
        assert SensitiveCategory.BANK_CARD.value == "bank_card"
        assert SensitiveCategory.ADDRESS.value == "address"
        assert SensitiveCategory.PASSWORD.value == "password"
        assert SensitiveCategory.EMAIL.value == "email"
        assert SensitiveCategory.API_KEY.value == "api_key"

    def test_enum_membership(self) -> None:
        """字符串构造枚举成功。"""
        assert SensitiveCategory("id_card") == SensitiveCategory.ID_CARD
        assert SensitiveCategory("phone") == SensitiveCategory.PHONE
        assert SensitiveCategory("bank_card") == SensitiveCategory.BANK_CARD
        assert SensitiveCategory("address") == SensitiveCategory.ADDRESS
        assert SensitiveCategory("password") == SensitiveCategory.PASSWORD
        assert SensitiveCategory("email") == SensitiveCategory.EMAIL
        assert SensitiveCategory("api_key") == SensitiveCategory.API_KEY

    def test_invalid_value_raises(self) -> None:
        """无效值构造抛出 ValueError。"""
        with pytest.raises(ValueError):
            SensitiveCategory("invalid")


# ── SensitiveMatch ──


class TestSensitiveMatch:
    """SensitiveMatch dataclass 基本验证。"""

    def test_create_match_with_positions(self) -> None:
        """创建带精确位置的匹配。"""
        m = SensitiveMatch(
            text="13800138000",
            category=SensitiveCategory.PHONE,
            start=5,
            end=16,
        )
        assert m.text == "13800138000"
        assert m.category == SensitiveCategory.PHONE
        assert m.start == 5
        assert m.end == 16

    def test_create_match_without_positions(self) -> None:
        """创建无位置的匹配（关键词匹配场景）。"""
        m = SensitiveMatch(
            text="密码",
            category=SensitiveCategory.PASSWORD,
        )
        assert m.text == "密码"
        assert m.start == -1
        assert m.end == -1


# ── SensitiveInfoResult ──


class TestSensitiveInfoResult:
    """SensitiveInfoResult dataclass 基本验证。"""

    def test_default_not_sensitive(self) -> None:
        """默认构造不标记为敏感。"""
        r = SensitiveInfoResult()
        assert r.is_sensitive is False
        assert r.matches == []
        assert r.categories == set()
        assert r.input_length == 0

    def test_sensitive_result_with_matches(self) -> None:
        """含匹配的结果正确设置 is_sensitive 和 categories。"""
        matches = [
            SensitiveMatch(text="13800138000", category=SensitiveCategory.PHONE, start=0, end=11),
            SensitiveMatch(
                text="test@example.com", category=SensitiveCategory.EMAIL, start=12, end=28
            ),
        ]
        r = SensitiveInfoResult(
            is_sensitive=True,
            matches=matches,
            categories={SensitiveCategory.PHONE, SensitiveCategory.EMAIL},
            input_length=30,
            detection_time_ms=1.5,
        )
        assert r.is_sensitive is True
        assert len(r.matches) == 2
        assert r.categories == {SensitiveCategory.PHONE, SensitiveCategory.EMAIL}
        assert r.input_length == 30
        assert r.detection_time_ms == 1.5


# ── SensitiveInfoDetector — 身份证 ──


class TestDetectIDCard:
    """身份证号检测。"""

    def setup_method(self) -> None:
        self.detector = SensitiveInfoDetector()

    def test_valid_18_digit_id(self) -> None:
        """有效的 18 位身份证号（含正确校验码）被检测。"""
        # 110101199003071233 — 使用标准校验码计算
        result = self.detector.detect("我的身份证是110101199003071233")
        assert result.is_sensitive
        assert SensitiveCategory.ID_CARD in result.categories

    def test_18_digit_with_wrong_checksum_rejected(self) -> None:
        """校验码错误的 18 位号不触发检测（数字日期但校验码错）。"""
        # 修改校验位使其不匹配
        result = self.detector.detect("身份证110101199003071230")
        # 校验码应不匹配 — 不检测为身份证
        id_matches = [m for m in result.matches if m.category == SensitiveCategory.ID_CARD]
        assert len(id_matches) == 0

    def test_15_digit_old_id(self) -> None:
        """15 位旧格式身份证被检测。"""
        result = self.detector.detect("老身份证110101900307123")
        assert result.is_sensitive
        assert SensitiveCategory.ID_CARD in result.categories

    def test_no_id_card(self) -> None:
        """不含身份证号的文本不触发检测。"""
        result = self.detector.detect("今天天气不错")
        assert not result.is_sensitive

    def test_id_card_surrounded_by_text(self) -> None:
        """身份证号在中文上下文中被正确检测。"""
        result = self.detector.detect("申请人张三，身份证号110101199003071233，联系电话13800138000")
        assert result.is_sensitive
        assert SensitiveCategory.ID_CARD in result.categories
        assert SensitiveCategory.PHONE in result.categories


# ── SensitiveInfoDetector — 手机号 ──


class TestDetectPhone:
    """手机号检测。"""

    def setup_method(self) -> None:
        self.detector = SensitiveInfoDetector()

    def test_valid_phone(self) -> None:
        """11 位有效手机号被检测。"""
        result = self.detector.detect("我的手机是13812345678")
        assert result.is_sensitive
        assert SensitiveCategory.PHONE in result.categories
        phones = [m for m in result.matches if m.category == SensitiveCategory.PHONE]
        assert len(phones) == 1
        assert phones[0].text == "13812345678"

    def test_multiple_phones(self) -> None:
        """多个手机号都被检测。"""
        result = self.detector.detect("联系人A：13812345678，联系人B：15987654321")
        phones = [m for m in result.matches if m.category == SensitiveCategory.PHONE]
        assert len(phones) == 2

    def test_invalid_prefix_not_detected(self) -> None:
        """非 1[3-9] 开头的 11 位数字不触发。"""
        result = self.detector.detect("号码12345678901不是手机号")
        phones = [m for m in result.matches if m.category == SensitiveCategory.PHONE]
        assert len(phones) == 0

    def test_too_short_not_detected(self) -> None:
        """少于 11 位不触发。"""
        result = self.detector.detect("号码1381234567不够长")
        phones = [m for m in result.matches if m.category == SensitiveCategory.PHONE]
        assert len(phones) == 0

    def test_phone_with_dashes_not_matched(self) -> None:
        """带分隔符的手机号不匹配（正确行为——纯数字格式期望）。"""
        result = self.detector.detect("138-1234-5678")
        phones = [m for m in result.matches if m.category == SensitiveCategory.PHONE]
        assert len(phones) == 0


# ── SensitiveInfoDetector — 银行卡 ──


class TestDetectBankCard:
    """银行卡号检测。"""

    def setup_method(self) -> None:
        self.detector = SensitiveInfoDetector()

    def test_valid_16_digit_card(self) -> None:
        """16 位银行卡号被检测。"""
        result = self.detector.detect("卡号6222021234567890请查收")
        assert result.is_sensitive
        assert SensitiveCategory.BANK_CARD in result.categories

    def test_valid_19_digit_card(self) -> None:
        """19 位银行卡号被检测。"""
        result = self.detector.detect("卡号6222021234567890123")
        assert result.is_sensitive
        assert SensitiveCategory.BANK_CARD in result.categories

    def test_timestamp_excluded(self) -> None:
        """形如时间戳的 16+ 位数字不触发银行卡检测。"""
        # 20260630143000 ≈ 2026-06-30 14:30:00
        result = self.detector.detect("时间戳20260630143000是今天下午")
        cards = [m for m in result.matches if m.category == SensitiveCategory.BANK_CARD]
        assert len(cards) == 0

    def test_repeated_digit_excluded(self) -> None:
        """全相同数字的 16 位串不触发。"""
        result = self.detector.detect("测试号码1111111111111111")
        cards = [m for m in result.matches if m.category == SensitiveCategory.BANK_CARD]
        assert len(cards) == 0


# ── SensitiveInfoDetector — 邮箱 ──


class TestDetectEmail:
    """邮箱地址检测。"""

    def setup_method(self) -> None:
        self.detector = SensitiveInfoDetector()

    def test_valid_email(self) -> None:
        """标准邮箱被检测。"""
        result = self.detector.detect("请联系test@example.com")
        assert result.is_sensitive
        assert SensitiveCategory.EMAIL in result.categories

    def test_email_with_subdomain(self) -> None:
        """带子域名的邮箱被检测。"""
        result = self.detector.detect("邮箱user@mail.example.com.cn")
        emails = [m for m in result.matches if m.category == SensitiveCategory.EMAIL]
        assert len(emails) == 1
        assert emails[0].text == "user@mail.example.com.cn"

    def test_invalid_email_not_detected(self) -> None:
        """不含 @ 的文本不触发。"""
        result = self.detector.detect("我的用户名是test")
        emails = [m for m in result.matches if m.category == SensitiveCategory.EMAIL]
        assert len(emails) == 0


# ── SensitiveInfoDetector — API 密钥 ──


class TestDetectAPIKey:
    """API 密钥检测。"""

    def setup_method(self) -> None:
        self.detector = SensitiveInfoDetector()

    def test_sk_prefix_key(self) -> None:
        """sk- 前缀的 API 密钥被检测。"""
        result = self.detector.detect("API密钥是sk-abcdefghijklmnopqrstuvwxyz123456")
        assert result.is_sensitive
        assert SensitiveCategory.API_KEY in result.categories

    def test_bearer_token(self) -> None:
        """Bearer token 被检测。"""
        result = self.detector.detect("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.dGVzdA.abc123")
        assert result.is_sensitive
        assert SensitiveCategory.API_KEY in result.categories

    def test_token_keyword(self) -> None:
        """token= 形式的凭证被检测。"""
        result = self.detector.detect("token=abc123def456ghi789jkl")
        assert result.is_sensitive
        assert SensitiveCategory.API_KEY in result.categories

    def test_api_key_keyword(self) -> None:
        """api_key= 形式的凭证被检测。"""
        result = self.detector.detect("api_key=sk-live-1234567890abcdef")
        assert result.is_sensitive
        assert SensitiveCategory.API_KEY in result.categories


# ── SensitiveInfoDetector — 地址 ──


class TestDetectAddress:
    """地址关键词检测。"""

    def setup_method(self) -> None:
        self.detector = SensitiveInfoDetector()

    def test_full_address_detected(self) -> None:
        """完整中文地址被检测。"""
        result = self.detector.detect("我的地址是北京市朝阳区建国路88号10栋3单元502室")
        assert result.is_sensitive
        assert SensitiveCategory.ADDRESS in result.categories

    def test_short_address_not_enough_keywords(self) -> None:
        """仅有单一地址词不触发（避免误报）。"""
        result = self.detector.detect("我在5号楼")
        addrs = [m for m in result.matches if m.category == SensitiveCategory.ADDRESS]
        assert len(addrs) == 0

    def test_english_street_not_address(self) -> None:
        """纯英文地址不触发中文地址检测。"""
        result = self.detector.detect("My address is 123 Main Street")
        addrs = [m for m in result.matches if m.category == SensitiveCategory.ADDRESS]
        assert len(addrs) == 0


# ── SensitiveInfoDetector — 密码/凭证 ──


class TestDetectPassword:
    """密码/凭证关键词检测。"""

    def setup_method(self) -> None:
        self.detector = SensitiveInfoDetector()

    def test_password_keyword(self) -> None:
        """含"密码"关键词触发检测。"""
        result = self.detector.detect("我的密码是abc123")
        assert result.is_sensitive
        assert SensitiveCategory.PASSWORD in result.categories

    def test_english_password(self) -> None:
        """含"password"关键词触发检测。"""
        result = self.detector.detect("my password is hunter2")
        assert result.is_sensitive
        assert SensitiveCategory.PASSWORD in result.categories

    def test_token_keyword_as_password(self) -> None:
        """含"secret"关键词触发检测。"""
        result = self.detector.detect("the secret code is 42")
        assert result.is_sensitive
        assert SensitiveCategory.PASSWORD in result.categories

    def test_no_password_keyword(self) -> None:
        """不含密码关键词的文本不触发。"""
        result = self.detector.detect("请帮我重置登录信息")
        pwds = [m for m in result.matches if m.category == SensitiveCategory.PASSWORD]
        assert len(pwds) == 0


# ── SensitiveInfoDetector — 综合检测 ──


class TestDetectComprehensive:
    """detect() 全类别扫描综合测试。"""

    def setup_method(self) -> None:
        self.detector = SensitiveInfoDetector()

    def test_empty_text(self) -> None:
        """空文本不触发检测。"""
        result = self.detector.detect("")
        assert not result.is_sensitive
        assert result.matches == []
        assert result.categories == set()
        assert result.input_length == 0

    def test_whitespace_only(self) -> None:
        """纯空白文本不触发检测。"""
        result = self.detector.detect("   \n  \t  ")
        assert not result.is_sensitive

    def test_normal_chat_message(self) -> None:
        """正常聊天消息不触发。"""
        result = self.detector.detect("今天天气真好，适合出去散步")
        assert not result.is_sensitive

    def test_multiple_categories(self) -> None:
        """同时包含多种敏感信息被全部检测。"""
        text = "我叫张三，身份证110101199003071233，手机13800138000，邮箱test@test.com"
        result = self.detector.detect(text)
        assert result.is_sensitive
        assert len(result.categories) >= 3  # 至少身份证+手机+邮箱

    def test_input_length_recorded(self) -> None:
        """input_length 正确记录。"""
        text = "测试文本"
        result = self.detector.detect(text)
        assert result.input_length == len(text)

    def test_detection_time_recorded(self) -> None:
        """detection_time_ms 大于等于 0。"""
        result = self.detector.detect("test")
        assert result.detection_time_ms >= 0

    def test_id_in_phone_number_not_matched_as_id(
        self,
    ) -> None:
        """11 位手机号不被误识别为身份证（负向测试）。"""
        result = self.detector.detect("13812345678")
        id_matches = [m for m in result.matches if m.category == SensitiveCategory.ID_CARD]
        assert len(id_matches) == 0

    def test_short_number_not_bank_card(self) -> None:
        """少于 16 位的纯数字不被检测为银行卡。"""
        result = self.detector.detect("订单号123456789012345")
        cards = [m for m in result.matches if m.category == SensitiveCategory.BANK_CARD]
        assert len(cards) == 0

    def test_detector_reuse(self) -> None:
        """同一检测器实例可复用多次。"""
        r1 = self.detector.detect("手机13800138000")
        r2 = self.detector.detect("邮箱test@example.com")
        assert r1.is_sensitive
        assert r2.is_sensitive
        assert SensitiveCategory.PHONE in r1.categories
        assert SensitiveCategory.EMAIL in r2.categories


# ── LocalRouteDecision ──


class TestLocalRouteDecision:
    """LocalRouteDecision dataclass 基本验证。"""

    def test_default_not_routed(self) -> None:
        """默认不路由到本地。"""
        d = LocalRouteDecision()
        assert d.routed_locally is False
        assert d.reason == ""
        assert d.categories == set()
        assert d.local_response == ""

    def test_routed_decision(self) -> None:
        """路由到本地的决策包含完整信息。"""
        d = LocalRouteDecision(
            routed_locally=True,
            reason="检测到敏感信息 (phone, email)，路由到本地管线",
            categories={SensitiveCategory.PHONE, SensitiveCategory.EMAIL},
            local_response="⚠️ 本地回复内容",
        )
        assert d.routed_locally is True
        assert "phone" in d.reason
        assert len(d.categories) == 2
        assert len(d.local_response) > 0


# ── route_local() ──


class TestRouteLocal:
    """route_local() 路由决策函数测试。"""

    def test_normal_message_not_routed(self) -> None:
        """正常消息不路由到本地。"""
        decision = route_local("今天天气不错")
        assert decision.routed_locally is False
        assert decision.reason == "no_sensitive_info"
        assert decision.local_response == ""

    def test_sensitive_message_routed_locally(self) -> None:
        """敏感消息路由到本地。"""
        decision = route_local("我的手机号是13812345678，请帮我查一下")
        assert decision.routed_locally is True
        assert SensitiveCategory.PHONE in decision.categories
        assert len(decision.local_response) > 0
        assert "敏感信息" in decision.local_response

    def test_password_message_routed_locally(self) -> None:
        """含密码关键词的路由到本地。"""
        decision = route_local("我的密码是abc123，帮我记一下")
        assert decision.routed_locally is True
        assert SensitiveCategory.PASSWORD in decision.categories

    def test_local_response_includes_categories(self) -> None:
        """本地回复包含敏感类别名称。"""
        decision = route_local("身份证110101199003071233和手机13812345678")
        assert decision.routed_locally is True
        # 回复中应包含类别信息（使用 enum name 即大写形式）
        assert "ID_CARD" in decision.local_response or "PHONE" in decision.local_response

    def test_local_response_warning_prefix(self) -> None:
        """本地回复以隐私警告开头。"""
        decision = route_local("我的邮箱是test@example.com")
        assert decision.local_response.startswith("⚠️ **检测到您的消息包含敏感信息**")

    def test_with_empty_recalled(self) -> None:
        """无召回记忆时本地回复包含空记忆提示。"""
        decision = route_local("手机13812345678帮我查记录", recalled=[])
        assert decision.routed_locally is True
        assert "暂无相关记忆" in decision.local_response

    def test_with_recalled_memories(self) -> None:
        """有召回记忆时本地回复包含记忆摘要。"""
        recalled = [
            {"content": "用户上次提到手机号13812345678用于账号绑定", "importance": 0.8},
            {"content": "2025年3月用户询问过隐私保护相关问题", "importance": 0.6},
        ]
        decision = route_local("13812345678这个号码有什么记录", recalled=recalled)
        assert decision.routed_locally is True
        assert "13812345678" in decision.local_response

    def test_with_custom_detector(self) -> None:
        """可传入自定义检测器实例。"""
        detector = SensitiveInfoDetector()
        decision = route_local("测试test@example.com", detector=detector)
        assert decision.routed_locally is True
        assert SensitiveCategory.EMAIL in decision.categories

    def test_long_content_truncated_in_summary(self) -> None:
        """超长记忆内容在摘要中被截断。"""
        long_content = "这是一个非常长的记忆内容" * 20  # ~280 chars
        recalled = [{"content": long_content, "importance": 0.5}]
        decision = route_local("13812345678", recalled=recalled)
        assert decision.routed_locally is True
        # 摘要不应包含完整长文本
        assert long_content not in decision.local_response

    def test_performance_under_5ms(self) -> None:
        """正常消息检测耗时低于 5ms。"""
        import time

        detector = SensitiveInfoDetector()
        t0 = time.time()
        for _ in range(100):
            detector.detect("今天天气正好适合出门郊游散步骑行")
        elapsed_ms = (time.time() - t0) * 1000
        avg_ms = elapsed_ms / 100
        assert avg_ms < 5.0, f"单次检测平均耗时 {avg_ms:.2f}ms，超过 5ms 阈值"

    def test_no_api_call_in_local_route(self) -> None:
        """route_local() 不产生任何外部 API 调用。"""
        # 验证函数不需要任何网络/API 依赖即可运行
        decision = route_local("我的密码123456", recalled=[])
        assert decision.routed_locally is True
        # 本地回复确实来自模板合成，不含 API 响应特征
        assert "⚠️" in decision.local_response
