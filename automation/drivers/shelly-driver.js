function toNormalizedPlug(definition, state = {}) {
  return {
    id: definition.id,
    vendor: 'shelly',
    name: definition.name || definition.id,
    model: definition.model || 'Shelly Plug',
    source: definition.manual ? 'manual' : 'discovered',
    connection: definition.connection || {},
    state: {
      online: Boolean(state.online ?? true),
      on: Boolean(state.on ?? state.output ?? false),
      powerW: typeof state.powerW === 'number' ? state.powerW : (typeof state.apower === 'number' ? state.apower : null),
      lastSeen: state.lastSeen || new Date().toISOString()
    },
    capabilities: {
      dimmable: false,
      powerMonitoring: true
    }
  };
}

export default class ShellyPlugDriver {
  constructor(options = {}) {
    this.devices = new Map();
    this.timeoutMs = options.timeoutMs || 2000;
  }

  vendor() {
    return 'shelly';
  }

  syncManualDefinitions(definitions = []) {
    this.devices = new Map(definitions.map((def) => [def.id, def]));
  }

  async discover() {
    const plugs = [];
    for (const definition of this.devices.values()) {
      const state = await this.safeGetState(definition).catch(() => ({}));
      plugs.push(toNormalizedPlug(definition, state));
    }
    return plugs;
  }

  async safeGetState(definition) {
    try {
      const state = await this.getState(definition.id);
      return state;
    } catch (error) {
      return { online: false, on: false, error: error.message };
    }
  }

  async request(definition, rpcMethod, params = {}) {
    if (!definition?.connection?.host) {
      throw new Error('Shelly device host not configured');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = new URL(`/rpc/${rpcMethod}`, `http://${definition.connection.host}`);
    if (definition.connection.token) {
      url.searchParams.set('auth_key', definition.connection.token);
    }
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Shelly RPC ${rpcMethod} failed (${response.status})`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      throw new Error(`Shelly request error: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getState(id) {
    const definition = this.devices.get(id);
    if (!definition) {
      throw new Error(`Shelly plug ${id} not registered`);
    }
    const channel = definition.connection?.channel ?? 0;
    const data = await this.request(definition, 'Switch.GetStatus', { id: channel });
    return {
      online: true,
      on: Boolean(data?.output),
      powerW: typeof data?.apower === 'number' ? data.apower : null,
      lastSeen: new Date().toISOString()
    };
  }

  async setOn(id, on) {
    const definition = this.devices.get(id);
    if (!definition) {
      throw new Error(`Shelly plug ${id} not registered`);
    }
    const channel = definition.connection?.channel ?? 0;
    await this.request(definition, 'Switch.Set', { id: channel, on: on ? 'true' : 'false' });
    return this.getState(id);
  }

  async readPower(id) {
    const state = await this.getState(id);
    return state.powerW ?? null;
  }
}
