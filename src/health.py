"""Glassmind 健康检查 — 主动探测各组件健康状态。

check_health() 返回结构化报告，供启动时自动运行和 Dashboard 手动触发。
"""

from __future__ import annotations

import shutil
import sqlite3
import time
from typing import Any

from src.config import Settings


def check_health(
    store: Any,
    idx: Any,
    chat_engine: Any,
    settings: Settings,
    embed_fn: Any = None,
) -> dict[str, dict[str, Any]]:
    """对各组件执行健康检查，返回结构化报告。

    每项检查返回 {"status": "ok"|"warn"|"error", "latency_ms": float, "detail": str}。
    非 ok 状态附带 "detail" 字段描述具体原因。
    """
    results: dict[str, dict[str, Any]] = {}

    # ── 1. 数据库 ──
    t0 = time.time()
    try:
        store._execute("SELECT 1")
        results["database"] = {
            "status": "ok",
            "latency_ms": round((time.time() - t0) * 1000, 1),
            "detail": f"db={settings.resolved_db_path}",
        }
    except sqlite3.Error as exc:
        results["database"] = {
            "status": "error",
            "latency_ms": round((time.time() - t0) * 1000, 1),
            "detail": str(exc)[:200],
        }

    # ── 2. FAISS 索引 ──
    t0 = time.time()
    try:
        ntotal = idx.index.ntotal if idx.index is not None else 0
        index_path = settings.resolved_index_path
        index_exists = index_path.exists()
        if not index_exists and ntotal == 0:
            results["faiss_index"] = {
                "status": "warn",
                "latency_ms": round((time.time() - t0) * 1000, 1),
                "detail": "索引文件未创建，首次对话后自动初始化",
            }
        else:
            results["faiss_index"] = {
                "status": "ok",
                "latency_ms": round((time.time() - t0) * 1000, 1),
                "detail": (
                    f"ntotal={ntotal}, dim={idx.index.d if idx.index is not None else '?'}"
                    f", index={index_path}"
                ),
            }
    except (RuntimeError, OSError) as exc:
        results["faiss_index"] = {
            "status": "error",
            "latency_ms": round((time.time() - t0) * 1000, 1),
            "detail": str(exc)[:200],
        }

    # ── 3. LLM API ──
    t0 = time.time()
    try:
        client = chat_engine.client
        api_key = getattr(client, "api_key", None)
        if api_key and api_key != "未设置":
            results["llm_api"] = {
                "status": "ok",
                "latency_ms": round((time.time() - t0) * 1000, 1),
                "detail": f"model={settings.llm_model}, base_url={settings.llm_base_url}",
            }
        else:
            results["llm_api"] = {
                "status": "warn",
                "latency_ms": round((time.time() - t0) * 1000, 1),
                "detail": "API key 未设置，对话功能不可用",
            }
    except RuntimeError:
        results["llm_api"] = {
            "status": "warn",
            "latency_ms": round((time.time() - t0) * 1000, 1),
            "detail": "API key 未设置，对话功能不可用",
        }
    except AttributeError as exc:
        results["llm_api"] = {
            "status": "error",
            "latency_ms": round((time.time() - t0) * 1000, 1),
            "detail": str(exc)[:200],
        }

    # ── 4. 磁盘空间 ──
    t0 = time.time()
    try:
        usage = shutil.disk_usage(settings.data_dir)
        free_mb = usage.free / (1024 * 1024)
        status = "ok" if free_mb > 100 else "warn"
        results["disk_space"] = {
            "status": status,
            "latency_ms": round((time.time() - t0) * 1000, 1),
            "detail": f"剩余 {free_mb:.0f} MB, data_dir={settings.data_dir}",
        }
    except OSError as exc:
        results["disk_space"] = {
            "status": "error",
            "latency_ms": round((time.time() - t0) * 1000, 1),
            "detail": str(exc)[:200],
        }

    # ── 5. Embedding 模型 ──
    t0 = time.time()
    if embed_fn is not None:
        try:
            vec = embed_fn(["health check"])
            if vec.shape == (1, settings.embed_dim):
                results["embedding_model"] = {
                    "status": "ok",
                    "latency_ms": round((time.time() - t0) * 1000, 1),
                    "detail": f"model={settings.embed_model}, dim={settings.embed_dim}",
                }
            else:
                results["embedding_model"] = {
                    "status": "warn",
                    "latency_ms": round((time.time() - t0) * 1000, 1),
                    "detail": f"输出维度 {vec.shape} 与预期 {settings.embed_dim} 不匹配",
                }
        except (RuntimeError, ValueError) as exc:
            results["embedding_model"] = {
                "status": "error",
                "latency_ms": round((time.time() - t0) * 1000, 1),
                "detail": str(exc)[:200],
            }
    else:
        results["embedding_model"] = {
            "status": "warn",
            "latency_ms": 0,
            "detail": "embed_fn 未注入，跳过检查",
        }

    return results
