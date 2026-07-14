"""事实提取引擎——LLM 三元组抽取 + 去重合并 + 实体规范化 + 置信度衰减。"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable, Sequence
from typing import cast

import numpy as np
from openai import APIError, OpenAI

from src.cache import FactCache
from src.config import settings
from src.logging import get_logger
from src.memory.index import IndexManager
from src.memory.store import FactRow, MemoryStore
from src.memory.triple import Triple
from src.token_ledger import TokenLedger

logger = get_logger(__name__)

# 实体归一化：去掉常见称谓后缀
_ENTITY_TITLES = ("老师", "先生", "女士", "同学", "老板", "经理", "医生", "律师")


class FactExtractor:
    """从对话中抽取事实知识并存入 Fact 层。

    ADR-002: Episode 记录对话片段（时间衰减），Fact 记录抽取的事实（三元组结构化）。
    事实同时存入 FAISS 索引，支持语义召回。
    """

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
        self._ledger: TokenLedger | None = None
        self._fact_cache = FactCache(max_size=64)

    @property
    def client(self) -> OpenAI:
        if self._client is None:
            api_key = os.environ.get(settings.llm_api_key_env)
            if not api_key:
                raise RuntimeError(f"{settings.llm_api_key_env} 未设置，无法抽取事实。")
            self._client = OpenAI(
                api_key=api_key, base_url=settings.llm_base_url, timeout=settings.llm_timeout
            )
        return self._client

    def set_ledger(self, ledger: TokenLedger) -> None:
        """注入 TokenLedger，在 _extract_via_api 中自动记录 token 消耗。"""
        self._ledger = ledger

    @property
    def cache(self) -> FactCache:
        """FactCache 实例，供可观测性端点读取命中率。"""
        return self._fact_cache

    # ── 公开入口 ──

    def extract_and_store(
        self, user_msg: str, assistant_msg: str, source_episode_id: int
    ) -> tuple[list[int], dict[str, object]]:
        """从一轮对话中抽取三元组事实，结构化去重后存入 MemoryStore + FAISS。

        返回 (fact_ids, trace_dict)，trace_dict 包含完整抽取管线数据供 UI 透明化展示。
        """
        existing = self._store.get_all_facts()
        fact_state_hash = FactCache.compute_fact_state_hash(existing)  # type: ignore[arg-type]  # list[dict]→Sequence[FactRow]; sqlite3 query returns untyped dicts

        # 检查 Fact 抽取缓存
        cached = self._fact_cache.get(user_msg, assistant_msg, fact_state_hash)
        if cached is not None:
            triples = cast(list[Triple], cached["triples"])
            api_trace = cast(dict[str, object], cached["api_trace"])
            # 记录缓存命中节省的 token 量
            if self._ledger is not None:
                saved_usage = cast(dict[str, object] | None, api_trace.get("token_usage"))
                if saved_usage is not None:
                    saved = cast(int, saved_usage["prompt_tokens"]) + cast(
                        int, saved_usage["completion_tokens"]
                    )
                    self._ledger.record_cache_hit("fact_extraction", saved)
            trace: dict[str, object] = {
                "status": "ok",
                "system_prompt": api_trace["system_prompt"],
                "user_prompt": api_trace["user_prompt"],
                "model": settings.llm_model,
                "max_tokens": settings.fact_extraction_max_tokens,
                "temperature": api_trace.get("temperature", 1.0),
                "elapsed_ms": 0.0,
                "raw_response": api_trace["raw_response"],
                "parsed_triples": triples,
                "parse_error": api_trace.get("parse_error"),
                "dedup_results": [],
                "stored_fact_ids": [],
                "token_usage": api_trace.get("token_usage"),
                "cache_hit": True,
                "user_msg": user_msg,
                "assistant_msg": assistant_msg,
            }
        else:
            trace = {
                "status": "ok",
                "system_prompt": "",
                "user_prompt": "",
                "model": settings.llm_model,
                "max_tokens": settings.fact_extraction_max_tokens,
                "temperature": 1.0,
                "elapsed_ms": 0.0,
                "raw_response": "",
                "parsed_triples": [],
                "parse_error": None,
                "dedup_results": [],
                "stored_fact_ids": [],
                "token_usage": None,
                "user_msg": user_msg,
                "assistant_msg": assistant_msg,
            }
            try:
                triples, api_trace = self._extract_via_api(user_msg, assistant_msg, existing)
                trace["system_prompt"] = api_trace["system_prompt"]
                trace["user_prompt"] = api_trace["user_prompt"]
                trace["raw_response"] = api_trace["raw_response"]
                trace["parsed_triples"] = triples
                trace["parse_error"] = api_trace.get("parse_error")
                trace["token_usage"] = api_trace.get("token_usage")
                trace["temperature"] = api_trace.get("temperature", 1.0)
                trace["elapsed_ms"] = api_trace.get("elapsed_ms", 0.0)
                # 缓存结果
                self._fact_cache.put(
                    user_msg,
                    assistant_msg,
                    fact_state_hash,
                    {"triples": triples, "api_trace": api_trace},
                )
            except (APIError, RuntimeError, OSError, ValueError):  # fmt: skip
                logger.warning("事实抽取 API 调用失败", extra={"component": "fact_extraction"})
                trace["status"] = "error"
                return [], trace

        fact_ids: list[int] = []
        dedup_results: list[dict[str, object]] = []
        for triple in triples:
            fid, action = self._dedup_and_store(triple, existing, source_episode_id)
            if fid is not None:
                fact_ids.append(fid)
            dedup_results.append(
                {
                    "triple": triple.content,
                    "action": action["action"],
                    "detail": action["detail"],
                }
            )
        trace["dedup_results"] = dedup_results
        trace["stored_fact_ids"] = fact_ids
        return fact_ids, trace

    # ── API 调用 ──

    def _extract_via_api(
        self,
        user_msg: str,
        assistant_msg: str,
        existing_facts: Sequence[FactRow],
    ) -> tuple[list[Triple], dict[str, object]]:
        system_prompt = (
            "你是一个事实抽取助手。从用户的对话消息中抽取关于用户的**事实性信息**，"
            "以 JSON 数组形式返回，每条事实包含三个字段：\n"
            "subject（主体）、relation（关系）、object（客体）。\n"
            "规则：\n"
            "1. subject 用规范化称呼——当前对话者统一用「用户」，其他人用全名且跨对话保持一致\n"
            "2. relation 用简洁的动词或动词短语（如「喜欢」「工作地点」「拥有」「职业」）\n"
            "3. object 用具体值，避免模糊表述\n"
            "4. 只抽取关于用户的事实（偏好、属性、经历），不抽取对话元信息\n"
            "5. 如果对话中没有新的事实性信息，返回空数组 []\n"
            "6. 不要重复已有的事实（见下方已有事实列表）\n"
        )
        if settings.loss_detection_enabled:
            system_prompt += "7. 提取完成后，复查原始消息——如有遗漏的重要用户信息，请补充\n"

        user_prompt = f"用户消息: {user_msg}\n助手回复: {assistant_msg}\n"
        if existing_facts:
            user_prompt += "\n已有事实（不要重复）:\n"
            for f in existing_facts:
                user_prompt += f"- {f['content']}\n"
        user_prompt += (
            '\n输出格式：\n[{"subject": "用户", "relation": "喜欢", "object": "布偶猫"}]\n'
            "请输出 JSON 数组："
        )

        api_trace: dict[str, object] = {
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "raw_response": "",
            "parse_error": None,
            "token_usage": None,
            "temperature": 1.0,
            "elapsed_ms": 0.0,
        }

        t0 = time.time()
        response = self.client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=settings.fact_extraction_max_tokens,
        )
        api_trace["elapsed_ms"] = (time.time() - t0) * 1000
        if self._ledger is not None and response.usage is not None:
            self._ledger.record(
                "fact_extraction",
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
            )
            api_trace["token_usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }
        raw = response.choices[0].message.content or "[]"
        api_trace["raw_response"] = raw
        triples, parse_error = self._parse_triples(raw)
        if parse_error:
            api_trace["parse_error"] = parse_error
        return triples, api_trace

    # ── 解析 ──

    @staticmethod
    def _parse_triples(raw: str) -> tuple[list[Triple], str | None]:
        """解析 LLM 返回的 JSON 数组为 Triple 列表，容错处理。

        返回 (triples, parse_error)。parse_error 仅在 JSON 完全无法解析时非 None。
        空数组 [] 是合法响应（无新事实），返回 ([], None)。
        """
        parsed, success = FactExtractor._try_parse_triple_json(raw)
        if success:
            return parsed, None
        # 容错：尝试提取 [...] 之间的内容
        start = raw.find("[")
        end = raw.rfind("]")
        if start != -1 and end != -1 and end > start:
            parsed, success = FactExtractor._try_parse_triple_json(raw[start : end + 1])
            if success:
                return parsed, None
        return [], f"JSON 解析失败，原始响应: {raw[:200]}"

    @staticmethod
    def _try_parse_triple_json(json_str: str) -> tuple[list[Triple], bool]:
        """尝试解析 JSON 数组为 Triple 列表。

        返回 (triples, success)。success=True 表示成功解析（即使数组为空）；
        success=False 表示 JSON 无法解析。
        """
        try:
            data = json.loads(json_str)
            if isinstance(data, list):
                return (
                    [
                        Triple(
                            subject=FactExtractor._normalize_entity(str(item["subject"])),
                            relation=str(item["relation"]).strip(),
                            object=FactExtractor._normalize_entity(str(item["object"])),
                        )
                        for item in data
                        if isinstance(item, dict)
                        and all(k in item for k in ("subject", "relation", "object"))
                    ],
                    True,
                )
        except (json.JSONDecodeError, TypeError, KeyError):  # fmt: skip
            pass
        return [], False

    # ── 去重与存储 ──

    def _dedup_and_store(
        self,
        triple: Triple,
        existing: Sequence[FactRow],
        source_episode_id: int,
    ) -> tuple[int | None, dict[str, str]]:
        """结构化匹配去重 + FAISS/SQLite 存储。

        返回 (fact_id | None, action_dict)。

        1. 完全匹配 (s, r, o) → 旧事实 confidence 提升，返回 (None, action)
        2. 冲突 (s, r 相同, o 不同) → 旧事实 confidence 降低，新建低 confidence 事实
        3. 无匹配 → 正常新建
        旧数据（无法解析为 Triple 的自由文本）跳过结构化比较，走新建路径。
        """
        # 解析已有事实为 Triple（跳过无法解析的旧数据）
        existing_triples: list[tuple[FactRow, Triple]] = []
        for ex in existing:
            t = Triple.from_content(str(ex["content"]))
            if t is not None:
                existing_triples.append((ex, t))

        # 完全匹配检查
        for ex_dict, ex_triple in existing_triples:
            if ex_triple == triple:
                delta = settings.fact_delta_base + settings.fact_delta_sim_multiplier * 0.95
                old_conf = ex_dict["confidence"]
                self._store.update_fact_confidence(ex_dict["id"], delta)
                new_conf = min(1.0, max(0.0, old_conf + delta))
                self._store.log_fact_confidence(ex_dict["id"], old_conf, new_conf, reason="merge")
                return None, {
                    "action": "merge",
                    "detail": f"与已有事实完全匹配，置信度 +{delta:.2f}",
                }

        # 冲突检测：同 (s, r) 但不同 o（仍会创建新事实，但标注为 conflict）
        conflict_penalty = 0.0
        is_conflict = False
        conflict_detail = ""
        for ex_dict, ex_triple in existing_triples:
            if (
                ex_triple.predicate_key == triple.predicate_key
                and ex_triple.object != triple.object
            ):
                old_conf = ex_dict["confidence"]
                self._store.update_fact_confidence(
                    ex_dict["id"], -settings.conflict_confidence_penalty
                )
                new_conf = max(0.0, old_conf - settings.conflict_confidence_penalty)
                self._store.log_fact_confidence(
                    ex_dict["id"], old_conf, new_conf, reason="conflict"
                )
                conflict_penalty = settings.conflict_confidence_penalty
                is_conflict = True
                conflict_detail = (
                    f"与已有事实矛盾（已有: {ex_triple.object}），旧事实置信度"
                    f" -{conflict_penalty:.2f}，新事实降权入库"
                )
                break

        # 新事实：embed → FAISS → SQLite
        new_vec = self._embed(triple.content)
        new_vec_norm = new_vec / (np.linalg.norm(new_vec) + 1e-8)
        faiss_ids = self._index.add(new_vec_norm.reshape(1, -1))
        confidence = max(0.1, settings.fact_initial_confidence - conflict_penalty)
        fid = self._store.add_fact(
            content=triple.content,
            confidence=confidence,
            source_episode_id=source_episode_id,
            faiss_id=faiss_ids[0],
            subject=triple.subject,
            relation=triple.relation,
            object=triple.object,
        )
        self._store.log_fact_confidence(fid, 0.0, confidence, reason="initial")
        action = "conflict" if is_conflict else "new"
        detail = (
            conflict_detail
            if is_conflict
            else f"新事实，置信度 {confidence:.2f}，faiss_id={faiss_ids[0]}"
        )
        return fid, {"action": action, "detail": detail}

    # ── 实体归一化 ──

    @staticmethod
    def _normalize_entity(name: str) -> str:
        """去掉常见称谓后缀，归一化实体名称。"""
        result = name.strip()
        for title in _ENTITY_TITLES:
            if result.endswith(title) and len(result) > len(title):
                result = result[: -len(title)]
        return result.strip()
