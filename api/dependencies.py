"""FastAPI 依赖注入——引擎生命周期管理。

引擎在 lifespan 中创建一次并存于 app.state，每次请求通过 get_engines()/get_settings() 获取。
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, Request

from src.bootstrap import EngineBundle

ENGINES_KEY = "engines"
SETTINGS_KEY = "settings"


async def get_engines(request: Request) -> EngineBundle:
    """FastAPI 依赖注入：从 app.state 获取 7 引擎具名元组。

    EngineBundle 向后兼容位置解包——现有 router 无需改动。
    """
    engines = getattr(request.app.state, ENGINES_KEY, None)
    if engines is None:
        raise RuntimeError("引擎未初始化——lifespan 启动可能失败。请检查 data/ 目录是否存在且可写。")
    return engines  # type: ignore[no-any-return]  # Starlette app.state is untyped


async def get_settings(request: Request) -> Any:
    """FastAPI 依赖注入：从 app.state 获取 Settings 单例。"""
    settings = getattr(request.app.state, SETTINGS_KEY, None)
    if settings is None:
        raise RuntimeError("app.state 中 Settings 未初始化。")
    return settings


# 模块级单例以满足 B008 规范（默认参数不能含 Depends()）。
# 必须在引用函数定义之后声明。
EnginesDep = Depends(get_engines)
SettingsDep = Depends(get_settings)
