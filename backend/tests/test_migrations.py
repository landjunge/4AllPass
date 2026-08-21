import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent

MIGRATIONS_TEST_DATABASE_URL = os.environ.get("FOURALLPASS_MIGRATIONS_TEST_DATABASE_URL", "")


def _run_alembic(*args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "FOURALLPASS_DATABASE_URL": MIGRATIONS_TEST_DATABASE_URL}
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


@pytest.mark.skipif(
    not MIGRATIONS_TEST_DATABASE_URL.startswith("postgresql"),
    reason="migration round-trip is Postgres-only; SQLite uses create_all",
)
def test_migrations_upgrade_downgrade_upgrade_round_trip_and_no_drift():
    upgrade = _run_alembic("upgrade", "head")
    assert upgrade.returncode == 0, upgrade.stdout + upgrade.stderr

    downgrade = _run_alembic("downgrade", "base")
    assert downgrade.returncode == 0, downgrade.stdout + downgrade.stderr

    upgrade_again = _run_alembic("upgrade", "head")
    assert upgrade_again.returncode == 0, upgrade_again.stdout + upgrade_again.stderr

    check = _run_alembic("check")
    assert check.returncode == 0, check.stdout + check.stderr

    cleanup = _run_alembic("downgrade", "base")
    assert cleanup.returncode == 0, cleanup.stdout + cleanup.stderr
