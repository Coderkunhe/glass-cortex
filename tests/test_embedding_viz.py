from __future__ import annotations

import numpy as np
import pytest
from plotly.graph_objects import Figure  # type: ignore[import-untyped]


class TestPCAReduce:
    def test_reduces_to_2d(self) -> None:
        from src.visualize.embedding_viz import pca_reduce

        vectors = np.random.randn(20, 384).astype(np.float32)
        result = pca_reduce(vectors, n_components=2, return_variance=False)
        assert isinstance(result, np.ndarray)
        assert result.shape == (20, 2)

    def test_reduces_to_3d(self) -> None:
        from src.visualize.embedding_viz import pca_reduce

        vectors = np.random.randn(20, 384).astype(np.float32)
        result = pca_reduce(vectors, n_components=3, return_variance=False)
        assert isinstance(result, np.ndarray)
        assert result.shape == (20, 3)

    def test_single_vector(self) -> None:
        from src.visualize.embedding_viz import pca_reduce

        vectors = np.random.randn(1, 384).astype(np.float32)
        # 单样本无法降维到 2 维 (rank ≤ 1)
        with pytest.raises(ValueError):
            pca_reduce(vectors, n_components=2)

    def test_preserves_relative_distances(self) -> None:
        from src.visualize.embedding_viz import pca_reduce

        # Three vectors: v1 and v2 are similar, v3 is different
        base = np.random.randn(384).astype(np.float32)
        v1 = base + np.random.randn(384).astype(np.float32) * 0.1
        v2 = base + np.random.randn(384).astype(np.float32) * 0.1
        v3 = np.random.randn(384).astype(np.float32)
        vectors = np.array([v1, v2, v3])

        result = pca_reduce(vectors, n_components=2, return_variance=False)
        assert isinstance(result, np.ndarray)

        dist_12 = np.linalg.norm(result[0] - result[1])
        dist_13 = np.linalg.norm(result[0] - result[2])
        dist_23 = np.linalg.norm(result[1] - result[2])

        # v1 and v2 should be closer than v1-v3 or v2-v3
        assert dist_12 < dist_13
        assert dist_12 < dist_23

    def test_all_identical_vectors(self) -> None:
        from src.visualize.embedding_viz import pca_reduce

        v = np.random.randn(384).astype(np.float32)
        vectors = np.array([v, v, v])
        result = pca_reduce(vectors, n_components=2, return_variance=False)
        assert isinstance(result, np.ndarray)
        assert result.shape == (3, 2)
        assert np.allclose(result, 0, atol=1e-6)

    def test_raises_on_too_many_components(self) -> None:
        from src.visualize.embedding_viz import pca_reduce

        vectors = np.random.randn(3, 384).astype(np.float32)
        with pytest.raises(ValueError):
            pca_reduce(vectors, n_components=5)


class TestCreateEmbeddingScatter:
    @staticmethod
    def _make_labels(n: int) -> tuple[list[str], list[str]]:
        texts = [f"text {i}" for i in range(n)]
        colors = ["ep" if i % 2 == 0 else "fact" for i in range(n)]
        return texts, colors

    def test_returns_figure(self) -> None:
        from src.visualize.embedding_viz import create_embedding_scatter

        coords = np.random.randn(10, 3).astype(np.float32)
        texts, colors = self._make_labels(10)
        fig = create_embedding_scatter(coords, texts, colors)
        assert isinstance(fig, Figure)

    def test_correct_number_of_traces(self) -> None:
        from src.visualize.embedding_viz import create_embedding_scatter

        coords = np.random.randn(10, 3).astype(np.float32)
        texts, colors = self._make_labels(10)
        fig = create_embedding_scatter(coords, texts, colors)

        # Two traces: one for "ep", one for "fact"
        assert len(fig.data) == 2

    def test_hover_text_contains_labels(self) -> None:
        from src.visualize.embedding_viz import create_embedding_scatter

        coords = np.random.randn(5, 3).astype(np.float32)
        texts = ["hello world abc", "goodbye xyz", "foo", "bar", "baz"]
        colors = ["ep", "fact", "ep", "fact", "ep"]
        fig = create_embedding_scatter(coords, texts, colors)

        all_hover = ""
        for trace in fig.data:
            if hasattr(trace, "hovertext") and trace.hovertext is not None:
                all_hover += " ".join(trace.hovertext)
        assert "hello world abc" in all_hover
        assert "goodbye xyz" in all_hover

    def test_ep_fact_color_split(self) -> None:
        from src.visualize.embedding_viz import create_embedding_scatter

        coords = np.random.randn(6, 3).astype(np.float32)
        texts = ["a", "b", "c", "d", "e", "f"]
        colors = ["ep", "ep", "ep", "fact", "fact", "fact"]
        fig = create_embedding_scatter(coords, texts, colors)

        # Check that both traces have correct point counts
        ep_trace = fig.data[0]
        fact_trace = fig.data[1]
        assert ep_trace.name == "对话记忆"
        assert fact_trace.name == "事实知识"
        assert len(ep_trace.x) == 3
        assert len(fact_trace.x) == 3

    def test_single_point(self) -> None:
        from src.visualize.embedding_viz import create_embedding_scatter

        coords = np.random.randn(1, 3).astype(np.float32)
        texts = ["solo"]
        colors = ["ep"]
        fig = create_embedding_scatter(coords, texts, colors)
        assert isinstance(fig, Figure)
        assert len(fig.data) == 2  # both traces still exist, one empty

    def test_2d_coordinates(self) -> None:
        from src.visualize.embedding_viz import create_embedding_scatter

        coords = np.random.randn(10, 2).astype(np.float32)
        texts, colors = self._make_labels(10)
        fig = create_embedding_scatter(coords, texts, colors)
        assert isinstance(fig, Figure)

    def test_all_same_type(self) -> None:
        from src.visualize.embedding_viz import create_embedding_scatter

        coords = np.random.randn(5, 3).astype(np.float32)
        texts = ["a", "b", "c", "d", "e"]
        colors = ["ep", "ep", "ep", "ep", "ep"]
        fig = create_embedding_scatter(coords, texts, colors)
        assert len(fig.data) == 2
        # ep trace has all 5, fact trace is empty
        assert len(fig.data[1].x) == 0
