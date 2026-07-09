"""Integration tests — full pipeline across memory modules."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from src.context.overflow_sim import OverflowSimResult, simulate_overflow
from src.embed import embed
from src.memory.forget import ForgettingEngine
from src.memory.index import IndexManager
from src.memory.recall import RecallEngine
from src.memory.store import MemoryStore


def test_full_pipeline(tmp_path: Path) -> None:
    """全链路：存储 → 召回 → 遗忘 → 强度增强。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()

    texts = [
        "布偶猫需要每天梳毛保持毛发整洁",
        "Python 的 mypy 可以做静态类型检查",
        "FAISS 支持余弦相似度向量检索",
        "布偶猫性格温顺适合家庭饲养",
        "艾宾浩斯遗忘曲线描述了人类的记忆衰减",
    ]
    for text in texts:
        vec = embed(text)
        faiss_ids = idx.add(vec.reshape(1, -1))
        store.add_episode(text, faiss_id=faiss_ids[0])

    forgetting = ForgettingEngine(store)
    recall = RecallEngine(store, idx, embed, forgetting)

    results = recall.recall("布偶猫的毛发护理", top_k=2)
    assert len(results) == 2
    for r in results:
        assert "id" in r
        assert "content" in r
        assert "importance" in r
        assert "initial_strength" in r
        assert "faiss_id" in r
        assert r["faiss_id"] is not None

    for r in results:
        assert cast(float, r["initial_strength"]) >= 1.0

    forgetting.decay_all()
    all_eps = store.get_all_episodes()
    for ep in all_eps:
        assert ep["initial_strength"] > 0.99

    store.close()


def test_multi_cycle_forgetting(tmp_path: Path) -> None:
    """多次遗忘循环后强度持续衰减。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()
    forgetting = ForgettingEngine(store)

    vec = embed("测试记忆衰减")
    faiss_ids = idx.add(vec.reshape(1, -1))
    store.add_episode("测试记忆衰减", faiss_id=faiss_ids[0])

    strengths: list[float] = []
    for _ in range(5):
        forgetting.decay_all()
        ep = store.get_all_episodes()[0]
        strengths.append(ep["initial_strength"])

    assert strengths == sorted(strengths, reverse=True)
    assert strengths[-1] < strengths[0]

    store.close()


def test_index_save_and_load(tmp_path: Path) -> None:
    """索引保存到磁盘再加载，向量数一致。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()

    for i in range(3):
        vec = embed(f"test message {i}")
        idx.add(vec.reshape(1, -1))

    index_path = str(tmp_path / "test.index")
    idx.save(index_path)

    idx2 = IndexManager()
    idx2.load(index_path)
    assert idx2.index.size == 3

    store.close()


def test_recall_respects_top_k(tmp_path: Path) -> None:
    """召回数量严格遵守 top_k 参数。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()
    forgetting = ForgettingEngine(store)
    recall = RecallEngine(store, idx, embed, forgetting)

    for i in range(10):
        vec = embed(f"记忆内容编号 {i}")
        faiss_ids = idx.add(vec.reshape(1, -1))
        store.add_episode(f"记忆内容编号 {i}", faiss_id=faiss_ids[0])

    r1 = recall.recall("记忆", top_k=1)
    r3 = recall.recall("记忆", top_k=3)
    r5 = recall.recall("记忆", top_k=5)
    assert len(r1) == 1
    assert 1 <= len(r3) <= 3
    assert 1 <= len(r5) <= 5

    store.close()


def test_overflow_simulation_with_real_data(tmp_path: Path) -> None:
    """用真实召回数据模拟上下文溢出。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()
    forgetting = ForgettingEngine(store)
    recall = RecallEngine(store, idx, embed, forgetting)

    for i in range(8):
        text = f"这是第{i}条关于机器学习和深度神经网络的长文本记忆记录"
        vec = embed(text)
        faiss_ids = idx.add(vec.reshape(1, -1))
        store.add_episode(text, faiss_id=faiss_ids[0])

    recalled = recall.recall("机器学习 神经网络", top_k=6)
    assert len(recalled) > 0

    result = simulate_overflow(recalled, "prioritize", window_size=512)
    assert isinstance(result, OverflowSimResult)
    assert result.total_estimated_tokens > 0
    assert result.window_size == 512
    assert hasattr(result, "overflow_triggered")
    assert hasattr(result, "memories_after")

    result2 = simulate_overflow(recalled, "truncate", window_size=512)
    assert isinstance(result2, OverflowSimResult)

    store.close()


def test_conflict_detection_integration(tmp_path: Path) -> None:
    """冲突检测集成：插入两条 (s, r, o1) 和 (s, r, o2)，验证旧事实 confidence 降低。"""
    from unittest.mock import MagicMock

    from src.memory.fact import FactExtractor

    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()

    # 创建有效的 source_episode_id
    episode_id_1 = store.add_episode("用户说：Alice 喜欢 Python", faiss_id=None)
    episode_id_2 = store.add_episode("用户说：Alice 现在喜欢 Java", faiss_id=None)

    extractor = FactExtractor(store, idx, embed)

    # Mock LLM 返回三元组
    mock_response1 = MagicMock()
    mock_response1.choices[0].message.content = json.dumps(
        [{"subject": "Alice", "relation": "likes", "object": "Python"}]
    )
    mock_response1.usage.prompt_tokens = 30
    mock_response1.usage.completion_tokens = 10

    extractor._client = MagicMock()
    extractor._client.chat.completions.create.return_value = mock_response1

    # 第一次抽取：Alice likes Python
    ids1, _ = extractor.extract_and_store(
        "Alice 喜欢 Python",
        "Alice likes Python",
        source_episode_id=episode_id_1,
    )
    assert len(ids1) == 1
    all_facts_1 = store.get_all_facts()
    fact1 = next(f for f in all_facts_1 if f["id"] == ids1[0])
    conf1 = float(fact1["confidence"])

    # Mock LLM 返回冲突三元组
    mock_response2 = MagicMock()
    mock_response2.choices[0].message.content = json.dumps(
        [{"subject": "Alice", "relation": "likes", "object": "Java"}]
    )
    mock_response2.usage.prompt_tokens = 30
    mock_response2.usage.completion_tokens = 10
    extractor._client.chat.completions.create.return_value = mock_response2

    # 第二次抽取：Alice likes Java（冲突：相同 s,r 但不同 o）
    ids2, _ = extractor.extract_and_store(
        "Alice 现在喜欢 Java",
        "Alice likes Java",
        source_episode_id=episode_id_2,
    )
    assert len(ids2) == 1
    all_facts_2 = store.get_all_facts()
    fact2 = next(f for f in all_facts_2 if f["id"] == ids2[0])
    conf2 = float(fact2["confidence"])

    # 旧事实 confidence 降低
    all_facts_updated = store.get_all_facts()
    fact1_updated = next(f for f in all_facts_updated if f["id"] == ids1[0])
    conf1_updated = float(fact1_updated["confidence"])
    assert conf1_updated < conf1, f"旧事实 confidence 应降低：{conf1_updated} < {conf1}"
    assert conf2 < 1.0, "冲突新事实 confidence 应 < 1.0"

    store.close()


def test_fact_extraction_with_mock_llm(tmp_path: Path) -> None:
    """事实抽取 Mock LLM：返回三元组 JSON，验证 triple 解析和 FAISS 存储。"""
    from unittest.mock import MagicMock

    from src.memory.fact import FactExtractor

    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()

    vec = embed("测试事实抽取")
    faiss_ids = idx.add(vec.reshape(1, -1))
    store.add_episode("测试事实抽取", faiss_id=faiss_ids[0])

    extractor = FactExtractor(store, idx, embed)

    # Mock LLM 返回三元组 JSON
    mock_response = MagicMock()
    mock_response.choices[0].message.content = json.dumps(
        [
            {"subject": "Alice", "relation": "likes", "object": "Python"},
            {"subject": "Bob", "relation": "likes", "object": "Rust"},
        ]
    )
    mock_response.usage.prompt_tokens = 50
    mock_response.usage.completion_tokens = 20

    extractor._client = MagicMock()
    extractor._client.chat.completions.create.return_value = mock_response

    fact_ids, trace = extractor.extract_and_store(
        "Alice 和 Bob 讨论编程语言",
        "Alice likes Python, Bob likes Rust",
        source_episode_id=1,
    )

    assert len(fact_ids) == 2, f"应抽取 2 条事实，实际 {len(fact_ids)}"
    all_facts = store.get_all_facts()
    for fid in fact_ids:
        fact = next(f for f in all_facts if f["id"] == fid)
        assert fact is not None
        assert fact["content"]  # content 非空

    # 验证 FAISS 向量存储
    assert len(all_facts) >= 2

    store.close()


def test_compression_pipeline_integration(tmp_path: Path) -> None:
    """压缩管道集成：Mock LLM 返回压缩文本，验证长度缩短和 api_trace。"""
    from unittest.mock import MagicMock

    from src.chat.engine import ChatEngine

    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()
    engine = ChatEngine(store, idx, embed)

    long_text = " ".join(["Alice"] * 100)  # ~600 字符
    compressed_short = "Alice discussed programming languages"

    mock_response = MagicMock()
    mock_response.choices[0].message.content = compressed_short
    mock_response.usage.prompt_tokens = 30
    mock_response.usage.completion_tokens = 10

    engine._client = MagicMock()
    engine._client.chat.completions.create.return_value = mock_response

    compressed, api_trace = engine.compress_message(long_text)

    assert len(compressed) < len(long_text), f"压缩后应更短：{len(compressed)} < {len(long_text)}"
    assert "compression" in str(api_trace.get("caller", ""))
    assert api_trace["raw_response"] == compressed_short
    assert cast(float, api_trace["elapsed_ms"]) >= 0

    store.close()


def test_memory_augmented_generation(tmp_path: Path) -> None:
    """记忆增强生成：recall → context_window → generate 完整链路。"""
    from unittest.mock import MagicMock

    from src.chat.engine import ChatEngine

    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()
    forgetting = ForgettingEngine(store)
    recall = RecallEngine(store, idx, embed, forgetting)
    engine = ChatEngine(store, idx, embed)

    # 存储记忆
    texts = ["Alice 喜欢 Python", "Bob 喜欢 Rust", "Python 是解释型语言"]
    for _, text in enumerate(texts):
        vec = embed(text)
        faiss_ids = idx.add(vec.reshape(1, -1))
        store.add_episode(text, faiss_id=faiss_ids[0])

    # 召回
    recalled = recall.recall("Alice 喜欢什么语言", top_k=2)
    assert len(recalled) > 0

    # Mock LLM 生成
    mock_response = MagicMock()
    mock_response.choices[0].message.content = "根据记忆，Alice 喜欢 Python。"
    mock_response.usage.prompt_tokens = 100
    mock_response.usage.completion_tokens = 20

    engine._client = MagicMock()
    engine._client.chat.completions.create.return_value = mock_response

    reply, context_meta, api_trace = engine.generate(
        "Alice 喜欢什么语言？",
        recalled,
        context_window_size=512,
    )

    # 验证 system_prompt 包含召回记忆
    system_prompt = str(context_meta.get("system_prompt", ""))
    assert "Alice" in system_prompt or "python" in system_prompt.lower()
    assert reply == "根据记忆，Alice 喜欢 Python。"

    store.close()


def test_multi_turn_conversation_memory(tmp_path: Path) -> None:
    """多轮对话记忆累积：3 轮对话后记忆均可召回。"""
    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()
    forgetting = ForgettingEngine(store)
    recall = RecallEngine(store, idx, embed, forgetting)

    conversations = [
        ("Alice 喜欢 Python", "Python 是解释型语言"),
        ("Bob 喜欢 Rust", "Rust 是系统编程语言"),
        ("Python 和 Rust 的区别", "Python 动态类型，Rust 静态类型"),
    ]

    for _, (user_msg, assistant_msg) in enumerate(conversations, 1):
        user_vec = embed(user_msg)
        user_faiss = idx.add(user_vec.reshape(1, -1))
        store.add_episode(user_msg, faiss_id=user_faiss[0])

        assistant_vec = embed(f"[Assistant] {assistant_msg}")
        assistant_faiss = idx.add(assistant_vec.reshape(1, -1))
        store.add_episode(assistant_msg, faiss_id=assistant_faiss[0])

    # 最终召回
    results = recall.recall("编程语言", top_k=3)
    assert len(results) >= 3, f"应召回至少 3 条，实际 {len(results)}"

    # 验证强度排序（recall 结果按 initial_strength 降序）
    strengths = [float(cast(float, r["initial_strength"])) for r in results]
    assert strengths == sorted(strengths, reverse=True), "召回结果应按强度降序"

    store.close()


def test_error_recovery_graceful_degradation(tmp_path: Path) -> None:
    """错误恢复：compress_message LLM API 失败时降级为截断。"""
    from unittest.mock import MagicMock

    from src.chat.engine import ChatEngine

    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()
    engine = ChatEngine(store, idx, embed)

    # compress_message 失败降级
    long_text = " ".join(["word"] * 200)
    engine._client = MagicMock()
    engine._client.chat.completions.create.side_effect = RuntimeError("API Error")
    compressed, _ = engine.compress_message(long_text)

    assert len(compressed) == 203, f"降级截断应为 203 字符：{len(compressed)}"
    assert compressed.endswith("..."), "降级截断应以 ... 结尾"

    store.close()


def test_recall_with_different_strategies(tmp_path: Path) -> None:
    """三种溢出策略对比：prioritize/truncate/fifo。"""
    from src.context.overflow_sim import simulate_overflow

    store = MemoryStore(str(tmp_path / "test.db"))
    store.init_db()
    idx = IndexManager()
    forgetting = ForgettingEngine(store)
    recall = RecallEngine(store, idx, embed, forgetting)

    # 存储 10 条记忆
    for i in range(10):
        text = f"记忆内容编号 {i}" * 10  # 长文本
        vec = embed(text)
        faiss_ids = idx.add(vec.reshape(1, -1))
        store.add_episode(text, faiss_id=faiss_ids[0])

    recalled = recall.recall("记忆", top_k=10)
    assert len(recalled) >= 5

    window = 256
    result_prioritize = simulate_overflow(recalled, "prioritize", window_size=window)
    result_truncate = simulate_overflow(recalled, "truncate", window_size=window)
    result_fifo = simulate_overflow(recalled, "fifo", window_size=window)

    # 三种策略均返回 OverflowSimResult
    assert hasattr(result_prioritize, "memories_after")
    assert hasattr(result_truncate, "memories_after")
    assert hasattr(result_fifo, "memories_after")

    # prioritize 优先保留高 strength，结果数可能不同
    n_prioritize = result_prioritize.memories_after
    n_truncate = result_truncate.memories_after
    n_fifo = result_fifo.memories_after

    assert n_prioritize <= len(recalled)
    assert n_truncate <= len(recalled)
    assert n_fifo <= len(recalled)

    store.close()
