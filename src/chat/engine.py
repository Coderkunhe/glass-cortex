"""聊天引擎核心——System Prompt 构建、LLM 调用、回复生成与记忆存储的编排中枢。

两阶段上下文注入 (Phase 58): Stage 1 概要列表 → Stage 2 [ref:N] 按需展开。
"""

from __future__ import annotations

import os
import re
import time
from collections.abc import Callable, Generator
from typing import TYPE_CHECKING, cast

import numpy as np
from openai import APIError, OpenAI

from src.config import settings
from src.context.overflow_sim import (
    OverflowSimResult,
    estimate_tokens,
    simulate_overflow,
)
from src.context.partition import summarize_recall_item
from src.logging import get_logger
from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.token_ledger import TokenLedger

if TYPE_CHECKING:
    from src.memory.fact import FactExtractor

logger = get_logger(__name__)


class ChatEngine:
    """对话生成引擎，通过 DeepSeek API 生成回复并存入记忆系统。"""

    def __init__(
        self,
        store: MemoryStore,
        index: IndexManager,
        embed_fn: Callable[[str], np.ndarray],
    ) -> None:
        self._store = store
        self._index = index
        self._embed = embed_fn
        self._client: OpenAI | None = None
        self._fact_extractor: FactExtractor | None = None
        self._ledger: TokenLedger | None = None
        self._last_overflow: OverflowSimResult | None = None
        self._last_ref_map: dict[int, dict[str, object]] | None = None

    def set_fact_extractor(self, extractor: FactExtractor) -> None:
        """注入 FactExtractor，在 generate_and_store 中自动抽取事实。"""
        self._fact_extractor = extractor

    def set_ledger(self, ledger: TokenLedger) -> None:
        """注入 TokenLedger，在 generate 中自动记录 token 消耗。"""
        self._ledger = ledger

    @property
    def client(self) -> OpenAI:
        if self._client is None:
            api_key = os.environ.get(settings.llm_api_key_env)
            if not api_key:
                raise RuntimeError(
                    f"{settings.llm_api_key_env} 未设置，无法生成回复。"
                    f"设置后重新启动即可：export {settings.llm_api_key_env}=sk-..."
                )
            self._client = OpenAI(
                api_key=api_key,
                base_url=settings.llm_base_url,
                timeout=settings.llm_timeout,
            )
        return self._client

    @property
    def last_overflow(self) -> OverflowSimResult | None:
        return self._last_overflow

    @property
    def last_ref_map(self) -> dict[int, dict[str, object]] | None:
        """最近一次两阶段注入的引用映射，供调用方在 generate() 后展开引用。"""
        return self._last_ref_map

    @property
    def fact_extractor(self) -> FactExtractor | None:
        """FactExtractor 实例，供可观测性端点读取缓存统计。"""
        return self._fact_extractor

    def _build_system_prompt(
        self,
        recalled: list[dict[str, object]],
        context_window_size: int = 4096,
        context_overflow_strategy: str = "prioritize",
    ) -> tuple[str, dict[str, object]]:
        base_header = "你是一个有记忆的 AI 助手。"
        closing = (
            "请参考这些记忆和事实与用户自然地交流。如果某些信息与当前话题相关，"
            "可以在回复中自然地提及，但不要生硬地逐条复述。"
        )
        ep_header = "## 对话记忆"
        fact_header = "## 已知事实"

        result = simulate_overflow(
            recalled=recalled,
            strategy=context_overflow_strategy,
            window_size=context_window_size,
            user_input="",
        )
        self._last_overflow = result

        if not recalled:
            prompt = (
                f"{base_header}你正在和一个真实用户对话。"
                "用自然、友好的方式回复。如果这是首次见面，可以简单打个招呼。"
            )
            return prompt, {
                "window_size": result.window_size,
                "base_tokens": result.base_tokens,
                "memories_before": result.memories_before,
                "memories_token_before": result.memories_token_before,
                "memories_after": result.memories_after,
                "overflow_applied": result.overflow_triggered,
                "strategy": result.strategy,
                "dropped_count": result.dropped_count,
                "dropped_items": result.dropped_items,
                "usage_pct": result.usage_pct,
                "memories_token_after": result.memories_token_after,
            }

        lines: list[str] = [base_header, ""]
        kept_episodes = [it for it in result.kept_items if it["kind"] == "episode"]
        kept_facts = [it for it in result.kept_items if it["kind"] == "fact"]
        kept_summaries = [it for it in result.kept_items if it["kind"] == "summary"]

        if kept_episodes:
            lines.append(ep_header)
            for item in kept_episodes:
                lines.append(str(item["line"]))
        if kept_facts:
            lines.append("")
            lines.append(fact_header)
            for item in kept_facts:
                lines.append(str(item["line"]))
        if kept_summaries:
            lines.append("")
            for item in kept_summaries:
                lines.append(str(item["line"]))
        lines.append("")
        lines.append(closing)

        prompt = "\n".join(lines)
        return prompt, {
            "window_size": result.window_size,
            "base_tokens": result.base_tokens,
            "memories_before": result.memories_before,
            "memories_token_before": result.memories_token_before,
            "memories_after": result.memories_after,
            "overflow_applied": result.overflow_triggered,
            "strategy": result.strategy,
            "dropped_count": result.dropped_count,
            "dropped_items": result.dropped_items,
            "usage_pct": result.usage_pct,
            "memories_token_after": result.memories_token_after,
        }

    def _build_two_stage_prompt(
        self,
        recalled: list[dict[str, object]],
        context_window_size: int = 4096,
        context_overflow_strategy: str = "prioritize",
    ) -> tuple[str, dict[str, object], dict[int, dict[str, object]]]:
        """构建两阶段注入的 Stage 1 系统提示——概要 + [ref:N] 自引用标签。

        每个召回条目先经 summarize_recall_item() 压缩为 ≤80 char 摘要，
        再送入溢出模拟。摘要 token 消耗约为完整内容的 1/3，使更多条目
        可容纳于上下文窗口内。[ref:N] 标签允许 LLM 在响应中标注引用号，
        由 expand_references() 在 Stage 2 按需展开为完整内容。

        Args:
            recalled: 召回条目列表 (RecallEngine.recall() 返回格式)。
            context_window_size: 上下文窗口 token 容量。
            context_overflow_strategy: 溢出策略 ("truncate"|"prioritize"|"summarize")。

        Returns:
            (system_prompt, context_meta, ref_map) —— ref_map 为
            {ref_id: full_recalled_item_dict}，供 Stage 2 展开使用。
        """
        # ── 构建 ref_map + 摘要替换 ──
        ref_map: dict[int, dict[str, object]] = {}
        summarized: list[dict[str, object]] = []
        for i, item in enumerate(recalled, start=1):
            ref_map[i] = dict(item)
            summary = summarize_recall_item(item, max_len=80)
            s_item = dict(item)
            # 将 content 替换为摘要，以便溢出模拟使用较短文本计算 token
            s_item["content"] = summary if summary else str(item.get("content", ""))
            s_item["_ref_id"] = i
            summarized.append(s_item)

        # ── 溢出模拟（用摘要版条目，token 估算更省）──
        result = simulate_overflow(
            recalled=summarized,
            strategy=context_overflow_strategy,
            window_size=context_window_size,
            user_input="",
        )
        self._last_overflow = result

        base_header = "你是一个有记忆的 AI 助手。"
        closing = (
            "请参考这些记忆和事实与用户自然地交流。如果某些信息与当前话题相关，"
            "可以在回复中自然地提及，但不要生硬地逐条复述。"
            "每条记忆前缀 [ref:N] 是引用标签——如需某条记忆的完整原文，"
            "在回复中标注 [ref:N] 即可获取全文。"
        )
        ep_header = "## 对话记忆 (概要)"
        fact_header = "## 已知事实 (概要)"

        if not recalled:
            prompt = (
                f"{base_header}你正在和一个真实用户对话。"
                "用自然、友好的方式回复。如果这是首次见面，可以简单打个招呼。"
            )
            return (
                prompt,
                {
                    "window_size": result.window_size,
                    "base_tokens": result.base_tokens,
                    "memories_before": result.memories_before,
                    "memories_token_before": result.memories_token_before,
                    "memories_after": result.memories_after,
                    "overflow_applied": result.overflow_triggered,
                    "strategy": result.strategy,
                    "dropped_count": result.dropped_count,
                    "dropped_items": result.dropped_items,
                    "usage_pct": result.usage_pct,
                    "memories_token_after": result.memories_token_after,
                },
                ref_map,
            )

        lines: list[str] = [base_header, ""]
        kept_episodes = [it for it in result.kept_items if it["kind"] == "episode"]
        kept_facts = [it for it in result.kept_items if it["kind"] == "fact"]
        kept_summaries = [it for it in result.kept_items if it["kind"] == "summary"]

        if kept_episodes:
            lines.append(ep_header)
            for item in kept_episodes:
                ref_id = item.get("_ref_id", "?")
                lines.append(f"[ref:{ref_id}] {item['content']}")
        if kept_facts:
            lines.append("")
            lines.append(fact_header)
            for item in kept_facts:
                ref_id = item.get("_ref_id", "?")
                lines.append(f"[ref:{ref_id}] {item['content']}")
        if kept_summaries:
            lines.append("")
            for item in kept_summaries:
                lines.append(str(item["line"]))
        lines.append("")
        lines.append(closing)

        prompt = "\n".join(lines)
        return (
            prompt,
            {
                "window_size": result.window_size,
                "base_tokens": result.base_tokens,
                "memories_before": result.memories_before,
                "memories_token_before": result.memories_token_before,
                "memories_after": result.memories_after,
                "overflow_applied": result.overflow_triggered,
                "strategy": result.strategy,
                "dropped_count": result.dropped_count,
                "dropped_items": result.dropped_items,
                "usage_pct": result.usage_pct,
                "memories_token_after": result.memories_token_after,
            },
            ref_map,
        )

    @staticmethod
    def expand_references(
        text: str,
        ref_map: dict[int, dict[str, object]],
    ) -> str:
        """Stage 2: 展开响应中的 [ref:N] 引用标签为完整记忆内容。

        扫描 LLM 响应文本，将匹配到的 [ref:N] 模式替换为
        "[ref:N] <完整内容>" 格式。未在 ref_map 中的引用号原文保留。

        Args:
            text: LLM 响应文本，可能包含 [ref:N] 引用标签。
            ref_map: _build_two_stage_prompt() 产出的引用映射。

        Returns:
            展开后的文本。[ref:N] 出现一次展开一次（多次出现均替换）。
        """

        def _replace(match: re.Match[str]) -> str:
            ref_id = int(match.group(1))
            item = ref_map.get(ref_id)
            if item is None:
                return match.group(0)
            content = str(item.get("content", ""))
            return f"[ref:{ref_id}] {content}"

        return re.sub(r"\[ref:(\d+)\]", _replace, text)

    def generate(
        self,
        user_input: str,
        recalled: list[dict[str, object]],
        context_window_size: int = 4096,
        context_overflow_strategy: str = "prioritize",
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        two_stage: bool = False,
    ) -> tuple[str, dict[str, object], dict[str, object]]:
        """生成 LLM 回复，可选两阶段上下文注入以节省 token。

        Args:
            user_input: 用户消息文本。
            recalled: 召回条目列表。
            context_window_size: 上下文窗口 token 容量。
            context_overflow_strategy: 溢出策略。
            model: 模型覆盖（None=使用配置默认值）。
            temperature: 温度覆盖。
            max_tokens: 最大生成 token 覆盖。
            two_stage: 启用两阶段注入——Stage 1 注入摘要+[ref:N]标签，
                       Stage 2 调用方可用 expand_references() 展开响应中的引用。

        Returns:
            (response_text, context_meta, api_trace) —— 同单阶段签名。
        """
        if two_stage:
            system_prompt, context_meta, ref_map = self._build_two_stage_prompt(
                recalled, context_window_size, context_overflow_strategy
            )
            self._last_ref_map = ref_map
        else:
            system_prompt, context_meta = self._build_system_prompt(
                recalled, context_window_size, context_overflow_strategy
            )
            self._last_ref_map = None
        user_tokens = estimate_tokens(user_input)
        dropped = cast(list[str], context_meta.get("dropped_items", []))
        dropped_token_sum = sum(estimate_tokens(d) for d in dropped)
        context_meta["user_message_tokens"] = user_tokens
        context_meta["total_estimated_tokens"] = (
            cast(int, context_meta["base_tokens"])
            + cast(int, context_meta["memories_token_before"])
            - dropped_token_sum
            + user_tokens
        )
        context_meta["system_prompt"] = system_prompt
        t0 = time.time()
        try:
            response = self.client.chat.completions.create(
                model=model if model else settings.llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_input},
                ],
                max_tokens=max_tokens if max_tokens is not None else settings.llm_max_tokens,
                temperature=temperature if temperature is not None else settings.llm_temperature,
            )
            elapsed_ms = round((time.time() - t0) * 1000, 1)
            if self._ledger is not None and response.usage is not None:
                self._ledger.record(
                    "chat",
                    response.usage.prompt_tokens,
                    response.usage.completion_tokens,
                )
            reply_len = len(response.choices[0].message.content or "")
            logger.info(
                "API 调用成功",
                extra={
                    "component": "chat",
                    "elapsed_ms": elapsed_ms,
                    "model": model if model else settings.llm_model,
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                    "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                    "reply_len": reply_len,
                },
            )
            response_text = response.choices[0].message.content or ""
            api_trace: dict[str, object] = {
                "caller": "chat",
                "model": model if model else settings.llm_model,
                "system_prompt": system_prompt,
                "user_prompt": user_input,
                "temperature": temperature if temperature is not None else settings.llm_temperature,
                "max_tokens": max_tokens if max_tokens is not None else settings.llm_max_tokens,
                "raw_response": response_text,
                "elapsed_ms": elapsed_ms,
                "parsed_result": response_text,
                "parse_error": None,
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": response.usage.completion_tokens if response.usage else 0,
            }
            return response_text, context_meta, api_trace
        except (APIError, RuntimeError) as exc:
            elapsed_ms = round((time.time() - t0) * 1000, 1)
            logger.error(
                "API 调用失败",
                extra={
                    "component": "chat",
                    "elapsed_ms": elapsed_ms,
                    "error": str(exc)[:200],
                },
            )
            raise RuntimeError(f"DeepSeek API 调用失败: {exc}") from exc

    def generate_stream(
        self,
        user_input: str,
        recalled: list[dict[str, object]],
        context_window_size: int = 4096,
        context_overflow_strategy: str = "prioritize",
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        two_stage: bool = False,
    ) -> Generator[dict[str, object], None, None]:
        """逐 token 流式生成 LLM 回复。

        与 ``generate()`` 使用相同的 system prompt 构建逻辑，
        但通过 ``client.chat.completions.create(stream=True)`` 返回生成器，
        逐 chunk yield SSE 事件 dict。

        Yields:
            ``{"type": "token", "delta": "..."}`` — 增量文本。
            ``{"type": "done", "response_text": "...", ...}`` — 流结束，携带完整元数据。
            ``{"type": "error", "detail": "..."}`` — API 调用失败。
        """
        # ── Stage 1: 构建 system prompt（与同步路径 100% 一致）──
        if two_stage:
            system_prompt, context_meta, ref_map = self._build_two_stage_prompt(
                recalled, context_window_size, context_overflow_strategy
            )
            self._last_ref_map = ref_map
        else:
            system_prompt, context_meta = self._build_system_prompt(
                recalled, context_window_size, context_overflow_strategy
            )
            self._last_ref_map = None

        user_tokens = estimate_tokens(user_input)
        dropped = cast(list[str], context_meta.get("dropped_items", []))
        dropped_token_sum = sum(estimate_tokens(d) for d in dropped)
        context_meta["user_message_tokens"] = user_tokens
        context_meta["total_estimated_tokens"] = (
            cast(int, context_meta["base_tokens"])
            + cast(int, context_meta["memories_token_before"])
            - dropped_token_sum
            + user_tokens
        )
        context_meta["system_prompt"] = system_prompt

        # ── Stage 2: 流式 LLM 调用 ──
        t0 = time.time()
        try:
            stream = self.client.chat.completions.create(
                model=model if model else settings.llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_input},
                ],
                max_tokens=max_tokens if max_tokens is not None else settings.llm_max_tokens,
                temperature=temperature if temperature is not None else settings.llm_temperature,
                stream=True,
                stream_options={"include_usage": True},
            )

            full_text = ""
            prompt_tokens = 0
            completion_tokens = 0

            for chunk in stream:
                # 最后一个 chunk (usage-only) 可能没有 choices
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        full_text += delta.content
                        yield {"type": "token", "delta": delta.content}

                # 流式 completion 的 token 统计在最后一个 chunk
                if chunk.usage is not None:
                    prompt_tokens = chunk.usage.prompt_tokens
                    completion_tokens = chunk.usage.completion_tokens

            elapsed_ms = round((time.time() - t0) * 1000, 1)

            # Token 记录（与同步 generate() 同等行为）
            if self._ledger is not None and (prompt_tokens or completion_tokens):
                self._ledger.record("chat", prompt_tokens, completion_tokens)

            reply_len = len(full_text)
            logger.info(
                "API 流式调用成功",
                extra={
                    "component": "chat",
                    "elapsed_ms": elapsed_ms,
                    "model": model if model else settings.llm_model,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "reply_len": reply_len,
                },
            )

            api_trace: dict[str, object] = {
                "caller": "chat",
                "model": model if model else settings.llm_model,
                "system_prompt": system_prompt,
                "user_prompt": user_input,
                "temperature": temperature if temperature is not None else settings.llm_temperature,
                "max_tokens": max_tokens if max_tokens is not None else settings.llm_max_tokens,
                "raw_response": full_text,
                "elapsed_ms": elapsed_ms,
                "parsed_result": full_text,
                "parse_error": None,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            }

            yield {
                "type": "done",
                "response_text": full_text,
                "context_meta": context_meta,
                "api_trace": api_trace,
            }

        except (APIError, RuntimeError) as exc:
            elapsed_ms = round((time.time() - t0) * 1000, 1)
            logger.error(
                "API 流式调用失败",
                extra={
                    "component": "chat",
                    "elapsed_ms": elapsed_ms,
                    "error": str(exc)[:200],
                },
            )
            yield {"type": "error", "detail": str(exc)}

    def compress_message(self, content: str) -> tuple[str, dict[str, object]]:
        """将长文本调用 LLM 压缩为一句话摘要。

        失败时静默降级为原文截断（前 200 字符）。
        返回值 (compressed_text, api_trace_dict) — api_trace 失败时为空 dict。
        """
        prompt = f"将以下内容压缩为一句话摘要，保留所有关键信息、事实和人名：\n\n{content}"
        t0 = time.time()
        try:
            response = self.client.chat.completions.create(
                model=settings.llm_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=128,
                temperature=0.3,
            )
            elapsed_ms = round((time.time() - t0) * 1000, 1)
            summary = response.choices[0].message.content or ""
            logger.info(
                "消息压缩完成",
                extra={
                    "component": "compress",
                    "original_len": len(content),
                    "compressed_len": len(summary),
                },
            )
            compressed = summary.strip() if summary.strip() else content[:200] + "..."
            # 记录压缩 LLM 调用的 token 消耗 + 节省量到 ledger
            if self._ledger is not None and response.usage is not None:
                self._ledger.record(
                    "compression",
                    response.usage.prompt_tokens,
                    response.usage.completion_tokens,
                )
                original_tokens = estimate_tokens(content)
                compressed_tokens = estimate_tokens(compressed)
                saved = max(0, original_tokens - compressed_tokens)
                if saved > 0:
                    self._ledger.record_compression_savings(saved)
            api_trace: dict[str, object] = {
                "caller": "compression",
                "model": settings.llm_model,
                "system_prompt": "",
                "user_prompt": prompt,
                "temperature": 0.3,
                "max_tokens": 128,
                "raw_response": compressed,
                "elapsed_ms": elapsed_ms,
                "parsed_result": compressed,
                "parse_error": None,
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": response.usage.completion_tokens if response.usage else 0,
            }
            self._store.insert_trace(
                session_id="",
                step_name="compression",
                elapsed_ms=elapsed_ms,
                status="ok",
                metrics={
                    "original_len": len(content),
                    "compressed_len": len(compressed),
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                    "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                },
            )
            return compressed, api_trace
        except (APIError, RuntimeError):  # fmt: skip
            logger.warning("消息压缩失败，降级为截断", extra={"component": "compress"})
            return content[:200] + "...", {}

    def store_response(self, response_text: str, session_id: str | None = None) -> int:
        prefixed = f"[Assistant] {response_text}"
        vec = self._embed(prefixed)
        faiss_ids = self._index.add(vec.reshape(1, -1))
        return self._store.add_episode(
            content=prefixed,
            importance=settings.assistant_importance,
            faiss_id=faiss_ids[0],
            session_id=session_id,
        )

    def generate_and_store(
        self,
        user_input: str,
        recalled: list[dict[str, object]],
        context_window_size: int = 4096,
        context_overflow_strategy: str = "prioritize",
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        two_stage: bool = False,
        skip_fact_extraction: bool = False,
        session_id: str | None = None,
    ) -> tuple[str, int, dict[str, object], dict[str, object]]:
        """生成 LLM 回复 + 存储 + 可选事实抽取 + 管线 trace 持久化。

        Args:
            user_input: 用户消息文本。
            recalled: 召回条目列表。
            context_window_size: 上下文窗口 token 容量。
            context_overflow_strategy: 溢出策略。
            model: 模型覆盖。
            temperature: 温度覆盖。
            max_tokens: 最大生成 token 覆盖。
            two_stage: 启用两阶段上下文注入。
            skip_fact_extraction: 跳过事实抽取（Phase 63 降级门控）。

        Returns:
            (response_text, episode_id, context_meta, api_trace)。
        """
        sid = session_id or ""
        # ── Step 1: 聊天引擎 ──
        response_text, context_meta, api_trace = self.generate(
            user_input,
            recalled,
            context_window_size,
            context_overflow_strategy,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            two_stage=two_stage,
        )
        self._store.insert_trace(
            session_id=sid,
            step_name="chat",
            elapsed_ms=cast("float", api_trace.get("elapsed_ms", 0)),
            status="ok",
            metrics={
                k: v
                for k, v in api_trace.items()
                if k
                in (
                    "model",
                    "prompt_tokens",
                    "completion_tokens",
                    "temperature",
                    "max_tokens",
                )
            },
        )

        # ── Step 2: 记忆存储 ──
        t0_store = time.time()
        eid = self.store_response(response_text, session_id=session_id)
        store_elapsed = round((time.time() - t0_store) * 1000, 1)
        self._store.insert_trace(
            session_id=sid,
            step_name="store",
            elapsed_ms=store_elapsed,
            status="ok",
            metrics={"episode_id": eid},
        )

        # ── Step 3: 事实抽取（可选）──
        if self._fact_extractor is not None and not skip_fact_extraction:
            t0_fact = time.time()
            try:
                _, fact_trace = self._fact_extractor.extract_and_store(
                    user_input, response_text, eid
                )
                context_meta["fact_extraction_trace"] = fact_trace
                self._store.insert_trace(
                    session_id=sid,
                    step_name="fact_extraction",
                    elapsed_ms=round((time.time() - t0_fact) * 1000, 1),
                    status="ok",
                    metrics=(
                        fact_trace if isinstance(fact_trace, dict) else {"trace": str(fact_trace)}
                    ),
                )
            except (APIError, RuntimeError, ValueError):  # fmt: skip
                logger.warning("事实抽取失败", extra={"component": "chat"})
                self._store.insert_trace(
                    session_id=sid,
                    step_name="fact_extraction",
                    elapsed_ms=round((time.time() - t0_fact) * 1000, 1),
                    status="error",
                    metrics={},
                )
        elif skip_fact_extraction and self._fact_extractor is not None:
            logger.info(
                "事实抽取已降级跳过",
                extra={"component": "chat", "reason": "budget_degradation"},
            )

        return response_text, eid, context_meta, api_trace
