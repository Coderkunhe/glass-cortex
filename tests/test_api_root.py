"""API tests — GET / root endpoint."""

from __future__ import annotations

import re

from .helpers import make_client


class TestRoot:
    """GET / — service identity."""

    def test_root_returns_identity(self) -> None:
        with make_client() as client:
            resp = client.get("/")
            assert resp.status_code == 200
            data = resp.json()
            assert data["service"] == "glasscortex"
            assert data["status"] == "ok"
            assert "version" in data

    def test_root_rejects_post(self) -> None:
        """POST on / returns 405 Method Not Allowed."""
        with make_client() as client:
            resp = client.post("/")
            assert resp.status_code == 405

    def test_root_rejects_put(self) -> None:
        """PUT on / returns 405 Method Not Allowed."""
        with make_client() as client:
            resp = client.put("/")
            assert resp.status_code == 405

    def test_root_rejects_delete(self) -> None:
        """DELETE on / returns 405 Method Not Allowed."""
        with make_client() as client:
            resp = client.delete("/")
            assert resp.status_code == 405

    def test_root_content_type_is_json(self) -> None:
        """Response Content-Type includes application/json."""
        with make_client() as client:
            resp = client.get("/")
            assert "application/json" in resp.headers["content-type"]

    def test_root_version_is_semver(self) -> None:
        """Version field matches semver-like pattern (e.g. 0.1.0)."""
        with make_client() as client:
            data = client.get("/").json()
            assert re.match(r"^\d+\.\d+\.\d+", data["version"]), (
                f"version {data['version']!r} does not match semver pattern"
            )
