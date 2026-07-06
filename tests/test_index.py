from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np

from src.memory.index import IndexManager


def test_add_and_search() -> None:
    """add 后 search 能找回，且距离反映相似度。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(42)
    # 5 个随机向量 + 1 个基准向量的变体
    vecs = rng.normal(size=(6, 8)).astype(np.float32)
    ids = idx.add(vecs)

    assert len(ids) == 6
    assert ids == [0, 1, 2, 3, 4, 5]

    # 检索自身：第一条应与自己最相似
    results = idx.search(vecs[0], k=3)
    assert len(results) == 3
    assert results[0][0] == 0  # 第一条应是自己
    assert results[0][1] > results[1][1]  # 自身距离 > 第二条


def test_search_returns_distance() -> None:
    """余弦相似度 distance 应在 [-1, 1] 范围。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(7)
    vecs = rng.normal(size=(10, 8)).astype(np.float32)
    idx.add(vecs)

    results = idx.search(vecs[0], k=5)
    for _, dist in results:
        assert -1.0 <= dist <= 1.0


def test_reconstruct_returns_normalized_vector() -> None:
    """reconstruct 返回 L2 归一化向量，自点积 ≈ 1.0。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(42)
    vecs = rng.normal(size=(3, 8)).astype(np.float32)
    ids = idx.add(vecs)
    for fid in ids:
        v = idx.reconstruct(fid)
        assert v.shape == (8,)
        self_dot = float(np.dot(v, v))
        assert abs(self_dot - 1.0) < 0.001


def test_reconstruct_missing_id_raises_keyerror() -> None:
    """不存在的 faiss_id 抛 KeyError。"""
    idx = IndexManager(dimension=8)
    try:
        idx.reconstruct(999)
        raise AssertionError("Expected KeyError")
    except KeyError:
        pass


def test_reconstruct_after_load_succeeds() -> None:
    """load 后 _vectors 从伴随 .vecs 文件恢复，reconstruct 正常工作。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(42)
    vecs = rng.normal(size=(3, 8)).astype(np.float32)
    idx.add(vecs)
    with tempfile.TemporaryDirectory() as tmpdir:
        path = str(Path(tmpdir) / "test.index")
        idx.save(path)
        idx2 = IndexManager(dimension=8)
        idx2.load(path)
        # reconstruct 应从恢复的 _vectors 中返回归一化向量
        v = idx2.reconstruct(0)
        assert v.shape == (8,)
        self_dot = float(np.dot(v, v))
        assert abs(self_dot - 1.0) < 0.001


def test_save_load_roundtrip() -> None:
    """save → load → search 结果一致。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(99)
    vecs = rng.normal(size=(5, 8)).astype(np.float32)
    idx.add(vecs)

    with tempfile.TemporaryDirectory() as tmpdir:
        path = str(Path(tmpdir) / "test.index")
        idx.save(path)

        idx2 = IndexManager(dimension=8)
        idx2.load(path)

        results1 = idx.search(vecs[0], k=3)
        results2 = idx2.search(vecs[0], k=3)

        assert results1 == results2


def test_save_load_reconstruct_values_preserved() -> None:
    """save→load 后 reconstruct 返回值与原向量一致。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(42)
    vecs = rng.normal(size=(3, 8)).astype(np.float32)
    idx.add(vecs)

    original = [idx.reconstruct(i).copy() for i in range(3)]

    with tempfile.TemporaryDirectory() as tmpdir:
        path = str(Path(tmpdir) / "test.index")
        idx.save(path)

        idx2 = IndexManager(dimension=8)
        idx2.load(path)
        for i in range(3):
            restored = idx2.reconstruct(i)
            assert np.allclose(original[i], restored, atol=1e-6), (
                f"Vector {i} mismatch after roundtrip"
            )


def test_load_old_format_without_vecs_file() -> None:
    """旧格式索引（无 .vecs 伴随文件）load 后 reconstruct 抛 KeyError（优雅降级）。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(42)
    vecs = rng.normal(size=(3, 8)).astype(np.float32)
    idx.add(vecs)

    with tempfile.TemporaryDirectory() as tmpdir:
        path = str(Path(tmpdir) / "test.index")
        # 仅保存 FAISS index，不保存 .vecs（模拟旧格式）
        import faiss

        faiss.write_index(idx.index, path)

        idx2 = IndexManager(dimension=8)
        idx2.load(path)
        # search 仍正常工作（FAISS index 完整）
        results = idx2.search(vecs[0], k=3)
        assert len(results) == 3
        # reconstruct 不可用（无 .vecs 文件）
        try:
            idx2.reconstruct(0)
            raise AssertionError("Expected KeyError for old-format index")
        except KeyError:
            pass


def test_add_consistency__vectors_faiss_next_id_aligned() -> None:
    """add 后 _vectors、FAISS ntotal、_next_id 三者一致。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(42)
    vecs = rng.normal(size=(5, 8)).astype(np.float32)
    ids = idx.add(vecs)

    assert len(ids) == 5
    assert idx._next_id == 5
    assert idx.index.ntotal == 5
    assert len(idx._vectors) == 5
    # 每个 ID 都能 reconstruct
    for fid in ids:
        v = idx.reconstruct(fid)
        assert v.shape == (8,)
    # 所有 id 都能 search 到
    results = idx.search(vecs[0], k=5)
    found_ids = {r[0] for r in results}
    assert found_ids == set(range(5))


# ── Batch 106: IndexManager.remove_faiss_ids ──


def test_remove_existing_ids() -> None:
    """删除部分向量后 search 排除被删 ID，且 _vectors 同步清理。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(42)
    vecs = rng.normal(size=(6, 8)).astype(np.float32)
    ids = idx.add(vecs)
    assert len(ids) == 6

    removed = idx.remove_faiss_ids([2, 4, 5])
    assert removed == 3

    results = idx.search(vecs[0], k=5)
    found_ids = {r[0] for r in results}
    assert 0 in found_ids and 1 in found_ids and 3 in found_ids
    assert 2 not in found_ids and 4 not in found_ids and 5 not in found_ids
    assert 2 not in idx._vectors
    assert 4 not in idx._vectors
    assert 5 not in idx._vectors
    assert 0 in idx._vectors


def test_remove_nonexistent_ids_returns_zero() -> None:
    """删除从未添加过的 ID 返回 0。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(42)
    idx.add(rng.normal(size=(3, 8)).astype(np.float32))
    removed = idx.remove_faiss_ids([999, 1000])
    assert removed == 0


def test_remove_empty_list_returns_zero() -> None:
    """空列表安全返回 0，不破坏内部状态。"""
    idx = IndexManager(dimension=8)
    rng = np.random.default_rng(42)
    idx.add(rng.normal(size=(3, 8)).astype(np.float32))
    n_before = idx._next_id
    removed = idx.remove_faiss_ids([])
    assert removed == 0
    assert idx._next_id == n_before
