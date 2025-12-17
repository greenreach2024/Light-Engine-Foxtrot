import fs from 'fs';
import path from 'path';
import SwitchBotPlugDriver from './drivers/switchbot-driver.js';

const FARM_PROFILE_PATH = path.resolve('./public/data/farm.json');

function readSwitchBotCredentials() {
  const envToken = (process.env.SWITCHBOT_TOKEN || '').trim();
  const envSecret = (process.env.SWITCHBOT_SECRET || '').trim();
  const apiBase = process.env.SWITCHBOT_API_BASE || 'https://api.switch-bot.com/v1.1';

  if (envToken && envSecret) {
    return { token: envToken, secret: envSecret, apiBase };
  }

  try {
    if (!fs.existsSync(FARM_PROFILE_PATH)) {
      return { token: envToken, secret: envSecret, apiBase };
    }
    const raw = fs.readFileSync(FARM_PROFILE_PATH, 'utf8');
    const farm = JSON.parse(raw);
    const sb = farm?.integrations?.switchbot || {};
    const token = (sb.token || envToken || '').trim();
    const secret = (sb.secret || envSecret || '').trim();
    const regionBase = sb.apiBase || apiBase;
    return { token, secret, apiBase: regionBase || 'https://api.switch-bot.com/v1.1' };
  } catch (error) {
    console.warn('[automation] Unable to read switchbot credentials from farm profile:', error.message);
    return { token: envToken, secret: envSecret, apiBase };
  }
}

function normalizeAction(action) {
  if (!action) return null;
  const payload = { ...action };
  if (typeof payload.set === 'string') {
    payload.set = payload.set.toLowerCase();
  }
  return payload;
}

export default class PlugManager {
  constructor({ registry, logger } = {}) {
    this.registry = registry;
    this.logger = logger;
    this.drivers = new Map();
    this.switchBotCreds = null;

    this.ensureSwitchBotDriver();

    this.refreshManualAssignments();
  }

  // Dynamically register Kasa driver when user initiates Kasa search
  registerKasaDriver() {
    if (!this.drivers.has('kasa')) {
      const KasaPlugDriver = require('./drivers/kasa-driver.js').default;
      this.registerDriver(new KasaPlugDriver());
    }
  }

  // Dynamically register Shelly driver when user initiates Shelly search
  registerShellyDriver() {
    if (!this.drivers.has('shelly')) {
      const ShellyPlugDriver = require('./drivers/shelly-driver.js').default;
      this.registerDriver(new ShellyPlugDriver());
    }
  }
  registerDriver(driver) {
    if (!driver) return;
    this.drivers.set(driver.vendor(), driver);
  }

  ensureSwitchBotDriver() {
    const creds = readSwitchBotCredentials();
    const changed = !this.switchBotCreds ||
      this.switchBotCreds.token !== creds.token ||
      this.switchBotCreds.secret !== creds.secret ||
      this.switchBotCreds.apiBase !== creds.apiBase;
    const driver = this.drivers.get('switchbot');

    if (!driver) {
      this.registerDriver(new SwitchBotPlugDriver(creds));
      this.switchBotCreds = creds;
      return;
    }

    if (changed) {
      if (typeof driver.updateCredentials === 'function') {
        driver.updateCredentials(creds);
      } else {
        this.registerDriver(new SwitchBotPlugDriver(creds));
      }
      this.switchBotCreds = creds;
    }
  }

  refreshManualAssignments() {
    if (!this.registry) return;
    const plugs = this.registry.list();
    const byVendor = plugs.reduce((acc, plug) => {
      const vendor = plug.vendor;
      if (!acc[vendor]) acc[vendor] = [];
      acc[vendor].push(plug);
      return acc;
    }, {});
    for (const [vendor, devices] of Object.entries(byVendor)) {
      const driver = this.drivers.get(vendor);
      if (driver?.syncManualDefinitions) {
        driver.syncManualDefinitions(devices);
      }
    }
  }

  async discoverAll() {
    this.ensureSwitchBotDriver();
    const results = [];
    for (const driver of this.drivers.values()) {
      try {
        const plugs = await driver.discover();
        results.push(...plugs);
      } catch (error) {
        console.warn(`[automation] ${driver.vendor()} discovery failed:`, error.message);
      }
    }
    return this.mergeWithRegistry(results);
  }

  mergeWithRegistry(discoveredPlugs) {
    const manualPlugs = this.registry ? this.registry.list() : [];
    const combined = new Map();
    for (const plug of discoveredPlugs) {
      combined.set(plug.id, plug);
    }
    for (const manual of manualPlugs) {
      if (!combined.has(manual.id)) {
        combined.set(manual.id, {
          id: manual.id,
          vendor: manual.vendor,
          name: manual.name,
          model: manual.model,
          source: 'manual',
          connection: manual.connection,
          state: { online: false, on: false, powerW: null },
          capabilities: { dimmable: false, powerMonitoring: false }
        });
      }
    }
    return Array.from(combined.values());
  }

  async getState(plugId) {
    const driver = this.getDriverForPlug(plugId);
    if (!driver) throw new Error(`Driver not found for ${plugId}`);
    const state = await driver.getState(plugId);
    return state;
  }

  getDriverForPlug(plugId) {
    // Handle both normalized format (plug:vendor:id) and bare device IDs
    if (plugId.includes(':')) {
      // Format: plug:vendor:id - extract vendor from position 1
      const vendor = plugId.split(':')[1];
      return this.drivers.get(vendor);
    } else {
      // Bare device ID - fallback to pattern matching
      // SwitchBot uses MAC addresses (12 hex chars)
      if (/^[0-9A-F]{12}$/i.test(plugId)) {
        return this.drivers.get('switchbot');
      }
      // Kasa devices typically have longer IDs
      if (plugId.length > 20) {
        return this.drivers.get('kasa');
      }
      
      return null;
    }
  }

  async setPowerState(plugId, on) {
    const driver = this.getDriverForPlug(plugId);
    if (!driver) throw new Error(`Driver not found for ${plugId}`);
    const state = await driver.setOn(plugId, on);
    return state;
  }

  async readPower(plugId) {
    const driver = this.getDriverForPlug(plugId);
    if (!driver?.readPower) return null;
    return driver.readPower(plugId);
  }

  async snapshot(actions = []) {
    const uniquePlugIds = Array.from(new Set(actions.map((action) => normalizeAction(action)?.plugId).filter(Boolean)));
    const snapshot = {};
    for (const plugId of uniquePlugIds) {
      try {
        snapshot[plugId] = await this.getState(plugId);
      } catch (error) {
        snapshot[plugId] = { error: error.message, online: false };
      }
    }
    return snapshot;
  }

  async apply(actions = []) {
    const results = [];
    for (const action of actions.map(normalizeAction)) {
      if (!action?.plugId) continue;
      const desired = action.set === 'off' ? false : action.set === 'on' ? true : Boolean(action.on ?? action.state);
      try {
        const state = await this.setPowerState(action.plugId, desired);
        results.push({ plugId: action.plugId, success: true, state });
      } catch (error) {
        console.warn(`[automation] Failed to set ${action.plugId}:`, error.message);
        results.push({ plugId: action.plugId, success: false, error: error.message });
      }
    }
    return results;
  }
}
