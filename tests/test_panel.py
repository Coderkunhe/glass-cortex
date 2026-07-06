"""Tests for src/visualize/panel.py — Rich CLI panel rendering."""

from __future__ import annotations

from unittest.mock import MagicMock, patch


class TestStrengthBar:
    """Tests for _strength_bar — pure function, no I/O, returns Text object."""

    def test_high_strength_green(self) -> None:
        """value=0.85 produces bar with green style and correct filled count."""
        from src.visualize.panel import _strength_bar

        result = _strength_bar(0.85, width=20)
        rendered = result.markup
        assert result.style == "green"
        assert rendered.count("█") == 17  # 0.85 * 20 = 17
        assert rendered.count("░") == 3

    def test_low_strength_red(self) -> None:
        """value=0.15 produces bar with red style."""
        from src.visualize.panel import _strength_bar

        result = _strength_bar(0.15)
        assert result.style == "red"
        assert result.markup.count("█") == 3

    def test_medium_strength_yellow(self) -> None:
        """value=0.45 produces bar with yellow style."""
        from src.visualize.panel import _strength_bar

        result = _strength_bar(0.45)
        assert result.style == "yellow"
        assert result.markup.count("█") == 9

    def test_boundary_value_one(self) -> None:
        """value=1.0 fills entire bar with block chars."""
        from src.visualize.panel import _strength_bar

        result = _strength_bar(1.0)
        assert result.style == "green"
        assert result.markup.count("█") == 20
        assert "░" not in result.markup

    def test_boundary_value_zero(self) -> None:
        """value=0.0 produces empty bar, all unfilled."""
        from src.visualize.panel import _strength_bar

        result = _strength_bar(0.0)
        assert result.style == "red"
        assert result.markup.count("░") == 20
        assert "█" not in result.markup

    def test_custom_width(self) -> None:
        """Custom width parameter is honored."""
        from src.visualize.panel import _strength_bar

        result = _strength_bar(0.5, width=10)
        assert result.markup.count("█") == 5
        assert result.markup.count("░") == 5

    def test_boundary_0_6_is_yellow_not_green(self) -> None:
        """value=0.6 exactly is not > 0.6 so it uses yellow."""
        from src.visualize.panel import _strength_bar

        result = _strength_bar(0.6)
        assert result.style == "yellow"


class TestRenderRecall:
    """Tests for render_recall — prints recalled memory panel."""

    @patch("src.visualize.panel.Console")
    def test_empty_episodes_prints_empty_panel(self, mock_console_cls: MagicMock) -> None:
        """Empty episode list renders dim panel with no-memory message."""
        mock_console = MagicMock()
        mock_console_cls.return_value = mock_console

        from src.visualize.panel import render_recall

        render_recall([])
        mock_console.print.assert_called_once()
        panel_arg = mock_console.print.call_args[0][0]
        assert panel_arg.title == "🧠 召回"
        assert panel_arg.border_style == "dim"

    @patch("src.visualize.panel.Console")
    def test_with_episodes_prints_table_panel(self, mock_console_cls: MagicMock) -> None:
        """Non-empty episodes render cyan-border panel with table rows."""
        mock_console = MagicMock()
        mock_console_cls.return_value = mock_console

        from src.visualize.panel import render_recall

        episodes: list[dict[str, object]] = [
            {"content": "python 是动态语言", "initial_strength": 0.85},
            {"content": "pytest 用 conftest.py 管理 fixtures", "initial_strength": 0.55},
        ]
        render_recall(episodes)
        mock_console.print.assert_called_once()
        panel_arg = mock_console.print.call_args[0][0]
        assert panel_arg.title == "🧠 召回记忆"
        assert panel_arg.border_style == "cyan"

    @patch("src.visualize.panel.Console")
    def test_long_content_is_truncated(self, mock_console_cls: MagicMock) -> None:
        """Content exceeding 60 chars is truncated with ellipsis."""
        mock_console = MagicMock()
        mock_console_cls.return_value = mock_console

        from src.visualize.panel import render_recall

        long_msg = "这是一段非常长的文本" * 10  # ~100 chars
        episodes: list[dict[str, object]] = [
            {"content": long_msg, "initial_strength": 0.5},
        ]
        render_recall(episodes)
        panel = mock_console.print.call_args[0][0]
        # Table holds the truncated content — extract from table rows
        table = panel.renderable
        row_text = table.columns[0]._cells[0]
        assert "..." in str(row_text)
        assert len(long_msg) > 60  # original is long


class TestRenderNewMemory:
    """Tests for render_new_memory — green panel notification."""

    @patch("src.visualize.panel.Console")
    def test_prints_green_panel(self, mock_console_cls: MagicMock) -> None:
        """Renders green-bordered panel with checkmark and strength."""
        mock_console = MagicMock()
        mock_console_cls.return_value = mock_console

        from src.visualize.panel import render_new_memory

        render_new_memory("pytest fixture 作用域", 0.75)
        mock_console.print.assert_called_once()
        panel = mock_console.print.call_args[0][0]
        assert panel.border_style == "green"
        # The renderable is a Text with appended segments
        rendered = panel.renderable.markup
        assert "新记忆" in rendered
        assert "0.75" in rendered


class TestRenderResponse:
    """Tests for render_response — magenta assistant panel."""

    @patch("src.visualize.panel.Console")
    def test_prints_magenta_panel(self, mock_console_cls: MagicMock) -> None:
        """Renders bold magenta-bordered panel with assistant response."""
        mock_console = MagicMock()
        mock_console_cls.return_value = mock_console

        from src.visualize.panel import render_response

        render_response("你好，这是回复")
        assert mock_console.print.call_count == 2  # blank line + panel
        panel = mock_console.print.call_args_list[1][0][0]
        assert panel.title == "Assistant"
        assert panel.border_style == "bold magenta"
        assert panel.renderable == "你好，这是回复"


class TestRenderDecay:
    """Tests for render_decay — forgetting status summary."""

    @patch("src.visualize.panel.Console")
    def test_decay_zero_returns_early(self, mock_console_cls: MagicMock) -> None:
        """When decayed=0, no output is printed at all."""
        mock_console = MagicMock()
        mock_console_cls.return_value = mock_console

        from src.visualize.panel import render_decay

        render_decay(0, 10)
        mock_console.print.assert_not_called()

    @patch("src.visualize.panel.Console")
    def test_high_decay_ratio_red_border(self, mock_console_cls: MagicMock) -> None:
        """Ratio > 0.3 uses red border."""
        mock_console = MagicMock()
        mock_console_cls.return_value = mock_console

        from src.visualize.panel import render_decay

        render_decay(8, 10)
        mock_console.print.assert_called_once()
        panel = mock_console.print.call_args[0][0]
        assert panel.border_style == "red"
        assert panel.title == "📉 遗忘"
        assert "8/10" in str(panel.renderable)

    @patch("src.visualize.panel.Console")
    def test_low_decay_ratio_yellow_border(self, mock_console_cls: MagicMock) -> None:
        """Ratio <= 0.3 uses yellow border."""
        mock_console = MagicMock()
        mock_console_cls.return_value = mock_console

        from src.visualize.panel import render_decay

        render_decay(3, 10)
        mock_console.print.assert_called_once()
        panel = mock_console.print.call_args[0][0]
        assert panel.border_style == "yellow"
