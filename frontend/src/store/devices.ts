import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type DeviceProtocol = "kasa" | "mqtt" | "switchbot" | "other";

export interface DeviceAssignment {
  roomId: string | null;
  equipmentId: string | null;
  channels?: number[] | Record<string, number>;
}

export interface Device {
  device_id: string;
  name: string;
  category: string;
  protocol: DeviceProtocol | string;
  online: boolean;
  capabilities: Record<string, unknown>;
  details: Record<string, unknown>;
  assignedEquipment: DeviceAssignment;
}

interface DeviceContextValue {
  devices: Device[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  assignDevice: (deviceId: string, assignment: DeviceAssignment) => Promise<Device | undefined>;
  unassignDevice: (deviceId: string) => Promise<Device | undefined>;
}

const DeviceContext = createContext<DeviceContextValue | undefined>(undefined);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const canonicalizeProtocol = (value: unknown): DeviceProtocol => {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "kasa" || normalized === "kasa-wifi" || normalized === "tplink" || normalized === "kasa_cloud") {
    return "kasa";
  }
  if (normalized === "mqtt" || normalized === "mqtt-tls" || normalized === "mqtt_tls") {
    return "mqtt";
  }
  if (normalized === "switchbot" || normalized === "switchbot-cloud" || normalized === "ble-switchbot") {
    return "switchbot";
  }
  return "other";
};

const normalizeCapabilities = (value: unknown): Record<string, unknown> => {
  if (!value) {
    return {};
  }
  if (Array.isArray(value)) {
    return value.reduce<Record<string, boolean>>((acc, entry) => {
      const key = typeof entry === "string" ? entry : String(entry);
      acc[key] = true;
      return acc;
    }, {});
  }
  if (isRecord(value)) {
    return value;
  }
  return { value };
};

const normalizeAssignment = (value: unknown): DeviceAssignment => {
  const direct = isRecord(value) ? value : null;
  const maybeContainer = !direct && value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const nestedAssigned = maybeContainer?.assignedEquipment;
  const nestedAssignment = maybeContainer?.assignment;
  const source =
    direct ?? (isRecord(nestedAssigned) ? nestedAssigned : null) ?? (isRecord(nestedAssignment) ? nestedAssignment : null);
  if (!source) {
    return { roomId: null, equipmentId: null };
  }
  const roomIdCandidate =
    typeof source.roomId === "string"
      ? source.roomId
      : typeof source.room === "string"
      ? source.room
      : typeof source.room_id === "string"
      ? source.room_id
      : null;
  const equipmentIdCandidate =
    typeof source.equipmentId === "string"
      ? source.equipmentId
      : typeof source.equipment === "string"
      ? source.equipment
      : typeof source.equipment_id === "string"
      ? source.equipment_id
      : null;
  const roomId = roomIdCandidate && roomIdCandidate.length > 0 ? roomIdCandidate : null;
  const equipmentId = equipmentIdCandidate && equipmentIdCandidate.length > 0 ? equipmentIdCandidate : null;
  const rawChannels = (source as Record<string, unknown>).channels;
  let channels: DeviceAssignment["channels"];
  if (Array.isArray(rawChannels)) {
    const normalized = rawChannels.map((entry) => {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        return entry;
      }
      const parsed = Number.parseFloat(String(entry ?? ""));
      return Number.isFinite(parsed) ? parsed : 0;
    });
    if (normalized.some((value) => value !== 0)) {
      channels = normalized;
    }
  } else if (isRecord(rawChannels)) {
    const normalizedEntries = Object.entries(rawChannels).reduce<Record<string, number>>((acc, [key, value]) => {
      const parsed =
        typeof value === "number" && Number.isFinite(value)
          ? value
          : Number.parseFloat(String(value ?? ""));
      if (Number.isFinite(parsed)) {
        acc[key] = parsed;
      }
      return acc;
    }, {});
    if (Object.keys(normalizedEntries).length > 0) {
      channels = normalizedEntries;
    }
  }

  return channels ? { roomId, equipmentId, channels } : { roomId, equipmentId };
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

interface ChannelState {
  values: number[];
  total: number;
  apply: (next: number[]) => DeviceAssignment;
}

const getChannelState = (assignment: DeviceAssignment): ChannelState | null => {
  const raw = assignment.channels;
  if (!raw) {
    return null;
  }
  if (Array.isArray(raw)) {
    const values = raw.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0));
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
    return total > 0
      ? {
          values,
          total,
          apply: (next) => ({ ...assignment, channels: next }),
        }
      : null;
  }
  if (isRecord(raw)) {
    const entries = Object.entries(raw)
      .map(([key, value]) => {
        const parsed = toFiniteNumber(value);
        return parsed === null ? null : ([key, parsed] as const);
      })
      .filter((entry): entry is readonly [string, number] => Array.isArray(entry));
    if (!entries.length) {
      return null;
    }
    const keys = entries.map(([key]) => key);
    const values = entries.map(([, value]) => value);
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
    if (total <= 0) {
      return null;
    }
    return {
      values,
      total,
      apply: (next) => ({
        ...assignment,
        channels: next.reduce<Record<string, number>>((acc, value, index) => {
          acc[keys[index]] = value;
          return acc;
        }, {}),
      }),
    };
  }
  return null;
};

const scaleChannelValues = (values: number[], cap: number): number[] | null => {
  if (!Number.isFinite(cap) || cap <= 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= cap || total <= 0) {
    return null;
  }
  const factor = cap / total;
  const scaled = values.map((value) => Number((Math.max(0, value) * factor).toFixed(3)));
  const scaledTotal = scaled.reduce((sum, value) => sum + value, 0);
  if (scaledTotal > cap && scaled.length) {
    const diff = scaledTotal - cap;
    const lastIndex = scaled.length - 1;
    scaled[lastIndex] = Number(Math.max(0, scaled[lastIndex] - diff).toFixed(3));
  }
  return scaled;
};

const parseJsonSafe = (text: string): unknown => {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const includesPowerCap = (payload: unknown, statusText: string): boolean => {
  const textCandidates: string[] = [];
  if (typeof statusText === "string" && statusText.trim()) {
    textCandidates.push(statusText);
  }
  if (typeof payload === "string") {
    textCandidates.push(payload);
  }
  if (isRecord(payload)) {
    const keys = ["error", "message", "detail", "reason", "status"];
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string") {
        textCandidates.push(value);
      }
    }
  }
  return textCandidates.some((entry) => entry.toLowerCase().includes("power cap"));
};

const extractPowerCap = (payload: unknown, response: Response, fallback: number): number | null => {
  const headerCandidates = ["x-power-cap", "x-power-limit", "x-max-power", "x-controller-cap"]
    .map((key) => response.headers.get(key))
    .map((value) => toFiniteNumber(value))
    .filter((value): value is number => value !== null);
  if (headerCandidates.length > 0) {
    return headerCandidates[0];
  }
  if (isRecord(payload)) {
    const valueCandidates = [
      payload.cap,
      payload.limit,
      payload.max,
      payload.maxPower,
      payload.powerCap,
      payload.power_cap,
      payload.powerLimit,
      payload.allowed,
    ];
    for (const candidate of valueCandidates) {
      const parsed = toFiniteNumber(candidate);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  if (Number.isFinite(fallback) && fallback > 0) {
    const reduced = Number((fallback * 0.95).toFixed(3));
    return reduced > 0 ? reduced : null;
  }
  return null;
};

const normalizeDevice = (raw: unknown): Device => {
  const source = isRecord(raw) ? raw : {};

  const deviceIdCandidate =
    source.device_id ?? source.deviceId ?? source.id ?? source.uuid ?? source._id ?? "";
  const rawId = String(deviceIdCandidate ?? "").trim();

  const nameCandidate =
    source.name ?? source.deviceName ?? source.label ?? (rawId ? `Device ${rawId.slice(-6)}` : "");
  const rawName = String(nameCandidate ?? "").trim() || rawId || "";

  const categoryCandidate = source.category ?? source.type ?? source.deviceType ?? source.model ?? "device";
  const rawCategory = String(categoryCandidate ?? "device").trim() || "device";

  const protocolCandidate =
    source.protocol ?? source.transport ?? source.conn ?? source.connectivity ?? source.protocolType;
  const protocol = canonicalizeProtocol(protocolCandidate);

  const onlineValue = source.online ?? source.status ?? source.state;
  const online =
    typeof onlineValue === "boolean"
      ? onlineValue
      : String(onlineValue ?? "").toLowerCase() === "online" || Boolean(onlineValue);

  const capabilities = normalizeCapabilities(source.capabilities);

  const details: Record<string, unknown> = {
    ...(isRecord(source.details) ? source.details : {}),
  };

  const assignDetail = (key: string, ...values: unknown[]) => {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") {
        details[key] = value;
        break;
      }
    }
  };

  assignDetail("manufacturer", details.manufacturer, source.manufacturer, source.vendor);
  assignDetail("model", details.model, source.model, source.deviceModel, source.device_type);
  assignDetail("address", details.address, source.address, source.host, source.ip);
  assignDetail("lastSeen", details.lastSeen, source.lastSeen, source.updatedAt, source.last_seen);

  if (!details.raw) {
    details.raw = source;
  }

  const assignmentSource =
    source.assignedEquipment ?? source.assignment ?? (isRecord(source.assigned_equipment) ? source.assigned_equipment : null);

  return {
    device_id: rawId,
    name: rawName,
    category: rawCategory,
    protocol,
    online,
    capabilities,
    details,
    assignedEquipment: normalizeAssignment(assignmentSource),
  };
};

export const DeviceProvider: React.FC<React.PropsWithChildren<unknown>> = ({ children }) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/devices");
      if (!response.ok) {
        throw new Error(response.statusText);
      }
      const payload = await response.json().catch(() => null);
      const list: unknown[] = Array.isArray((payload as { devices?: unknown[] } | null)?.devices)
        ? ((payload as { devices?: unknown[] }).devices as unknown[])
        : Array.isArray(payload)
        ? (payload as unknown[])
        : [];
      setDevices(list.map((item: unknown) => normalizeDevice(item)));
    } catch (err) {
      console.warn("[net]", err);
      return;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateAssignment = useCallback(
    async (deviceId: string, assignment: DeviceAssignment): Promise<Device | undefined> => {
      let attempt = 0;
      let payload = assignment;
      while (attempt < 2) {
        try {
          const response = await fetch(`/devices/${encodeURIComponent(deviceId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignedEquipment: payload }),
          });

          if (response.status === 400) {
            const errorText = await response.text();
            const parsedError = parseJsonSafe(errorText);
            if (attempt === 0 && includesPowerCap(parsedError, response.statusText)) {
              const channelState = getChannelState(payload);
              if (channelState) {
                const cap = extractPowerCap(parsedError, response, channelState.total);
                const scaledValues = cap !== null ? scaleChannelValues(channelState.values, cap) : null;
                if (scaledValues) {
                  payload = channelState.apply(scaledValues);
                  attempt += 1;
                  continue;
                }
              }
            }
            throw new Error(response.statusText);
          }

          if (!response.ok) {
            throw new Error(response.statusText);
          }

          const responseText = await response.text();
          const parsed = parseJsonSafe(responseText);
          const candidate =
            (isRecord(parsed) && "device" in parsed ? (parsed as Record<string, unknown>).device : parsed) ?? {
              device_id: deviceId,
              assignedEquipment: payload,
            };
          const updated = normalizeDevice(candidate);
          setDevices((prev: Device[]) => {
            const next = prev.map((device: Device) => (device.device_id === updated.device_id ? updated : device));
            if (next.some((device: Device) => device.device_id === updated.device_id)) {
              return next;
            }
            return [...next, updated];
          });
          return updated;
        } catch (err) {
          console.warn("[net]", err);
          return;
        }
      }
      return undefined;
    },
    [setDevices]
  );

  const assignDevice = useCallback(
    (deviceId: string, assignment: DeviceAssignment) => updateAssignment(deviceId, assignment),
    [updateAssignment]
  );

  const unassignDevice = useCallback(
    (deviceId: string) => updateAssignment(deviceId, { roomId: null, equipmentId: null }),
    [updateAssignment]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<DeviceContextValue>(
    () => ({
      devices,
      loading,
      error,
      refresh,
      assignDevice,
      unassignDevice,
    }),
    [devices, loading, error, refresh, assignDevice, unassignDevice]
  );

  return React.createElement(DeviceContext.Provider, { value }, children);
};

export const useDevices = (): DeviceContextValue => {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error("useDevices must be used within a DeviceProvider");
  }
  return context;
};
