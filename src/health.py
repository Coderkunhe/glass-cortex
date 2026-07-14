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

    # ── 2. 向量索引 ──
    t0 = time.time()
    try:
        index_size = idx.index.size if idx.index is not None else 0
        index_path = settings.resolved_index_path
        index_exists = index_path.exists()
        if not index_exists and index_size == 0:
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
                    f"ntotal={index_size}, dim={idx.index.ndim if idx.index is not None else '?'}"
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
        if not api_key or api_key == "未设置":
            results["llm_api"] = {
                "status": "warn",
                "latency_ms": round((time.time() - t0) * 1000, 1),
                "detail": "API key 未设置，对话功能不可用",
            }
        else:
            # 真实 API 探测：调用 models.list() 验证网络/SSL/DNS 全链路
            _ = client.models.list()
            results["llm_api"] = {
                "status": "ok",
                "latency_ms": round((time.time() - t0) * 1000, 1),
                "detail": f"model={settings.llm_model}, base_url={settings.llm_base_url}",
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
    except Exception as exc:
        # 真实 API 调用失败
        latency_ms = round((time.time() - t0) * 1000, 1)
        # 若异常携带 HTTP 状态码（如 404/401），说明 TCP+TLS 链路已通，
        # API 可达——只是 models 端点不可用或无权限，视为 ok
        if hasattr(exc, "status_code") or hasattr(exc, "response"):
            results["llm_api"] = {
                "status": "ok",
                "latency_ms": latency_ms,
                "detail": (
                    f"API 可达（收到 HTTP 响应），model={settings.llm_model}, "
                    f"base_url={settings.llm_base_url}"
                ),
            }
        else:
            # 连接级失败 → 分类异常类型给出可操作的诊断提示
            detail = str(exc)[:200]
            cause_chain: list[BaseException] = [exc]
            current: BaseException = exc
            while current.__cause__ is not None:
                current = current.__cause__
                cause_chain.append(current)
            for e in cause_chain:
                cls_name = type(e).__qualname__
                if "SSL" in cls_name or "Certificate" in cls_name:
                    detail = (
                        f"SSL 证书验证失败（Windows Server 常见问题）。原始错误: {str(exc)[:150]}"
                    )
                    break
                if "Connect" in cls_name or "RemoteDisconnected" in cls_name:
                    detail = (
                        f"无法连接 {settings.llm_base_url} —— "
                        f"请检查服务器外网访问、防火墙规则和 DNS 解析。"
                        f"原始错误: {str(exc)[:120]}"
                    )
                    break
                if "Timeout" in cls_name or "ReadTimeout" in cls_name:
                    detail = (
                        f"连接 {settings.llm_base_url} 超时 —— "
                        f"请检查网络延迟或代理设置。"
                        f"原始错误: {str(exc)[:150]}"
                    )
                    break
            results["llm_api"] = {
                "status": "error",
                "latency_ms": latency_ms,
                "detail": detail,
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
