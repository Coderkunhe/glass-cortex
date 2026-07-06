"""CLI 命令测试 — run() 函数的核心路径：启动、退出、命令分发、错误处理。

通过 Mock Console + init_engines 控制输入/输出，不依赖真实 LLM/嵌入/数据库。
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from src.chat.cli import run


def _make_mock_engines() -> tuple[
    MagicMock, MagicMock, MagicMock, MagicMock, object, MagicMock, MagicMock
]:
    """构造全套模拟引擎，每个方法返回有意义的值。"""
    store = MagicMock()
    store.get_all_episodes.return_value = []
    store.add_episode.return_value = 1
    store.get_episodes.return_value = [{"id": 1, "content": "测试消息", "initial_strength": 1.0}]
    store.delete_episode.return_value = True
    store.update_episode_content.return_value = True

    idx = MagicMock()
    idx.add.return_value = [42]

    recall = MagicMock()
    recall.recall.return_value = []

    forgetting = MagicMock()

    class _FakeChat:
        def generate_and_store(
            self, _msg: str, _recalled: list[dict[str, object]]
        ) -> tuple[str, object, object, object]:
            return ("AI 回复", None, None, None)

    chat = _FakeChat()
    ledger = MagicMock()
    planner = MagicMock()

    return (store, idx, recall, forgetting, chat, ledger, planner)


# ── 启动与退出 ──


def test_run_exits_on_slash_exit() -> None:
    """输入 /exit 后立即退出循环。"""
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
        patch("src.chat.cli.render_recall"),
        patch("src.chat.cli.render_new_memory"),
        patch("src.chat.cli.render_response"),
    ):
        # 用 MagicMock 模拟 Console —— input 返回 "/exit"
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.return_value = "/exit"

            run()

    mock_console.input.assert_called_once()
    mock_console.print.assert_called()  # 至少打印了 goodbye
    mock_console.input.assert_called_with("\n[bold cyan]你 > [/bold cyan]")


def test_run_empty_input_skipped() -> None:
    """空输入被跳过，继续等待下一次输入。"""
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
        patch("src.chat.cli.render_recall"),
        patch("src.chat.cli.render_new_memory"),
        patch("src.chat.cli.render_response"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            # 第一次空输入，第二次 /exit
            mock_console.input.side_effect = ["", "  ", "/exit"]

            run()

        # 调用了 3 次（2 次有效 + 1 次 /exit）
        assert mock_console.input.call_count >= 2


def test_run_keyboard_interrupt() -> None:
    """KeyboardInterrupt (Ctrl+C) 优雅退出。"""
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = KeyboardInterrupt()

            run()

        # 应该打印了 farewell 消息
        farewell_calls = [c for c in mock_console.print.call_args_list if "再见" in str(c)]
        assert len(farewell_calls) > 0


def test_run_eof_error() -> None:
    """EOFError (Ctrl+D) 优雅退出。"""
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = EOFError()

            run()

        farewell_calls = [c for c in mock_console.print.call_args_list if "再见" in str(c)]
        assert len(farewell_calls) > 0


# ── /list 命令 ──


def test_list_empty_store() -> None:
    """空记忆库显示 '(暂无记忆)'。"""
    engines = _make_mock_engines()
    engines[0].get_all_episodes.return_value = []

    with (
        patch("src.chat.cli.init_engines", return_value=engines),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/list", "/exit"]

            run()

        # 应看到 "(暂无记忆)"
        empty_calls = [c for c in mock_console.print.call_args_list if "暂无记忆" in str(c)]
        assert len(empty_calls) > 0


def test_list_with_episodes() -> None:
    """有记忆时显示记忆列表。"""
    engines = _make_mock_engines()
    engines[0].get_all_episodes.return_value = [
        {"id": 1, "content": "第一条记忆内容", "initial_strength": 0.95},
        {"id": 2, "content": "第二条记忆内容更长一些", "initial_strength": 0.72},
    ]

    with (
        patch("src.chat.cli.init_engines", return_value=engines),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/list", "/exit"]

            run()

        # 应看到两条记忆
        calls = [c for c in mock_console.print.call_args_list if "#1" in str(c)]
        assert len(calls) > 0


# ── /delete 命令 ──


def test_delete_valid_id() -> None:
    """删除存在的 episode。"""
    engines = _make_mock_engines()
    engines[0].delete_episode.return_value = True

    with (
        patch("src.chat.cli.init_engines", return_value=engines),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/delete 5", "/exit"]

            run()

        engines[0].delete_episode.assert_called_once_with(5)

        # 成功消息
        success = [c for c in mock_console.print.call_args_list if "已删除 episode" in str(c)]
        assert len(success) > 0


def test_delete_missing_args() -> None:
    """无 ID 参数时显示用法提示。"""
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/delete", "/exit"]

            run()

        usage = [c for c in mock_console.print.call_args_list if "用法" in str(c)]
        assert len(usage) > 0


def test_delete_non_numeric_id() -> None:
    """非数字 ID 显示错误。"""
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/delete abc", "/exit"]

            run()

        error = [c for c in mock_console.print.call_args_list if "ID 必须是数字" in str(c)]
        assert len(error) > 0


def test_delete_nonexistent_id() -> None:
    """删除不存在的 ID 显示提示。"""
    engines = _make_mock_engines()
    engines[0].delete_episode.return_value = False

    with (
        patch("src.chat.cli.init_engines", return_value=engines),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/delete 999", "/exit"]

            run()

        not_found = [c for c in mock_console.print.call_args_list if "不存在" in str(c)]
        assert len(not_found) > 0


# ── /edit 命令 ──


def test_edit_valid() -> None:
    """编辑存在的 episode。"""
    engines = _make_mock_engines()
    engines[0].update_episode_content.return_value = True

    with (
        patch("src.chat.cli.init_engines", return_value=engines),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/edit 1 新内容", "/exit"]

            run()

        engines[0].update_episode_content.assert_called_once_with(1, "新内容")

        success = [c for c in mock_console.print.call_args_list if "已更新 episode" in str(c)]
        assert len(success) > 0


def test_edit_missing_args() -> None:
    """缺少参数时显示用法提示。"""
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/edit", "/exit"]

            run()

        usage = [c for c in mock_console.print.call_args_list if "用法" in str(c)]
        assert len(usage) > 0


def test_edit_only_id_no_content() -> None:
    """只有 ID 没有内容时提示用法。"""
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/edit 1", "/exit"]

            run()

        usage = [c for c in mock_console.print.call_args_list if "用法" in str(c)]
        assert len(usage) > 0


def test_edit_non_numeric_id() -> None:
    """非数字 ID 显示错误。"""
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/edit abc 新内容", "/exit"]

            run()

        error = [c for c in mock_console.print.call_args_list if "ID 必须是数字" in str(c)]
        assert len(error) > 0


def test_edit_empty_content() -> None:
    """内容全空白时提示不能为空（防御性代码路径）。

    由于 str.split(maxsplit=2) 在默认 sep=None 时先 strip 前后空白再 split，
    纯空白内容在 split 时已经被吞掉，实际走的是 <3 参数的用法提示。
    此测试验证的是参数不足时的提示路径。
    """
    with (
        patch("src.chat.cli.init_engines", return_value=_make_mock_engines()),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            # 只传 ID 不传内容 → len(parts) < 3 → 显示用法
            mock_console.input.side_effect = ["/edit 1", "/exit"]

            run()

        usage = [c for c in mock_console.print.call_args_list if "用法" in str(c)]
        assert len(usage) > 0


def test_edit_nonexistent_id() -> None:
    """编辑不存在的 ID 显示提示。"""
    engines = _make_mock_engines()
    engines[0].update_episode_content.return_value = False

    with (
        patch("src.chat.cli.init_engines", return_value=engines),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/edit 999 新内容", "/exit"]

            run()

        not_found = [c for c in mock_console.print.call_args_list if "不存在" in str(c)]
        assert len(not_found) > 0


# ── 混合命令序列 ──


def test_multiple_commands_before_exit() -> None:
    """连续的多个命令都能正确执行。"""
    engines = _make_mock_engines()
    engines[0].get_all_episodes.return_value = []

    with (
        patch("src.chat.cli.init_engines", return_value=engines),
        patch("src.chat.cli.load_dotenv"),
        patch("src.chat.cli.render_recall"),
        patch("src.chat.cli.render_new_memory"),
        patch("src.chat.cli.render_response"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = [
                "/list",  # 空列表
                "/delete abc",  # 非法 ID
                "/edit 1 新",  # 编辑
                "/exit",
            ]

            run()

    # /list 执行了
    empty = [c for c in mock_console.print.call_args_list if "暂无记忆" in str(c)]
    assert len(empty) > 0

    # /delete abc 报错
    id_error = [c for c in mock_console.print.call_args_list if "ID 必须是数字" in str(c)]
    assert len(id_error) > 0

    # /edit 1 新 执行了
    engines[0].update_episode_content.assert_called_once_with(1, "新")


# ── 正常消息处理 ──


def test_normal_message_goes_through_pipeline() -> None:
    """正常消息经过遗忘→召回→存储→回复完整管线。"""
    engines = _make_mock_engines()

    with (
        patch("src.chat.cli.init_engines", return_value=engines),
        patch("src.chat.cli.load_dotenv"),
        patch("src.chat.cli.render_recall"),
        patch("src.chat.cli.render_new_memory"),
        patch("src.chat.cli.render_response"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["你好", "/exit"]

            run()

    # 遗忘衰减被调用
    engines[3].decay_all.assert_called()

    # 召回被调用
    engines[2].recall.assert_called_once()

    # 用户消息被存储
    engines[0].add_episode.assert_called_once()

    # FAISS 索引被更新
    engines[1].add.assert_called_once()


def test_chat_runtime_error_shows_warning() -> None:
    """LLM 调用失败显示 Warning 面板而非崩溃。"""
    engines = _make_mock_engines()

    class _FailChat:
        def generate_and_store(
            self, _msg: str, _recalled: list[dict[str, object]]
        ) -> tuple[str, object, object, object]:
            raise RuntimeError("API 不可用")

    engines_list = list(engines)
    engines_list[4] = _FailChat()

    with (
        patch("src.chat.cli.init_engines", return_value=tuple(engines_list)),
        patch("src.chat.cli.load_dotenv"),
        patch("src.chat.cli.render_recall"),
        patch("src.chat.cli.render_new_memory"),
        patch("src.chat.cli.render_response"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["导致错误的消息", "/exit"]

            run()

    # 检查 console.print 调用中是否有 Panel 对象（Rich Panel）
    # 包含 Warning 或错误消息
    from rich.panel import Panel

    warning_found = False
    for call_args in mock_console.print.call_args_list:
        args = call_args[0]  # positional args
        if args:
            panel = args[0]
            if isinstance(panel, Panel):
                # Panel.title 或 Panel.renderable (内容) 应包含相关信息
                title = str(getattr(panel, "title", ""))
                content = str(getattr(panel, "renderable", ""))
                if "Warning" in title or "API 不可用" in content:
                    warning_found = True
                    break

    assert warning_found, (
        f"console.print 应收到包含 Warning 的 Panel，"
        f"实际调用次数: {len(mock_console.print.call_args_list)}"
    )


# ── 索引保存 ──


def test_index_saved_on_exit() -> None:
    """正常退出时 FAISS 索引被保存、存储被关闭。"""
    engines = _make_mock_engines()

    with (
        patch("src.chat.cli.init_engines", return_value=engines),
        patch("src.chat.cli.load_dotenv"),
    ):
        with patch("src.chat.cli.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            mock_console.input.side_effect = ["/exit"]

            run()

    # 索引保存（路径由 profile_settings 决定，无法通过模块级 settings mock 控制）
    engines[1].save.assert_called_once()
    # 存储关闭
    engines[0].close.assert_called_once()
