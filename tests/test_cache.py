from __future__ import annotations

import numpy as np

from src.cache import EmbeddingCache, FactCache


class TestEmbeddingCache:
    def test_get_miss_returns_none(self) -> None:
        cache = EmbeddingCache(max_size=10)
        assert cache.get("missing") is None

    def test_put_and_get_returns_same_vector(self) -> None:
        cache = EmbeddingCache(max_size=10)
        vec = np.array([1.0, 2.0, 3.0], dtype=np.float32)
        cache.put("hello", vec)
        result = cache.get("hello")
        assert result is not None
        assert np.array_equal(result, vec)

    def test_cache_hit_returns_cached_value(self) -> None:
        cache = EmbeddingCache(max_size=10)
        vec = np.ones(384, dtype=np.float32)
        cache.put("test text", vec)
        result = cache.get("test text")
        assert np.array_equal(result, vec)  # type: ignore[arg-type]
        assert cache.hits == 1
        assert cache.misses == 0

    def test_hits_and_misses_counters(self) -> None:
        cache = EmbeddingCache(max_size=10)
        assert cache.hits == 0
        assert cache.misses == 0

        cache.get("a")  # miss
        cache.get("b")  # miss
        cache.put("a", np.ones(384, dtype=np.float32))
        cache.get("a")  # hit
        cache.get("c")  # miss

        assert cache.hits == 1
        assert cache.misses == 3

    def test_fifo_eviction(self) -> None:
        cache = EmbeddingCache(max_size=3)
        cache.put("a", np.array([1.0], dtype=np.float32))
        cache.put("b", np.array([2.0], dtype=np.float32))
        cache.put("c", np.array([3.0], dtype=np.float32))
        cache.put("d", np.array([4.0], dtype=np.float32))

        assert cache.size == 3
        assert cache.get("a") is None  # 最先插入的 a 被淘汰
        assert cache.get("b") is not None
        assert cache.get("d") is not None

    def test_put_existing_key_does_not_evict(self) -> None:
        cache = EmbeddingCache(max_size=2)
        cache.put("a", np.ones(384, dtype=np.float32))
        cache.put("b", np.ones(384, dtype=np.float32))
        cache.put("a", np.ones(384, dtype=np.float32))  # 更新 a，不增加新条目

        assert cache.size == 2
        assert cache.get("a") is not None
        assert cache.get("b") is not None

    def test_size_property(self) -> None:
        cache = EmbeddingCache(max_size=100)
        assert cache.size == 0
        cache.put("x", np.ones(384, dtype=np.float32))
        assert cache.size == 1
        cache.put("y", np.ones(384, dtype=np.float32))
        assert cache.size == 2


class TestFactCache:
    def test_cache_miss_returns_none(self) -> None:
        cache = FactCache(max_size=10)
        assert cache.get("hello", "hi", "abc123") is None

    def test_cache_hit_same_input(self) -> None:
        cache = FactCache(max_size=10)
        result: dict[str, object] = {"triples": [], "api_trace": {"raw_response": "[]"}}
        cache.put("user msg", "assistant msg", "hash1", result)
        cached = cache.get("user msg", "assistant msg", "hash1")
        assert cached is not None
        assert cached["api_trace"]["raw_response"] == "[]"  # type: ignore[index]

    def test_different_fact_state_misses(self) -> None:
        cache = FactCache(max_size=10)
        cache.put("msg", "reply", "hash_old", {"triples": [], "api_trace": {}})
        assert cache.get("msg", "reply", "hash_new") is None

    def test_different_msg_misses(self) -> None:
        cache = FactCache(max_size=10)
        cache.put("msg1", "reply1", "hash", {"triples": [], "api_trace": {}})
        assert cache.get("msg2", "reply2", "hash") is None

    def test_different_assistant_msg_misses(self) -> None:
        cache = FactCache(max_size=10)
        cache.put("same user", "reply A", "hash", {"triples": [], "api_trace": {}})
        cached = cache.get("same user", "reply A", "hash")
        assert cached is not None
        assert cache.get("same user", "reply B", "hash") is None

    def test_max_size_eviction(self) -> None:
        cache = FactCache(max_size=2)
        cache.put("a", "ra", "h1", {"triples": [], "api_trace": {}})
        cache.put("b", "rb", "h2", {"triples": [], "api_trace": {}})
        cache.put("c", "rc", "h3", {"triples": [], "api_trace": {}})

        assert cache.size == 2
        assert cache.get("a", "ra", "h1") is None  # 最先插入的 a 被淘汰
        assert cache.get("b", "rb", "h2") is not None
        assert cache.get("c", "rc", "h3") is not None

    def test_hits_misses_counters(self) -> None:
        cache = FactCache(max_size=10)
        cache.get("a", "ra", "h1")  # miss
        cache.get("b", "rb", "h2")  # miss
        cache.put("a", "ra", "h1", {"triples": [], "api_trace": {}})
        cache.get("a", "ra", "h1")  # hit
        cache.get("a", "ra", "h3")  # miss (different hash)

        assert cache.hits == 1
        assert cache.misses == 3

    def test_compute_fact_state_hash_deterministic(self) -> None:
        facts: list[dict[str, object]] = [
            {"id": 3, "content": "用户 — 喜欢 → 猫"},
            {"id": 1, "content": "用户 — 工作地点 → 北京"},
        ]
        h1 = FactCache.compute_fact_state_hash(facts)
        h2 = FactCache.compute_fact_state_hash(facts)
        assert h1 == h2

    def test_compute_fact_state_hash_sorts_by_id(self) -> None:
        facts1: list[dict[str, object]] = [
            {"id": 3, "content": "c"},
            {"id": 1, "content": "a"},
        ]
        facts2: list[dict[str, object]] = [
            {"id": 1, "content": "a"},
            {"id": 3, "content": "c"},
        ]
        h1 = FactCache.compute_fact_state_hash(facts1)
        h2 = FactCache.compute_fact_state_hash(facts2)
        assert h1 == h2

    def test_compute_fact_state_hash_different_ids(self) -> None:
        facts1: list[dict[str, object]] = [{"id": 1, "content": "a"}]
        facts2: list[dict[str, object]] = [{"id": 1, "content": "a"}, {"id": 2, "content": "b"}]
        h1 = FactCache.compute_fact_state_hash(facts1)
        h2 = FactCache.compute_fact_state_hash(facts2)
        assert h1 != h2

    def test_compute_fact_state_hash_empty(self) -> None:
        h = FactCache.compute_fact_state_hash([])
        assert isinstance(h, str)
        assert len(h) == 16
