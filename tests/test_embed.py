"""Tests for src/embed.py — text → embedding vector conversion."""

from __future__ import annotations

import numpy as np

from src.embed import embed

# ── Shape / dtype ──


def test_embed_single_shape() -> None:
    vec = embed("你好世界")
    assert vec.shape == (384,)
    assert vec.dtype == np.float32


def test_embed_batch_shape() -> None:
    vecs = embed(["第一句话", "第二句话", "第三句话"])
    assert vecs.shape == (3, 384)
    assert vecs.dtype == np.float32


# ── Edge cases ──


def test_embed_empty_string() -> None:
    vec = embed("")
    assert vec.shape == (384,)
    assert vec.dtype == np.float32


def test_embed_single_word() -> None:
    vec = embed("hello")
    assert vec.shape == (384,)
    assert not np.all(vec == 0)


def test_embed_special_characters() -> None:
    vec = embed("🚀✨🎉 测试 Unicode äöü 😀")
    assert vec.shape == (384,)
    assert vec.dtype == np.float32


def test_embed_numeric_only() -> None:
    vec = embed("12345 67890 3.14159")
    assert vec.shape == (384,)


def test_embed_very_long_text() -> None:
    long_text = "人工智能是计算机科学的一个重要分支。" * 100
    vec = embed(long_text)
    assert vec.shape == (384,)


def test_embed_batch_single_item() -> None:
    vecs = embed(["only one"])
    assert vecs.shape == (1, 384)


def test_embed_batch_empty_list() -> None:
    """空列表返回 (0,) 退化数组，不抛异常。"""
    vecs = embed([])
    assert vecs.shape == (0,)
    assert vecs.dtype in (np.float32, np.float64)
