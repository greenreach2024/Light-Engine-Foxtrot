import path from 'path';
import { readJsonFileSync, writeJsonFileSync, ensureDirSync } from './utils/file-storage.js';

function normalizePlug(definition) {
  if (!definition) return null;
  const vendor = String(definition.vendor || 'generic').toLowerCase();
  const shortId = String(definition.deviceId || definition.shortId || definition.id || '').trim();
  const normalizedId = shortId ? `plug:${vendor}:${shortId}` : `plug:${vendor}:${Date.now()}`;
  return {
    id: normalizedId,
    vendor,
    name: definition.name || definition.label || shortId || 'Smart Plug',
    model: definition.model || '',
    manual: definition.manual !== false,
    connection: definition.connection || {},
    metadata: definition.metadata || {},
    createdAt: definition.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export default class PlugRegistry {
  constructor(options = {}) {
    const {
      dataDir = path.resolve('./data/automation'),
      fileName = 'plugs.json'
    } = options;

    this.dataDir = dataDir;
    this.filePath = path.join(this.dataDir, fileName);
    ensureDirSync(this.dataDir);
    const payload = readJsonFileSync(this.filePath, { plugs: [] });
    this.plugs = Array.isArray(payload?.plugs) ? payload.plugs.map(normalizePlug) : [];
  }

  list() {
    return this.plugs.map(plug => ({ ...plug }));
  }

  listByVendor(vendor) {
    return this.plugs.filter(plug => plug.vendor === vendor).map(plug => ({ ...plug }));
  }

  upsert(definition) {
    const normalized = normalizePlug(definition);
    const index = this.plugs.findIndex(plug => plug.id === normalized.id);
    if (index >= 0) {
      this.plugs[index] = { ...this.plugs[index], ...normalized, updatedAt: new Date().toISOString() };
    } else {
      this.plugs.push(normalized);
    }
    this.persist();
    return normalized;
  }

  remove(plugId) {
    const before = this.plugs.length;
    this.plugs = this.plugs.filter(plug => plug.id !== plugId);
    if (before !== this.plugs.length) {
      this.persist();
      return true;
    }
    return false;
  }

  persist() {
    writeJsonFileSync(this.filePath, { plugs: this.plugs });
  }
}
