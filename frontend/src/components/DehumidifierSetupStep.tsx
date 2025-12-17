
import React, { useState, useEffect } from "react";

import { ZERO_RESULTS_TEXT } from "../constants/zeroState";

interface Dehumidifier {
  id: string;
  name: string;
  capacity?: string;
  control?: string;
}

// Helper to convert backend device to Dehumidifier type
function deviceToDehumidifier(device: any): Dehumidifier {
  return {
    id: device.device_id || device.id || device.name,
    name: device.name || device.device_id || device.id,
    capacity: device.details?.capacity || device.details?.specs || undefined,
    control: device.details?.control || device.protocol || undefined,
  };
}

const DEFAULT_DEHUMIDIFIER: Dehumidifier = {
  id: "quest-155",
  name: "Quest Quest Dual 155",
  capacity: "155 pints/day",
  control: "WiFi",
};

export const DehumidifierSetupStep: React.FC = () => {

  const [qty, setQty] = useState(1);
  const [search, setSearch] = useState("");
  const [dehumidifiers, setDehumidifiers] = useState<Dehumidifier[]>([]);
  const [selected, setSelected] = useState<Dehumidifier | null>(null);
  const [loading, setLoading] = useState(false);
  // Fetch dehumidifiers from backend
  useEffect(() => {
    let cancelled = false;
    const loadDevices = async () => {
      setLoading(true);
      try {
        const response = await fetch("/devices");
        if (!response.ok) {
          throw new Error(response.statusText);
        }
        const devices = await response.json().catch(() => null);
        const deviceList: any[] = Array.isArray(devices)
          ? devices
          : devices && Array.isArray((devices as any).devices)
          ? (devices as any).devices
          : [];
        const filtered = deviceList.filter((d: any) => (d.category || "").toLowerCase().includes("dehumidifier"));
        if (!cancelled) {
          setDehumidifiers(filtered.map(deviceToDehumidifier));
        }
      } catch (e) {
        console.warn("[net]", e);
        if (!cancelled) {
          setDehumidifiers([]);
        }
        return;
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadDevices();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleAdd = () => setQty(q => q + 1);
  const handleSubtract = () => setQty(q => (q > 1 ? q - 1 : 1));
  const handleRemove = () => setQty(0);

  // Filter dehumidifiers by search
  const filteredDehums = search
    ? dehumidifiers.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))
    : dehumidifiers;

  return (
    <div style={{ maxWidth: 540, margin: "0 auto", background: "#fff", borderRadius: 12, boxShadow: "0 2px 12px #0001", padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>Set up a Grow Room</h2>
      <h3>Dehumidifier setup</h3>
      <p style={{ color: "#64748b" }}>We’ll capture a quick count, control method, and energy metering for each device type.</p>
      <div style={{ margin: "24px 0" }}>
        <label htmlFor="dehum-search" style={{ fontWeight: 600 }}>Search dehumidifiers:</label>
        <input
          id="dehum-search"
          type="text"
          placeholder="Search models (e.g., Quest Dual 155)"
          style={{ width: "100%", margin: "8px 0 0 0", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {loading && <div style={{ color: "#64748b", fontSize: 13 }}>Loading dehumidifiers...</div>}
        {search && filteredDehums.length > 0 && (
          <div style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, marginTop: 8 }}>
            {filteredDehums.map(d => (
              <div
                key={d.id}
                style={{ padding: 8, borderBottom: "1px solid #e2e8f0", cursor: "pointer" }}
                onClick={() => {
                  setSelected(d);
                  setSearch("");
                }}
              >
                <span style={{ fontWeight: 600 }}>{d.name}</span>
                {d.capacity && <span style={{ marginLeft: 8, color: "#64748b" }}>{d.capacity}</span>}
                {d.control && <span style={{ marginLeft: 8, color: "#64748b" }}>{d.control}</span>}
              </div>
            ))}
          </div>
        )}
        {search && !loading && filteredDehums.length === 0 && (
          <div className="device-manager__empty" style={{ color: "#64748b", fontSize: 13, marginTop: 8 }}>
            {ZERO_RESULTS_TEXT}
          </div>
        )}
      </div>
      <div style={{ margin: "16px 0" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Selected Dehumidifiers:</div>
        {qty > 0 && selected ? (
          <div style={{ display: "flex", alignItems: "center", background: "#f8fafc", borderRadius: 8, padding: 12, border: "1px solid #e2e8f0" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{selected.name}</div>
              <div style={{ fontSize: 14, color: "#334155" }}>
                Qty: {qty}
                {selected.capacity && <> • {selected.capacity}</>}
                {selected.control && <> • {selected.control}</>}
              </div>
            </div>
            <button onClick={handleSubtract} style={{ width: 32, height: 32, fontSize: 18, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", marginRight: 4 }}>-</button>
            <span style={{ minWidth: 24, textAlign: "center" }}>{qty}</span>
            <button onClick={handleAdd} style={{ width: 32, height: 32, fontSize: 18, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", marginLeft: 4 }}>+</button>
            <button onClick={handleRemove} style={{ marginLeft: 12, color: "#fff", background: "#ef4444", border: "none", borderRadius: 6, width: 32, height: 32, fontWeight: 700, fontSize: 18 }}>×</button>
          </div>
        ) : (
          <div style={{ color: "#64748b", fontStyle: "italic" }}>No dehumidifiers selected.</div>
        )}
      </div>
      <div style={{ margin: "24px 0 0 0" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Control Options</div>
        <label style={{ display: "block", marginBottom: 4 }}>
          <input type="checkbox" checked={true} readOnly /> Wi-Fi Control
        </label>
        <label style={{ display: "block", marginBottom: 4 }}>
          <input type="checkbox" checked={true} readOnly /> Wired Thermostat Control
        </label>
        <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>• Needs info</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32 }}>
        <button style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 24px", fontWeight: 600 }}>Previous</button>
        <button style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 6, padding: "8px 24px", fontWeight: 600 }}>Next</button>
      </div>
    </div>
  );
};

export default DehumidifierSetupStep;
