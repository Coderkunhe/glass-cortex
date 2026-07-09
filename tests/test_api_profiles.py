"""API tests — /profiles endpoints (list, create, delete, switch)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from api.main import app

from .helpers import build_mock_engines, make_client


class TestProfiles:
    """Profile management endpoints."""

    def test_list_profiles_empty(self, tmp_path: Path) -> None:
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        with make_client(data_dir=str(data_dir)) as client:
            resp = client.get("/profiles")
            assert resp.status_code == 200
            data = resp.json()
            assert data["profiles"] == []
            assert data["current"] == "default"

    def test_list_profiles_multiple(self, tmp_path: Path) -> None:
        data_dir = tmp_path / "data"
        alice_dir = data_dir / "alice"
        bob_dir = data_dir / "bob"
        alice_dir.mkdir(parents=True)
        bob_dir.mkdir(parents=True)
        (alice_dir / "memory.db").write_text("")
        (alice_dir / "index.usearch").write_text("")
        (bob_dir / "memory.db").write_text("")

        with make_client(data_dir=str(data_dir)) as client:
            resp = client.get("/profiles")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["profiles"]) == 2
            names = [p["name"] for p in data["profiles"]]
            assert "alice" in names
            assert "bob" in names

            alice = [p for p in data["profiles"] if p["name"] == "alice"][0]
            assert alice["has_index"] is True
            bob = [p for p in data["profiles"] if p["name"] == "bob"][0]
            assert bob["has_index"] is False

    def test_current_profile_metadata(self) -> None:
        store = MagicMock()
        store.get_all_episodes.return_value = [{"id": 1}, {"id": 2}]
        store.get_all_facts.return_value = [{"id": 1}]

        idx = MagicMock()
        idx.index.size = 42

        engines = build_mock_engines(store=store, idx=idx)
        with make_client(engines) as client:
            resp = client.get("/profiles/current")
            assert resp.status_code == 200
            data = resp.json()
            assert data["name"] == "default"
            assert data["episode_count"] == 2
            assert data["fact_count"] == 1
            assert data["index_vectors"] == 42

    def test_create_profile_success(self) -> None:
        with make_client(data_dir="/tmp/glassmind-test") as client:
            resp = client.post("/profiles/test123")
            assert resp.status_code == 201
            data = resp.json()
            assert data["name"] == "test123"
            assert data["db_size_bytes"] == 0
            assert data["has_index"] is True
            assert data["episode_count"] == 0

    def test_create_profile_already_exists(self, tmp_path: Path) -> None:
        data_dir = tmp_path / "data"
        existing = data_dir / "test456"
        existing.mkdir(parents=True)

        with make_client(data_dir=str(data_dir)) as client:
            resp = client.post("/profiles/test456")
            assert resp.status_code == 409
            data = resp.json()
            assert "already exists" in data["detail"]

    def test_delete_profile_not_current(self, tmp_path: Path) -> None:
        data_dir = tmp_path / "data"
        alice_dir = data_dir / "alice"
        alice_dir.mkdir(parents=True)
        (alice_dir / "memory.db").write_text("test data")

        with make_client(data_dir=str(data_dir), user_profile="default") as client:
            resp = client.delete("/profiles/alice")
            assert resp.status_code == 204
            assert not alice_dir.exists()

    def test_delete_profile_is_current(self) -> None:
        with make_client(user_profile="default") as client:
            resp = client.delete("/profiles/default")
            assert resp.status_code == 409
            data = resp.json()
            assert "不能删除" in data["detail"]

    def test_delete_profile_not_found(self, tmp_path: Path) -> None:
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        with make_client(data_dir=str(data_dir)) as client:
            resp = client.delete("/profiles/nonexistent")
            assert resp.status_code == 404
            data = resp.json()
            assert "not found" in data["detail"]

    def test_switch_profile_already_active(self) -> None:
        with make_client(user_profile="default") as client:
            resp = client.post(
                "/profiles/switch",
                json={"name": "default"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "already_active"
            assert data["profile"] == "default"

    def test_switch_profile_success(self) -> None:
        """Switching to a different profile re-inits engines and updates state."""
        store = MagicMock()
        idx = MagicMock()
        idx.index = MagicMock()

        old_engines = build_mock_engines(store=store, idx=idx)
        new_engines = build_mock_engines()

        with make_client(
            engines=old_engines,
            user_profile="default",
        ) as client:
            with patch("src.bootstrap.init_engines", return_value=new_engines) as mock_init:
                resp = client.post(
                    "/profiles/switch",
                    json={"name": "alice"},
                )
                assert resp.status_code == 200
                data = resp.json()
                assert data["status"] == "switched"
                assert data["profile"] == "alice"
                mock_init.assert_called_once()

                assert app.state.engines is new_engines
                assert app.state.store is new_engines[0]

    def test_switch_profile_updates_app_state(self) -> None:
        """After switch, app.state reflects the new profile."""
        store = MagicMock()
        idx = MagicMock()
        idx.index = MagicMock()
        old_engines = build_mock_engines(store=store, idx=idx)
        new_engines = build_mock_engines()

        with make_client(
            engines=old_engines,
            user_profile="default",
        ) as client:
            with patch("src.bootstrap.init_engines", return_value=new_engines):
                client.post("/profiles/switch", json={"name": "alice"})

            assert app.state.settings.user_profile == "alice"
