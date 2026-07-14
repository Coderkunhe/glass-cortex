"""文本嵌入——SentenceTransformer 模型加载与向量编码。"""

from __future__ import annotations

import logging
import os

import numpy as np
from sentence_transformers import SentenceTransformer

from src.cache import EmbeddingCache
from src.config import settings

logger = logging.getLogger("embed")

_MODEL: SentenceTransformer | None = None
_MODEL_NAME = settings.embed_model
_EMBEDDING_DIM = settings.embed_dim
_CACHE = EmbeddingCache(max_size=1000)


def _get_model() -> SentenceTransformer:
    """加载 SentenceTransformer 模型（懒初始化，线程安全）。

    国内服务器无法直连 huggingface.co 时，通过 HF_ENDPOINT 环境变量
    切换到镜像站（如 https://hf-mirror.com）。settings.hf_endpoint 默认为
    https://huggingface.co，可通过 .env 的 HF_ENDPOINT 覆盖。
    """
    global _MODEL
    if _MODEL is None:
        # 在模型加载前设置 HF_ENDPOINT，sentence-transformers → huggingface_hub
        # 自动读取此环境变量决定模型下载地址。
        # 使用 setdefault 尊重已存在的环境变量（如 .env 或 shell export 设置的）。
        endpoint_before = os.environ.get("HF_ENDPOINT")
        os.environ.setdefault("HF_ENDPOINT", settings.hf_endpoint)
        endpoint_after = os.environ["HF_ENDPOINT"]
        if endpoint_before is None and endpoint_after != "https://huggingface.co":
            logger.info("HF_ENDPOINT=%s（镜像模式，huggingface.co 不可直连）", endpoint_after)
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
