"""文本嵌入——SentenceTransformer 模型加载与向量编码。"""

from __future__ import annotations

import numpy as np
from sentence_transformers import SentenceTransformer

from src.cache import EmbeddingCache
from src.config import settings

_MODEL: SentenceTransformer | None = None
_MODEL_NAME = settings.embed_model
_EMBEDDING_DIM = settings.embed_dim
_CACHE = EmbeddingCache(max_size=1000)


def _get_model() -> SentenceTransformer:
    global _MODEL
    if _MODEL is None:
        _MODEL = SentenceTransformer(_MODEL_NAME)
    return _MODEL


def embed(text: str | list[str]) -> np.ndarray:
    """将文本转换为 embedding 向量。

    单文本返回 shape=(384,)，多文本返回 shape=(N, 384)。
    模型在首次调用时自动加载（all-MiniLM-L6-v2，约 100MB）。
    单文本优先查缓存，命中则跳过模型推理。
    """
    if isinstance(text, str):
        cached = _CACHE.get(text)
        if cached is not None:
            return cached
        model = _get_model()
        result = np.asarray(model.encode(text, normalize_embeddings=True))
        _CACHE.put(text, result)
        return result

    model = _get_model()
    raw = model.encode(text, normalize_embeddings=True)
    return np.asarray(raw)


def get_embedding_cache() -> EmbeddingCache:
    """获取模块级 EmbeddingCache 实例，供 UI 读取统计信息。"""
    return _CACHE
