from __future__ import annotations

from pathlib import Path
from typing import Any, cast
from unittest.mock import MagicMock, patch

from src.config import Settings
from src.memory.index import IndexManager
from src.memory.store import MemoryStore


class TestCLICommands:
    """Batch 26: CLI /list, /delete, /edit 命令测试."""

    @staticmethod
    def _make_engines(tmp_path: Path) -> tuple[MemoryStore, IndexManager]:
        s = Settings.from_flat(data_dir=tmp_path, user_profile="test-cli")
        store = MemoryStore(str(s.resolved_db_path))
        store.init_db()
        idx = IndexManager()
        idx.save = MagicMock()  # type: ignore[method-assign]
        return store, idx

    _MOCK_REST = (
        MagicMock(),
        MagicMock(),
        MagicMock(),
        MagicMock(),
        MagicMock(),
    )

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_delete_command_removes_episode(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        from src.chat.cli import run

        store, idx = self._make_engines(tmp_path)
        db_path = store.db_path
        eid = store.add_episode("will be deleted")

        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = [f"/delete {eid}", "/exit"]
        mock_console_cls.return_value = mock_console

        run(profile="test-cli")
        verify = MemoryStore(str(db_path))
        verify.init_db()
        assert verify.get_episodes([eid]) == []
        verify.close()

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_invalid_inputs_show_errors(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        from src.chat.cli import run

        store, idx = self._make_engines(tmp_path)

        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = [
            "/delete",
            "/delete abc",
            "/delete 9999",
            "/edit",
            "/edit 1",
            "/exit",
        ]
        mock_console_cls.return_value = mock_console

        run(profile="test-cli")
        printed = " ".join(
            str(cast(tuple[Any, ...], call.args)[0])
            for call in mock_console.print.call_args_list
            if call.args
        )
        assert "用法: /delete <id>" in printed
        assert "ID 必须是数字" in printed
        assert "不存在" in printed
        assert "用法: /edit <id> <新内容>" in printed

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_list_shows_episodes(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        from src.chat.cli import run

        store, idx = self._make_engines(tmp_path)
        e1 = store.add_episode("第一段记忆内容")
        e2 = store.add_episode("第二段")

        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = ["/list", "/exit"]
        mock_console_cls.return_value = mock_console

        run(profile="test-cli")
        printed = " ".join(
            str(cast(tuple[Any, ...], call.args)[0])
            for call in mock_console.print.call_args_list
            if call.args
        )
        assert f"#{e1}" in printed
        assert f"#{e2}" in printed
        assert "第一段记忆内容" in printed
        assert "第二段" in printed

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_list_empty_store(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        store, idx = self._make_engines(tmp_path)
        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = ["/list", "/exit"]
        mock_console_cls.return_value = mock_console

        from src.chat.cli import run

        run(profile="test-cli")
        printed = " ".join(
            str(cast(tuple[Any, ...], call.args)[0])
            for call in mock_console.print.call_args_list
            if call.args
        )
        assert "暂无记忆" in printed

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_list_with_long_content(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        store, idx = self._make_engines(tmp_path)
        long_content = "这是一条很长" * 20  # ~120 chars, >60
        store.add_episode(long_content)
        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = ["/list", "/exit"]
        mock_console_cls.return_value = mock_console

        from src.chat.cli import run

        run(profile="test-cli")
        printed = " ".join(
            str(cast(tuple[Any, ...], call.args)[0])
            for call in mock_console.print.call_args_list
            if call.args
        )
        assert "..." in printed

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_edit_command_success(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        store, idx = self._make_engines(tmp_path)
        db_path = store.db_path
        eid = store.add_episode("原始内容")
        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = [f"/edit {eid} 修改后的内容", "/exit"]
        mock_console_cls.return_value = mock_console

        from src.chat.cli import run

        run(profile="test-cli")
        verify = MemoryStore(str(db_path))
        verify.init_db()
        episodes = verify.get_episodes([eid])
        assert len(episodes) == 1
        assert episodes[0]["content"] == "修改后的内容"
        verify.close()

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_edit_nonexistent_episode(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        store, idx = self._make_engines(tmp_path)
        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = ["/edit 99999 新内容", "/exit"]
        mock_console_cls.return_value = mock_console

        from src.chat.cli import run

        run(profile="test-cli")
        printed = " ".join(
            str(cast(tuple[Any, ...], call.args)[0])
            for call in mock_console.print.call_args_list
            if call.args
        )
        assert "不存在" in printed

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_delete_with_extra_whitespace(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        store, idx = self._make_engines(tmp_path)
        db_path = store.db_path
        eid = store.add_episode("will be deleted")
        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = [f"/delete   {eid}   ", "/exit"]
        mock_console_cls.return_value = mock_console

        from src.chat.cli import run

        run(profile="test-cli")
        verify = MemoryStore(str(db_path))
        verify.init_db()
        assert verify.get_episodes([eid]) == []
        verify.close()

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_exit_with_trailing_spaces(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        store, idx = self._make_engines(tmp_path)
        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = ["/exit   ", "/exit"]
        mock_console_cls.return_value = mock_console

        from src.chat.cli import run

        run(profile="test-cli")
        printed = " ".join(
            str(cast(tuple[Any, ...], call.args)[0])
            for call in mock_console.print.call_args_list
            if call.args
        )
        assert "索引已保存" in printed

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_empty_input_is_skipped(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        store, idx = self._make_engines(tmp_path)
        mock_init_engines.return_value = (store, idx) + self._MOCK_REST
        mock_console = MagicMock()
        mock_console.input.side_effect = ["", "  ", "/exit"]
        mock_console_cls.return_value = mock_console

        from src.chat.cli import run

        run(profile="test-cli")
        printed = " ".join(
            str(cast(tuple[Any, ...], call.args)[0])
            for call in mock_console.print.call_args_list
            if call.args
        )
        assert "索引已保存" in printed

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_unknown_slash_command_falls_through_to_chat(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        store, idx = self._make_engines(tmp_path)
        recall, forgetting, chat, __, __ = self._MOCK_REST
        chat.generate_and_store.return_value = ("response", 1, {}, {})
        recall.recall.return_value = []
        mock_init_engines.return_value = (
            store,
            idx,
            recall,
            forgetting,
            chat,
            MagicMock(),
            MagicMock(),
        )
        mock_console = MagicMock()
        mock_console.input.side_effect = ["/nonexistent", "/exit"]
        mock_console_cls.return_value = mock_console

        from src.chat.cli import run

        run(profile="test-cli")
        recall.recall.assert_called()
        forgetting.decay_all.assert_called()

    @patch("src.chat.cli.init_engines")
    @patch("src.chat.cli.Console")
    def test_chat_message_triggers_full_pipeline(
        self,
        mock_console_cls: MagicMock,
        mock_init_engines: MagicMock,
        tmp_path: Path,
    ) -> None:
        store, idx = self._make_engines(tmp_path)
        recall, forgetting, chat, __, __ = self._MOCK_REST
        chat.generate_and_store.return_value = ("response", 1, {}, {})
        recall.recall.return_value = []
        mock_init_engines.return_value = (
            store,
            idx,
            recall,
            forgetting,
            chat,
            MagicMock(),
            MagicMock(),
        )
        mock_console = MagicMock()
        mock_console.input.side_effect = ["hello cli test", "/exit"]
        mock_console_cls.return_value = mock_console

        from src.chat.cli import run

        run(profile="test-cli")
        forgetting.decay_all.assert_called()
        recall.recall.assert_called()
        chat.generate_and_store.assert_called()
