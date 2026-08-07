"""GET /api/admin — 管理员仪表盘 API。

Phase 68 Batch 2 — 工程可视化数据端点。
提供工程健康指标 + 文档清单 + 文档内容读取。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/admin", tags=["admin"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DOCS_DIR = PROJECT_ROOT / "docs"
TOOLS_DIR = PROJECT_ROOT / "tools"

# ── 路径沙箱：允许读取的目录 ──
_ALLOWED_DIRS = {
    "docs": DOCS_DIR,
}


def _sanitize_name(name: str) -> Path:
    """防路径穿越 — 仅允许 docs/ 下的 .md 文件。"""
    cleaned = name.replace("\\", "/").lstrip("/")
    if ".." in cleaned or cleaned.startswith("/"):
        raise HTTPException(status_code=400, detail="非法文档路径")

    doc_path = DOCS_DIR / cleaned
    # 必须解析后仍在 docs/ 目录下
    try:
        resolved = doc_path.resolve()
        if not str(resolved).startswith(str(DOCS_DIR.resolve())):
            raise HTTPException(status_code=403, detail="路径越界") from None
    except (ValueError, OSError):
        raise HTTPException(status_code=400, detail="无效路径") from None

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"文档不存在: {cleaned}")

    return resolved


@router.get("/health")
async def admin_health() -> dict[str, Any]:
    """工程健康指标 — check-docs JSON 输出 + git log 摘要。

    调用 tools/check_docs.py --json 获取结构化数据。
    """
    check_docs = TOOLS_DIR / "check_docs.py"
    if not check_docs.exists():
        return {"error": "check_docs.py 不存在", "timestamp": date.today().isoformat()}

    try:
        result = subprocess.run(
            [sys.executable, str(check_docs), "--json"],
            capture_output=True,
            text=True,
            cwd=PROJECT_ROOT,
            timeout=30,
            env={**os.environ, "PYTHONPATH": str(PROJECT_ROOT)},
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)  # type: ignore[no-any-return]
        # 即使 check-docs 有硬阻断，仍返回 JSON（前端展示用）
        if result.stdout.strip():
            return json.loads(result.stdout)  # type: ignore[no-any-return]
        return {
            "error": "check_docs.py 无输出",
            "stderr": result.stderr[:500],
            "timestamp": date.today().isoformat(),
        }
    except subprocess.TimeoutExpired:
        return {"error": "check_docs.py 超时", "timestamp": date.today().isoformat()}
    except json.JSONDecodeError:
        return {
            "error": "check_docs.py JSON 解析失败",
            "raw": result.stdout[:1000] if "result" in dir() else "",
            "timestamp": date.today().isoformat(),
        }


@router.get("/docs")
async def list_docs() -> list[dict[str, object]]:
    """文档清单 — docs/ 下所有 .md 文件的元数据。

    按分组归类（核心文档/经验库/治理/参考/日报/归档）。
    """
    items: list[dict[str, object]] = []

    # ── 顶级文档 ──
    for f in sorted(DOCS_DIR.glob("*.md")):
        stat = f.stat()
        items.append(
            {
                "name": f.name,
                "path": f"docs/{f.name}",
                "group": _classify_group(f.name),
                "size_bytes": stat.st_size,
                "mtime": date.fromtimestamp(stat.st_mtime).isoformat(),
                "lines": _count_lines(f),
            }
        )

    # ── 日报 ──
    daily_dir = DOCS_DIR / "daily"
    if daily_dir.exists():
        daily_files: list[dict[str, object]] = []
        for f in sorted(daily_dir.glob("*.md"), reverse=True):
            stat = f.stat()
            daily_files.append(
                {
                    "name": f.name,
                    "path": f"docs/daily/{f.name}",
                    "group": "日报",
                    "size_bytes": stat.st_size,
                    "mtime": date.fromtimestamp(stat.st_mtime).isoformat(),
                    "lines": _count_lines(f),
                }
            )
        # 日报作为子列表，方便前端按月份折叠
        daily_entry: dict[str, object] = {
            "name": "开发日报",
            "path": "docs/daily/",
            "group": "日报",
            "is_directory": True,
            "count": len(daily_files),
            "children": daily_files,
        }
        items.append(daily_entry)

    # ── 归档 ──
    archive_dir = DOCS_DIR / "archive"
    if archive_dir.exists():
        archive_files: list[dict[str, object]] = []
        for f in sorted(archive_dir.glob("*.md")):
            stat = f.stat()
            archive_files.append(
                {
                    "name": f.name,
                    "path": f"docs/archive/{f.name}",
                    "group": "归档",
                    "size_bytes": stat.st_size,
                    "mtime": date.fromtimestamp(stat.st_mtime).isoformat(),
                    "lines": _count_lines(f),
                }
            )
        if archive_files:
            items.append(
                {
                    "name": "Phase 历史需求日志",
                    "path": "docs/archive/",
                    "group": "归档",
                    "is_directory": True,
                    "count": len(archive_files),
                    "children": archive_files,
                }
            )

    return items


@router.get("/docs/{name:path}")
async def get_doc(name: str) -> dict[str, object]:
    """获取单个文档的 Markdown 原始内容。

    *name* 为 docs/ 下的相对路径（如 "architecture.md" 或 "daily/2026-08-07.md"）。
    """
    doc_path = _sanitize_name(name)
    try:
        content = doc_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        raise HTTPException(status_code=500, detail="文档无法读取") from None

    return {
        "name": doc_path.name,
        "path": f"docs/{name}",
        "content": content,
        "lines": content.count("\n") + 1,
    }


# ═══════════════════════════════════════════════════════════════════
# helpers
# ═══════════════════════════════════════════════════════════════════

# ── 文档分组规则 ──
_GROUP_MAP: dict[str, str] = {
    "architecture.md": "核心文档",
    "methodology.md": "核心文档",
    "requirements-log.md": "核心文档",
    "roadmap.md": "核心文档",
    "lessons-learned.md": "经验库",
    "pitfalls.md": "经验库",
    "violations.md": "经验库",
    "master-backlog.md": "治理看板",
    "ci-cd.md": "治理看板",
    "core_issues.md": "治理看板",
    "model-comparison.md": "参考手册",
    "research-strategy.md": "参考手册",
    "ui-ux-patterns.md": "参考手册",
    "desensitization-classification.md": "参考手册",
    "ONBOARDING.md": "核心文档",
}


def _classify_group(filename: str) -> str:
    return _GROUP_MAP.get(filename, "其他")


def _count_lines(path: Path) -> int:
    """Count lines in a text file."""
    try:
        return path.read_text(encoding="utf-8").count("\n") + 1
    except (OSError, UnicodeDecodeError):
        return 0
