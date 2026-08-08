"""API tests — GET /admin/search — 文档全文搜索端点。"""

from __future__ import annotations

from .helpers import make_client


class TestAdminSearch:
    """GET /admin/search?q= — 文档正文全文检索。"""

    def test_search_empty_query_returns_empty(self) -> None:
        """空查询返回空列表。"""
        with make_client() as client:
            resp = client.get("/admin/search")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_search_with_query_returns_matches(self) -> None:
        """有匹配关键词时返回带 snippet 的结果列表。"""
        with make_client() as client:
            # "架构" 是 project docs 中的常见词
            resp = client.get("/admin/search?q=架构")
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) > 0, "应在至少一个文档中找到'架构'"

            # 验证结果结构
            first = data[0]
            assert "path" in first
            assert "name" in first
            assert "group" in first
            assert "snippet" in first
            assert "match_count" in first
            assert int(first["match_count"]) > 0

            # architecture.md 是核心文档，应排在前面
            arch_result = next((r for r in data if r["name"] == "architecture.md"), None)
            assert arch_result is not None, "architecture.md 应出现在搜索结果中"
            assert arch_result["group"] == "核心文档"

    def test_search_no_match_returns_empty(self) -> None:
        """无匹配关键词返回空列表。"""
        with make_client() as client:
            resp = client.get("/admin/search?q=zzz_nonexistent_xyz_12345")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_search_results_sorted_by_match_count(self) -> None:
        """结果按匹配行数降序排列。"""
        with make_client() as client:
            resp = client.get("/admin/search?q=的")
            assert resp.status_code == 200
            data = resp.json()

            if len(data) < 2:
                return  # 不够两个结果，跳过排序测试

            counts = [int(r["match_count"]) for r in data]
            assert counts == sorted(counts, reverse=True), f"match_count 应降序排列，实际: {counts}"

    def test_search_snippet_not_empty(self) -> None:
        """snippet 字段包含匹配行的上下文文本。"""
        with make_client() as client:
            resp = client.get("/admin/search?q=架构")
            assert resp.status_code == 200
            data = resp.json()

            for r in data:
                assert len(str(r["snippet"])) > 0, f"snippet 不应为空: {r['path']}"
