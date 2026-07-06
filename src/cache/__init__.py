"""缓存层——EmbeddingCache / FactCache / SemanticResponseCache.

模块→包转换 (Phase 62)：原 ``src/cache.py`` 迁移至 ``src/cache/_core.py``，
``__init__.py`` 重导出保持 ``from src.cache import EmbeddingCache, FactCache`` 兼容。
"""

from __future__ import annotations

from src.cache._core import EmbeddingCache, FactCache
from src.cache.semantic_cache import SemanticResponseCache, get_response_cache

__all__ = [
    "EmbeddingCache",
    "FactCache",
    "SemanticResponseCache",
    "get_response_cache",
]
