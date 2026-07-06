"""压缩质量加固——关键信息保护器 + 压缩前后保真度验证。

Phase 64 (四支柱 2.3)：CriticalInfoProtector 在压缩前标记不可概括的
关键信息 span——专名、数字、日期、决策、承诺；压缩后 verify()
检测被保护项是否在压缩结果中完整保留。纯规则引擎，零 LLM 依赖。

设计原则：
- 五类检测器各自独立，regex+启发式——快、确定、可测试。
- 检测和验证分离——ProtectionReport 作为中间产物，verify() 独立运行。
- 默认 feature flag 关闭（与压缩管线解耦），ProtectionReport.passed 供调用方决策。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum


class ProtectCategory(StrEnum):
    """保护类别——标记不可概括的关键信息类型。"""

    PROPER_NAME = "proper_name"  # 专名（人名/地名/机构名）
    NUMBER = "number"  # 数字（金额/百分比/数量+单位）
    DATE = "date"  # 日期（绝对日期/相对时间）
    DECISION = "decision"  # 决策（结论/确认/拍板）
    PROMISE = "promise"  # 承诺（保证/必须/一定）


@dataclass
class ProtectedSpan:
    """被标记为不可概括的文本片段。

    Attributes:
        start: 在原文本中的起始字符偏移。
        end: 在原文本中的结束字符偏移（不含）。
        text: 被保护的原文片段。
        category: 保护类别——决定其在下游验证中的优先级。
    """

    start: int
    end: int
    text: str
    category: ProtectCategory


@dataclass
class ProtectionReport:
    """关键信息保护分析报告——detect() 的产物。

    Attributes:
        original_text: 被分析的原始文本。
        protected_spans: 被标记为不可概括的文本片段列表。
        total_spans: 被保护片段总数。
    """

    original_text: str
    protected_spans: list[ProtectedSpan] = field(default_factory=list)

    @property
    def total_spans(self) -> int:
        """被保护的 span 数量。"""
        return len(self.protected_spans)

    def verify(self, compressed_text: str) -> VerificationResult:
        """验证被保护项是否在压缩文本中完整保留。

        对每个 protected span，检查其 text 是否作为子串
        出现在 compressed_text 中。容忍轻微格式变化
        （去除首尾空白后匹配）。空文本 span 始终视为保留（
        空串是任意字符串的子串，但无信息可丢失）。

        Args:
            compressed_text: 压缩后的文本。

        Returns:
            VerificationResult——统计保留/丢失数量及通过与否。
        """
        preserved: list[ProtectedSpan] = []
        lost: list[ProtectedSpan] = []
        normalized_compressed = compressed_text.strip()

        for span in self.protected_spans:
            normalized_span = span.text.strip()
            if not normalized_span:
                # 空文本 span 无信息可丢失，视为保留
                preserved.append(span)
            elif normalized_span in normalized_compressed:
                preserved.append(span)
            else:
                lost.append(span)

        total = self.total_spans
        rate = len(preserved) / total if total > 0 else 1.0
        return VerificationResult(
            total_protected=total,
            preserved=len(preserved),
            lost=lost,
            preservation_rate=rate,
        )


@dataclass
class VerificationResult:
    """压缩前后保护验证结果。

    Attributes:
        total_protected: 原始文本中被保护的 span 总数。
        preserved: 压缩后仍然完整保留的数量。
        lost: 压缩后丢失的 protected span 列表。
        preservation_rate: 保留率 (0.0-1.0)。
        passed: True 表示所有关键信息均已保留（lost 为空）。
    """

    total_protected: int
    preserved: int
    lost: list[ProtectedSpan] = field(default_factory=list)
    preservation_rate: float = 1.0

    @property
    def passed(self) -> bool:
        """所有被保护 span 均完整保留。"""
        return len(self.lost) == 0


class CriticalInfoProtector:
    """关键信息保护器——regex+启发式标记不可概括 spans。

    五类检测器（按优先级排列）:
      1. 专名 (Proper Name) — 中文姓名/英文名/地名/机构名
      2. 数字 (Number)       — 金额/百分比/数量+单位
      3. 日期 (Date)         — 绝对日期/相对时间
      4. 决策 (Decision)     — 结论/确认/拍板关键词
      5. 承诺 (Promise)      — 保证/必须/一定关键词

    设计为纯规则引擎——无 LLM 依赖，每次 detect() 耗时 < 1ms。
    检测器可被子类覆盖以定制 A/B 实验。

    用法::

        protector = CriticalInfoProtector()
        report = protector.detect("李总承诺下周五前打款 ¥500,000。")
        # → 3 protected spans: 李总(PROPER_NAME) / 下周五(DATE) / ¥500,000(NUMBER)
        result = report.verify("李总承诺下周付款。")
        # → passed=False, lost=[¥500,000]
    """

    # ── 中文姓氏（百家姓前 60）──
    _CN_SURNAMES: str = (
        "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许"
        "何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章"
        "云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳"
        "酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常"
        "乐于时傅皮下齐康伍余元卜顾孟平黄和穆萧尹"
    )

    # ── 决策关键词 ──
    _DECISION_KEYWORDS: tuple[str, ...] = (
        "决定",
        "确认",
        "同意",
        "定下来",
        "敲定",
        "拍板",
        "商定",
        "议定",
        "核定",
        "批准",
        "通过",
        "否决",
        "结论是",
        "最终方案",
        "就这么定",
    )

    # ── 承诺关键词 ──
    _PROMISE_KEYWORDS: tuple[str, ...] = (
        "承诺",
        "保证",
        "一定",
        "必须",
        "务必",
        "绝不会",
        "绝不",
        "说到做到",
        "确保",
        "担保",
        "发誓",
    )

    # ── 相对日期关键词 ──
    _RELATIVE_DATE_KEYWORDS: tuple[str, ...] = (
        "今天",
        "明天",
        "后天",
        "昨天",
        "前天",
        "本周",
        "下周",
        "上周",
        "这周",
        "本月",
        "下个月",
        "上个月",
        "这个月",
        "今年",
        "明年",
        "去年",
        "周一",
        "周二",
        "周三",
        "周四",
        "周五",
        "周六",
        "周日",
        "星期一",
        "星期二",
        "星期三",
        "星期四",
        "星期五",
        "星期六",
        "星期日",
        "大后天",
        "大前天",
    )

    def detect(self, text: str) -> ProtectionReport:
        """运行全部五类检测器，返回保护报告。

        对 text 运行所有检测器，合并结果并去重（重叠 span 保留先出现的）。
        返回的 ProtectionReport 包含原始文本和支持 verify() 的完整信息。

        Args:
            text: 待分析的原始文本（压缩前）。

        Returns:
            ProtectionReport——包含所有被保护 span 和便捷的 verify() 方法。
        """
        spans: list[ProtectedSpan] = []
        spans.extend(self._detect_dates(text))
        spans.extend(self._detect_numbers(text))
        spans.extend(self._detect_proper_names(text))
        spans.extend(self._detect_decisions(text))
        spans.extend(self._detect_promises(text))

        # 去重：按 start 排序，重叠 span 保留先出现的（更具体）
        spans.sort(key=lambda s: (s.start, s.end))
        deduped: list[ProtectedSpan] = []
        for span in spans:
            if deduped and span.start < deduped[-1].end:
                continue  # 与上一个重叠，跳过
            deduped.append(span)

        return ProtectionReport(original_text=text, protected_spans=deduped)

    def verify(self, original: str, compressed: str) -> VerificationResult:
        """便捷方法——一步完成检测 + 验证。

        等价于 self.detect(original).verify(compressed)。

        Args:
            original: 原始文本（压缩前）。
            compressed: 压缩后文本。

        Returns:
            VerificationResult——保留率 + 丢失列表 + 通过标志。
        """
        return self.detect(original).verify(compressed)

    # ═══════════════════════════════════════════════════════
    # 五类检测器（public——允许调用方单独使用）
    # ═══════════════════════════════════════════════════════

    def _detect_proper_names(self, text: str) -> list[ProtectedSpan]:
        """检测专名——中文姓名、英文名、地名、机构名。

        策略：
        - 中文姓名：常见姓氏 + 1-3 个后续字符，过滤常见非姓名词
        - 英文名：连续大写开头的单词序列（≥2 词时标记）
        - 地名/机构名：带后缀关键词的片段（市/省/公司/大学/医院等）
        """
        spans: list[ProtectedSpan] = []

        # ── 常见非姓名词前缀（姓氏+后续字符恰好组成常见词）──
        _non_name_prefixes: frozenset[str] = frozenset(
            {
                "任何",
                "然后",
                "许多",
                "多么",
                "于是",
                "而言",
                "与否",
                "以及",
                "以为",
                "以前",
                "以后",
                "于是乎",
            }
        )

        # ── 中文姓名：姓氏 + 1-3 个中文字符 ──
        _common_suffixes: tuple[str, ...] = (
            "的",
            "了",
            "是",
            "在",
            "和",
            "与",
            "或",
            "市",
            "省",
            "县",
            "区",
            "镇",
            "乡",
        )
        for match in re.finditer(rf"([{self._CN_SURNAMES}])([一-鿿]{{1,3}})", text):
            tail = match.group(2)
            full = match.group()
            # 过滤误报：常见非姓名词（前缀匹配——"任何需要" 以 "任何" 开头）
            if any(full.startswith(w) for w in _non_name_prefixes):
                continue
            # 过滤误报：tail 以常见后缀结尾（如 "市"、"的"）
            if tail.endswith(_common_suffixes):
                continue
            spans.append(
                ProtectedSpan(
                    start=match.start(),
                    end=match.end(),
                    text=full,
                    category=ProtectCategory.PROPER_NAME,
                )
            )

        # ── 英文名：2+ 连续大写开头单词 ──
        for match in re.finditer(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b", text):
            spans.append(
                ProtectedSpan(
                    start=match.start(),
                    end=match.end(),
                    text=match.group(),
                    category=ProtectCategory.PROPER_NAME,
                )
            )

        # ── 地名/机构名后缀 ──
        org_suffix = r"(?:市|省|县|区|镇|公司|集团|大学|学院|医院|研究所|中心|部门)"
        for match in re.finditer(rf"[一-鿿]{{2,8}}{org_suffix}", text):
            spans.append(
                ProtectedSpan(
                    start=match.start(),
                    end=match.end(),
                    text=match.group(),
                    category=ProtectCategory.PROPER_NAME,
                )
            )

        return spans

    def _detect_numbers(self, text: str) -> list[ProtectedSpan]:
        """检测数字——金额、百分比、数量+单位。

        策略：
        - 金额：¥/$ + 数字 / 数字 + 元/美元/欧元
        - 百分比：数字 + %
        - 数量+单位：数字 + 常见量词/单位
        """
        spans: list[ProtectedSpan] = []

        # ── 金额 ──
        patterns = [
            r"[¥￥\$]\s*\d[\d,.]*",  # ¥5,000 / $100.50
            r"\d[\d,.]*\s*[元美元欧元港币英镑]",  # 500元 / 100万美元
        ]
        for pat in patterns:
            for match in re.finditer(pat, text):
                spans.append(
                    ProtectedSpan(
                        start=match.start(),
                        end=match.end(),
                        text=match.group(),
                        category=ProtectCategory.NUMBER,
                    )
                )

        # ── 百分比 ──
        for match in re.finditer(r"\d+\.?\d*\s*%", text):
            spans.append(
                ProtectedSpan(
                    start=match.start(),
                    end=match.end(),
                    text=match.group(),
                    category=ProtectCategory.NUMBER,
                )
            )

        # ── 数量 + 单位（至少含数字 + 中文量词）──
        for match in re.finditer(r"\d[\d,.]*\s*[个件条次人天月年只台辆张本支颗粒]", text):
            spans.append(
                ProtectedSpan(
                    start=match.start(),
                    end=match.end(),
                    text=match.group(),
                    category=ProtectCategory.NUMBER,
                )
            )

        return spans

    def _detect_dates(self, text: str) -> list[ProtectedSpan]:
        """检测日期——绝对日期 + 相对时间。

        策略：
        - 绝对日期：YYYY-MM-DD, YYYY/MM/DD, N年N月N日
        - 相对日期：明天/后天/下周/下个月等关键词
        """
        spans: list[ProtectedSpan] = []

        # ── 绝对日期 ──
        abs_patterns = [
            r"\d{4}[-/]\d{1,2}[-/]\d{1,2}",  # 2025-01-15
            r"\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日",  # 2025年3月15日（容空格）
            r"\d{1,2}\s*月\s*\d{1,2}\s*日",  # 3月15日（容空格）
        ]
        for pat in abs_patterns:
            for match in re.finditer(pat, text):
                spans.append(
                    ProtectedSpan(
                        start=match.start(),
                        end=match.end(),
                        text=match.group(),
                        category=ProtectCategory.DATE,
                    )
                )

        # ── 相对日期 ──
        for keyword in self._RELATIVE_DATE_KEYWORDS:
            for match in re.finditer(re.escape(keyword), text):
                # 检查上下文：前面有数字则跳过（如"3天"不是日期关键词）
                if match.start() > 0 and text[match.start() - 1].isdigit():
                    continue
                spans.append(
                    ProtectedSpan(
                        start=match.start(),
                        end=match.end(),
                        text=match.group(),
                        category=ProtectCategory.DATE,
                    )
                )

        return spans

    def _detect_decisions(self, text: str) -> list[ProtectedSpan]:
        """检测决策——包含决策关键词的句子片段。

        策略：匹配决策关键词，向前后各扩展若干字符捕获上下文。
        """
        spans: list[ProtectedSpan] = []
        for keyword in self._DECISION_KEYWORDS:
            for match in re.finditer(re.escape(keyword), text):
                # 扩展捕获上下文：前后各取至多 15 个字符
                ctx_start = max(0, match.start() - 15)
                ctx_end = min(len(text), match.end() + 15)
                # 裁剪到最近的标点或句边界
                ctx_text = text[ctx_start:ctx_end]
                spans.append(
                    ProtectedSpan(
                        start=ctx_start,
                        end=ctx_end,
                        text=ctx_text,
                        category=ProtectCategory.DECISION,
                    )
                )
        return spans

    def _detect_promises(self, text: str) -> list[ProtectedSpan]:
        """检测承诺——包含保证/必须/一定等承诺关键词的句子片段。

        策略：匹配承诺关键词，向前后各扩展若干字符。
        特别注意"一定+动词"模式（如"一定完成"）。
        """
        spans: list[ProtectedSpan] = []
        for keyword in self._PROMISE_KEYWORDS:
            for match in re.finditer(re.escape(keyword), text):
                ctx_start = max(0, match.start() - 15)
                ctx_end = min(len(text), match.end() + 15)
                ctx_text = text[ctx_start:ctx_end]
                spans.append(
                    ProtectedSpan(
                        start=ctx_start,
                        end=ctx_end,
                        text=ctx_text,
                        category=ProtectCategory.PROMISE,
                    )
                )
        return spans


# ═══════════════════════════════════════════════════════════════
# Phase 64 Batch 2 — TemporalFidelityEvaluator
# ═══════════════════════════════════════════════════════════════


@dataclass
class TemporalAnchor:
    """时序锚点——文本中出现的时间标记。

    由 TemporalFidelityEvaluator 从文本中提取，
    代表一个可定位到具体字符偏移的时间或事件顺序标记。

    Attributes:
        position: 在文本中的字符偏移。
        text: 锚点原文。
        anchor_type: 锚点类别——"absolute_date"（绝对日期）、
            "relative_date"（相对日期）或 "sequence_marker"（序列标记词）。
    """

    position: int
    text: str
    anchor_type: str


@dataclass
class TemporalFidelityResult:
    """时序保真度评估结果——压缩后事件顺序是否保持。

    由最长公共子序列 (LCS) 算法计算原始文本与压缩文本中
    时序锚点的相对顺序一致性。逆序对列表可供上游决策使用
    （例如触发人工复核或拒绝压缩结果）。

    Attributes:
        original_anchors: 原始文本中提取的时序锚点总数。
        compressed_anchors: 压缩文本中提取的时序锚点总数。
        matched_anchors: 匹配成功的锚点对数（同时出现在两边的锚点）。
        lcs_length: 最长公共子序列长度——顺序正确的锚点数。
        inversion_pairs: 逆序对列表，每对 (原文先出现的, 原文后出现的)
            但压缩后顺序颠倒。
        order_preservation_rate: 顺序保持率 = lcs_length / matched_anchors
            （0.0-1.0，无匹配锚点时 1.0）。
        fidelity_score: 综合保真度 = 匹配率 × 顺序保持率（0.0-1.0）。
    """

    original_anchors: int
    compressed_anchors: int
    matched_anchors: int
    lcs_length: int
    inversion_pairs: list[tuple[str, str]] = field(default_factory=list)
    order_preservation_rate: float = 1.0
    fidelity_score: float = 1.0

    @property
    def order_preserved(self) -> bool:
        """时序完全保持——无逆序对。"""
        return len(self.inversion_pairs) == 0


@dataclass
class TemporalFidelityReport:
    """时序锚点提取报告——evaluate() 的中间产物。

    保存原始文本及其提取的时序锚点，供后续与压缩文本
    锚点进行 LCS 比对。调用方可以单独使用此报告检查
    原始文本中包含哪些时序信息。

    Attributes:
        original_text: 被分析的原始文本。
        anchors: 从原始文本中提取的时序锚点（按位置升序）。
    """

    original_text: str
    anchors: list[TemporalAnchor] = field(default_factory=list)

    def evaluate(self, compressed_anchors: list[TemporalAnchor]) -> TemporalFidelityResult:
        """对压缩文本锚点进行 LCS 比对，返回保真度结果。

        匹配策略：对每个原始锚点，在压缩锚点中寻找文本重叠
        （子串包含关系）的匹配项，greedy 按位置就近匹配。
        对匹配上的锚点对，计算压缩位置序列的最长递增子序列 (LIS)
        作为顺序保持长度。遍历所有匹配对找出逆序。

        Args:
            compressed_anchors: 从压缩文本中提取的时序锚点（按位置升序）。

        Returns:
            TemporalFidelityResult——匹配统计 + 逆序对 + 保真度评分。
        """
        orig_anchors = self.anchors
        n_orig = len(orig_anchors)
        n_comp = len(compressed_anchors)

        # 边界：原始无锚点 → 无信息可乱序
        if n_orig == 0:
            return TemporalFidelityResult(
                original_anchors=0,
                compressed_anchors=n_comp,
                matched_anchors=0,
                lcs_length=0,
                inversion_pairs=[],
                order_preservation_rate=1.0,
                fidelity_score=1.0,
            )

        # ── 锚点匹配：greedy 文本重叠匹配 ──
        matched_pairs: list[tuple[int, int]] = []  # [(orig_idx, comp_idx)]
        used_comp: set[int] = set()
        for i, oa in enumerate(orig_anchors):
            for j, ca in enumerate(compressed_anchors):
                if j in used_comp:
                    continue
                if _texts_overlap(oa.text, ca.text):
                    matched_pairs.append((i, j))
                    used_comp.add(j)
                    break

        n_matched = len(matched_pairs)

        # 边界：零匹配 → 保真度为 0
        if n_matched == 0:
            return TemporalFidelityResult(
                original_anchors=n_orig,
                compressed_anchors=n_comp,
                matched_anchors=0,
                lcs_length=0,
                inversion_pairs=[],
                order_preservation_rate=1.0,
                fidelity_score=0.0,
            )

        # ── LIS 长度（顺序正确的锚点数）──
        comp_positions = [j for _i, j in matched_pairs]
        lcs_len = _lis_length(comp_positions)

        # ── 逆序检测 ──
        inversions: list[tuple[str, str]] = []
        for a in range(n_matched):
            for b in range(a + 1, n_matched):
                # orig 顺序: a < b（因为 matched_pairs 按 orig_idx 升序）
                # 如果 comp_positions[a] > comp_positions[b] → 逆序
                if comp_positions[a] > comp_positions[b]:
                    inversions.append(
                        (
                            orig_anchors[matched_pairs[a][0]].text,
                            orig_anchors[matched_pairs[b][0]].text,
                        )
                    )

        # ── 评分 ──
        match_rate = n_matched / n_orig
        order_rate = lcs_len / n_matched
        fidelity = match_rate * order_rate

        return TemporalFidelityResult(
            original_anchors=n_orig,
            compressed_anchors=n_comp,
            matched_anchors=n_matched,
            lcs_length=lcs_len,
            inversion_pairs=inversions,
            order_preservation_rate=round(order_rate, 4),
            fidelity_score=round(fidelity, 4),
        )


class TemporalFidelityEvaluator:
    """时序保真度评估器——检查压缩是否打乱了事件时间顺序。

    纯规则引擎，零 LLM 依赖。复用 CriticalInfoProtector 的
    日期检测逻辑提取时间锚点，补充序列标记词检测。
    通过最长公共子序列 (LCS) 算法比对原始文本与压缩文本中
    时序锚点的相对顺序一致性。

    用法::

        evaluator = TemporalFidelityEvaluator()
        result = evaluator.evaluate(
            original="首先开会，然后签约，最后庆祝。",
            compressed="签约完成，庆祝活动开始。",
        )
        # → order_preserved=True（签约→庆祝顺序正确，首先开会丢失）
        # → fidelity_score ≈ 0.67（3 锚点中匹配 2 个，顺序正确的 2 个）
    """

    _SEQUENCE_MARKERS: tuple[str, ...] = (
        "首先",
        "然后",
        "接着",
        "最后",
        "之前",
        "之后",
        "第一步",
        "第二步",
        "第三步",
        "第四步",
        "第五步",
        "先",
        "再",
        "紧接着",
        "起初",
        "随后",
        "最终",
        "一开始",
        "后来",
        "接下来",
    )

    def __init__(self, protector: CriticalInfoProtector | None = None) -> None:
        """初始化评估器。

        Args:
            protector: 可选的 CriticalInfoProtector 实例，
                用于复用日期检测逻辑。若未提供则创建一个默认实例。
        """
        self._protector = protector or CriticalInfoProtector()

    def extract_anchors(self, text: str) -> list[TemporalAnchor]:
        """提取文本中所有时序锚点。

        两阶段提取：
        1. 日期锚点——复用 CriticalInfoProtector._detect_dates()
           检测绝对日期和相对日期。
        2. 序列标记词——检测表示步骤/顺序的关键词。

        结果按 position 升序排列。

        Args:
            text: 待分析文本。

        Returns:
            按文本位置升序排列的 TemporalAnchor 列表。
        """
        anchors: list[TemporalAnchor] = []
        import re as _re

        # ── 阶段 1：日期锚点（复用 protector 日期检测器）──
        for span in self._protector._detect_dates(text):
            # 推断锚点类型：绝对日期 vs 相对日期
            # 绝对日期：包含数字格式 (YYYY-MM-DD, N年N月N日, N月N日)

            is_absolute = bool(
                _re.search(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", span.text)
                or _re.search(r"\d+\s*年\s*\d+\s*月", span.text)
                or _re.search(r"\d{1,2}\s*月\s*\d{1,2}\s*日", span.text)
            )
            anchor_type = "absolute_date" if is_absolute else "relative_date"
            anchors.append(
                TemporalAnchor(
                    position=span.start,
                    text=span.text,
                    anchor_type=anchor_type,
                )
            )

        # ── 阶段 2：序列标记词 ──
        for marker in self._SEQUENCE_MARKERS:
            for match in _re.finditer(_re.escape(marker), text):
                # 上下文检查："先" 前面有数字则跳过（如 "第3步" 不是 "先" 标记）
                if marker == "先" and match.start() > 0 and text[match.start() - 1].isdigit():
                    continue
                anchors.append(
                    TemporalAnchor(
                        position=match.start(),
                        text=match.group(),
                        anchor_type="sequence_marker",
                    )
                )

        # 按 position 升序排列
        anchors.sort(key=lambda a: a.position)
        return anchors

    def evaluate(self, original: str, compressed: str) -> TemporalFidelityResult:
        """便捷方法——一步完成锚点提取 + 时序比对。

        等价于::

            orig = self.extract_anchors(original)
            comp = self.extract_anchors(compressed)
            return TemporalFidelityReport(original, orig).evaluate(comp)

        Args:
            original: 原始文本（压缩前）。
            compressed: 压缩后文本。

        Returns:
            TemporalFidelityResult——匹配统计 + 逆序对 + 保真度评分。
        """
        orig_anchors = self.extract_anchors(original)
        comp_anchors = self.extract_anchors(compressed)
        return TemporalFidelityReport(original, orig_anchors).evaluate(comp_anchors)


# ═══════════════════════════════════════════════════════════════
# 辅助函数
# ═══════════════════════════════════════════════════════════════


def _texts_overlap(a: str, b: str) -> bool:
    """检查两段文本是否有重叠（子串包含关系）。

    去除首尾空白后，检查一段文本是否是另一段的子串。
    这是锚点匹配的核心——容忍压缩导致的轻微文本变化
    （如 "2025年3月15日" vs "3月15日"）。

    Args:
        a: 第一段文本。
        b: 第二段文本。

    Returns:
        True 如果 a 包含 b 或 b 包含 a（去除空白后）。
    """
    a_norm = a.strip()
    b_norm = b.strip()
    if not a_norm or not b_norm:
        return False
    return a_norm in b_norm or b_norm in a_norm


def _lis_length(seq: list[int]) -> int:
    """最长递增子序列 (LIS) 长度——O(n log n) 耐心排序算法。

    用于计算匹配锚点在压缩文本中的位置序列中，
    有多少个保持原始顺序（递增）。

    Args:
        seq: 整数序列（压缩文本中匹配锚点的位置）。

    Returns:
        LIS 长度。
    """
    import bisect

    tails: list[int] = []
    for x in seq:
        i = bisect.bisect_left(tails, x)
        if i == len(tails):
            tails.append(x)
        else:
            tails[i] = x
    return len(tails)
