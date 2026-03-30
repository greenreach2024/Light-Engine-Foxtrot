"""Lighting control helpers that honor on-site fixture capabilities."""
from __future__ import annotations

import logging
from typing import Dict, Iterable, Optional

from .config import LightingFixture
from .state import LightingState

LOGGER = logging.getLogger(__name__)


class LightingController:
    """Controller responsible for validating and applying light levels."""

    def __init__(self, fixtures: Iterable[LightingFixture], state: LightingState) -> None:
        self._fixtures: Dict[str, LightingFixture] = {fixture.address: fixture for fixture in fixtures}
        self._state = state

    def _clamp(self, fixture: LightingFixture, brightness: int, spectrum: Optional[int]) -> Dict[str, int]:
        clamped_brightness = max(fixture.min_brightness, min(brightness, fixture.max_brightness))
        clamped_spectrum = None
        if spectrum is not None:
            clamped_spectrum = max(fixture.spectrum_min, min(spectrum, fixture.spectrum_max))
        return {
            "brightness": clamped_brightness,
            "spectrum": clamped_spectrum,
        }

    def set_output(self, address: str, brightness: int, spectrum: Optional[int] = None) -> Dict[str, int]:
        fixture = self._fixtures.get(address)
        if not fixture:
            LOGGER.error("Attempt to control unknown fixture %s", address)
            raise ValueError(f"Unknown fixture {address}")

        clamped = self._clamp(fixture, brightness, spectrum)
        LOGGER.debug(
            "Setting fixture %s to brightness=%s spectrum=%s", address, clamped["brightness"], clamped["spectrum"]
        )
        applied = self._state.apply_setting(address, clamped["brightness"], clamped["spectrum"])
        return applied

    def apply_safe_defaults(self) -> None:
        """Apply a fail-safe state to all fixtures."""

        for address, fixture in self._fixtures.items():
            safe_brightness = int(
                fixture.min_brightness
                + (fixture.max_brightness - fixture.min_brightness) * 0.5
            )
            LOGGER.info("Applying safe default to %s: %s", address, safe_brightness)
            self.set_output(address, safe_brightness, fixture.spectrum_min)

    def last_known_state(self, address: str) -> Optional[Dict[str, int]]:
        return self._state.get_state(address)


__all__ = ["LightingController"]
