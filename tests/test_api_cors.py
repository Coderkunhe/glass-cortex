"""API tests — CORS middleware headers."""

from __future__ import annotations

from .helpers import make_client


class TestCorsHeaders:
    """CORS middleware headers."""

    def test_cors_headers_present(self) -> None:
        """CORS middleware echoes back the Origin header."""
        with make_client() as client:
            resp = client.get("/", headers={"Origin": "http://localhost:3000"})
            assert resp.status_code == 200
            assert "access-control-allow-origin" in resp.headers

    def test_cors_preflight(self) -> None:
        """OPTIONS preflight returns allow-origin and allow-methods."""
        with make_client() as client:
            resp = client.options(
                "/health",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "GET",
                },
            )
            assert resp.status_code == 200
            assert resp.headers.get("access-control-allow-origin") is not None
            assert resp.headers.get("access-control-allow-methods") is not None

    def test_cors_preflight_post(self) -> None:
        """OPTIONS preflight with POST method returns CORS headers."""
        with make_client() as client:
            resp = client.options(
                "/health",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "POST",
                },
            )
            assert resp.status_code == 200
            assert "access-control-allow-origin" in resp.headers
            assert "access-control-allow-methods" in resp.headers

    def test_cors_no_origin_header(self) -> None:
        """Request without Origin header still succeeds (CORS headers optional)."""
        with make_client() as client:
            resp = client.get("/")
            assert resp.status_code == 200

    def test_cors_preflight_custom_headers(self) -> None:
        """OPTIONS preflight with custom request headers returns allow-headers."""
        with make_client() as client:
            resp = client.options(
                "/health",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "X-Profile, Content-Type",
                },
            )
            assert resp.status_code == 200
            assert "access-control-allow-origin" in resp.headers

    def test_cors_on_different_route(self) -> None:
        """CORS headers present on /docs route (middleware applied globally)."""
        with make_client() as client:
            resp = client.get("/docs", headers={"Origin": "http://localhost:3000"})
            assert resp.status_code == 200
            assert "access-control-allow-origin" in resp.headers
