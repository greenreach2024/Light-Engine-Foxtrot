// controller/environment-loop.js
import { getAnomalies, getEffects } from '../services/ml-gateway.js';
import { coreAllocator } from './coreAllocator.js';

function robustSensor(z, key, allZones, anomalies) {
  const zKey = `${z.id}.${key}`;
  const sev = anomalies?.anomalies?.find(a => a.zoneId === z.id && a.sensor === key)?.severity ?? 0;
  const conf = anomalies?.confidences?.[zKey] ?? 1.0;
  if (sev < 0.8 && conf >= 0.5) return z.sensors?.[key]?.current;
  // fallback: median of neighbors (distance-weighted); simplified here
  const vals = allZones.filter(o => o.id !== z.id).map(o => o.sensors?.[key]?.current).filter(v => v != null);
  if (!vals.length) return z.sensors?.[key]?.current;
  vals.sort((a,b)=>a-b);
  return vals[Math.floor(vals.length/2)];
}

export async function tick(allZones, iotDevices, context) {
  let anomalies=null, effects=null;
  try { anomalies = await getAnomalies(); } catch {}
  try { effects   = await getEffects();   } catch {}

  const zonesForControl = allZones.map(z => ({
    ...z,
    sensors: {
      rh:    { current: robustSensor(z, 'rh', allZones, anomalies) },
      tempC: { current: robustSensor(z, 'tempC', allZones, anomalies) }
    }
  }));

  const ml = effects ? { H: effects.H, T: effects.T, confidence: effects.confidence } : null;
  await coreAllocator(zonesForControl, iotDevices, ml, context);
}
