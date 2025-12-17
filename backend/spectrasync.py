"""SpectraSync environmental dimming helpers.

This module translates the specification outlined in "SpectraSync —
Environment‑Responsive Lighting Control (Spec v1.0)" into deterministic
helpers that other services can call.  The helpers focus on a few core
responsibilities:

* Determine whether SpectraSync should currently be active based on room
  conditions, operator intent, and ventilation efficiency guardrails.
* Compute the PPFD (intensity) and blue-channel moderation factors whenever
  SpectraSync is active.
* Apply those factors to static and dynamic channel recipes while respecting
  channel limits and HEX12 encoding requirements for Code3 dynamic fixtures.

The functions here are intentionally state-light; only ``SpectraSyncDecider``
maintains activation state so that hysteresis rules can be enforced across
evaluations.  Everything else is pure so it can be reused in both backend and
automation contexts.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, Mapping, Optional, Tuple


def _lower_keys(data: Optional[Mapping[str, object]]) -> Dict[str, object]:
    if not data:
        return {}
    return {str(key).lower(): value for key, value in data.items()}


def _extract_number(data: Mapping[str, object], *keys: str) -> Optional[float]:
    for key in keys:
        if key in data and data[key] is not None:
            try:
                return float(data[key])
            except (TypeError, ValueError):
                continue
    return None


def _extract_bool(
    data: Mapping[str, object], *keys: str, default: Optional[bool] = None
) -> Optional[bool]:
    for key in keys:
        if key in data and data[key] is not None:
            value = data[key]
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                lowered = value.strip().lower()
                if lowered in {"1", "true", "yes", "on"}:
                    return True
                if lowered in {"0", "false", "no", "off"}:
                    return False
            if isinstance(value, (int, float)):
                return bool(value)
    return default


def _clip(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


@dataclass(frozen=True)
class SpectraSyncTargets:
    """Target environmental bands for SpectraSync activation."""

    temperature: float = 24.0
    temperature_band: float = 1.0
    humidity: float = 65.0
    humidity_band: float = 5.0


@dataclass(frozen=True)
class SpectraSyncCoefficients:
    """Slope and limiter coefficients for SpectraSync scaling."""

    alpha_temp: float = 0.10
    alpha_humidity: float = 0.10
    gamma_humidity: float = 0.10
    k_ppfd_min: float = 0.50
    k_blue_min: float = 0.50
    mu_min: float = 0.0
    mu_max: float = 1.20


@dataclass(frozen=True)
class SpectraSyncConfig:
    """Full configuration container for SpectraSync computations."""

    targets: SpectraSyncTargets = field(default_factory=SpectraSyncTargets)
    coefficients: SpectraSyncCoefficients = field(default_factory=SpectraSyncCoefficients)
    hysteresis_temp: float = 0.2
    hysteresis_humidity: float = 1.0


DEFAULT_CONFIG = SpectraSyncConfig()
CHANNEL_ORDER: Tuple[str, ...] = ("cw", "ww", "bl", "rd")

HEX_SCALE_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "channel-scale.json"


def _load_hex_scale_config() -> Dict[str, object]:
    default = {"scale": "00-40", "max_byte": 64}
    try:
        raw = HEX_SCALE_CONFIG_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return default
    except OSError:
        return default

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return default

    scale_label = str(payload.get("scale", "00-FF")).upper()
    max_byte_value = payload.get("maxByte")

    parsed_max: Optional[int] = None
    if isinstance(max_byte_value, (int, float)):
        try:
            parsed_max = int(round(max_byte_value))
        except (TypeError, ValueError):
            parsed_max = None

    if parsed_max is None or parsed_max <= 0 or parsed_max > 255:
        if scale_label == "00-40":
            parsed_max = 64
        elif scale_label == "00-64":  # Legacy label
            parsed_max = 100
        elif scale_label == "00-FF":
            parsed_max = 255
        else:
            parsed_max = 64

    return {"scale": scale_label, "max_byte": parsed_max}


HEX_SCALE_CONFIG = _load_hex_scale_config()
HEX_MAX_BYTE = max(1, min(255, int(HEX_SCALE_CONFIG.get("max_byte", 255))))


def compute_exceedances(
    temperature: Optional[float],
    humidity: Optional[float],
    config: SpectraSyncConfig = DEFAULT_CONFIG,
) -> Tuple[float, float]:
    """Return positive exceedances for temperature and humidity.

    Parameters
    ----------
    temperature:
        Current internal temperature in degrees Celsius.
    humidity:
        Current internal relative humidity in percent.
    config:
        Active SpectraSync configuration.
    """

    targets = config.targets
    e_temp = 0.0
    e_humidity = 0.0
    if temperature is not None:
        threshold = targets.temperature + targets.temperature_band
        if temperature > threshold:
            e_temp = (temperature - threshold) / 1.0
    if humidity is not None:
        threshold = targets.humidity + targets.humidity_band
        if humidity > threshold:
            e_humidity = (humidity - threshold) / 5.0
    return (max(0.0, e_temp), max(0.0, e_humidity))


def compute_scales(
    exceedances: Tuple[float, float],
    config: SpectraSyncConfig = DEFAULT_CONFIG,
) -> Tuple[float, float]:
    """Compute the PPFD and blue scaling factors from exceedances."""

    e_temp, e_humidity = exceedances
    coeff = config.coefficients
    k_ppfd = 1.0 - (coeff.alpha_temp * e_temp + coeff.alpha_humidity * e_humidity)
    k_ppfd = max(coeff.k_ppfd_min, k_ppfd)
    k_blue = 1.0 - coeff.gamma_humidity * e_humidity
    k_blue = max(coeff.k_blue_min, k_blue)
    return (k_ppfd, k_blue)


def _infer_hvac_inefficient(
    internal: Mapping[str, object],
    external: Optional[Mapping[str, object]] = None,
) -> bool:
    lowered_internal = _lower_keys(internal)
    explicit_flag = _extract_bool(
        lowered_internal,
        "hvac_inefficient",
        "venting_inefficient",
        "dehumid_inefficient",
    )
    if explicit_flag is not None:
        return explicit_flag

    if not external:
        return False

    lowered_external = _lower_keys(external)
    int_temp = _extract_number(lowered_internal, "temp", "temperature", "t")
    int_rh = _extract_number(lowered_internal, "rh", "humidity")
    ext_temp = _extract_number(lowered_external, "temp", "temperature", "t")
    ext_rh = _extract_number(lowered_external, "rh", "humidity")

    comparisons: Iterable[bool] = []
    temp_flag = None
    if int_temp is not None and ext_temp is not None:
        temp_flag = ext_temp >= int_temp - 0.5
    rh_flag = None
    if int_rh is not None and ext_rh is not None:
        rh_flag = ext_rh >= int_rh - 2.0

    candidates = [flag for flag in (temp_flag, rh_flag) if flag is not None]
    if not candidates:
        return False
    return all(candidates)


def _extract_operator_enabled(data: Mapping[str, object]) -> bool:
    lowered = _lower_keys(data)
    flag = _extract_bool(
        lowered,
        "auto_adjust_lighting",
        "auto_adjust_enabled",
        "auto_adjust",
        "spectrasync_enabled",
        "auto_adjust_for_climate",
    )
    return bool(flag)


def apply_static_recipe(
    baseline: Mapping[str, float],
    k_ppfd: float,
) -> Dict[str, float]:
    """Scale all channels uniformly for static fixtures."""

    return {channel: _clip(float(percent) * k_ppfd, 0.0, 100.0) for channel, percent in baseline.items()}


def apply_dynamic_recipe(
    baseline: Mapping[str, float],
    k_ppfd: float,
    k_blue: float,
    config: SpectraSyncConfig = DEFAULT_CONFIG,
) -> Dict[str, float]:
    """Apply SpectraSync scaling to a dynamic spectrum recipe."""

    coeff = config.coefficients
    normalized = {channel.lower(): float(percent) for channel, percent in baseline.items()}

    total = sum(normalized.get(channel, 0.0) for channel in CHANNEL_ORDER)
    if total <= 0.0:
        return {channel: 0.0 for channel in CHANNEL_ORDER if channel in normalized}

    fractions = {channel: normalized.get(channel, 0.0) / total for channel in CHANNEL_ORDER}
    f_blue = fractions.get("bl", 0.0)
    b_blue = f_blue * k_blue
    b_others = fractions.get("cw", 0.0) + fractions.get("ww", 0.0) + fractions.get("rd", 0.0)

    if b_others <= 0.0:
        # No other channels to backfill; fall back to simple scaling.
        return {channel: _clip(normalized.get(channel, 0.0) * (k_blue if channel == "bl" else k_ppfd), 0.0, 100.0) for channel in fractions}

    mu_raw = (k_ppfd - b_blue) / b_others
    mu = _clip(mu_raw, coeff.mu_min, coeff.mu_max)

    scaled: Dict[str, float] = {}
    for channel, base_value in normalized.items():
        if channel == "bl":
            scaled[channel] = _clip(base_value * k_blue, 0.0, 100.0)
        else:
            scaled[channel] = _clip(base_value * mu, 0.0, 100.0)
    return scaled


def percentages_to_hex(channels: Mapping[str, float]) -> str:
    """Convert CW/WW/BL/RD percentages to the HEX12 payload format."""

    ordered = []
    for channel in CHANNEL_ORDER:
        percent = float(channels.get(channel, 0.0))
        clipped = _clip(percent, 0.0, 100.0)
        scaled = int(round((clipped / 100.0) * HEX_MAX_BYTE))
        byte_value = max(0, min(HEX_MAX_BYTE, scaled))
        ordered.append(f"{byte_value:02X}")
    ordered.extend(["00", "00"])
    return "".join(ordered)


def should_activate(
    internal_env: Mapping[str, object],
    external_env: Optional[Mapping[str, object]] = None,
    *,
    config: SpectraSyncConfig = DEFAULT_CONFIG,
    previously_active: bool = False,
) -> Tuple[bool, Dict[str, float]]:
    """Evaluate SpectraSync activation guardrails.

    Returns a tuple ``(active, exceedances)`` where ``active`` indicates
    whether SpectraSync should be running for the provided readings and
    ``exceedances`` contains the raw exceedance values for diagnostics.
    """

    lowered_internal = _lower_keys(internal_env)
    operator_enabled = _extract_operator_enabled(lowered_internal)
    if not operator_enabled:
        return (False, {"temp": 0.0, "humidity": 0.0})

    temperature = _extract_number(lowered_internal, "temp", "temperature", "t")
    humidity = _extract_number(lowered_internal, "rh", "humidity")
    exceedances = compute_exceedances(temperature, humidity, config)
    exceedance_map = {"temp": exceedances[0], "humidity": exceedances[1]}

    hvac_inefficient = _infer_hvac_inefficient(lowered_internal, external_env)
    if not hvac_inefficient:
        return (False, exceedance_map)

    if previously_active:
        deactivate_temp = False
        deactivate_rh = False
        if temperature is not None:
            deactivate_temp = temperature <= (
                config.targets.temperature
                + config.targets.temperature_band
                - config.hysteresis_temp
            )
        else:
            deactivate_temp = True
        if humidity is not None:
            deactivate_rh = humidity <= (
                config.targets.humidity
                + config.targets.humidity_band
                - config.hysteresis_humidity
            )
        else:
            deactivate_rh = True
        if not (deactivate_temp and deactivate_rh):
            return (True, exceedance_map)
        return (False, exceedance_map)

    if exceedances[0] > 0 or exceedances[1] > 0:
        return (True, exceedance_map)
    return (False, exceedance_map)


@dataclass
class SpectraSyncDecision:
    active: bool
    ppfd_scale: float
    blue_scale: float
    exceedances: Dict[str, float]
    hvac_inefficient: bool
    operator_enabled: bool
    reason: str


class SpectraSyncDecider:
    """Stateful helper that enforces SpectraSync guardrails with hysteresis."""

    def __init__(self, config: SpectraSyncConfig = DEFAULT_CONFIG) -> None:
        self.config = config
        self._active = False

    @property
    def active(self) -> bool:
        return self._active

    def evaluate(
        self,
        internal_env: Mapping[str, object],
        external_env: Optional[Mapping[str, object]] = None,
    ) -> SpectraSyncDecision:
        lowered_internal = _lower_keys(internal_env)
        operator_enabled = _extract_operator_enabled(lowered_internal)
        temperature = _extract_number(lowered_internal, "temp", "temperature", "t")
        humidity = _extract_number(lowered_internal, "rh", "humidity")

        exceedances = compute_exceedances(temperature, humidity, self.config)
        exceedance_map = {"temp": exceedances[0], "humidity": exceedances[1]}

        hvac_inefficient = _infer_hvac_inefficient(lowered_internal, external_env)

        reasons = []
        if not operator_enabled:
            reasons.append("operator-disabled")
        if not hvac_inefficient:
            reasons.append("hvac-efficient")
        if exceedances[0] <= 0 and exceedances[1] <= 0:
            reasons.append("within-band")

        should_run, _ = should_activate(
            lowered_internal,
            external_env,
            config=self.config,
            previously_active=self._active,
        )

        if not should_run:
            self._active = False
            return SpectraSyncDecision(
                active=False,
                ppfd_scale=1.0,
                blue_scale=1.0,
                exceedances=exceedance_map,
                hvac_inefficient=hvac_inefficient,
                operator_enabled=operator_enabled,
                reason=",".join(reasons) if reasons else "guardrails",
            )

        self._active = True
        scales = compute_scales(exceedances, self.config)
        return SpectraSyncDecision(
            active=True,
            ppfd_scale=scales[0],
            blue_scale=scales[1],
            exceedances=exceedance_map,
            hvac_inefficient=hvac_inefficient,
            operator_enabled=operator_enabled,
            reason="active",
        )


__all__ = [
    "SpectraSyncConfig",
    "SpectraSyncCoefficients",
    "SpectraSyncTargets",
    "SpectraSyncDecision",
    "SpectraSyncDecider",
    "apply_dynamic_recipe",
    "apply_static_recipe",
    "compute_exceedances",
    "compute_scales",
    "percentages_to_hex",
    "should_activate",
]

