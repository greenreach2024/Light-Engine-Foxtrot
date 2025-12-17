"""Lightweight AI assist heuristics for setup guidance."""
from __future__ import annotations

import ipaddress
import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from .config import AIConfig

LOGGER = logging.getLogger(__name__)


class SetupAssistError(Exception):
    """Raised when AI Assist suggestions cannot be produced."""


@dataclass
class SetupAssistResult:
    """Container for setup assist responses."""

    suggested_fields: Dict[str, Any]
    next_steps: list[str]
    summary: Optional[str]
    provider: str

    def asdict(self) -> Dict[str, Any]:
        """Return a JSON-serialisable dictionary."""

        return {
            "suggested_fields": self.suggested_fields,
            "next_steps": self.next_steps,
            "summary": self.summary,
            "provider": self.provider,
        }


class SetupAssistService:
    """Service that produces setup assist suggestions."""

    def __init__(self, config: AIConfig):
        if not config.enabled:
            raise SetupAssistError("Attempted to initialise SetupAssistService when disabled")
        self.config = config
        self.provider = (config.provider or "heuristic").lower()
        LOGGER.info("Initialised SetupAssistService with provider %s", self.provider)

    async def generate(
        self,
        device_metadata: Optional[Dict[str, Any]] = None,
        wizard_state: Optional[Dict[str, Any]] = None,
        environment_context: Optional[Dict[str, Any]] = None,
        stage: str | None = None,
    ) -> Dict[str, Any]:
        """Return heuristic suggestions for the provided metadata."""

        if self.provider not in {"heuristic", "builtin"}:
            raise SetupAssistError(f"Unsupported AI assist provider '{self.provider}'")

        result = self._heuristic_response(
            device_metadata or {},
            wizard_state or {},
            environment_context or {},
            (stage or "start").lower(),
        )
        return result.asdict()

    def _heuristic_response(
        self,
        metadata: Dict[str, Any],
        wizard_state: Dict[str, Any],
        environment_context: Dict[str, Any],
        stage: str,
    ) -> SetupAssistResult:
        """Produce a heuristic setup recommendation."""

        suggestions: Dict[str, Any] = {}
        next_steps: list[str] = []

        vendor = (metadata.get("vendor") or metadata.get("manufacturer") or "").strip()
        model = (metadata.get("model") or metadata.get("name") or "").strip()
        category = (metadata.get("category") or metadata.get("deviceType") or "").strip()
        label = " ".join(part for part in (vendor, model) if part)
        if not label:
            label = category or "device"

        connectivity = metadata.get("connectivity") or metadata.get("transports") or []
        if isinstance(connectivity, str):
            connectivity = [connectivity]
        connectivity = [str(value).lower() for value in connectivity if value]

        preferred_transport = (
            metadata.get("preferred_transport")
            or metadata.get("default_transport")
            or metadata.get("suggestedTransport")
            or wizard_state.get("transport")
        )
        if preferred_transport:
            preferred_transport = str(preferred_transport).lower()
        elif "wifi" in connectivity:
            preferred_transport = "wifi"
        elif "bluetooth" in connectivity:
            preferred_transport = "bluetooth"

        farm_ctx = environment_context.get("farm") or {}
        farm_ssid = farm_ctx.get("preferredSsid") or farm_ctx.get("ssid")
        farm_subnet = farm_ctx.get("subnet")

        summary_parts: list[str] = []
        if label:
            summary_parts.append(label)
        if category and category.lower() not in label.lower():
            summary_parts.append(f"({category})")

        if stage == "start":
            if preferred_transport:
                suggestions["transport"] = preferred_transport
                summary_parts.append(f"pairs best over {preferred_transport.upper()}")

            wifi_suggestion: Dict[str, Any] = {}
            if preferred_transport == "wifi" or "wifi" in connectivity:
                if farm_ssid:
                    wifi_suggestion["ssid"] = farm_ssid
                static_flag = metadata.get("requiresStaticIp") or metadata.get("preferred_static")
                static_ip = metadata.get("preferredIp") or metadata.get("staticIp")
                if not static_ip:
                    static_ip = self._guess_static_ip(farm_subnet, vendor, model)
                if static_ip:
                    wifi_suggestion["staticIp"] = static_ip
                    wifi_suggestion["useStatic"] = True
                elif static_flag:
                    wifi_suggestion["useStatic"] = True
                if wifi_suggestion:
                    suggestions["wifi"] = wifi_suggestion
                    detail_bits = []
                    if wifi_suggestion.get("ssid"):
                        detail_bits.append(f"SSID {wifi_suggestion['ssid']}")
                    if wifi_suggestion.get("staticIp"):
                        detail_bits.append(f"static IP {wifi_suggestion['staticIp']}")
                    if detail_bits:
                        summary_parts.append("use " + " and ".join(detail_bits))

            bt_suggestion: Dict[str, Any] = {}
            if preferred_transport == "bluetooth" or "bluetooth" in connectivity:
                advertised = metadata.get("advertisedName") or metadata.get("friendlyName")
                if advertised:
                    bt_suggestion["name"] = advertised
                pin_hint = metadata.get("pairingPin") or metadata.get("defaultPin")
                if pin_hint:
                    bt_suggestion["pin"] = pin_hint
                if bt_suggestion:
                    suggestions["bluetooth"] = bt_suggestion
                    summary_parts.append("prepare Bluetooth discovery details")

            summary = ", ".join(summary_parts) + "." if summary_parts else None

        else:
            # completion guidance
            summary = ", ".join(summary_parts) + "." if summary_parts else None
            transport = (wizard_state.get("transport") or preferred_transport or "wifi").lower()
            if transport == "wifi":
                next_steps.append("Run device discovery to confirm the light comes online.")
                if farm_ssid:
                    next_steps.append(f"Monitor SSID {farm_ssid} for connectivity events.")
                wifi_state = wizard_state.get("wifi") or {}
                if wifi_state.get("static") or wifi_state.get("useStatic") or wifi_state.get("staticIp"):
                    next_steps.append("Reserve the static IP in DHCP to prevent conflicts.")
            elif transport == "bluetooth":
                next_steps.append("Initiate a BLE scan from the controller once the device advertises.")

            if metadata.get("requiresHub"):
                next_steps.append("Link the device to its hub before assigning grow zones.")

            room_ctx = environment_context.get("room") or {}
            if room_ctx.get("name"):
                next_steps.append(f"Assign the device to room “{room_ctx['name']}” and verify automations.")

            controller_ref = farm_ctx.get("controller")
            if controller_ref:
                next_steps.append(f"Sync the controller ({controller_ref}) to pull the latest inventory.")

        return SetupAssistResult(
            suggested_fields=suggestions,
            next_steps=next_steps,
            summary=summary,
            provider=self.provider,
        )

    @staticmethod
    def _guess_static_ip(subnet: Optional[str], vendor: str, model: str) -> Optional[str]:
        """Derive a deterministic static IP within the provided subnet."""

        if not subnet:
            return None
        try:
            network = ipaddress.ip_network(subnet, strict=False)
        except ValueError:
            LOGGER.debug("Invalid subnet %s for static IP heuristic", subnet)
            return None

        if network.num_addresses <= 4:
            return None

        base = int(network.network_address)
        last = int(network.broadcast_address)
        # Reserve the first 10 addresses for infrastructure
        start = base + 10
        if start >= last:
            start = base + 2
        seed = hash((vendor, model)) & 0xFF
        candidate = start + seed
        if candidate >= last:
            candidate = last - 1
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            return None


__all__ = ["SetupAssistError", "SetupAssistService", "SetupAssistResult"]
