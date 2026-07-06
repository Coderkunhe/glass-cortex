"""GlassCortex 结构化日志 — JSON Lines 输出到 data/{profile}/ 下。

使用方式：
    from src.logging import get_logger
    logger = get_logger(__name__)
    logger.info("消息内容", extra={"elapsed_ms": 12.3})

启动时调用 setup_logging() 配置 handler 和上下文。
"""

from __future__ import annotations

import functools
import json
import logging
import logging.handlers
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from src.config import LOG_FILENAME

F = TypeVar("F", bound=Callable[..., Any])

# 模块级状态 — setup_logging() 写入，get_logger() / JsonFormatter 读取
_profile: str = "default"
_session_id: str = ""


def setup_logging(log_dir: Path, level: str = "INFO", profile: str = "default") -> None:
    """配置 glasscortex 根 logger：JSON 格式 + RotatingFileHandler。

    幂等 — 重复调用会先清除已有 handler。
    """
    global _profile, _session_id
    _profile = profile
    _session_id = f"{int(time.time())}-{os.urandom(4).hex()}"

    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / LOG_FILENAME

    root = logging.getLogger("glasscortex")
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root.handlers.clear()

    handler = logging.handlers.RotatingFileHandler(
        str(log_file), maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)

    # 防止 log 向上传播到 root logger（避免 stderr 输出）
    root.propagate = False


def get_logger(name: str) -> logging.Logger:
    """返回 glasscortex 子树下的 logger。"""
    if not name.startswith("glasscortex"):
        name = f"glasscortex.{name}"
    return logging.getLogger(name)


class JsonFormatter(logging.Formatter):
    """将 LogRecord 序列化为 JSON Lines，自动注入 profile 和 session_id 上下文。"""

    def __init__(self) -> None:
        super().__init__()
        self._default_keys: set[str] = {
            "name",
            "msg",
            "args",
            "levelname",
            "levelno",
            "pathname",
            "filename",
            "module",
            "exc_info",
            "exc_text",
            "stack_info",
            "lineno",
            "funcName",
            "created",
            "msecs",
            "relativeCreated",
            "thread",
            "threadName",
            "processName",
            "process",
        }

    def format(self, record: logging.LogRecord) -> str:
        # 优先用 record 上的字段（通过 extra 传入），否则回退到模块级全局
        obj: dict[str, Any] = {
            "ts": self.formatTime(record, datefmt="%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z",
            "level": record.levelname,
            "logger": getattr(record, "name", ""),
            "msg": record.getMessage(),
            "profile": getattr(record, "profile", None) or _profile,
            "session_id": getattr(record, "session_id", None) or _session_id,
        }

        # 展开 extra 中的自定义字段（如 elapsed_ms, component 等）
        for key, value in record.__dict__.items():
            if key not in self._default_keys and not key.startswith("_"):
                obj[key] = value

        # 异常信息
        if record.exc_info and record.exc_info[0]:
            obj["error_type"] = record.exc_info[0].__name__
            obj["error_msg"] = str(record.exc_info[1]) if record.exc_info[1] else ""

        return json.dumps(obj, ensure_ascii=False, default=str)


def trace_step(name: str | None = None) -> Callable[[F], F]:
    """装饰器：计时 + 结构化日志（start/end/error），返回原始结果不变。

    用 time.monotonic() 计时（不受系统时钟跳变影响），
    进入时 DEBUG，成功时 INFO + elapsed_ms，异常时 ERROR + elapsed_ms + re-raise。
    """

    def decorator(func: F) -> F:
        step_name = name if name is not None else func.__name__

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            func_logger = get_logger(func.__module__)
            func_logger.debug(
                "%s started",
                step_name,
                extra={"event": "step_start", "step": step_name},
            )
            t0 = time.monotonic()
            try:
                result = func(*args, **kwargs)
                elapsed = (time.monotonic() - t0) * 1000
                func_logger.info(
                    "%s completed in %.1fms",
                    step_name,
                    elapsed,
                    extra={"event": "step_end", "step": step_name, "elapsed_ms": round(elapsed, 2)},
                )
                return result
            except Exception:
                # 泛型装饰器包裹任意函数，Exception 范围不可收窄
                elapsed = (time.monotonic() - t0) * 1000
                func_logger.error(
                    "%s failed after %.1fms",
                    step_name,
                    elapsed,
                    extra={
                        "event": "step_error",
                        "step": step_name,
                        "elapsed_ms": round(elapsed, 2),
                    },
                )
                raise

        return wrapper  # type: ignore[return-value]

    return decorator
