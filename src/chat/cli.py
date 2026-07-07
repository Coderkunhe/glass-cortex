"""CLI 聊天入口——Rich 终端交互、命令分发（/list /delete /edit）、遗忘→召回→回复管线。"""

from __future__ import annotations

from rich.console import Console
from rich.panel import Panel

from src.bootstrap import init_engines, load_dotenv
from src.config import Settings, settings
from src.embed import embed
from src.visualize.panel import render_new_memory, render_recall, render_response


def run(profile: str = "default") -> None:
    """CLI 交互入口——启动聊天循环，串联遗忘衰减→记忆召回→消息存储→AI 回复的完整管线。

    Args:
        profile: 用户 Profile 名称，不同 Profile 拥有独立的记忆库和嵌入索引。
    """
    load_dotenv()

    profile_settings = Settings.from_flat(user_profile=Settings.sanitize_profile_name(profile))

    console = Console()
    console.print(
        Panel(
            f"聊天 + 记忆 + 可视化 — 输入内容开始对话，/exit 退出\n"
            f"[dim]Profile: {profile_settings.user_profile}[/dim]",
            title="🧠 GlassCortex",
            border_style="bold cyan",
        )
    )

    engines = init_engines(settings_override=profile_settings)
    store, idx, recall, forgetting, chat, _ledger, _planner = engines

    try:
        while True:
            try:
                user_input = console.input("\n[bold cyan]你 > [/bold cyan]").strip()
            except (EOFError, KeyboardInterrupt):  # fmt: skip
                console.print("\n[dim]再见。[/dim]")
                break

            if not user_input:
                continue
            if user_input.lower() == "/exit":
                break

            # 命令分发
            if user_input.lower() == "/list":
                episodes = store.get_all_episodes()
                if not episodes:
                    console.print("[dim](暂无记忆)[/dim]")
                else:
                    for ep in episodes:
                        eid = ep["id"]
                        content = str(ep["content"])
                        snippet = content[:60] + "..." if len(content) > 60 else content
                        strength = ep["initial_strength"]
                        console.print(
                            f"  [bold cyan]#{eid}[/bold cyan] "
                            f"[[bold]{strength:.2f}[/bold]] {snippet}"
                        )
                continue

            if user_input.lower().startswith("/delete"):
                parts = user_input.split()
                if len(parts) != 2:
                    console.print("[red]用法: /delete <id>[/red]")
                else:
                    try:
                        eid = int(parts[1])
                        if store.delete_episode(eid):
                            console.print(f"[green]已删除 episode #{eid}[/green]")
                        else:
                            console.print(f"[yellow]episode #{eid} 不存在[/yellow]")
                    except ValueError:
                        console.print("[red]ID 必须是数字[/red]")
                continue

            if user_input.lower().startswith("/edit"):
                parts = user_input.split(maxsplit=2)
                if len(parts) < 3:
                    console.print("[red]用法: /edit <id> <新内容>[/red]")
                else:
                    try:
                        eid = int(parts[1])
                        new_content = parts[2].strip()
                        if not new_content:
                            console.print("[red]内容不能为空[/red]")
                        elif store.update_episode_content(eid, new_content):
                            console.print(f"[green]已更新 episode #{eid}[/green]")
                        else:
                            console.print(f"[yellow]episode #{eid} 不存在[/yellow]")
                    except ValueError:
                        console.print("[red]ID 必须是数字[/red]")
                continue

            # 1. 遗忘衰减
            forgetting.decay_all()

            # 2. 召回
            recalled = recall.recall(user_input, top_k=settings.recall_top_k)
            render_recall(recalled)

            # 3. 存储用户消息
            vec = embed(user_input)
            faiss_ids = idx.add(vec.reshape(1, -1))
            eid = store.add_episode(user_input, faiss_id=faiss_ids[0])
            episodes = store.get_episodes([eid])
            if episodes:
                render_new_memory(
                    str(episodes[0]["content"]),
                    episodes[0]["initial_strength"],
                )

            # 4. 生成 AI 回复（回复也进入记忆系统）
            try:
                response_text, _, _, _ = chat.generate_and_store(user_input, recalled)
                render_response(response_text)
            except RuntimeError as exc:
                console.print(
                    Panel(
                        str(exc),
                        title="[yellow]Warning[/yellow]",
                        border_style="yellow",
                    )
                )

    finally:
        idx.save(str(profile_settings.resolved_index_path))
        store.close()
        console.print("[dim]索引已保存。[/dim]")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="GlassCortex CLI")
    parser.add_argument(
        "--profile",
        type=str,
        default="default",
        help="用户 Profile 名称（不同 Profile 拥有独立的记忆库）",
    )
    args = parser.parse_args()
    run(profile=args.profile)
