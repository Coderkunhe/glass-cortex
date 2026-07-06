"""日志查看器端点——读取服务器端 JSON Lines 日志文件。

Next.js 浏览器端无法直接访问服务器文件系统，此端点提供只读日志查询接口。
行号（1-indexed）作为日志条目的唯一 ID，支持列表查询和单条详情。
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

from api.schemas import LogDetailResponse, LogEntry, LogResponse

router = APIRouter(prefix="/logs", tags=["logs"])


def _resolve_log_path(profile: str | None, request: Request) -> Path | None:
    """解析日志文件路径，文件缺失时返回 None。"""
    settings = request.app.state.settings
    profile_name = profile or settings.user_profile
    log_dir = settings.data_dir / profile_name
    log_path = log_dir / "glasscortex.log"
    return log_path if log_path.exists() else None


def _parse_log_lines(lines: list[str], start_line: int = 1) -> list[dict[str, str]]:
    """将原始文本行解析为结构化条目，畸形行标记为 PARSE_ERROR。

    Args:
        lines: 原始文本行列表。
        start_line: 第一行在文件中的行号（1-indexed），用于生成 id。

    Returns:
        结构化条目字典列表，每项包含 id（行号）字段。
    """
    entries: list[dict[str, str]] = []
    for i, line in enumerate(lines):
        line_number = start_line + i
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            entries.append(
                {
                    "id": str(line_number),
                    "timestamp": str(entry.get("ts") or entry.get("timestamp", "")),
                    "level": str(entry.get("level", "UNKNOWN")),
                    "logger": str(entry.get("logger", "")),
                    "message": str(entry.get("msg") or entry.get("message", "")),
                    "raw": line,
                }
            )
        except json.JSONDecodeError, TypeError:
            entries.append(
                {
                    "id": str(line_number),
                    "timestamp": "",
                    "level": "PARSE_ERROR",
                    "logger": "",
                    "message": line[:300],
                    "raw": line,
                }
            )
    return entries


@router.get("", response_model=LogResponse)
def list_logs(
    request: Request,
    profile: str | None = Query(None, description="Profile 名称"),
    tail_n: int = Query(200, ge=1, le=10000, description="从文件末尾读取的行数"),
    level: str | None = Query(None, pattern=r"^(DEBUG|INFO|WARNING|ERROR|CRITICAL)$"),
    keyword: str | None = Query(None, min_length=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
) -> LogResponse:
    """读取并查询服务器日志文件。

    从 data/{profile}/glasscortex.log 读取最近 N 行 JSON Lines 日志，
    按 level / keyword 筛选后分页返回。
    """
    log_path = _resolve_log_path(profile, request)
    if log_path is None:
        return LogResponse(
            entries=[],
            total_lines=0,
            file_size_bytes=0,
            page=page,
            page_size=page_size,
        )

    file_size = log_path.stat().st_size

    # 读取末尾 N 行（内存友好：只读需要的行数）
    lines: list[str] = []
    with open(log_path, encoding="utf-8") as f:
        all_lines = f.readlines()
        total_lines = len(all_lines)
        lines = all_lines[-tail_n:] if total_lines > tail_n else all_lines

    # 计算起始行号，使 id 与文件中的绝对行号一致
    start_line = total_lines - len(lines) + 1 if total_lines > tail_n else 1
    entries = _parse_log_lines(lines, start_line)

    # 筛选
    if level:
        entries = [e for e in entries if e["level"].upper() == level.upper()]
    if keyword:
        kw = keyword.lower()
        entries = [e for e in entries if kw in e["message"].lower() or kw in e["logger"].lower()]

    # 分页
    start = (page - 1) * page_size
    end = start + page_size
    paged = entries[start:end]

    return LogResponse(
        entries=[
            LogEntry(
                id=int(e["id"]),
                timestamp=e["timestamp"],
                level=e["level"],
                logger=e["logger"],
                message=e["message"],
                raw=e["raw"],
            )
            for e in paged
        ],
        total_lines=total_lines,
        file_size_bytes=file_size,
        page=page,
        page_size=page_size,
    )


@router.get("/{log_id}", response_model=LogDetailResponse)
def get_log_detail(
    log_id: int,
    request: Request,
    profile: str | None = Query(None, description="Profile 名称"),
) -> LogDetailResponse:
    """获取单条日志的完整详情。

    按行号读取日志文件中的指定条目，返回完整内容及前后导航指针。
    """
    log_path = _resolve_log_path(profile, request)
    if log_path is None:
        raise HTTPException(status_code=404, detail="日志文件不存在")

    with open(log_path, encoding="utf-8") as f:
        all_lines = f.readlines()

    total_lines = len(all_lines)
    if log_id < 1 or log_id > total_lines:
        raise HTTPException(
            status_code=404,
            detail=f"行 {log_id} 不存在（文件共 {total_lines} 行）",
        )

    line = all_lines[log_id - 1].strip()
    if not line:
        raise HTTPException(status_code=404, detail=f"行 {log_id} 为空")

    try:
        entry = json.loads(line)
        return LogDetailResponse(
            id=log_id,
            timestamp=str(entry.get("ts") or entry.get("timestamp", "")),
            level=str(entry.get("level", "UNKNOWN")),
            logger=str(entry.get("logger", "")),
            message=str(entry.get("msg") or entry.get("message", "")),
            raw=line,
            prev_id=log_id - 1 if log_id > 1 else None,
            next_id=log_id + 1 if log_id < total_lines else None,
            total_lines=total_lines,
        )
    except json.JSONDecodeError, TypeError:
        return LogDetailResponse(
            id=log_id,
            timestamp="",
            level="PARSE_ERROR",
            logger="",
            message=line[:300],
            raw=line,
            prev_id=log_id - 1 if log_id > 1 else None,
            next_id=log_id + 1 if log_id < total_lines else None,
            total_lines=total_lines,
        )
