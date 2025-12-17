import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ZERO_RESULTS_TEXT } from "../constants/zeroState";
import { Device, DeviceAssignment, useDevices } from "../store/devices";

const DEVICE_METRIC_STYLE_ID = "device-manager-metrics";
const DEVICE_METRIC_STYLES = `
  .device-manager__grid {
    counter-reset: device-card-counter;
  }

  .device-card::before {
    position: absolute;
    top: 10px;
    left: 10px;
    min-width: 22px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.85);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
    counter-increment: device-card-counter;
    content: counter(device-card-counter);
    z-index: 2;
  }

  .device-card__metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0 8px;
  }

  .device-card__metric {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--gr-bg, #f1f5f9);
    border: 1px solid var(--gr-border, #e2e8f0);
    font-size: 0.8rem;
  }

  .device-card__metric-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--dark, #0f172a);
  }

  .device-card__metric-value {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-weight: 600;
    color: var(--dark, #0f172a);
  }

  .device-card__metric-unit {
    font-size: 0.7rem;
    color: var(--medium, #64748b);
  }

  .device-card__metric-hint {
    margin-left: 2px;
  }
`;


const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const slashIndex = trimmed.indexOf("/");
    if (slashIndex > 0) {
      const first = trimmed.slice(0, slashIndex).trim();
      const parsedFirst = Number.parseFloat(first);
      if (Number.isFinite(parsedFirst)) {
        return parsedFirst;
      }
    }
    const match = trimmed.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number.parseFloat(match[0]);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = coerceNumber(entry);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return null;
};

const parsePhotoperiodHours = (value: unknown): number | null => {
  const parsed = coerceNumber(value);
  if (parsed === null) {
    return null;
  }
  return parsed >= 0 ? parsed : null;
};

const getValueByPath = (source: Record<string, unknown>, path: string): unknown => {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!isRecord(acc)) {
      return undefined;
    }
    return acc[key];
  }, source);
};

const getNumberFromDetails = (
  details: Record<string, unknown>,
  paths: string[],
  parser: (value: unknown) => number | null = coerceNumber
): { value: number | null; path: string | null } => {
  for (const path of paths) {
    const raw = getValueByPath(details, path);
    const parsed = parser(raw);
    if (parsed !== null) {
      return { value: parsed, path };
    }
  }
  return { value: null, path: null };
};

const computeDliValue = (ppfd: number | null, hours: number | null): number | null => {
  if (ppfd === null || hours === null) {
    return null;
  }
  if (ppfd < 0 || hours < 0) {
    return null;
  }
  const dli = (ppfd * hours * 3600) / 1e6;
  return Number.isFinite(dli) ? dli : null;
};

interface MetricInfo {
  value: number | null;
  tooltip: string;
}

interface RoomOption {
  id: string;
  name: string;
  targetPpfd: number | null;
  photoperiodHours: number | null;
  energyHours: number | null;
}

const deriveDeviceMetrics = (device: Device, room?: RoomOption): { dli: MetricInfo; energy: MetricInfo } => {
  const details = isRecord(device.details) ? device.details : {};

  const ppfdCandidates = [
    "ppfd",
    "targetPpfd",
    "plan.ppfd",
    "lighting.ppfd",
    "targets.ppfd",
    "derived.ppfd",
    "telemetry.ppfd",
  ];
  const hoursCandidates = [
    "photoperiodHours",
    "hours",
    "photoperiod",
    "plan.photoperiodHours",
    "plan.photoperiod",
    "lighting.photoperiodHours",
    "lighting.photoperiod",
    "schedule.photoperiodHours",
    "schedule.photoperiod",
    "runtimeHours",
  ];
  const energyCandidates = [
    "energyForecastKwh",
    "energyKwh",
    "energy.forecastKwh",
    "plan.energyKwh",
    "telemetry.energyKwh",
  ];
  const wattCandidates = [
    "watts",
    "wattage",
    "powerWatts",
    "nominalW",
    "ratedWatts",
    "lighting.watts",
    "specs.watts",
    "telemetry.watts",
  ];
  const energyHoursCandidates = [
    "energyHours",
    "lighting.energyHours",
    "schedule.energyHours",
    "expectedHours",
    "dailyHours",
  ];

  const { value: devicePpfd, path: ppfdPath } = getNumberFromDetails(details, ppfdCandidates);
  const { value: deviceHours, path: hoursPath } = getNumberFromDetails(details, hoursCandidates, parsePhotoperiodHours);
  const { value: deviceEnergyHours, path: energyHoursPath } = getNumberFromDetails(details, energyHoursCandidates);

  const ppfdValue = devicePpfd ?? room?.targetPpfd ?? null;
  const ppfdSource = devicePpfd !== null ? `device ${ppfdPath?.replace(/\./g, " → ") ?? "target"}` : room ? `${room.name} target` : null;

  let hoursValue = deviceHours;
  let hoursSource = hoursPath ? `device ${hoursPath.replace(/\./g, " → ")}` : null;
  if (hoursValue === null && deviceEnergyHours !== null) {
    hoursValue = deviceEnergyHours;
    hoursSource = energyHoursPath ? `device ${energyHoursPath.replace(/\./g, " → ")}` : "device energy hours";
  }
  if (hoursValue === null && room) {
    if (room.photoperiodHours !== null) {
      hoursValue = room.photoperiodHours;
      hoursSource = `${room.name} photoperiod`;
    } else if (room.energyHours !== null) {
      hoursValue = room.energyHours;
      hoursSource = `${room.name} energy hours`;
    }
  }

  const dliValue = computeDliValue(ppfdValue, hoursValue);
  const dliTooltipParts = ["Daily light integral = PPFD × hours × 3600 ÷ 1e6."];
  if (ppfdValue !== null) {
    const ppfdLabel = `${ppfdValue.toFixed(0)} µmol·m⁻²·s⁻¹`;
    dliTooltipParts.push(`PPFD ${ppfdLabel}${ppfdSource ? ` (${ppfdSource})` : ""}.`);
  } else {
    dliTooltipParts.push("PPFD value unavailable.");
  }
  if (hoursValue !== null) {
    const hoursLabel = `${hoursValue.toFixed(1)} h`;
    dliTooltipParts.push(`Photoperiod ${hoursLabel}${hoursSource ? ` (${hoursSource})` : ""}.`);
  } else {
    dliTooltipParts.push("Photoperiod hours unavailable.");
  }
  if (dliValue !== null) {
    dliTooltipParts.push(`Result ≈ ${dliValue.toFixed(2)} mol·m⁻²·d⁻¹.`);
  }

  const { value: directEnergy, path: energyPath } = getNumberFromDetails(details, energyCandidates);
  const { value: wattsValue, path: wattsPath } = getNumberFromDetails(details, wattCandidates);

  let energyValue = directEnergy;
  let energyTooltipParts: string[];

  if (energyValue !== null) {
    const energySource = energyPath ? energyPath.replace(/\./g, " → ") : "device telemetry";
    energyTooltipParts = [
      `Energy forecast provided by device telemetry (${energySource}).`,
      `Reported ≈ ${energyValue.toFixed(2)} kWh per day.`,
    ];
  } else {
    const hoursForEnergy =
      deviceEnergyHours ?? hoursValue ?? (room?.energyHours ?? room?.photoperiodHours ?? null);
    const hoursEnergySource =
      deviceEnergyHours !== null
        ? energyHoursPath
          ? `device ${energyHoursPath.replace(/\./g, " → ")}`
          : "device energy hours"
        : hoursValue !== null
        ? hoursSource
        : room
        ? `${room.name}${room.energyHours !== null ? " energy hours" : " photoperiod"}`
        : null;

    if (
      wattsValue !== null &&
      hoursForEnergy !== null &&
      wattsValue >= 0 &&
      hoursForEnergy >= 0
    ) {
      energyValue = (wattsValue * hoursForEnergy) / 1000;
      energyTooltipParts = [
        "Energy forecast = watts × hours ÷ 1000.",
        `Watts ${wattsValue.toFixed(0)} W${wattsPath ? ` (device ${wattsPath.replace(/\./g, " → ")})` : ""}.`,
        `Hours ${hoursForEnergy.toFixed(1)} h${hoursEnergySource ? ` (${hoursEnergySource})` : ""}.`,
        `Result ≈ ${energyValue.toFixed(2)} kWh.`,
      ];
    } else {
      energyTooltipParts = [
        "Energy forecast = watts × hours ÷ 1000.",
        wattsValue === null || wattsValue < 0
          ? "Watts value unavailable."
          : `Watts ${wattsValue.toFixed(0)} W available.`,
        hoursForEnergy === null || hoursForEnergy < 0
          ? "Runtime hours unavailable."
          : `Hours ${hoursForEnergy.toFixed(1)} h${hoursEnergySource ? ` (${hoursEnergySource})` : ""}.`,
      ];
    }
  }

  return {
    dli: { value: dliValue, tooltip: dliTooltipParts.join(" ") },
    energy: { value: energyValue, tooltip: energyTooltipParts.join(" ") },
  };
};

const PROTOCOL_ORDER = ["kasa", "mqtt", "switchbot", "other"] as const;

const protocolLabel = (protocol: string): string => {
  switch (protocol) {
    case "kasa":
      return "Kasa";
    case "mqtt":
      return "MQTT";
    case "switchbot":
      return "SwitchBot";
    default:
      return protocol.toUpperCase();
  }
};

const getProtocolIndex = (protocol: string): number => {
  const index = PROTOCOL_ORDER.indexOf(protocol as (typeof PROTOCOL_ORDER)[number]);
  return index === -1 ? PROTOCOL_ORDER.length : index;
};

const filterDevices = (devices: Device[], protocolFilter: string, search: string): Device[] => {
  return devices
    .filter((device) => (protocolFilter === "all" ? true : device.protocol === protocolFilter))
    .filter((device) => {
      const haystack = `${device.name} ${device.category} ${device.device_id}`.toLowerCase();
      return haystack.includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const protocolIndexA = getProtocolIndex(a.protocol);
      const protocolIndexB = getProtocolIndex(b.protocol);
      if (protocolIndexA !== protocolIndexB) {
        return protocolIndexA - protocolIndexB;
      }
      return a.name.localeCompare(b.name);
    });
};

type ToastOptions = {
  title?: string;
  msg?: string;
  kind?: string;
  icon?: string;
};

const emitToast = (options: ToastOptions, ttlMs?: number) => {
  if (typeof window !== "undefined" && typeof (window as Record<string, unknown>).showToast === "function") {
    (window as { showToast: (opts: ToastOptions, ttl?: number) => void }).showToast(options, ttlMs);
  }
};

interface EquipmentOption {
  id: string;
  label: string;
  category?: string;
}

const normalizeRoom = (room: unknown, index: number): RoomOption => {
  if (!isRecord(room)) {
    const fallbackId = `room-${index + 1}`;
    return {
      id: fallbackId,
      name: `Room ${index + 1}`,
      targetPpfd: null,
      photoperiodHours: null,
      energyHours: null,
    };
  }
  const source = room;
  const idRaw = typeof source.id === "string" && source.id.trim().length > 0 ? source.id.trim() : null;
  const nameRaw = typeof source.name === "string" && source.name.trim().length > 0 ? source.name.trim() : null;
  const fallback = `room-${index + 1}`;
  const lighting = isRecord(source.lighting) ? source.lighting : undefined;
  const targetPpfdRaw =
    source["targetPpfd"] ?? source["ppfd"] ?? (lighting ? lighting["targetPpfd"] ?? lighting["ppfd"] : undefined);
  const photoperiodRaw =
    source["photoperiodHours"] ??
    source["photoperiod"] ??
    (lighting ? lighting["photoperiodHours"] ?? lighting["photoperiod"] : undefined);
  const energyHoursRaw = source["energyHours"] ?? (lighting ? lighting["energyHours"] : undefined);
  const targetPpfd = coerceNumber(targetPpfdRaw);
  const photoperiodHours = parsePhotoperiodHours(photoperiodRaw);
  const energyHours = coerceNumber(energyHoursRaw);
  return {
    id: idRaw || fallback,
    name: nameRaw || idRaw || fallback,
    targetPpfd: targetPpfd !== null ? targetPpfd : null,
    photoperiodHours: photoperiodHours !== null ? photoperiodHours : null,
    energyHours:
      energyHours !== null
        ? energyHours
        : photoperiodHours !== null
        ? photoperiodHours
        : null,
  };
};

const normalizeEquipment = (item: unknown, index: number): EquipmentOption => {
  if (!item || typeof item !== "object") {
    const fallback = `equipment-${index + 1}`;
    return { id: fallback, label: fallback };
  }
  const source = item as Record<string, unknown>;
  const vendor = typeof source.vendor === "string" ? source.vendor : "";
  const model = typeof source.model === "string" ? source.model : "";
  const category = typeof source.category === "string" ? source.category : undefined;
  const readable = [vendor, model].filter(Boolean).join(" ").trim() || `Equipment ${index + 1}`;
  const fallbackId = readable.toLowerCase().replace(/[^a-z0-9]+/gi, "-") || `equipment-${index + 1}`;
  const id = typeof source.id === "string" && source.id.trim().length > 0 ? source.id.trim() : fallbackId;
  const label = category ? `${readable} (${category})` : readable;
  return { id, label, category };
};

export const DeviceManager: React.FC = () => {
  const { devices, loading, refresh, assignDevice, unassignDevice } = useDevices();
  const [protocolFilter, setProtocolFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, DeviceAssignment>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (document.getElementById(DEVICE_METRIC_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = DEVICE_METRIC_STYLE_ID;
    style.textContent = DEVICE_METRIC_STYLES;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    setAssignmentDrafts(() => {
      const next: Record<string, DeviceAssignment> = {};
      devices.forEach((device) => {
        const assigned = device.assignedEquipment ?? { roomId: null, equipmentId: null };
        const channels = Array.isArray(assigned.channels)
          ? [...assigned.channels]
          : assigned.channels && typeof assigned.channels === "object"
          ? { ...assigned.channels }
          : undefined;
        next[device.device_id] = {
          roomId: assigned.roomId ?? null,
          equipmentId: assigned.equipmentId ?? null,
          ...(channels ? { channels } : {}),
        };
      });
      return next;
    });
  }, [devices]);

  useEffect(() => {
    let cancelled = false;

    const loadRooms = async () => {
      try {
        const response = await fetch("/farm");
        if (!response.ok) {
          throw new Error(response.statusText);
        }
        const data = (await response.json().catch(() => null)) as {
          rooms?: unknown[];
          farm?: { rooms?: unknown[] };
        };
        const rawRooms = Array.isArray(data.rooms)
          ? data.rooms
          : Array.isArray(data.farm?.rooms)
          ? data.farm?.rooms
          : [];
        if (!cancelled) {
          const normalized = (rawRooms as unknown[]).map((room, index) => normalizeRoom(room, index));
          const unique = normalized.filter(
            (room, index, arr) => arr.findIndex((candidate) => candidate.id === room.id) === index
          );
          setRooms(unique);
        }
      } catch (err) {
        console.warn("[net]", err);
        if (!cancelled) {
          setRooms([]);
        }
        return;
      }
    };

    const loadEquipment = async () => {
      try {
        const response = await fetch("/data/equipment-kb.json");
        if (!response.ok) {
          throw new Error(response.statusText);
        }
        const data = (await response.json().catch(() => null)) as { equipment?: unknown[] };
        const rawEquipment = Array.isArray(data.equipment) ? data.equipment : [];
        if (!cancelled) {
          const normalized = (rawEquipment as unknown[]).map((item, index) => normalizeEquipment(item, index));
          const deduped = normalized.filter(
            (item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index
          );
          deduped.sort((a, b) => a.label.localeCompare(b.label));
          setEquipment(deduped);
        }
      } catch (err) {
        console.warn("[net]", err);
        if (!cancelled) {
          setEquipment([]);
        }
        return;
      }
    };

    loadRooms();
    loadEquipment();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredDevices = useMemo(
    () => filterDevices(devices, protocolFilter, search),
    [devices, protocolFilter, search]
  );

  const roomLookup = useMemo(() => {
    return rooms.reduce<Record<string, RoomOption>>((acc, room) => {
      acc[room.id] = room;
      return acc;
    }, {});
  }, [rooms]);

  const equipmentLookup = useMemo(() => {
    return equipment.reduce<Record<string, EquipmentOption>>((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, [equipment]);

  const isExpanded = useCallback(
    (deviceId: string) => expanded.includes(deviceId),
    [expanded]
  );

  const toggleExpanded = useCallback((deviceId: string) => {
    setExpanded((prev) =>
      prev.includes(deviceId) ? prev.filter((id) => id !== deviceId) : [...prev, deviceId]
    );
  }, []);

  const setDraft = useCallback((deviceId: string, draft: DeviceAssignment) => {
    setAssignmentDrafts((prev) => {
      const existing = prev[deviceId] ?? { roomId: null, equipmentId: null };
      return { ...prev, [deviceId]: { ...existing, ...draft } };
    });
  }, []);

  const setPendingState = useCallback((deviceId: string, value: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (value) {
        next.add(deviceId);
      } else {
        next.delete(deviceId);
      }
      return next;
    });
  }, []);

  const handleSubmitAssignment = useCallback(
    async (device: Device) => {
      const draft = assignmentDrafts[device.device_id] ?? {
        roomId: null,
        equipmentId: null,
      };
      if (!draft.roomId || !draft.equipmentId) {
        emitToast({
          title: "Assignment required",
          msg: "Select both a room and equipment to assign this device.",
          kind: "warn",
          icon: "⚠️",
        });
        throw new Error("Room and equipment are required");
      }
      setPendingState(device.device_id, true);
      try {
        const updated = await assignDevice(device.device_id, draft);
        if (!updated) {
          return;
        }
        const roomName = updated.assignedEquipment.roomId
          ? roomLookup[updated.assignedEquipment.roomId]?.name || updated.assignedEquipment.roomId
          : "room";
        const equipmentName = updated.assignedEquipment.equipmentId
          ? equipmentLookup[updated.assignedEquipment.equipmentId]?.label || updated.assignedEquipment.equipmentId
          : "equipment";
        emitToast({
          title: "Assignment saved",
          msg: `${updated.name} mapped to ${equipmentName} in ${roomName}.`,
          kind: "success",
          icon: "✅",
        });
        toggleExpanded(device.device_id);
      } catch (err) {
        emitToast({
          title: "Assignment failed",
          msg: err instanceof Error ? err.message : String(err),
          kind: "warn",
          icon: "⚠️",
        });
        throw err;
      } finally {
        setPendingState(device.device_id, false);
      }
    },
    [assignmentDrafts, assignDevice, equipmentLookup, roomLookup, setPendingState, toggleExpanded]
  );

  const handleUnassign = useCallback(
    async (device: Device) => {
      setPendingState(device.device_id, true);
      try {
        const updated = await unassignDevice(device.device_id);
        if (!updated) {
          return;
        }
        emitToast({
          title: "Device unassigned",
          msg: `${device.name} is now unassigned.`,
          kind: "info",
          icon: "ℹ️",
        });
      } catch (err) {
        emitToast({
          title: "Unassign failed",
          msg: err instanceof Error ? err.message : String(err),
          kind: "warn",
          icon: "⚠️",
        });
      } finally {
        setPendingState(device.device_id, false);
      }
    },
    [setPendingState, unassignDevice]
  );

  return (
    <section className="device-manager">
      <header className="device-manager__header">
        <h2>Device Manager</h2>
        <div className="device-manager__controls">
          <label>
            Filter by type
            <select value={protocolFilter} onChange={(event) => setProtocolFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="kasa">Kasa</option>
              <option value="mqtt">MQTT</option>
              <option value="switchbot">SwitchBot</option>
            </select>
          </label>
          <label>
            Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, ID or category" />
          </label>
          <button type="button" onClick={refresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {loading && <p className="device-manager__loading">Loading devices…</p>}

      {!loading && filteredDevices.length === 0 && (
        <p className="device-manager__empty">{ZERO_RESULTS_TEXT}</p>
      )}

      <div className="device-manager__grid">
        {filteredDevices.map((device) => {
          const assignment = assignmentDrafts[device.device_id] ?? {
            roomId: device.assignedEquipment?.roomId ?? null,
            equipmentId: device.assignedEquipment?.equipmentId ?? null,
          };
          const expandedForDevice = isExpanded(device.device_id);
          const pendingForDevice = pending.has(device.device_id);
          const assignedRoomName = device.assignedEquipment?.roomId
            ? roomLookup[device.assignedEquipment.roomId]?.name || device.assignedEquipment.roomId
            : null;
          const assignedEquipmentName = device.assignedEquipment?.equipmentId
            ? equipmentLookup[device.assignedEquipment.equipmentId]?.label || device.assignedEquipment.equipmentId
            : null;
          const selectedRoom = assignment.roomId ? roomLookup[assignment.roomId] : undefined;
          const metrics = deriveDeviceMetrics(device, selectedRoom);
          const assignmentSummary = (() => {
            if (assignedRoomName && assignedEquipmentName) {
              return `Assigned to ${assignedEquipmentName} in ${assignedRoomName}`;
            }
            if (assignedRoomName) {
              return `Assigned to ${assignedRoomName}`;
            }
            if (assignedEquipmentName) {
              return `Assigned to ${assignedEquipmentName}`;
            }
            return "Not yet assigned";
          })();

          const handleRoomChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
            const value = event.target.value || null;
            setDraft(device.device_id, {
              roomId: value,
              equipmentId: assignment.equipmentId,
            });
          };

          const handleEquipmentChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
            const value = event.target.value || null;
            setDraft(device.device_id, {
              roomId: assignment.roomId,
              equipmentId: value,
            });
          };

          const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            try {
              await handleSubmitAssignment(device);
            } catch {
              // handled via toast
            }
          };

          return (
            <article key={device.device_id} className="device-card" data-protocol={device.protocol}>
              <header className="device-card__header">
                <h3>{device.name}</h3>
                <span className={`device-card__status device-card__status--${device.online ? "online" : "offline"}`}>
                  {device.online ? "Online" : "Offline"}
                </span>
              </header>
              <dl className="device-card__meta">
                <div>
                  <dt>Type</dt>
                  <dd>{device.category}</dd>
                </div>
                <div>
                  <dt>Protocol</dt>
                  <dd>{protocolLabel(device.protocol)}</dd>
                </div>
                <div>
                  <dt>Identifier</dt>
                  <dd>{device.device_id}</dd>
                </div>
              </dl>
              <div className="device-card__metrics" role="list" aria-label="Lighting forecast">
                <div className="device-card__metric" role="listitem">
                  <span className="device-card__metric-label">DLI</span>
                  <span className="device-card__metric-value">
                    {metrics.dli.value !== null ? metrics.dli.value.toFixed(2) : "—"}
                    <span className="device-card__metric-unit">mol·m⁻²·d⁻¹</span>
                  </span>
                  <span className="hint device-card__metric-hint" title={metrics.dli.tooltip} data-tip={metrics.dli.tooltip}>
                    ?
                  </span>
                </div>
                <div className="device-card__metric" role="listitem">
                  <span className="device-card__metric-label">Energy</span>
                  <span className="device-card__metric-value">
                    {metrics.energy.value !== null ? metrics.energy.value.toFixed(2) : "—"}
                    <span className="device-card__metric-unit">kWh</span>
                  </span>
                  <span className="hint device-card__metric-hint" title={metrics.energy.tooltip} data-tip={metrics.energy.tooltip}>
                    ?
                  </span>
                </div>
              </div>
              {Object.keys(device.capabilities).length > 0 && (
                <div className="device-card__capabilities">
                  <h4>Capabilities</h4>
                  <ul>
                    {Object.entries(device.capabilities).map(([key, value]) => (
                      <li key={key}>
                        <strong>{key}:</strong> {String(value)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="device-manager__assignment">
                <div className="device-manager__assignment-summary">
                  <span>{assignmentSummary}</span>
                  <div className="device-manager__assignment-actions">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(device.device_id)}
                      className="ghost"
                      disabled={pendingForDevice}
                    >
                      {expandedForDevice ? "Close" : "Assign"}
                    </button>
                    {(device.assignedEquipment?.roomId || device.assignedEquipment?.equipmentId) && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleUnassign(device)}
                        disabled={pendingForDevice}
                      >
                        Unassign
                      </button>
                    )}
                  </div>
                </div>
                {expandedForDevice && (
                  rooms.length > 0 && equipment.length > 0 ? (
                    <form className="device-manager__assign-form" onSubmit={handleSubmit}>
                      <label>
                        Room
                        <select value={assignment.roomId ?? ""} onChange={handleRoomChange} required>
                          <option value="">Select room</option>
                          {rooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Equipment
                        <select value={assignment.equipmentId ?? ""} onChange={handleEquipmentChange} required>
                          <option value="">Select equipment</option>
                          {equipment.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="device-manager__assign-form-actions">
                        <button type="submit" className="primary" disabled={pendingForDevice}>
                          Save assignment
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => toggleExpanded(device.device_id)}
                          disabled={pendingForDevice}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="device-manager__assign-form device-manager__assign-form--empty">
                      <p className="device-manager__empty">{ZERO_RESULTS_TEXT}</p>
                    </div>
                  )
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default DeviceManager;
