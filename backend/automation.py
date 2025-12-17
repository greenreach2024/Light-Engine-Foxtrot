"""Automation engine that reacts to MQTT sensor events and schedules."""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Dict, List

from .device_models import Schedule, SensorEvent, UserContext
from .lighting import LightingController
from .state import ScheduleStore

LOGGER = logging.getLogger(__name__)

AutomationRule = Callable[[SensorEvent, LightingController], Awaitable[None]]


class AutomationEngine:
    """Simple event-driven automation engine."""

    def __init__(self, controller: LightingController, schedule_store: ScheduleStore) -> None:
        self._controller = controller
        self._schedule_store = schedule_store
        self._rules: List[AutomationRule] = []
        self._queue: "asyncio.Queue[SensorEvent]" = asyncio.Queue()
        self._running = False

    def register_rule(self, rule: AutomationRule) -> None:
        LOGGER.debug("Registering automation rule %s", rule)
        self._rules.append(rule)

    async def publish(self, event: SensorEvent) -> None:
        await self._queue.put(event)

    async def start(self) -> None:
        LOGGER.info("Starting automation engine")
        self._running = True
        while self._running:
            event = await self._queue.get()
            await self._dispatch(event)

    async def stop(self) -> None:
        LOGGER.info("Stopping automation engine")
        self._running = False

    async def _dispatch(self, event: SensorEvent) -> None:
        for rule in self._rules:
            try:
                await rule(event, self._controller)
            except Exception as exc:  # pylint: disable=broad-except
                LOGGER.error("Automation rule %s failed: %s", rule, exc)

    def apply_schedule(self, schedule: Schedule, user: UserContext) -> None:
        if not user.can_access_group(schedule.group):
            raise PermissionError(f"User {user.user_id} cannot access group {schedule.group}")
        LOGGER.info("Applying schedule %s for group %s", schedule.name, schedule.group)
        self._schedule_store.upsert(schedule)
        try:
            self._controller.set_output(schedule.group, schedule.brightness, schedule.spectrum)
        except ValueError:
            LOGGER.warning("Schedule %s references unknown fixture %s", schedule.schedule_id, schedule.group)

    def enforce_fail_safe(self) -> None:
        LOGGER.info("Enforcing lighting fail-safe defaults")
        self._controller.apply_safe_defaults()


def lux_balancing_rule(zone_to_fixture: Dict[str, str], target_lux: int) -> AutomationRule:
    """Create a rule that adjusts lighting based on lux sensor events."""

    async def rule(event: SensorEvent, controller: LightingController) -> None:
        if event.payload.get("measurement") != "illuminance":
            return
        zone = event.payload.get("zone")
        if zone not in zone_to_fixture:
            return
        fixture_address = zone_to_fixture[zone]
        current_lux = event.payload.get("value")
        if current_lux is None:
            return
        delta = target_lux - int(current_lux)
        state = controller.last_known_state(fixture_address) or {"brightness": 0, "spectrum": None}
        new_brightness = max(0, min(100, state.get("brightness", 0) + int(delta * 0.1)))
        LOGGER.debug("Lux rule adjusting %s to %s based on delta %s", fixture_address, new_brightness, delta)
        controller.set_output(fixture_address, new_brightness, state.get("spectrum"))

    return rule


def occupancy_rule(zone_to_fixture: Dict[str, str], occupied_brightness: int, vacant_brightness: int) -> AutomationRule:
    """Create a rule that reacts to occupancy events."""

    async def rule(event: SensorEvent, controller: LightingController) -> None:
        if event.payload.get("measurement") != "occupancy":
            return
        zone = event.payload.get("zone")
        if zone not in zone_to_fixture:
            return
        fixture_address = zone_to_fixture[zone]
        occupied = bool(event.payload.get("value"))
        target_brightness = occupied_brightness if occupied else vacant_brightness
        LOGGER.debug("Occupancy rule setting %s to %s", fixture_address, target_brightness)
        controller.set_output(fixture_address, target_brightness)

    return rule


__all__ = [
    "AutomationEngine",
    "lux_balancing_rule",
    "occupancy_rule",
]
