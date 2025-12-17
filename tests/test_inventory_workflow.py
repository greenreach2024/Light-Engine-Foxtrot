from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.server import app
from backend.models.base import Base, engine, SessionLocal
from backend.models.inventory import TrayPlacement
from backend.state import PlanStore


@pytest.fixture(autouse=True)
def reset_inventory_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _bootstrap_hierarchy(client: TestClient):
    farm_id = client.post("/api/farms", json={"name": "Test Farm"}).json()["farmId"]
    room_id = client.post("/api/rooms", json={"name": "Room 1", "farmId": farm_id}).json()["roomId"]
    zone_id = client.post("/api/zones", json={"name": "Zone A", "roomId": room_id}).json()["zoneId"]
    group_id = client.post("/api/groups", json={"name": "Group Alpha", "zoneId": zone_id}).json()["groupId"]
    return farm_id, group_id


def _create_tray_and_run(client: TestClient, recipe_id: str = "romaine"):
    format_id = client.post(
        "/api/tray-formats",
        json={"name": "128 Cell", "plantSiteCount": 128},
    ).json()["trayFormatId"]
    tray_id = client.post(
        "/api/trays/register",
        json={"qrCodeValue": "TRAY-001", "trayFormatId": format_id},
    ).json()["trayId"]
    seed_date = date.today()
    tray_run = client.post(
        f"/api/trays/{tray_id}/seed",
        json={"recipeId": recipe_id, "seedDate": seed_date.isoformat()},
    ).json()
    return tray_id, tray_run, seed_date


def test_tray_registration(test_client: TestClient):
    format_resp = test_client.post(
        "/api/tray-formats", json={"name": "10x20", "plantSiteCount": 72}
    )
    assert format_resp.status_code == 200
    tray_format_id = format_resp.json()["trayFormatId"]

    register_resp = test_client.post(
        "/api/trays/register",
        json={"qrCodeValue": "QR-123", "trayFormatId": tray_format_id},
    )
    assert register_resp.status_code == 200
    payload = register_resp.json()
    assert payload["qrCodeValue"] == "QR-123"
    assert payload["trayFormatId"] == tray_format_id


def test_tray_run_expected_harvest(test_client: TestClient):
    # Initialize PLAN_STORE if not present
    if not hasattr(app.state, "PLAN_STORE") or app.state.PLAN_STORE is None:
        app.state.PLAN_STORE = PlanStore()
    
    app.state.PLAN_STORE.upsert_many({"romaine": {"name": "Romaine", "daysToHarvest": 28}})
    tray_id, tray_run, seed_date = _create_tray_and_run(test_client, recipe_id="romaine")
    expected = seed_date + timedelta(days=28)
    assert tray_run["expectedHarvestDate"] == expected.isoformat()


def test_placement_transition_closes_previous(test_client: TestClient):
    farm_id, group_id = _bootstrap_hierarchy(test_client)
    location_one = test_client.post(
        "/api/locations/register", json={"qrCodeValue": "LOC-1", "groupId": group_id}
    ).json()["locationId"]
    location_two = test_client.post(
        "/api/locations/register", json={"qrCodeValue": "LOC-2", "groupId": group_id}
    ).json()["locationId"]

    _, tray_run, _ = _create_tray_and_run(test_client)
    tray_run_id = tray_run["trayRunId"]

    first_place = test_client.post(
        f"/api/tray-runs/{tray_run_id}/place",
        json={"locationId": location_one},
    )
    assert first_place.status_code == 200

    second_place = test_client.post(
        f"/api/tray-runs/{tray_run_id}/place",
        json={"locationId": location_two},
    )
    assert second_place.status_code == 200

    with SessionLocal() as session:
        placements = (
            session.query(TrayPlacement)
            .filter(TrayPlacement.tray_run_id == tray_run_id)
            .order_by(TrayPlacement.placed_at)
            .all()
        )
        assert len(placements) == 2
        assert placements[0].removed_at is not None
        assert placements[1].removed_at is None


def test_inventory_rollup_counts_active_runs(test_client: TestClient):
    farm_id, group_id = _bootstrap_hierarchy(test_client)
    location_id = test_client.post(
        "/api/locations/register", json={"qrCodeValue": "LOC-ROLLUP", "groupId": group_id}
    ).json()["locationId"]

    _, tray_run, _ = _create_tray_and_run(test_client)
    tray_run_id = tray_run["trayRunId"]
    place_resp = test_client.post(
        f"/api/tray-runs/{tray_run_id}/place",
        json={"locationId": location_id},
    )
    assert place_resp.status_code == 200

    inventory = test_client.get(f"/api/inventory/current?farmId={farm_id}").json()
    assert inventory["totals"]["trays"] == 1
    assert inventory["rooms"][0]["zones"][0]["groups"][0]["totals"]["trays"] == 1

    forecast = test_client.get(f"/api/inventory/forecast?farmId={farm_id}&days=30").json()
    assert forecast["farmId"] == farm_id
    assert forecast["forecast"]
