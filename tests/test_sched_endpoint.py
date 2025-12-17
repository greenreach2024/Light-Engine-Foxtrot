import copy
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.server import GROUP_SCHEDULES, app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_group_schedule_store():
    GROUP_SCHEDULES.clear()
    yield
    GROUP_SCHEDULES.clear()


def make_payload(**overrides):
    base = {
        "deviceId": "group:LG-Z2-Lights",
        "planKey": "ScheduleA.CompactLeafy.v1",
        "seedDate": "2025-10-01",
        "override": {"mode": "off"},
        "schedule": {
            "type": "photoperiod",
            "start": "06:00",
            "durationHours": 16,
            "rampUpMin": 10,
            "rampDownMin": 10,
        },
        "offsets": {"ppfd": 50, "blue": 5},
    }
    payload = copy.deepcopy(base)
    for key, value in overrides.items():
        payload[key] = value
    return payload


def test_save_group_schedule_success():
    payload = make_payload()

    response = client.post("/sched", json=payload, headers={"X-User-Groups": "LG-Z2-Lights"})
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "ok"
    schedule = body["schedule"]
    assert schedule["deviceId"] == payload["deviceId"]
    assert schedule["planKey"] == payload["planKey"]
    assert schedule["seedDate"] == payload["seedDate"]
    assert schedule["schedule"]["start"] == payload["schedule"]["start"]
    assert schedule["schedule"]["durationHours"] == payload["schedule"]["durationHours"]
    assert schedule["offsets"]["ppfd"] == payload["offsets"]["ppfd"]
    assert "updatedAt" in schedule

    list_response = client.get("/sched", headers={"X-User-Groups": "LG-Z2-Lights"})
    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["status"] == "ok"
    assert len(listed["schedules"]) == 1
    assert listed["schedules"][0]["deviceId"] == payload["deviceId"]


def test_save_group_schedule_forbidden_without_group_membership():
    payload = make_payload()
    response = client.post("/sched", json=payload, headers={"X-User-Groups": "Propagation"})
    assert response.status_code == 403


def test_invalid_schedule_start_rejected():
    payload = make_payload()
    payload["schedule"]["start"] = "25:00"

    response = client.post("/sched", json=payload, headers={"X-User-Groups": "LG-Z2-Lights"})
    assert response.status_code == 422


def test_list_schedules_filters_inaccessible_groups():
    payload = make_payload()
    client.post("/sched", json=payload, headers={"X-User-Groups": "LG-Z2-Lights"})

    other_user_response = client.get("/sched", headers={"X-User-Groups": "Propagation"})
    assert other_user_response.status_code == 200
    body = other_user_response.json()
    assert body["status"] == "ok"
    assert body["schedules"] == []
