"""嵌入空间可视化——Plotly 3D 散点图 + 降维投影 + 距离矩阵热力图。"""

from __future__ import annotations

import numpy as np
import plotly.graph_objects as go  # type: ignore[import-untyped]  # plotly has no PEP 561 type stubs


def pca_reduce(
    vectors: np.ndarray,
    n_components: int = 3,
    return_variance: bool = False,
) -> np.ndarray | tuple[np.ndarray, list[float]]:
    """用 PCA 将高维向量降到低维空间。

    使用 numpy SVD 实现，零额外依赖。确定性、快速。

    Args:
        vectors: shape (n_samples, n_features) 的浮点数组
        n_components: 降维目标维度 (2 或 3)
        return_variance: 若为 True，同时返回各主成分的方差解释比

    Returns:
        若 return_variance=False: shape (n_samples, n_components) 的降维后坐标
        若 return_variance=True: (坐标, 方差解释比列表)

    Raises:
        ValueError: n_components > n_samples 时无法降维
    """
    vectors = vectors.astype(np.float64)
    n_samples = vectors.shape[0]
    if n_components > n_samples:
        raise ValueError(f"n_components ({n_components}) 不能超过样本数 ({n_samples})")

    # 中心化
    mean = np.mean(vectors, axis=0, keepdims=True)
    centered = vectors - mean

    # SVD 奇异值分解降维
    u, s, vt = np.linalg.svd(centered, full_matrices=False)

    # 投影到前 n_components 个主成分
    transformed = centered @ vt[:n_components].T
    result = np.asarray(transformed, dtype=np.float32)

    if return_variance:
        # 方差解释比 = 各奇异值平方 / 总奇异值平方和
        s_sq = s * s
        total_var = np.sum(s_sq)
        variance = [float(s_sq[i] / total_var) for i in range(min(n_components, len(s)))]
        return result, variance

    return result


def create_embedding_scatter(
    coords: np.ndarray,
    labels: list[str],
    color_labels: list[str],
) -> go.Figure:
    """创建 embedding 空间的 2D/3D 散点图。

    Args:
        coords: shape (n, 2) 或 (n, 3) 的降维坐标
        labels: 每个点的标签文本（用于 hover）
        color_labels: 每个点的颜色分类 ("ep" = 对话记忆, "fact" = 事实知识)

    Returns:
        Plotly Figure，ep 和 fact 分两个 trace 用不同颜色渲染
    """
    is_3d = coords.shape[1] >= 3

    fig = go.Figure()

    ep_mask = np.array([c == "ep" for c in color_labels])
    fact_mask = ~ep_mask

    if is_3d:
        _add_trace_3d(fig, coords, ep_mask, labels, "对话记忆", "#3498db")
        _add_trace_3d(fig, coords, fact_mask, labels, "事实知识", "#e74c3c")
        fig.update_layout(
            scene=dict(
                xaxis_title="PC1",
                yaxis_title="PC2",
                zaxis_title="PC3",
            ),
        )
    else:
        _add_trace_2d(fig, coords, ep_mask, labels, "对话记忆", "#3498db")
        _add_trace_2d(fig, coords, fact_mask, labels, "事实知识", "#e74c3c")
        fig.update_layout(
            xaxis_title="PC1",
            yaxis_title="PC2",
        )

    fig.update_layout(
        height=450,
        margin=dict(l=0, r=0, t=0, b=0),
        legend=dict(
            orientation="h",
            yanchor="top",
            y=-0.1,
            xanchor="center",
            x=0.5,
            font=dict(size=10),
        ),
        hovermode="closest",
    )

    return fig


def _add_trace_3d(
    fig: go.Figure,
    coords: np.ndarray,
    mask: np.ndarray,
    labels: list[str],
    name: str,
    color: str,
) -> None:
    if not mask.any():
        fig.add_trace(
            go.Scatter3d(x=[], y=[], z=[], mode="markers", name=name, marker={"color": color})
        )
        return
    idx = np.where(mask)[0]
    fig.add_trace(
        go.Scatter3d(
            x=coords[mask, 0],
            y=coords[mask, 1],
            z=coords[mask, 2],
            mode="markers",
            name=name,
            marker={
                "color": color,
                "size": 5,
                "opacity": 0.8,
            },
            hovertext=[_truncate(labels[i]) for i in idx],
            hoverinfo="text",
        )
    )


def _add_trace_2d(
    fig: go.Figure,
    coords: np.ndarray,
    mask: np.ndarray,
    labels: list[str],
    name: str,
    color: str,
) -> None:
    if not mask.any():
        fig.add_trace(go.Scatter(x=[], y=[], mode="markers", name=name, marker={"color": color}))
        return
    idx = np.where(mask)[0]
    fig.add_trace(
        go.Scatter(
            x=coords[mask, 0],
            y=coords[mask, 1],
            mode="markers",
            name=name,
            marker={
                "color": color,
                "size": 8,
                "opacity": 0.8,
            },
            hovertext=[_truncate(labels[i]) for i in idx],
            hoverinfo="text",
        )
    )


def _truncate(text: str, max_len: int = 60) -> str:
    return text[: max_len - 3] + "..." if len(text) > max_len else text
