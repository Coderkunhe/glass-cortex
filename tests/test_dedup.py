from __future__ import annotations

from collections.abc import Callable

import numpy as np

from src.memory.dedup import deduplicate_candidates


def _make_reconstruct_fn(
    vectors: dict[int, np.ndarray],
) -> Callable[[int], np.ndarray]:
    def reconstruct(fid: int) -> np.ndarray:
        return vectors[fid]

    return reconstruct


def _normalize(v: np.ndarray) -> np.ndarray:
    result: np.ndarray = v / np.linalg.norm(v)
    return result


class TestDeduplicateCandidatesBasic:
    def test_empty_candidates(self) -> None:
        result = deduplicate_candidates([], _make_reconstruct_fn({}), 0.92)
        assert result.kept == []
        assert result.removed == []
        assert result.dedup_source == {}

    def test_single_candidate(self) -> None:
        vectors = {0: _normalize(np.array([1.0, 0.0, 0.0], dtype=np.float32))}
        candidates = [(0, 0.9)]
        result = deduplicate_candidates(candidates, _make_reconstruct_fn(vectors), 0.92)
        assert len(result.kept) == 1
        assert result.kept[0][0] == 0
        assert result.removed == []

    def test_no_duplicates(self) -> None:
        vectors = {
            0: _normalize(np.array([1.0, 0.0, 0.0], dtype=np.float32)),
            1: _normalize(np.array([0.0, 1.0, 0.0], dtype=np.float32)),
            2: _normalize(np.array([0.0, 0.0, 1.0], dtype=np.float32)),
        }
        candidates = [(0, 0.9), (1, 0.8), (2, 0.7)]
        result = deduplicate_candidates(candidates, _make_reconstruct_fn(vectors), 0.92)
        assert len(result.kept) == 3
        assert result.removed == []

    def test_all_duplicates_keep_first(self) -> None:
        vectors = {
            0: _normalize(np.array([1.0, 0.0, 0.0], dtype=np.float32)),
            1: _normalize(np.array([0.999, 0.001, 0.0], dtype=np.float32)),
            2: _normalize(np.array([0.998, 0.002, 0.0], dtype=np.float32)),
        }
        candidates = [(0, 0.9), (1, 0.85), (2, 0.8)]
        result = deduplicate_candidates(candidates, _make_reconstruct_fn(vectors), 0.92)
        assert len(result.kept) == 1
        assert result.kept[0][0] == 0
        assert len(result.removed) == 2
        assert result.dedup_source[1] == 0
        assert result.dedup_source[2] == 0

    def test_dedup_source_tracks_correct_kept(self) -> None:
        vectors = {
            0: _normalize(np.array([1.0, 0.0, 0.0], dtype=np.float32)),
            1: _normalize(np.array([0.0, 1.0, 0.0], dtype=np.float32)),
            2: _normalize(np.array([0.999, 0.001, 0.0], dtype=np.float32)),
        }
        candidates = [(0, 0.9), (1, 0.8), (2, 0.7)]
        result = deduplicate_candidates(candidates, _make_reconstruct_fn(vectors), 0.92)
        assert len(result.kept) == 2
        assert result.dedup_source[2] == 0  # 2 is dup of 0, not 1

    def test_keeps_higher_query_similarity(self) -> None:
        vectors = {
            0: _normalize(np.array([1.0, 0.0, 0.0], dtype=np.float32)),
            1: _normalize(np.array([0.999, 0.001, 0.0], dtype=np.float32)),
        }
        # lower query-sim first would be removed if equal; but sorted
        # by query-sim means higher is first. Test that order matters.
        candidates = [(1, 0.95), (0, 0.9)]  # 1 has higher query sim
        result = deduplicate_candidates(candidates, _make_reconstruct_fn(vectors), 0.92)
        assert len(result.kept) == 1
        assert result.kept[0][0] == 1
        assert 0 in result.dedup_source

    def test_handles_missing_faiss_id(self) -> None:
        vectors = {0: _normalize(np.array([1.0, 0.0, 0.0], dtype=np.float32))}
        candidates = [(0, 0.9), (99, 0.8)]  # 99 not in vectors
        result = deduplicate_candidates(candidates, _make_reconstruct_fn(vectors), 0.92)
        # 无法重建向量的候选保留而非丢弃（保守策略：宁多勿漏）
        assert len(result.kept) == 2
        kept_ids = {fid for fid, _ in result.kept}
        assert kept_ids == {0, 99}


class TestDeduplicateCandidatesThreshold:
    def test_threshold_1_0_nothing_deduped(self) -> None:
        vectors = {
            0: _normalize(np.array([1.0, 0.0], dtype=np.float32)),
            1: _normalize(np.array([0.999, 0.001], dtype=np.float32)),
        }
        candidates = [(0, 0.9), (1, 0.85)]
        result = deduplicate_candidates(candidates, _make_reconstruct_fn(vectors), 1.0)
        assert len(result.kept) == 2
        assert result.removed == []

    def test_high_threshold_keeps_most(self) -> None:
        vectors = {
            0: _normalize(np.array([1.0, 0.0], dtype=np.float32)),
            1: _normalize(np.array([0.7, 0.3], dtype=np.float32)),
        }
        candidates = [(0, 0.9), (1, 0.8)]
        # cosine sim ≈ 0.7, which is < 0.99, so both kept
        result = deduplicate_candidates(candidates, _make_reconstruct_fn(vectors), 0.99)
        assert len(result.kept) == 2
