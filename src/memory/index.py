"""FAISS 向量索引——FlatL2 索引的增删查 + 磁盘持久化。"""

from __future__ import annotations

import pickle
from pathlib import Path

import faiss
import numpy as np

from src.config import settings

_VECTORS_EXT = ".vecs"


class IndexManager:
    """FAISS 索引封装 — 管理向量存储和语义检索。

    ADR-001: FAISS 负责向量检索（"哪条记忆最像"），SQLite 负责结构化元数据
    （"这条记忆是什么"）。两者通过 faiss_id 外键关联。

    使用 IndexFlatIP（内积）+ 向量归一化 = 余弦相似度。
    向量同时在 Python dict 中保留一份副本，用于语义去重和 MMR 重排。
    保存/加载时 dict 序列化到 ``<path>.vecs`` 伴随文件，确保 restart 后可重建向量。
    """

    def __init__(self, dimension: int = settings.embed_dim) -> None:
        self.dimension = dimension
        self.index = faiss.IndexIDMap(faiss.IndexFlatIP(dimension))
        self._next_id = 0
        self._vectors: dict[int, np.ndarray] = {}

    # ── 读写 ──────────────────────────────────────────────

    def add(self, vectors: np.ndarray) -> list[int]:
        """添加向量到索引，返回分配的 faiss_id 列表。

        vectors 会自动 L2 归一化以支持余弦相似度检索。

        写入顺序：_vectors dict 先写（纯内存，安全）→ FAISS index（可能失败）
        → 失败时回滚 _vectors → 最后更新 _next_id。确保三者始终一致。
        """
        vectors = vectors.astype(np.float32)
        faiss.normalize_L2(vectors)
        ids = np.arange(self._next_id, self._next_id + vectors.shape[0], dtype=np.int64)

        # 1. 先写 _vectors（纯 Python dict，不会失败）
        for i, fid in enumerate(ids.tolist()):
            self._vectors[fid] = vectors[i].copy()

        # 2. 写 FAISS index（可能因内存/磁盘问题失败）
        try:
            self.index.add_with_ids(vectors, ids)
        except Exception:
            # 回滚 _vectors，保持一致性
            for fid in ids.tolist():
                self._vectors.pop(fid, None)
            raise

        # 3. 最后更新 _next_id（只有全部成功才推进）
        self._next_id += vectors.shape[0]
        return list(ids.tolist())

    def search(self, query: np.ndarray, k: int = 20) -> list[tuple[int, float]]:
        """检索 top-k 最相似向量，返回 [(faiss_id, distance), ...]。

        distance 为余弦相似度（归一化内积），范围 [-1, 1]，越大越相似。
        """
        query = query.astype(np.float32).reshape(1, -1)
        faiss.normalize_L2(query)
        distances, ids = self.index.search(query, k)
        return [(int(ids[0][i]), float(distances[0][i])) for i in range(k) if ids[0][i] != -1]

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

        FAISS IndexIDMap 的 remove_ids 通过 IDSelectorArray 过滤底层 IndexFlatIP，
        被删 ID 之后不会再出现在 search 结果中。
        """
        if not ids:
            return 0
        existing = sum(1 for fid in ids if fid in self._vectors)
        if existing == 0:
            return 0
        id_arr = np.array(ids, dtype=np.int64)
        selector = faiss.IDSelectorArray(id_arr)
        self.index.remove_ids(selector)
        for fid in ids:
            self._vectors.pop(fid, None)
        return existing

    # ── 持久化 ────────────────────────────────────────────

    def save(self, path: str) -> None:
        """保存 FAISS 索引到 path，同时序列化 _vectors 到 ``<path>.vecs``。

        两个文件一起构成完整的索引快照，restart 后可完全恢复。
        """
        faiss.write_index(self.index, path)
        vecs_path = str(Path(path).with_suffix(_VECTORS_EXT))
        with open(vecs_path, "wb") as f:
            pickle.dump(self._vectors, f)

    def load(self, path: str) -> None:
        """从 path 加载 FAISS 索引 + 伴随的 _vectors 快照。

        伴随文件 ``<path>.vecs`` 不存在时（旧格式索引），_vectors 保持为空 —
        reconstruct() 对旧格式索引抛 KeyError（优雅降级）。
        """
        raw = faiss.read_index(path)
        if not isinstance(raw, faiss.IndexIDMap):
            raise ValueError("Loaded index is not an IndexIDMap")
        self.index = raw
        self._next_id = self.index.ntotal

        vecs_path = str(Path(path).with_suffix(_VECTORS_EXT))
        if Path(vecs_path).exists():
            with open(vecs_path, "rb") as f:
                self._vectors = pickle.load(f)
        else:
            self._vectors.clear()
