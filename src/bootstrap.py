"""应用启动初始化——依赖注入拓扑、引擎实例化、旧数据迁移、Profile 数据擦除。"""

from __future__ import annotations

import os
from pathlib import Path
from typing import NamedTuple

from src.chat.engine import ChatEngine
from src.config import DB_FILENAME, INDEX_FILENAME, Settings, settings
from src.embed import embed
from src.logging import get_logger, setup_logging
from src.memory.forget import ForgettingEngine
from src.memory.index import IndexManager
from src.memory.recall import RecallEngine
from src.memory.store import MemoryStore
from src.planner import PlannerEngine
from src.token_ledger import TokenLedger


class EngineBundle(NamedTuple):
    """7 引擎强类型容器——替代裸元组位置契约。

    字段顺序与 init_engines() 构造顺序一致。
    NamedTuple 向后兼容位置解包——现有消费者无需改动。
    """

    store: MemoryStore
    idx: IndexManager
    recall: RecallEngine
    forgetting: ForgettingEngine
    chat: ChatEngine
    ledger: TokenLedger
    planner: PlannerEngine


ENV_FILE = settings.env_file
# DB_PATH/INDEX_PATH 是模块级常量，用于向后兼容（L10 面板、CLI）。
# 推荐使用 get_active_db_path()/get_active_index_path() 以感知当前 Profile。
DB_PATH = settings.resolved_db_path
INDEX_PATH = settings.resolved_index_path


def load_dotenv() -> None:
    """加载 .env 文件中的环境变量（已存在的变量不被覆盖）。"""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        elif value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        os.environ.setdefault(key, value)


def get_active_db_path() -> Path:
    """返回当前活跃 settings 的 resolved_db_path（profile 感知）。"""
    import src.config as config_module

    return config_module.settings.resolved_db_path


def get_active_index_path() -> Path:
    """返回当前活跃 settings 的 resolved_index_path（profile 感知）。"""
    import src.config as config_module

    return config_module.settings.resolved_index_path


def _migrate_legacy_flat_data(data_dir: Path, profile_data_dir: Path) -> None:
    """一次性迁移：将 data 下的 DB + FAISS 索引文件移动到 data/default/。

    仅在以下条件全部满足时执行：
    - 旧位置存在 legacy 文件
    - 新位置不存在同名文件（防止覆盖已有数据）
    """
    import shutil

    legacy_db = data_dir / DB_FILENAME
    legacy_idx = data_dir / INDEX_FILENAME
    new_db = profile_data_dir / DB_FILENAME
    new_idx = profile_data_dir / INDEX_FILENAME

    if not legacy_db.exists() and not legacy_idx.exists():
        return
    if new_db.exists() or new_idx.exists():
        return

    profile_data_dir.mkdir(parents=True, exist_ok=True)
    if legacy_db.exists():
        shutil.move(str(legacy_db), str(new_db))
    if legacy_idx.exists():
        shutil.move(str(legacy_idx), str(new_idx))


def wipe_profile_data(s: Settings | None = None) -> None:
    """清空当前 profile 的所有数据（SQLite + FAISS 索引文件）。

    删除 data/{profile}/ 下的 DB 和 FAISS 索引文件，
    然后让 init_engines 重建空数据库和空索引。

    调用方负责在此之前关闭已有的 store 连接。
    """
    import src.config as config_module

    target = s if s is not None else config_module.settings
    db_path = target.resolved_db_path
    index_path = target.resolved_index_path

    if db_path.exists():
        db_path.unlink()
    if index_path.exists():
        index_path.unlink()


def _try_init_fact_extractor(
    store: MemoryStore,
    idx: IndexManager,
    chat: ChatEngine,
    ledger: TokenLedger,
) -> None:
    """尝试初始化 FactExtractor 并注入到 ChatEngine。

    API key 缺失时静默跳过，fact 抽取不可用但不影响其他功能。
    """
    logger = get_logger("bootstrap")
    try:
        from src.memory.fact import FactExtractor

        fact_extractor = FactExtractor(store, idx, embed)
        fact_extractor.set_ledger(ledger)
        chat.set_fact_extractor(fact_extractor)
    except RuntimeError:
        logger.info("FactExtractor 未加载 — API key 未设置，事实抽取不可用")


def init_engines(
    settings_override: Settings | None = None,
) -> EngineBundle:
    """初始化全部引擎组件并完成依赖注入。

    FactExtractor 注入到 ChatEngine（API key 缺失时静默跳过），
    确保 CLI 和 Web 双界面共享一致的引擎拓扑。

    settings_override 非 None 时，临时替换模块级 settings 单例，
    用于 A/B 实验等需要多套参数并存的场景。finally 保证恢复。
    """
    import src.config as config_module

    s = settings_override if settings_override is not None else settings
    old = config_module.settings
    config_module.settings = s
    try:
        setup_logging(s.profile_data_dir, s.log_level, s.user_profile)

        if s.user_profile == "default":
            _migrate_legacy_flat_data(s.data_dir, s.profile_data_dir)
        db_path = s.resolved_db_path
        index_path = s.resolved_index_path

        store = MemoryStore.create(str(db_path))

        idx = IndexManager()
        if index_path.exists():
            idx.load(str(index_path))

        forgetting = ForgettingEngine(store, idx)
        recall = RecallEngine(store, idx, embed, forgetting)
        chat = ChatEngine(store, idx, embed)

        ledger = TokenLedger()
        chat.set_ledger(ledger)

        planner = PlannerEngine(store, idx, embed)
        planner.set_ledger(ledger)

        from src.planner.plan import PlanGenerator
        from src.planner.reflection import ReflectionEngine
        from src.planner.replan import ReplanDetector

        plan_gen = PlanGenerator(store, idx, embed)
        plan_gen.set_ledger(ledger)
        planner.set_plan_generator(plan_gen)

        replan_detector = ReplanDetector(store, idx, embed)
        replan_detector.set_ledger(ledger)
        planner.set_replan_detector(replan_detector)

        reflection_engine = ReflectionEngine(store, idx, embed)
        reflection_engine.set_ledger(ledger)
        planner.set_reflection_engine(reflection_engine)

        _try_init_fact_extractor(store, idx, chat, ledger)

        return EngineBundle(store, idx, recall, forgetting, chat, ledger, planner)
    finally:
        config_module.settings = old
