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
            encoding="utf-8",
            cwd=PROJECT_ROOT,
            timeout=30,
            env={**os.environ, "PYTHONPATH": str(PROJECT_ROOT)},
        )
        stdout = result.stdout or ""
        if result.returncode == 0 and stdout.strip():
            return json.loads(stdout)  # type: ignore[no-any-return]
        # 即使 check-docs 有硬阻断，仍返回 JSON（前端展示用）
        if stdout.strip():
            return json.loads(stdout)  # type: ignore[no-any-return]
        return {
            "error": "check_docs.py 无输出",
            "stderr": (result.stderr or "")[:500],
            "timestamp": date.today().isoformat(),
        }
    except subprocess.TimeoutExpired:
        return {"error": "check_docs.py 超时", "timestamp": date.today().isoformat()}
    except json.JSONDecodeError:
        raw_output = (result.stdout or "")[:1000] if "result" in dir() else ""
        return {
            "error": "check_docs.py JSON 解析失败",
            "raw": raw_output,
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
                "summary": _DOC_DESCRIPTIONS.get(f.name, ""),
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
                    "summary": _DOC_DESCRIPTIONS.get(f.name, ""),
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
                    "group": "需求日志",
                    "size_bytes": stat.st_size,
                    "mtime": date.fromtimestamp(stat.st_mtime).isoformat(),
                    "lines": _count_lines(f),
                    "summary": _DOC_DESCRIPTIONS.get(f.name, ""),
                }
            )
        if archive_files:
            items.append(
                {
                    "name": "历史需求日志",
                    "path": "docs/archive/",
                    "group": "需求日志",
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


@router.get("/search")
async def search_docs(q: str = "") -> list[dict[str, object]]:
    """全局文档全文搜索。

    遍历 docs/ 下所有 .md 文件（含 daily/、archive/ 子目录），对正文做
    大小写不敏感全文匹配。按匹配行数降序排列，返回 snippet（首条匹配行
    ± 前后一行上下文，最长 300 字符）。

    设计意图：补充前端 Cmd+K SearchModal 的客户端 Fuse.js 搜索——Fuse 仅搜
    文档名 + 摘要，此端点提供正文级全文检索。
    """
    query = q.strip()
    if not query:
        return []

    query_lower = query.lower()
    results: list[dict[str, object]] = []

    # 收集所有 .md 文件（遍历 docs/ 目录树）
    all_files: list[tuple[Path, str]] = []  # (Path, rel_path)
    for dirpath, dirnames, filenames in os.walk(DOCS_DIR):
        # 跳过隐藏目录
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fname in filenames:
            if fname.endswith(".md"):
                fp = Path(dirpath) / fname
                rel = str(fp.relative_to(PROJECT_ROOT))
                all_files.append((fp, rel))

    for filepath, rel_path in all_files:
        try:
            content = filepath.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        lines_list = content.split("\n")
        matched_indices: list[int] = []

        for i, line in enumerate(lines_list):
            if query_lower in line.lower():
                matched_indices.append(i)

        if not matched_indices:
            continue

        # snippet：首条匹配行 ± 1 行上下文
        first = matched_indices[0]
        ctx_start = max(0, first - 1)
        ctx_end = min(len(lines_list), first + 2)
        snippet = "\n".join(lines_list[ctx_start:ctx_end]).strip()
        if len(snippet) > 300:
            snippet = snippet[:297] + "..."

        results.append(
            {
                "path": rel_path,
                "name": filepath.name,
                "group": _classify_path(rel_path, filepath.name),
                "summary": _DOC_DESCRIPTIONS.get(filepath.name, ""),
                "snippet": snippet,
                "match_count": len(matched_indices),
            }
        )

    # 按匹配行数降序
    results.sort(key=lambda r: -int(str(r["match_count"])))

    return results


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


def _classify_path(rel_path: str, filename: str) -> str:
    """根据文件路径判定分组（含子目录覆盖）。"""
    if "/daily/" in rel_path or rel_path.startswith("docs/daily/"):
        return "日报"
    if "/archive/" in rel_path or rel_path.startswith("docs/archive/"):
        return "需求日志"
    return _classify_group(filename)


def _count_lines(path: Path) -> int:
    """Count lines in a text file."""
    try:
        return path.read_text(encoding="utf-8").count("\n") + 1
    except (OSError, UnicodeDecodeError):
        return 0


# ── 文档说明（手写描述，非内容提取） ──
_DOC_DESCRIPTIONS: dict[str, str] = {
    "architecture.md": (
        "系统架构全景图 — 组件依赖关系、ADR 决策记录、技术选型理由与实现现状追踪。"
    ),
    "methodology.md": (
        "AI 辅助开发工作流方法论 — Batch 生命周期、五层自检金字塔、"
        "违纪闭环机制、上下文管理策略。可迁移至其他 AI 协作项目。"
    ),
    "requirements-log.md": (
        "需求变更链路追踪 — 每条需求的提出背景、实现方案、验证方式与批次归档，全生命周期可审计。"
    ),
    "roadmap.md": (
        "产品路线图 — 按 Phase 组织的功能规划、执行状态与里程碑，从 MVP 到远期愿景的递进路径。"
    ),
    "lessons-learned.md": (
        "可迁移通用经验库 — 跨项目复用的踩坑教训、反模式识别与最佳实践，含机械防呆转化追踪。"
    ),
    "pitfalls.md": (
        "问题诊断手册 — 具体问题 → 根因分析 → 解决方案的完整链路，避免同类问题重复踩坑。"
    ),
    "violations.md": (
        "违纪追踪面板 — 工程铁律违规记录、触发频次统计与闭环状态机，保障流程纪律可执行。"
    ),
    "master-backlog.md": (
        "待办事项总表 —「发现即待办」条目、优先级排序、复杂度评估与来源批次追踪。"
    ),
    "ci-cd.md": ("CI/CD 流水线文档 — 自动化门禁配置、部署流程、环境管理与发布 checklist。"),
    "core_issues.md": (
        "核心问题追踪 — 项目关键阻塞问题、讨论记录与解决进展，团队对齐的单一真相源。"
    ),
    "model-comparison.md": (
        "模型能力对比追踪 — 不同 LLM 在项目场景下的性能、成本与适用性评估，选型决策的唯一参考。"
    ),
    "research-strategy.md": (
        "四支柱研究全景 — 研究命题定义、实验设计、数据采集与策略调整方向，驱动认知层持续演进。"
    ),
    "ui-ux-patterns.md": (
        "UI/UX 通用模式手册 — 项目级设计模式、组件契约、交互态规范与可复用代码片段。"
    ),
    "desensitization-classification.md": (
        "敏感信息分类与脱敏标准 — PII 识别规则、脱敏策略与合规要求，保障数据处理安全性。"
    ),
    "ONBOARDING.md": (
        "新人导览文档 — 项目名片、功能全景、技术地图、协作方式与快速上手指南，一小时了解全貌。"
    ),
}
