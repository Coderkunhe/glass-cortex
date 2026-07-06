"""Rich 终端面板渲染——召回结果、新记忆、AI 回复的结构化终端输出。"""

from __future__ import annotations

from typing import cast

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text


def _strength_bar(value: float, width: int = 20) -> Text:
    """强度 → 彩色柱状条：绿(强) → 黄(中) → 红(弱)。"""
    filled = max(0, min(width, int(value * width)))
    bar = "█" * filled + "░" * (width - filled)
    if value > 0.6:
        color = "green"
    elif value > 0.3:
        color = "yellow"
    else:
        color = "red"
    return Text(bar, style=color)


def render_recall(episodes: list[dict[str, object]]) -> None:
    """渲染召回记忆面板。"""
    console = Console()
    if not episodes:
        console.print(Panel("(无相关记忆)", title="🧠 召回", border_style="dim"))
        return

    table = Table(show_header=False, box=None, padding=(0, 1))
    for ep in episodes:
        raw = str(ep["content"])
        content = f"{raw[:57]}..." if len(raw) > 60 else raw
        strength = cast(float, ep["initial_strength"])
        bar = _strength_bar(strength)
        table.add_row(f"[bold]{content}[/bold]", bar, f"{strength:.2f}")

    console.print(Panel(table, title="🧠 召回记忆", border_style="cyan"))


def render_new_memory(content: str, strength: float) -> None:
    """渲染新记忆形成提示。"""
    console = Console()
    text = Text()
    text.append("✓ 新记忆", style="bold green")
    text.append(f"  {content[:60]}{'...' if len(content) > 60 else ''}")
    text.append(f"  [强度: {strength:.2f}]", style="dim")
    console.print(Panel(text, border_style="green"))


def render_response(content: str) -> None:
    """渲染 AI 回复面板。"""
    console = Console()
    console.print()
    console.print(Panel(content, title="Assistant", border_style="bold magenta"))


def render_decay(decayed: int, total: int) -> None:
    """渲染遗忘状态摘要。"""
    console = Console()
    if decayed == 0:
        return
    ratio = decayed / total
    color = "red" if ratio > 0.3 else "yellow"
    console.print(
        Panel(
            f"{decayed}/{total} 条记忆正在衰减",
            title="📉 遗忘",
            border_style=color,
        )
    )
