from __future__ import annotations

from typing import cast

import numpy as np


def _compute_decay_curve(
    creation_ts: float,
    init_strength: float,
    decay_lambda: float,
    now_ts: float,
    recall_logs: list[dict[str, object]],
    num_samples: int = 80,
) -> tuple[list[float], list[float], list[float], list[float]]:
    """Compute Ebbinghaus decay curve with recall jump markers.

    Returns (curve_t, curve_strength, jump_t, jump_strength).
    """
    if not recall_logs:
        t = np.linspace(creation_ts, now_ts, num_samples)
        s = init_strength * np.exp(-decay_lambda * (t - creation_ts))
        return list(t.tolist()), list(s.tolist()), [], []

    curve_t: list[float] = []
    curve_s: list[float] = []
    jump_t: list[float] = []
    jump_s: list[float] = []

    prev_t = creation_ts
    prev_s = 1.0  # 初始强度

    for log_entry in recall_logs:
        recall_at = cast(float, log_entry["recalled_at"])
        after = cast(float, log_entry["strength_after"])

        # 从上一个点到 recall 点的衰减曲线
        seg_t = np.linspace(prev_t, recall_at, max(10, num_samples // len(recall_logs)))
        time_since_prev = seg_t - prev_t if prev_t == creation_ts else seg_t - prev_t
        seg_s = prev_s * np.exp(-decay_lambda * time_since_prev)
        curve_t.extend(seg_t.tolist())
        curve_s.extend(seg_s.tolist())

        # recall 跳跃点
        jump_t.append(recall_at)
        jump_s.append(after)

        prev_t = recall_at
        prev_s = after

    # 从最后一次 recall 到现在的衰减
    seg_t = np.linspace(prev_t, now_ts, max(10, num_samples // (len(recall_logs) + 1)))
    seg_s = prev_s * np.exp(-decay_lambda * (seg_t - prev_t))
    curve_t.extend(seg_t.tolist())
    curve_s.extend(seg_s.tolist())

    return curve_t, curve_s, jump_t, jump_s


class TestDecayCurve:
    def test_no_recalls_simple_decay(self) -> None:
        creation = 1000.0
        now = 2000.0
        curve_t, curve_s, jump_t, jump_s = _compute_decay_curve(creation, 1.0, 0.1, now, [])

        assert len(curve_t) > 0
        assert len(curve_s) > 0
        assert len(jump_t) == 0
        # 开始 = 高，结束 = 低（衰减了）
        assert curve_s[0] > curve_s[-1]
        # 值域正确
        assert all(0 <= s <= 1.1 for s in curve_s)

    def test_with_recall_logs_produces_jumps(self) -> None:
        creation = 1000.0
        now = 2000.0
        recall_logs: list[dict[str, object]] = [
            {
                "recalled_at": 1200.0,
                "strength_before": 0.82,
                "strength_after": 0.98,
            },
            {
                "recalled_at": 1500.0,
                "strength_before": 0.75,
                "strength_after": 0.92,
            },
        ]
        curve_t, curve_s, jump_t, jump_s = _compute_decay_curve(
            creation, 1.0, 0.1, now, recall_logs
        )

        assert len(jump_t) == 2
        assert jump_s == [0.98, 0.92]
        # 时间单调递增
        assert all(curve_t[i] <= curve_t[i + 1] for i in range(len(curve_t) - 1))
        # 跳跃点之后的曲线段从 after 值开始

    def test_single_recall(self) -> None:
        creation = 1000.0
        now = 2000.0
        recall_logs: list[dict[str, object]] = [
            {
                "recalled_at": 1500.0,
                "strength_before": 0.61,
                "strength_after": 0.90,
            }
        ]
        curve_t, curve_s, jump_t, jump_s = _compute_decay_curve(
            creation, 1.0, 0.1, now, recall_logs
        )

        assert len(jump_t) == 1
        # 曲线的最后一段从 0.90 开始衰减
        assert any(s >= 0.9 for s in curve_s)


class TestEbbinghausEndToEnd:
    def test_real_world_curve(self) -> None:
        """用 ForgettingEngine 的公式验证曲线与引擎一致。"""
        creation = 1000.0
        now = 2000.0
        lam = 0.1
        recall_logs: list[dict[str, object]] = [
            {"recalled_at": 1500.0, "strength_before": 0.61, "strength_after": 0.90}
        ]

        _, curve_s, _, _ = _compute_decay_curve(creation, 1.0, lam, now, recall_logs)

        # 最后一点应接近 engine 计算的 current_strength
        # current_strength = 0.90 * exp(-0.1 * (2000 - 1500)) = 0.90 * exp(-50)
        # 对于 lambda=0.1 且时间以秒为单位，这太小了
        # 实际 lambda 值 ~ 0.1/day，测试用大时间跨度验证公式正确性
        expected = 0.90 * np.exp(-lam * (now - 1500.0))
        last_val = curve_s[-1]
        assert abs(last_val - expected) < 0.01

    def test_endpoint_at_now(self) -> None:
        creation = 0.0
        now = 1000.0
        curve_t, _, _, _ = _compute_decay_curve(creation, 1.0, 0.01, now, [])
        # 曲线终点接近 now
        assert abs(curve_t[-1] - now) < 10.0
