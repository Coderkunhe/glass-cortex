"""Tests for Phase 8 Batch 25: User Profile Isolation."""

from __future__ import annotations

from pathlib import Path

from src.config import Settings
from src.embed import embed


class TestProfileSanitizeName:
    """Profile name sanitization edge cases."""

    def test_sanitize_normal_name(self) -> None:
        assert Settings.sanitize_profile_name("alice") == "alice"

    def test_sanitize_special_chars(self) -> None:
        assert Settings.sanitize_profile_name("alice/bob") == "alice_bob"
        assert Settings.sanitize_profile_name("test@home") == "test_home"
        assert Settings.sanitize_profile_name("name with spaces") == "name_with_spaces"

    def test_sanitize_trailing_dash(self) -> None:
        assert Settings.sanitize_profile_name("test-") == "test"

    def test_sanitize_multiple_underscores(self) -> None:
        assert Settings.sanitize_profile_name("a///b") == "a_b"

    def test_sanitize_empty_returns_default(self) -> None:
        assert Settings.sanitize_profile_name("") == "default"
        assert Settings.sanitize_profile_name("   ") == "default"

    def test_sanitize_dots_returns_default(self) -> None:
        assert Settings.sanitize_profile_name("..") == "default"
        assert Settings.sanitize_profile_name(".") == "default"

    def test_sanitize_end_underscore(self) -> None:
        assert Settings.sanitize_profile_name("name_") == "name"


class TestProfileResolvedPaths:
    """Profile-aware path resolution."""

    def test_default_profile_resolves_to_default_subdir(self) -> None:
        s = Settings()
        assert s.profile_data_dir == Path("data") / "default"
        assert s.resolved_db_path == Path("data") / "default" / "memory.db"
        assert s.resolved_index_path == Path("data") / "default" / "index.faiss"

    def test_custom_profile_resolves_to_profile_subdir(self) -> None:
        s = Settings.from_flat(user_profile="alice")
        assert s.profile_data_dir == Path("data") / "alice"
        assert s.resolved_db_path == Path("data") / "alice" / "memory.db"

    def test_explicit_db_path_overrides_profile(self) -> None:
        s = Settings.from_flat(user_profile="alice", db_path=Path("/tmp/custom.db"))
        assert s.resolved_db_path == Path("/tmp/custom.db")
        assert s.profile_data_dir == Path("data") / "alice"

    def test_two_profiles_have_different_paths(self) -> None:
        a = Settings.from_flat(user_profile="alice")
        b = Settings.from_flat(user_profile="bob")
        assert a.resolved_db_path != b.resolved_db_path
        assert a.resolved_index_path != b.resolved_index_path


class TestMigration:
    """Legacy flat data migration."""

    @staticmethod
    def _touch(path: Path, content: str = "data") -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def test_migration_moves_legacy_files(self, tmp_path: Path) -> None:
        from src.bootstrap import _migrate_legacy_flat_data

        legacy_db = self._touch(tmp_path / "memory.db")
        legacy_idx = self._touch(tmp_path / "index.faiss")
        profile_dir = tmp_path / "default"

        _migrate_legacy_flat_data(tmp_path, profile_dir)

        assert not legacy_db.exists()
        assert not legacy_idx.exists()
        assert (profile_dir / "memory.db").exists()
        assert (profile_dir / "index.faiss").exists()

    def test_migration_noop_when_no_legacy(self, tmp_path: Path) -> None:
        from src.bootstrap import _migrate_legacy_flat_data

        profile_dir = tmp_path / "default"
        _migrate_legacy_flat_data(tmp_path, profile_dir)
        assert not profile_dir.exists()

    def test_migration_noop_when_already_migrated(self, tmp_path: Path) -> None:
        from src.bootstrap import _migrate_legacy_flat_data

        legacy_db = self._touch(tmp_path / "memory.db", "old")
        profile_dir = tmp_path / "default"
        self._touch(profile_dir / "memory.db", "new")

        _migrate_legacy_flat_data(tmp_path, profile_dir)

        assert legacy_db.exists()
        assert (profile_dir / "memory.db").read_text() == "new"

    def test_migration_idempotent(self, tmp_path: Path) -> None:
        from src.bootstrap import _migrate_legacy_flat_data

        self._touch(tmp_path / "memory.db", "data")
        profile_dir = tmp_path / "default"

        _migrate_legacy_flat_data(tmp_path, profile_dir)
        _migrate_legacy_flat_data(tmp_path, profile_dir)

        assert (profile_dir / "memory.db").exists()
        assert (profile_dir / "memory.db").read_text() == "data"


class TestProfileInitEngines:
    """Integration: init_engines with profile isolation."""

    def test_init_engines_creates_profile_specific_db(self, tmp_path: Path) -> None:
        from src.bootstrap import init_engines

        s = Settings.from_flat(data_dir=tmp_path, user_profile="test-profile")
        engines = init_engines(settings_override=s)
        store, idx, _, _, _, _, _ = engines
        try:
            expected_db = tmp_path / "test-profile" / "memory.db"
            assert expected_db.exists()
            eid = store.add_episode("profile test content")
            assert eid > 0
            assert len(store.get_all_episodes()) == 1
        finally:
            idx.save(str(s.resolved_index_path))
            store.close()

    def test_two_profiles_have_independent_data(self, tmp_path: Path) -> None:
        from src.bootstrap import init_engines

        # Add data to Alice
        s_a = Settings.from_flat(data_dir=tmp_path, user_profile="alice")
        engines_a = init_engines(settings_override=s_a)
        store_a, idx_a, _, _, _, _, _ = engines_a

        vec = embed("alice's memory")
        store_a.add_episode("alice's memory", faiss_id=idx_a.add(vec.reshape(1, -1))[0])
        idx_a.save(str(s_a.resolved_index_path))
        store_a.close()

        # Bob opens — should see zero episodes
        s_b = Settings.from_flat(data_dir=tmp_path, user_profile="bob")
        engines_b = init_engines(settings_override=s_b)
        store_b, idx_b, _, _, _, _, _ = engines_b
        try:
            eps = store_b.get_all_episodes()
            assert len(eps) == 0
        finally:
            idx_b.save(str(s_b.resolved_index_path))
            store_b.close()

    def test_profile_paths_are_wired_correctly(self, tmp_path: Path) -> None:
        from src.bootstrap import init_engines

        s = Settings.from_flat(data_dir=tmp_path, user_profile="integration-test")
        engines = init_engines(settings_override=s)
        store, idx, _, _, _, _, _ = engines
        try:
            assert s.resolved_db_path == tmp_path / "integration-test" / "memory.db"
            assert s.resolved_index_path == tmp_path / "integration-test" / "index.faiss"
        finally:
            idx.save(str(s.resolved_index_path))
            store.close()
