import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const FARMS_FILE = path.join(DATA_DIR, 'network-farms.json');

let cached = null;

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function seedFarms() {
  const demoUrl = process.env.DEMO_FARM_URL || process.env.LIGHT_ENGINE_URL || 'http://127.0.0.1:8091';
  return [
    {
      farm_id: 'light-engine-demo',
      farm_name: 'Light Engine Demo Farm',
      base_url: demoUrl,
      city: null,
      state: null,
      latitude: null,
      longitude: null,
      status: 'active',
      created_at: new Date().toISOString()
    }
  ];
}

async function loadFromDisk() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(FARMS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.farms)) return null;
    return parsed.farms;
  } catch {
    return null;
  }
}

async function saveToDisk(farms) {
  await ensureDataDir();
  const payload = { farms, updated_at: new Date().toISOString() };
  await fs.writeFile(FARMS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

export async function listNetworkFarms() {
  if (!cached) {
    cached = (await loadFromDisk()) || seedFarms();
  }
  return [...cached];
}

export async function upsertNetworkFarm(farm) {
  if (!cached) cached = (await loadFromDisk()) || seedFarms();

  const farmId = String(farm?.farm_id || '').trim();
  if (!farmId) throw new Error('farm_id is required');

  const idx = cached.findIndex((f) => f.farm_id === farmId);
  const next = {
    farm_id: farmId,
    farm_name: String(farm?.farm_name || '').trim() || farmId,
    base_url: String(farm?.base_url || '').trim(),
    city: farm?.city ?? null,
    state: farm?.state ?? null,
    latitude: farm?.latitude ?? null,
    longitude: farm?.longitude ?? null,
    status: farm?.status || 'active',
    created_at: idx >= 0 ? cached[idx].created_at : new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (!next.base_url) throw new Error('base_url is required');

  if (idx >= 0) cached[idx] = next;
  else cached.push(next);

  await saveToDisk(cached);
  return next;
}

export async function removeNetworkFarm(farmId) {
  if (!cached) cached = (await loadFromDisk()) || seedFarms();
  const before = cached.length;
  cached = cached.filter((f) => f.farm_id !== String(farmId));
  if (cached.length !== before) await saveToDisk(cached);
  return { removed: cached.length !== before };
}
