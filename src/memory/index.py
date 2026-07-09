"""向量索引——usearch 余弦距离索引的增删查 + 磁盘持久化。

Phase 67 Batch 1: FAISS → usearch 替换，消除 Windows Server 部署兼容性障碍。
公共 API 完全兼容，SQLite schema 中 faiss_id 列名保持不变（命名债后续 Batch 处理）。
"""

from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
from usearch.compiled import Index as USearchIndex
from usearch.compiled import MetricKind

from src.config import settings

_VECTORS_EXT = ".vecs"


class IndexManager:
    """向量索引封装 — 管理向量存储和语义检索。

    ADR-001 (修订): usearch 负责向量检索（"哪条记忆最像"），SQLite 负责结构化元数据
    （"这条记忆是什么"）。两者通过 faiss_id 外键关联。

    使用 usearch Cos 距离（内部 L2 归一化），消费者侧统一用余弦相似度 [-1, 1]。
    向量同时在 Python dict 中保留一份 L2 归一化副本，用于语义去重和 MMR 重排。
    保存/加载时 dict 序列化到 ``<path>.vecs`` 伴随文件，确保 restart 后可重建向量。
    """

    def __init__(self, dimension: int = settings.embed_dim) -> None:
        self.dimension = dimension
        self.index = USearchIndex(ndim=dimension, metric_kind=MetricKind.Cos)
        self._next_id = 0
        self._vectors: dict[int, np.ndarray] = {}

    # ── 读写 ──────────────────────────────────────────────

    def add(self, vectors: np.ndarray) -> list[int]:
        """添加向量到索引，返回分配的 faiss_id 列表。

        vectors 会 L2 归一化后存入 _vectors dict（保持与 FAISS 旧版兼容）；
        usearch Cos 距离内部再做归一化，不依赖输入向量的模长。

        写入顺序：_vectors dict 先写（纯内存，安全）→ usearch index → 回滚 _vectors
        → 最后更新 _next_id。确保三者始终一致。
        """
        vectors = vectors.astype(np.float32)
        # L2 归一化存入 _vectors——reconstruct() 和 dedup 消费者依赖归一化向量
        vecs_norm = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
        ids = np.arange(self._next_id, self._next_id + vectors.shape[0], dtype=np.int64)

        # 1. 先写 _vectors（纯 Python dict，不会失败）
        for i, fid in enumerate(ids.tolist()):
            self._vectors[fid] = vecs_norm[i].copy()

        # 2. 写 usearch index
        try:
            self.index.add_many(ids, vectors)
        except Exception:
            # 回滚 _vectors，保持一致性
            for fid in ids.tolist():
                self._vectors.pop(fid, None)
            raise

        # 3. 最后更新 _next_id（只有全部成功才推进）
        self._next_id += vectors.shape[0]
        return list(ids.tolist())

    def search(self, query: np.ndarray, k: int = 20) -> list[tuple[int, float]]:
        """检索 top-k 最相似向量，返回 [(faiss_id, similarity), ...]。

        similarity 为余弦相似度，范围 [-1, 1]，越大越相似。
        usearch Cos 距离 [0, 2] 转换为 similarity = 1 - distance。
        """
        query = query.astype(np.float32).reshape(1, -1)
        keys, distances, _counts, *_ = self.index.search_many(query, k)

        results: list[tuple[int, float]] = []
        for i in range(keys.shape[1]):
            key = int(keys[0, i])
            dist = float(distances[0, i])
            # 跳过填充位（usearch 对不足 k 的槽位填充 distance=NaN）
            if np.isnan(dist):
                continue
            similarity = 1.0 - dist  # Cos 距离 → 余弦相似度
            results.append((key, similarity))
        return results

    def reconstruct(self, faiss_id: int) -> np.ndarray:
        """返回 faiss_id 对应的 L2 归一化向量。

        优先从内存 _vectors dict 读取（add 时存储的副本）；
        load 后 _vectors 从伴随文件恢复，restart 后仍可用。
        """
        try:
            return self._vectors[faiss_id]
        except KeyError:
            raise KeyError(f"faiss_id {faiss_id} not found in index") from None

    def remove_faiss_ids(self, ids: list[int]) -> int:
        """删除指定 FAISS ID 的向量，同步清理内部缓存。

        usearch 的 remove_many 直接按 key 删除，被删 ID 之后不再出现在 search 结果中。
        """
        if not ids:
            return 0
        existing = sum(1 for fid in ids if fid in self._vectors)
        if existing == 0:
            return 0
        self.index.remove_many(ids, False, 0)
        for fid in ids:
            self._vectors.pop(fid, None)
        return existing

    # ── 持久化 ────────────────────────────────────────────

    def save(self, path: str) -> None:
        """保存向量索引到 path，同时序列化 _vectors 到 ``<path>.vecs``。

        两个文件一起构成完整的索引快照，restart 后可完全恢复。
        """
        self.index.save_index_to_path(path)
        vecs_path = str(Path(path).with_suffix(_VECTORS_EXT))
        with open(vecs_path, "wb") as f:
            pickle.dump(self._vectors, f)

    def load(self, path: str) -> None:
        """从 path 加载向量索引 + 伴随的 _vectors 快照。

        伴随文件 ``<path>.vecs`` 不存在时（旧格式索引），_vectors 保持为空 —
        reconstruct() 对旧格式索引抛 KeyError（优雅降级）。
        """
        self.index = USearchIndex(ndim=self.dimension, metric_kind=MetricKind.Cos)
        self.index.load_index_from_path(path)
        self._next_id = int(self.index.size)

        vecs_path = str(Path(path).with_suffix(_VECTORS_EXT))
        if Path(vecs_path).exists():
            with open(vecs_path, "rb") as f:
                self._vectors = pickle.load(f)
        else:
            self._vectors.clear()
