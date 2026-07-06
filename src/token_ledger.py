"""Token 计量账本——LLM 调用 Token 记录 + 缓存命中追踪 + 步骤计费汇总。"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class TokenUsage:
    """单次 LLM 调用的 token 消耗记录。"""

    call_point: str
    prompt_tokens: int
    completion_tokens: int
    timestamp: float = field(default_factory=time.time)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass
class StepRecord:
    """单次管道步骤的计时记录（非 LLM 调用）。"""

    step_name: str
    elapsed_ms: float
    status: str = "ok"
    metrics: dict[str, object] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)


class TokenLedger:
    """全链路计量收集器 — LLM token 会计 + 管道步骤计时。

    内存记账，会话级生命周期。通过 setter 注入到各引擎。
    """

    def __init__(self) -> None:
        self._records: list[TokenUsage] = []
        self._step_records: list[StepRecord] = []

    # ── Token 记录（LLM 调用） ──

    def record(self, call_point: str, prompt_tokens: int, completion_tokens: int) -> None:
        """记录一次 LLM 调用的 token 消耗。"""
        self._records.append(
            TokenUsage(
                call_point=call_point,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
        )

    def record_cache_hit(self, call_point: str, tokens_saved: int) -> None:
        """记录一次缓存命中所节省的 token 量。

        tokens_saved 记录在 prompt_tokens 字段，
        completion_tokens=0，call_point 保留来源组件名便于归因。
        """
        self._records.append(
            TokenUsage(
                call_point=call_point,
                prompt_tokens=tokens_saved,
                completion_tokens=0,
            )
        )

    def record_compression_savings(self, tokens_saved: int) -> None:
        """记录消息压缩所节省的 token 量。"""
        self._records.append(
            TokenUsage(
                call_point="compression_savings",
                prompt_tokens=tokens_saved,
                completion_tokens=0,
            )
        )

    @property
    def record_count(self) -> int:
        """当前记录的 token usage 条数，用于快照/差分定位每轮新增记录。"""
        return len(self._records)

    @property
    def last_usage(self) -> TokenUsage | None:
        """最近一次 token 记录，用于 trace step 即时展示。"""
        return self._records[-1] if self._records else None

    def get_range(self, start: int, end: int) -> list[TokenUsage]:
        """获取 [start, end) 区间的 token usage 记录，用于按轮次差分归因。"""
        return self._records[start:end]

    @property
    def total_tokens(self) -> int:
        """会话累计 token 消耗。"""
        return sum(r.total_tokens for r in self._records)

    def summary(self) -> dict[str, dict[str, int]]:
        """按 call_point 分组的累计统计 + total 汇总。

        Returns:
            {"chat": {"count": N, "prompt_tokens": P, "completion_tokens": C, "total_tokens": T},
             "fact_extraction": {...},
             "total": {...}}
        """
        groups: dict[str, dict[str, int]] = {}
        for r in self._records:
            if r.call_point not in groups:
                groups[r.call_point] = {
                    "count": 0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                }
            g = groups[r.call_point]
            g["count"] += 1
            g["prompt_tokens"] += r.prompt_tokens
            g["completion_tokens"] += r.completion_tokens
            g["total_tokens"] += r.total_tokens

        total = {
            "count": sum(g["count"] for g in groups.values()),
            "prompt_tokens": sum(g["prompt_tokens"] for g in groups.values()),
            "completion_tokens": sum(g["completion_tokens"] for g in groups.values()),
            "total_tokens": sum(g["total_tokens"] for g in groups.values()),
        }
        groups["total"] = total
        return groups

    # ── Step 计时记录（管道步骤） ──

    def record_step(
        self,
        step_name: str,
        elapsed_ms: float,
        status: str = "ok",
        metrics: dict[str, object] | None = None,
    ) -> None:
        """记录一次管道步骤的耗时。"""
        self._step_records.append(
            StepRecord(
                step_name=step_name,
                elapsed_ms=elapsed_ms,
                status=status,
                metrics=metrics or {},
            )
        )

    @property
    def last_step(self) -> StepRecord | None:
        """最近一次 step 记录。"""
        return self._step_records[-1] if self._step_records else None

    def step_summary(self) -> dict[str, dict[str, float]]:
        """按 step_name 分组的耗时统计。

        Returns:
            {"decay": {"count": N, "total_ms": T, "avg_ms": A, "min_ms": N, "max_ms": X}, ...}
        """
        groups: dict[str, list[float]] = {}
        for r in self._step_records:
            if r.step_name not in groups:
                groups[r.step_name] = []
            groups[r.step_name].append(r.elapsed_ms)

        result: dict[str, dict[str, float]] = {}
        for name, times in groups.items():
            result[name] = {
                "count": float(len(times)),
                "total_ms": sum(times),
                "avg_ms": sum(times) / len(times),
                "min_ms": min(times),
                "max_ms": max(times),
            }
        return result
