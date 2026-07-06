"""Tests for bootstrap.wipe_profile_data — one-click reset."""

from __future__ import annotations

import tempfile
from pathlib import Path

from src.bootstrap import init_engines, wipe_profile_data
from src.config import Settings


class TestWipeProfileData:
    """wipe_profile_data deletes memory.db + index.faiss for a given profile."""

    def test_wipe_deletes_db_and_index(self) -> None:
        td = Path(tempfile.mkdtemp())
        try:
            s = Settings.from_flat(data_dir=td, user_profile="test_wipe")
            store, idx, *_ = init_engines(settings_override=s)

            # Write some data so files exist
            store.add_episode("hello world", faiss_id=0)
            idx.save(str(s.resolved_index_path))
            store.close()

            db_path = s.resolved_db_path
            idx_path = s.resolved_index_path
            assert db_path.exists()
            assert idx_path.exists()

            wipe_profile_data(s)

            assert not db_path.exists()
            assert not idx_path.exists()
        finally:
            import shutil

            shutil.rmtree(str(td), ignore_errors=True)

    def test_wipe_idempotent(self) -> None:
        """Wiping an already-empty profile does not raise."""
        td = Path(tempfile.mkdtemp())
        try:
            s = Settings.from_flat(data_dir=td, user_profile="test_wipe_empty")
            td.mkdir(parents=True, exist_ok=True)

            # First wipe — no files yet
            wipe_profile_data(s)
            # Second wipe — still no files
            wipe_profile_data(s)
        finally:
            import shutil

            shutil.rmtree(str(td), ignore_errors=True)

    def test_wipe_then_reinit(self) -> None:
        """After wipe, re-init gives a clean empty engine."""
        td = Path(tempfile.mkdtemp())
        try:
            s = Settings.from_flat(data_dir=td, user_profile="test_wipe_reinit")
            store, idx, *_ = init_engines(settings_override=s)
            store.add_episode("some memory", faiss_id=1)
            store.close()

            wipe_profile_data(s)

            store2, idx2, *_ = init_engines(settings_override=s)
            episodes = store2.get_all_episodes()
            assert len(episodes) == 0
            assert idx2.index.ntotal == 0
            store2.close()
        finally:
            import shutil

            shutil.rmtree(str(td), ignore_errors=True)

    def test_wipe_uses_current_settings_when_none(self) -> None:
        """wipe_profile_data(None) resolves to module-level settings."""
        td = Path(tempfile.mkdtemp())
        try:
            import src.config as config_module

            old = config_module.settings
            try:
                s = Settings.from_flat(data_dir=td, user_profile="test_wipe_default")
                config_module.settings = s
                store, idx, *_ = init_engines(settings_override=s)
                store.add_episode("data", faiss_id=0)
                idx.save(str(s.resolved_index_path))
                store.close()

                wipe_profile_data()

                assert not s.resolved_db_path.exists()
                assert not s.resolved_index_path.exists()
            finally:
                config_module.settings = old
        finally:
            import shutil

            shutil.rmtree(str(td), ignore_errors=True)
