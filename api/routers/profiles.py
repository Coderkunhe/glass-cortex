"""Profile 管理端点——列举、创建、删除、切换 Profile。

每个 Profile 在 data/{profile}/ 下拥有独立的 SQLite + FAISS 存储。
通过 /profiles/switch 端点实现全局状态切换，为目标 Profile 重新初始化全部引擎。
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from api.dependencies import EnginesDep, SettingsDep
from api.schemas import (
    ProfileInfo,
    ProfileListResponse,
    ProfileSwitchRequest,
    ProfileSwitchResponse,
)
from src.config import DB_FILENAME, INDEX_FILENAME, Settings
from src.logging import get_logger

router = APIRouter(prefix="/profiles", tags=["profiles"])
logger = get_logger(__name__)


@router.get("", response_model=ProfileListResponse)
def list_profiles(settings: Any = SettingsDep) -> ProfileListResponse:
    """扫描 data/ 目录下的 Profile 目录（每个目录含 memory.db）。"""
    data_dir = Path(settings.data_dir)
    profiles: list[ProfileInfo] = []
    current = str(getattr(settings, "user_profile", "default"))

    if data_dir.exists():
        for entry in sorted(data_dir.iterdir()):
            if not entry.is_dir():
                continue
            safe_name = Settings.sanitize_profile_name(entry.name)
            db_path = entry / DB_FILENAME
            has_db = db_path.exists()
            if not has_db:
                continue
            db_size = db_path.stat().st_size if has_db else 0
            has_index = (entry / INDEX_FILENAME).exists()
            profiles.append(
                ProfileInfo(
                    name=safe_name,
                    db_size_bytes=db_size,
                    has_index=has_index,
                )
            )

    return ProfileListResponse(profiles=profiles, current=current)


@router.get("/current", response_model=ProfileInfo)
def current_profile(
    settings: Any = SettingsDep,
    engines: Any = EnginesDep,
) -> ProfileInfo:
    """展示当前活跃 Profile 的元数据。"""
    store, idx, *_ = engines
    profile_name = str(getattr(settings, "user_profile", "default"))
    db_path = Path(getattr(settings, "resolved_db_path", ""))
    db_size = db_path.stat().st_size if db_path.exists() else 0
    episode_count = len(store.get_all_episodes()) if store else 0
    fact_count = len(store.get_all_facts()) if store else 0
    ntotal = idx.index.size if idx and idx.index is not None else 0

    return ProfileInfo(
        name=profile_name,
        db_size_bytes=db_size,
        has_index=db_path.parent.joinpath(INDEX_FILENAME).exists(),
        episode_count=episode_count,
        fact_count=fact_count,
        index_vectors=ntotal,
    )


@router.post("/switch", response_model=ProfileSwitchResponse)
def switch_profile(
    body: ProfileSwitchRequest,
    request: Request,
    engines: Any = EnginesDep,
    settings: Any = SettingsDep,
) -> ProfileSwitchResponse:
    """切换活跃 Profile——用新配置重新初始化全部引擎。

    切换前：保存 FAISS 索引、关闭数据库。切换后：更新 app.state 中的引擎和配置。
    """
    import src.config as config_module
    from src.bootstrap import init_engines
    from src.memory.index import IndexManager
    from src.memory.store import MemoryStore

    safe_name = Settings.sanitize_profile_name(body.name)
    current = str(getattr(settings, "user_profile", "default"))

    if safe_name == current:
        return ProfileSwitchResponse(profile=safe_name, status="already_active")

    # 重新初始化前保存当前索引并关闭数据库
    store, idx, *_ = engines
    if isinstance(idx, IndexManager):
        index_dir = Path(str(getattr(settings, "resolved_db_path", ""))).parent
        try:
            idx.save(str(index_dir / INDEX_FILENAME))
        except (OSError, RuntimeError) as exc:
            logger.warning("Profile 切换期间 FAISS 索引保存失败: %s", exc)
    if isinstance(store, MemoryStore):
        store.close()

    # 创建新 Profile 设置并重新初始化引擎
    profile_settings = Settings.from_flat(user_profile=safe_name)
    new_engines = init_engines(settings_override=profile_settings)
    new_store, *_ = new_engines

    # 永久更新 settings 单例（init_engines 的 finally 块会恢复旧值）
    config_module.settings = profile_settings

    # 更新 app.state 供后续请求使用
    request.app.state.engines = new_engines
    request.app.state.settings = profile_settings
    request.app.state.store = new_store

    logger.info("Profile switched from '%s' to '%s'", current, safe_name)

    return ProfileSwitchResponse(profile=safe_name, status="switched")


@router.post("/{name}", status_code=201, response_model=ProfileInfo)
def create_profile(name: str, settings: Any = SettingsDep) -> ProfileInfo:
    """创建新 Profile——新建目录、初始化空数据库 + FAISS 索引。

    使用临时 Settings 覆盖调用 init_engines 创建磁盘文件后立即关闭数据库。
    """
    safe_name = Settings.sanitize_profile_name(name)
    profile_data_dir = Path(settings.data_dir) / safe_name

    if profile_data_dir.exists():
        raise HTTPException(status_code=409, detail=f"Profile '{safe_name}' already exists")

    from src.bootstrap import init_engines

    profile_settings = Settings.from_flat(user_profile=safe_name)
    tmp_engines = init_engines(settings_override=profile_settings)
    tmp_store, *_ = tmp_engines
    tmp_store.close()

    logger.info("Created profile '%s'", safe_name)

    return ProfileInfo(
        name=safe_name,
        db_size_bytes=0,
        has_index=True,
        episode_count=0,
        fact_count=0,
        index_vectors=0,
    )


@router.delete("/{name}", status_code=204)
def delete_profile(name: str, settings: Any = SettingsDep) -> None:
    """删除 Profile 目录——拒绝删除当前活跃的 Profile。"""
    safe_name = Settings.sanitize_profile_name(name)
    current = str(getattr(settings, "user_profile", "default"))

    if safe_name == current:
        raise HTTPException(status_code=409, detail="不能删除当前活跃的 Profile")

    data_dir = Path(settings.data_dir)
    candidates = [
        d
        for d in data_dir.iterdir()
        if d.is_dir() and Settings.sanitize_profile_name(d.name) == safe_name
    ]
    if not candidates:
        raise HTTPException(status_code=404, detail=f"Profile '{safe_name}' not found")

    shutil.rmtree(str(candidates[0]))
    logger.info("Deleted profile '%s'", safe_name)
