
from __future__ import annotations

def load_config(*args, **kwargs):
    """
    Alias for build_environment_config().
    Allows newer code to call load_config(env=...) while using
    the existing legacy implementation.
    """
    return build_environment_config(*args, **kwargs)
"""Configuration helpers for Light Engine Charlie."""

import base64
import hashlib
import hmac
import logging
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import yaml
from dotenv import load_dotenv

LOGGER = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent

# Best-effort .env load (safe for special chars, no shell expansion)
try:
    load_dotenv()
except Exception:
    pass


@dataclass(frozen=True)
class MQTTConfig:
    """Configuration for connecting to an MQTT broker."""

    host: str
    port: int = 1883
    username: Optional[str] = None
    password: Optional[str] = None
    topics: str = "sensors/#"


@dataclass(frozen=True)
class SwitchBotConfig:
    """SwitchBot Cloud API configuration."""

    token: str
    secret: str
    region: str = "us"

    @property
    def base_headers(self) -> Dict[str, str]:
        """Return the authenticated header set required by the SwitchBot API."""

        timestamp = str(int(time.time() * 1000))
        nonce = uuid.uuid4().hex
        payload = f"{self.token}{timestamp}{nonce}".encode("utf-8")
        signature = hmac.new(self.secret.encode("utf-8"), payload, hashlib.sha256)
        sign = base64.b64encode(signature.digest()).decode("utf-8")

        return {
            "Authorization": self.token,
            "sign": sign,
            "t": timestamp,
            "nonce": nonce,
            "Content-Type": "application/json; charset=utf8",
        }

    @property
    def base_url(self) -> str:
        region = (self.region or "us").lower()
        hosts = {
            "us": "https://api.switch-bot.com",
            "eu": "https://eu-apia.switch-bot.com",
            "cn": "https://cn-apia.switch-bot.com",
            "ap": "https://api.switch-bot.com",
        }
        base = hosts.get(region, hosts["us"])
        return f"{base}/v1.1"


@dataclass(frozen=True)
class KasaConfig:
    """Simple configuration holder for TP-Link Kasa credentials (optional).

    Currently used for parity with Node backend; LAN discovery does not
    require credentials but some APIs may.
    """

    email: Optional[str] = None
    password: Optional[str] = None


@dataclass(frozen=True)
class LightingFixture:
    """Represents a lighting fixture from the on-site inventory."""

    name: str
    model: str
    address: str
    min_brightness: int
    max_brightness: int
    control_interface: str
    spectrum_min: int
    spectrum_max: int


@dataclass(frozen=True)
class AIConfig:
    """Configuration for AI Assist integrations."""

    enabled: bool = False
    provider: str = "heuristic"
    api_url: Optional[str] = None


@dataclass(frozen=True)
class EnvironmentConfig:
    """Bundle of configuration for a specific deployment environment."""

    kasa_discovery_timeout: int = 10
    mqtt: Optional[MQTTConfig] = None
    switchbot: Optional[SwitchBotConfig] = None
    kasa: Optional[KasaConfig] = None
    lighting_inventory: Optional[List[LightingFixture]] = None
    ai_assist: Optional[AIConfig] = None


def get_environment() -> str:
    """Return the current environment name."""

    return os.getenv("ENVIRONMENT", "production").lower()


def load_lighting_inventory(path: Optional[Path] = None) -> List[LightingFixture]:
    """Load lighting inventory entries from disk."""

    inventory_path = path or BASE_DIR / "data" / "lighting_inventory.yaml"
    fixtures: List[LightingFixture] = []

    if not inventory_path.exists():
        LOGGER.warning("Lighting inventory file %s missing", inventory_path)
        return fixtures

    try:
        raw_data = yaml.safe_load(inventory_path.read_text(encoding="utf-8")) or []
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.error("Failed to read lighting inventory: %s", exc)
        return fixtures

    for entry in raw_data:
        try:
            fixtures.append(
                LightingFixture(
                    name=entry["name"],
                    model=entry["model"],
                    address=entry["address"],
                    min_brightness=int(entry.get("min_brightness", 0)),
                    max_brightness=int(entry.get("max_brightness", 100)),
                    control_interface=entry["control_interface"],
                    spectrum_min=int(entry.get("spectrum_min", 2700)),
                    spectrum_max=int(entry.get("spectrum_max", 6500)),
                )
            )
        except KeyError as exc:
            LOGGER.error("Invalid lighting inventory entry %s: %s", entry, exc)

    return fixtures


def build_environment_config(env: Optional[str] = None) -> EnvironmentConfig:
    """Construct an :class:`EnvironmentConfig` from the environment.

    Parameters
    ----------
    env:
        Optional override for the environment name. If not provided the
        environment will be resolved using :func:`get_environment`.
    """

    resolved_env = (env or get_environment()).lower()
    LOGGER.info("Loading configuration for environment: %s", resolved_env)

    mqtt_config = None
    if os.getenv("MQTT_HOST"):
        mqtt_config = MQTTConfig(
            host=os.environ["MQTT_HOST"],
            port=int(os.getenv("MQTT_PORT", "1883")),
            username=os.getenv("MQTT_USERNAME"),
            password=os.getenv("MQTT_PASSWORD"),
            topics=os.getenv("MQTT_TOPICS", "sensors/#"),
        )

    # Load farm.json for integrations (preferred), then environment variables
    farm_path = BASE_DIR / "public" / "data" / "farm.json"
    farm_data: Dict[str, any] = {}
    if farm_path.exists():
        try:
            import json as _json
            farm_data = _json.loads(farm_path.read_text(encoding="utf-8")) or {}
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.warning("Failed to read farm.json: %s", exc)

    integrations = farm_data.get("integrations", {}) if isinstance(farm_data, dict) else {}
    sb_from_file = integrations.get("switchbot") if isinstance(integrations, dict) else None
    kasa_from_file = integrations.get("kasa") if isinstance(integrations, dict) else None

    # SwitchBot precedence: env vars override farm.json
    switchbot_token = os.getenv("SWITCHBOT_TOKEN") or (sb_from_file or {}).get("token")
    switchbot_secret = os.getenv("SWITCHBOT_SECRET") or (sb_from_file or {}).get("secret")
    switchbot_region = os.getenv("SWITCHBOT_REGION", "us")
    switchbot_config = None
    if switchbot_token and switchbot_secret:
        switchbot_config = SwitchBotConfig(
            token=str(switchbot_token),
            secret=str(switchbot_secret),
            region=str(switchbot_region or "us"),
        )

    # Kasa precedence: env vars override farm.json (if provided)
    kasa_email = os.getenv("KASA_EMAIL") or (kasa_from_file or {}).get("email")
    kasa_password = os.getenv("KASA_PASSWORD") or (kasa_from_file or {}).get("password")
    kasa_config = None
    if kasa_email or kasa_password:
        kasa_config = KasaConfig(email=kasa_email, password=kasa_password)

    lighting_inventory = load_lighting_inventory()

    timeout = int(os.getenv("KASA_DISCOVERY_TIMEOUT", "10"))

    ai_assist_config = AIConfig(
        enabled=True,
        provider="gpt5-mini",  # Enable GPT-5 mini for all clients
        api_url=os.getenv("AI_ASSIST_API_URL"),  # Keep existing API URL if configured
    )

    return EnvironmentConfig(
        kasa_discovery_timeout=timeout,
        mqtt=mqtt_config,
        switchbot=switchbot_config,
        kasa=kasa_config,
        lighting_inventory=lighting_inventory,
        ai_assist=ai_assist_config,
    )


__all__ = [
    "MQTTConfig",
    "SwitchBotConfig",
    "KasaConfig",
    "LightingFixture",
    "AIConfig",
    "EnvironmentConfig",
    "build_environment_config",
    "get_environment",
    "load_lighting_inventory",
]
