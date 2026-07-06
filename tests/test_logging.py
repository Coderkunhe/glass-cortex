"""测试 src/logging.py — 结构化 JSON Lines 日志基础设施。"""

from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path

from src.logging import JsonFormatter, get_logger, setup_logging


class TestJsonFormatter:
    """验证 JSON Lines 格式输出。"""

    def test_formats_record_as_json(self) -> None:
        fmt = JsonFormatter()
        record = logging.LogRecord(
            name="glasscortex.test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="hello world",
            args=(),
            exc_info=None,
        )
        line = fmt.format(record)
        obj = json.loads(line)
        assert obj["level"] == "INFO"
        assert obj["msg"] == "hello world"
        assert obj["logger"] == "glasscortex.test"
        assert "ts" in obj

    def test_includes_extra_fields(self) -> None:
        fmt = JsonFormatter()
        record = logging.LogRecord(
            name="glasscortex.test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="test",
            args=(),
            exc_info=None,
        )
        record.elapsed_ms = 42.5
        record.component = "engine"
        line = fmt.format(record)
        obj = json.loads(line)
        assert obj["elapsed_ms"] == 42.5
        assert obj["component"] == "engine"

    def test_includes_exception_info(self) -> None:
        fmt = JsonFormatter()
        try:
            raise ValueError("boom")
        except ValueError:
            import sys

            record = logging.LogRecord(
                name="glasscortex.test",
                level=logging.ERROR,
                pathname="test.py",
                lineno=1,
                msg="failed",
                args=(),
                exc_info=sys.exc_info(),
            )
        line = fmt.format(record)
        obj = json.loads(line)
        assert obj["error_type"] == "ValueError"
        assert "boom" in obj["error_msg"]


class TestSetupAndGetLogger:
    """验证 setup_logging 和 get_logger 集成。"""

    def test_setup_creates_log_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = Path(tmpdir)
            setup_logging(log_dir, level="DEBUG", profile="test-profile")
            logger = get_logger("test.component")
            logger.debug("debug message")
            logger.info("info message")

            log_file = log_dir / "glasscortex.log"
            assert log_file.exists()
            lines = log_file.read_text().strip().split("\n")
            assert len(lines) == 2

    def test_log_level_filters_correctly(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = Path(tmpdir)
            setup_logging(log_dir, level="WARNING", profile="test")
            logger = get_logger("test.filter")
            logger.debug("should not appear")
            logger.info("should not appear either")
            logger.warning("should appear")

            log_file = log_dir / "glasscortex.log"
            lines = log_file.read_text().strip().split("\n")
            assert len(lines) == 1
            obj = json.loads(lines[0])
            assert obj["level"] == "WARNING"

    def test_context_injection(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = Path(tmpdir)
            setup_logging(log_dir, level="INFO", profile="ctx-test")
            logger = get_logger("test.ctx")
            logger.info("context check")

            log_file = log_dir / "glasscortex.log"
            line = log_file.read_text().strip()
            obj = json.loads(line)
            assert obj["profile"] == "ctx-test"
            assert len(obj["session_id"]) > 0

    def test_setup_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = Path(tmpdir)
            setup_logging(log_dir, "INFO", "p1")
            setup_logging(log_dir, "INFO", "p1")  # should not duplicate handlers
            root = logging.getLogger("glasscortex")
            assert len(root.handlers) == 1


class TestGetLogger:
    """验证 get_logger 命名规约。"""

    def test_prepends_glasscortex_prefix(self) -> None:
        logger = get_logger("engine")
        assert logger.name == "glasscortex.engine"

    def test_preserves_full_prefix(self) -> None:
        logger = get_logger("glasscortex.custom")
        assert logger.name == "glasscortex.custom"


class TestTraceStep:
    """验证 @trace_step 装饰器。"""

    def test_logs_start_and_end(self) -> None:
        import time

        from src.logging import trace_step

        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = Path(tmpdir)
            setup_logging(log_dir, level="DEBUG", profile="trace-test")

            @trace_step("my_step")
            def my_func() -> str:
                time.sleep(0.01)
                return "done"

            result = my_func()
            assert result == "done"

            log_file = log_dir / "glasscortex.log"
            lines = log_file.read_text().strip().split("\n")
            assert len(lines) == 2
            start_obj = json.loads(lines[0])
            assert start_obj["level"] == "DEBUG"
            assert start_obj["event"] == "step_start"
            assert start_obj["step"] == "my_step"
            end_obj = json.loads(lines[1])
            assert end_obj["level"] == "INFO"
            assert end_obj["event"] == "step_end"
            assert end_obj["step"] == "my_step"
            assert end_obj["elapsed_ms"] > 0

    def test_logs_elapsed_ms(self) -> None:
        from src.logging import trace_step

        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = Path(tmpdir)
            setup_logging(log_dir, level="DEBUG", profile="elapsed-test")

            @trace_step()
            def slow_func() -> None:
                pass

            slow_func()
            log_file = log_dir / "glasscortex.log"
            lines = log_file.read_text().strip().split("\n")
            end_obj = json.loads(lines[1])
            assert end_obj["event"] == "step_end"
            assert end_obj["step"] == "slow_func"
            assert end_obj["elapsed_ms"] >= 0

    def test_logs_error_and_reraises(self) -> None:
        from src.logging import trace_step

        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = Path(tmpdir)
            setup_logging(log_dir, level="DEBUG", profile="error-test")

            @trace_step("failing_step")
            def fail_func() -> None:
                raise ValueError("intentional")

            import pytest

            with pytest.raises(ValueError, match="intentional"):
                fail_func()

            log_file = log_dir / "glasscortex.log"
            lines = log_file.read_text().strip().split("\n")
            error_obj = json.loads(lines[-1])
            assert error_obj["level"] == "ERROR"
            assert error_obj["event"] == "step_error"
            assert error_obj["step"] == "failing_step"
            assert error_obj["elapsed_ms"] >= 0

    def test_preserves_return_value(self) -> None:
        from src.logging import trace_step

        @trace_step()
        def add(a: int, b: int) -> int:
            return a + b

        assert add(2, 3) == 5
        assert add(-1, 1) == 0

    def test_default_name_from_func(self) -> None:
        from src.logging import trace_step

        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = Path(tmpdir)
            setup_logging(log_dir, level="DEBUG", profile="name-test")

            @trace_step()
            def custom_func_name() -> str:
                return "ok"

            custom_func_name()
            log_file = log_dir / "glasscortex.log"
            lines = log_file.read_text().strip().split("\n")
            start_obj = json.loads(lines[0])
            assert start_obj["step"] == "custom_func_name"
