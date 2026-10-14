from django.apps import apps
from django.core.management import call_command
from django.db import connections


def test_health_reports_ok(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_runs_without_a_relational_database():
    assert connections["default"].settings_dict["ENGINE"] == "django.db.backends.dummy"
    for app in ("admin", "auth", "contenttypes", "sessions"):
        assert not apps.is_installed(f"django.contrib.{app}")
    call_command("check", fail_level="WARNING")
