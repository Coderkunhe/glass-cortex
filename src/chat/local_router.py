"""敏感信息本地分流——检测查询中的 PII/敏感内容并路由到本地管线。

Phase 65 (四支柱 3.2)：SensitiveInfoDetector 在消息发送前检测
敏感信息——身份证、手机号、银行卡、地址、密码、邮箱、API 密钥。
命中敏感内容时 `route_local()` 跳过外部 API，仅用本地召回
记忆合成回复，避免敏感数据外传。

设计原则：
- 纯规则引擎 + 关键词匹配——快、确定、零 LLM 依赖。
- 检测和路由分离——SensitiveInfoDetector.detect() 返回结构化结果，
  route_local() 基于结果决策。
- 默认 feature flag 关闭（local_routing_enabled），渐进启用。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

from src.logging import get_logger

logger = get_logger(__name__)


class SensitiveCategory(StrEnum):
    """敏感信息类别——决定分流策略和用户提示。"""

    ID_CARD = "id_card"  # 身份证号（18位/15位）
    PHONE = "phone"  # 手机号码（11位）
    BANK_CARD = "bank_card"  # 银行卡号（16-19位）
    ADDRESS = "address"  # 地址（省/市/区/路/号等关键词）
    PASSWORD = "password"  # 密码/凭证（密码/token/secret 等关键词）
    EMAIL = "email"  # 邮箱地址
    API_KEY = "api_key"  # API 密钥/令牌（sk-.../Bearer/等模式）


# ── 检测模式（编译一次，全局复用）──

# 18位身份证：6位地区 + 4位年(1900-2099) + 2位月(01-12) + 2位日(01-31) + 3位序 + 1位校验
_ID18_RE = re.compile(
    r"(?<!\d)"  # 左侧非数字边界
    r"[1-9]\d{5}"  # 地区码（6位，首位非0）
    r"(?:19|20)\d{2}"  # 年份（1900-2099）
    r"(?:0[1-9]|1[0-2])"  # 月份（01-12）
    r"(?:0[1-9]|[12]\d|3[01])"  # 日期（01-31）
    r"\d{3}"  # 顺序码（3位）
    r"[\dXx]"  # 校验码（数字或X）
    r"(?!\d)"  # 右侧非数字边界
)

# 15位身份证（旧格式）：6位地区 + 2位年 + 2位月 + 2位日 + 3位序
_ID15_RE = re.compile(
    r"(?<!\d)"
    r"[1-9]\d{5}"  # 地区码
    r"\d{2}"  # 年份（2位）
    r"(?:0[1-9]|1[0-2])"  # 月份
    r"(?:0[1-9]|[12]\d|3[01])"  # 日期
    r"\d{3}"  # 顺序码
    r"(?!\d)"
)

# 手机号：1[3-9] + 9位数字，共11位
_PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")

# 银行卡号：16-19位连续数字（宽松匹配，可能误报长数字串）
_BANK_CARD_RE = re.compile(r"(?<!\d)\d{16,19}(?!\d)")

# 邮箱：标准 RFC 5322 简化版
_EMAIL_RE = re.compile(
    r"(?<![a-zA-Z0-9._%+\-])"
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
    r"(?![a-zA-Z0-9.\-])"
)

# API 密钥：常见前缀模式（sk- / key- / Bearer / token= / api_key=）
_API_KEY_RE = re.compile(
    r"(?:sk-[a-zA-Z0-9]{20,})"  # OpenAI/DeepSeek 风格 (sk-...)
    r"|(?:Bearer\s+[a-zA-Z0-9\-._~+/]+=*)"  # Bearer token
    r"|(?:(?:api[_-]?key|token|secret|access_key)\s*[:=]\s*['\"]?[a-zA-Z0-9\-._~+/=]{16,}['\"]?)",
    re.IGNORECASE,
)

# 地址关键词：必须包含至少一个行政区划 + 一个具体定位词
_ADDRESS_KEYWORDS = re.compile(
    r"(?:省|市|区|县|镇|乡|村|路|街|巷|弄|道|号|栋|幢|单元|室|楼|层|门|座|苑|园|小区|花园)"
)

# 密码/凭证关键词
_PASSWORD_KEYWORDS = re.compile(
    r"(?:密码|密保|口令|password|passwd|pwd|secret|凭证)",
    re.IGNORECASE,
)

# ── 身份证校验码（ISO 7064:1983 MOD 11-2）──
_ID18_WEIGHTS = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
_ID18_CHECK_CHARS = "10X98765432"


def _validate_id18_checksum(id_str: str) -> bool:
    """校验 18 位身份证的最后一位校验码。

    使用 GB 11643-1999 标准算法：前 17 位加权求和 mod 11，
    余数映射到校验字符。

    Args:
        id_str: 18 位身份证号字符串。

    Returns:
        True 表示校验码正确或无法校验（非标准格式），
        False 表示校验码明确不匹配。
    """
    if len(id_str) != 18:
        return False
    try:
        weighted_sum = sum(int(id_str[i]) * _ID18_WEIGHTS[i] for i in range(17))
    except ValueError:
        return False
    expected = _ID18_CHECK_CHARS[weighted_sum % 11]
    return id_str[17].upper() == expected


# ── 数据类 ──


@dataclass
class SensitiveMatch:
    """单个敏感信息匹配。

    Attributes:
        text: 匹配到的文本片段。
        category: 敏感信息类别。
        start: 在原文本中的起始字符偏移（-1 表示关键词匹配无法精确定位）。
        end: 在原文本中的结束字符偏移（-1 同 start）。
    """

    text: str
    category: SensitiveCategory
    start: int = -1
    end: int = -1


@dataclass
class SensitiveInfoResult:
    """敏感信息检测结果。

    Attributes:
        is_sensitive: 是否包含敏感信息。
        matches: 所有检测到的敏感信息匹配列表。
        categories: 命中的敏感类别集合（去重）。
        input_length: 原始输入文本长度。
        detection_time_ms: 检测耗时（毫秒），用于性能监控。
    """

    is_sensitive: bool = False
    matches: list[SensitiveMatch] = field(default_factory=list)
    categories: set[SensitiveCategory] = field(default_factory=set)
    input_length: int = 0
    detection_time_ms: float = 0.0


@dataclass
class LocalRouteDecision:
    """本地分流决策——route_local() 的返回值。

    Attributes:
        routed_locally: 是否路由到本地管线（True = 跳过外部 API）。
        reason: 路由决策原因（人类可读，用于日志和调试）。
        categories: 触发的敏感信息类别。
        local_response: 本地合成的回复文本，routed_locally=True 时非空。
    """

    routed_locally: bool = False
    reason: str = ""
    categories: set[SensitiveCategory] = field(default_factory=set)
    local_response: str = ""


# ── 检测器 ──


class SensitiveInfoDetector:
    """敏感信息检测器——关键词 + 模式匹配，纯规则引擎。

    检测五类 PII/敏感内容：
    - 身份证号（18位带校验码验证 + 15位旧格式）
    - 手机号码（11位，1[3-9] 开头）
    - 银行卡号（16-19位连续数字）
    - 地址（省/市/区/路/号等关键词组合）
    - 密码/凭证（密码/token/secret 等关键词）
    - 邮箱地址（标准格式）
    - API 密钥（sk-.../Bearer/等模式）

    使用方式::

        detector = SensitiveInfoDetector()
        result = detector.detect("我的身份证号是110101199003071234")
        if result.is_sensitive:
            print(f"检测到敏感信息：{result.categories}")
    """

    def detect(self, text: str) -> SensitiveInfoResult:
        """对输入文本执行全类别敏感信息检测。

        Args:
            text: 待检测的输入文本。

        Returns:
            SensitiveInfoResult 包含所有匹配项和命中的类别集合。
        """
        import time

        t0 = time.time()
        matches: list[SensitiveMatch] = []

        # 身份证检测
        matches.extend(self._detect_id_cards(text))

        # 手机号检测
        matches.extend(self._detect_phones(text))

        # 银行卡检测
        matches.extend(self._detect_bank_cards(text))

        # 邮箱检测
        matches.extend(self._detect_emails(text))

        # API 密钥检测
        matches.extend(self._detect_api_keys(text))

        # 地址关键词检测
        matches.extend(self._detect_address(text))

        # 密码关键词检测
        matches.extend(self._detect_password(text))

        categories = {m.category for m in matches}
        elapsed_ms = round((time.time() - t0) * 1000, 1)

        return SensitiveInfoResult(
            is_sensitive=len(matches) > 0,
            matches=matches,
            categories=categories,
            input_length=len(text),
            detection_time_ms=elapsed_ms,
        )

    # ── 各类检测器（公开方法，支持单类检测）──

    def _detect_id_cards(self, text: str) -> list[SensitiveMatch]:
        """检测身份证号（18位 + 15位）。"""
        results: list[SensitiveMatch] = []
        for match in _ID18_RE.finditer(text):
            candidate = match.group()
            if _validate_id18_checksum(candidate):
                results.append(
                    SensitiveMatch(
                        text=candidate,
                        category=SensitiveCategory.ID_CARD,
                        start=match.start(),
                        end=match.end(),
                    )
                )
        for match in _ID15_RE.finditer(text):
            results.append(
                SensitiveMatch(
                    text=match.group(),
                    category=SensitiveCategory.ID_CARD,
                    start=match.start(),
                    end=match.end(),
                )
            )
        return results

    def _detect_phones(self, text: str) -> list[SensitiveMatch]:
        """检测手机号码。"""
        return [
            SensitiveMatch(
                text=match.group(),
                category=SensitiveCategory.PHONE,
                start=match.start(),
                end=match.end(),
            )
            for match in _PHONE_RE.finditer(text)
        ]

    def _detect_bank_cards(self, text: str) -> list[SensitiveMatch]:
        """检测银行卡号——对长数字串做上下文过滤以减少误报。

        排除明显不是银行卡的场景：
        - 时间戳（以 19/20 开头的 16-19 位纯数字）
        - 纯递增/递减序列
        """
        results: list[SensitiveMatch] = []
        for match in _BANK_CARD_RE.finditer(text):
            candidate = match.group()
            # 排除身份证号格式（18 位含校验码 + 15 位旧格式）
            if _ID18_RE.fullmatch(candidate) and _validate_id18_checksum(candidate):
                continue
            if _ID15_RE.fullmatch(candidate):
                continue
            # 排除时间戳格式（19xx/20xx 开头，后接合理月日时分）
            _ts_re = r"^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{4,11}$"
            if re.match(_ts_re, candidate):
                continue
            # 排除全是同一数字（如 1111111111111111）
            if len(set(candidate)) == 1:
                continue
            results.append(
                SensitiveMatch(
                    text=candidate,
                    category=SensitiveCategory.BANK_CARD,
                    start=match.start(),
                    end=match.end(),
                )
            )
        return results

    def _detect_emails(self, text: str) -> list[SensitiveMatch]:
        """检测邮箱地址。"""
        return [
            SensitiveMatch(
                text=match.group(),
                category=SensitiveCategory.EMAIL,
                start=match.start(),
                end=match.end(),
            )
            for match in _EMAIL_RE.finditer(text)
        ]

    def _detect_api_keys(self, text: str) -> list[SensitiveMatch]:
        """检测 API 密钥/令牌。"""
        return [
            SensitiveMatch(
                text=match.group().strip(),
                category=SensitiveCategory.API_KEY,
                start=match.start(),
                end=match.end(),
            )
            for match in _API_KEY_RE.finditer(text)
        ]

    def _detect_address(self, text: str) -> list[SensitiveMatch]:
        """检测地址关键词——考虑上下文长度和中文字符密度。

        只在包含足够多中文且出现地址关键词时触发，
        避免短文本中的孤立"号"/"路"字误报。
        """
        if not _ADDRESS_KEYWORDS.search(text):
            return []

        # 统计中文字符比例——纯中文内容 + 多地址关键词才判定为地址
        chinese_chars = len(re.findall(r"[一-鿿]", text))
        total_chars = len(text.replace(" ", ""))
        if total_chars == 0:
            return []

        chinese_ratio = chinese_chars / total_chars
        # 需要 ≥30% 中文字符 + ≥2 个地址关键词
        address_matches = _ADDRESS_KEYWORDS.findall(text)
        if chinese_ratio >= 0.3 and len(address_matches) >= 2:
            # 匹配整个包含地址上下文的片段
            context_match = re.search(
                r"[一-鿿0-9a-zA-Z" + re.escape("省市区县镇乡村路街巷弄道号栋幢单元室楼") + r"]{6,}",
                text,
            )
            if context_match:
                return [
                    SensitiveMatch(
                        text=context_match.group(),
                        category=SensitiveCategory.ADDRESS,
                        start=context_match.start(),
                        end=context_match.end(),
                    )
                ]
        return []

    def _detect_password(self, text: str) -> list[SensitiveMatch]:
        """检测密码/凭证关键词。"""
        results: list[SensitiveMatch] = []
        for match in _PASSWORD_KEYWORDS.finditer(text):
            # 获取关键词前后的上下文（前后各最多 20 个字符）
            ctx_start = max(0, match.start() - 20)
            ctx_end = min(len(text), match.end() + 20)
            context = text[ctx_start:ctx_end].strip()
            results.append(
                SensitiveMatch(
                    text=context,
                    category=SensitiveCategory.PASSWORD,
                    start=match.start(),
                    end=match.end(),
                )
            )
        return results


# ── 本地路由 ──


def _build_recall_summary(recalled: list[dict[str, object]]) -> str:
    """从召回记忆列表构建可读摘要。

    提取每条记忆的关键字段（内容/重要性/时间），
    格式化为用户可读的列表。

    Args:
        recalled: 召回的记忆条目列表，每条含 content/importance/timestamp 等字段。

    Returns:
        格式化后的记忆摘要文本，无记忆时返回空字符串。
    """
    if not recalled:
        return "（暂无相关记忆）"

    lines: list[str] = []
    for i, item in enumerate(recalled[:5], 1):  # 最多展示 5 条
        content = str(item.get("content", ""))
        # 截断过长内容
        if len(content) > 120:
            content = content[:120] + "..."
        lines.append(f"{i}. {content}")

    return "\n".join(lines)


def route_local(
    user_input: str,
    recalled: list[dict[str, object]] | None = None,
    detector: SensitiveInfoDetector | None = None,
) -> LocalRouteDecision:
    """检测敏感信息并决定是否需要本地分流。

    当输入包含敏感信息时，跳过外部 API 调用，使用本地
    召回记忆合成回复。否则返回 routed_locally=False，
    由调用方走正常的外部 API 管线。

    Args:
        user_input: 用户输入文本。
        recalled: 召回的记忆条目列表（可选，用于本地回复合成）。
        detector: 可复用的检测器实例（None 时内部创建）。

    Returns:
        LocalRouteDecision 包含路由决策和（如果路由到本地）
        合成的本地回复文本。

    Example::

        decision = route_local("我的密码是abc123", recalled=memories)
        if decision.routed_locally:
            return decision.local_response  # 本地回复，不调 API
        else:
            return engine.generate(user_input, recalled)  # 正常管线
    """
    if recalled is None:
        recalled = []

    det = detector if detector is not None else SensitiveInfoDetector()
    result = det.detect(user_input)

    if not result.is_sensitive:
        logger.debug(
            "未检测到敏感信息，走正常管线",
            extra={"component": "local_router", "input_len": len(user_input)},
        )
        return LocalRouteDecision(
            routed_locally=False,
            reason="no_sensitive_info",
        )

    # 命中敏感信息 → 本地分流
    category_names = ", ".join(c.name for c in result.categories)
    reason = f"检测到敏感信息 ({category_names})，路由到本地管线"
    logger.info(
        reason,
        extra={
            "component": "local_router",
            "categories": [c.value for c in result.categories],
            "match_count": len(result.matches),
            "detection_time_ms": result.detection_time_ms,
        },
    )

    # 构建本地回复
    recall_summary = _build_recall_summary(recalled)
    local_response = (
        "⚠️ **检测到您的消息包含敏感信息**，已自动转为本地处理，"
        "不会发送到外部 API。\n\n"
        f"敏感类别：{category_names}\n\n"
        "以下是本地记忆中与您问题相关的内容：\n\n"
        f"{recall_summary}\n\n"
        "为保护您的隐私，请避免在对话中直接发送身份证号、手机号、"
        "密码等个人信息。"
    )

    return LocalRouteDecision(
        routed_locally=True,
        reason=reason,
        categories=result.categories,
        local_response=local_response,
    )
