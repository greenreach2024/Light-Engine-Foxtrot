function toNormalizedPlug(definition, sysInfo = {}, emeter = {}) {
  const relayState = typeof sysInfo?.relay_state === 'number' ? sysInfo.relay_state === 1 : sysInfo?.relay_state === true;
  const powerMilli = typeof emeter?.power_mw === 'number' ? emeter.power_mw : null;
  const powerW = typeof emeter?.power === 'number' ? emeter.power : (powerMilli !== null ? powerMilli / 1000 : null);
  return {
    id: definition.id,
    vendor: 'kasa',
    name: definition.name || sysInfo.alias || definition.id,
    model: sysInfo.model || definition.model || 'Kasa Plug',
    source: definition.manual ? 'manual' : 'discovered',
    connection: definition.connection || {},
    state: {
      online: sysInfo.sys_info ? Boolean(sysInfo.sys_info.relay_state !== undefined) : true,
      on: Boolean(relayState),
      powerW: powerW === null ? null : Number(powerW.toFixed(2)),
      lastSeen: new Date().toISOString()
    },
    capabilities: {
      dimmable: false,
      powerMonitoring: powerW !== null
    }
  };
}

async function loadKasaClient() {
  const kasaModule = await import('tplink-smarthome-api');
  const Client = kasaModule.default?.Client || kasaModule.Client || kasaModule.default;
  if (!Client) {
    throw new Error('Kasa client not available from tplink-smarthome-api');
  }
  return new Client();
}

export default class KasaPlugDriver {
  constructor(options = {}) {
    this.devices = new Map();
    this.discoveryTimeoutMs = options.discoveryTimeoutMs || 2000;
    this.clientPromise = null;
  }

  vendor() {
    return 'kasa';
  }

  syncManualDefinitions(definitions = []) {
    this.devices = new Map(definitions.map((def) => [def.id, def]));
  }

  async ensureClient() {
    if (!this.clientPromise) {
      this.clientPromise = loadKasaClient().catch((error) => {
        console.warn('[automation] Kasa client initialization failed:', error.message);
        throw error;
      });
    }
    return this.clientPromise;
  }

  async discover() {
    const plugs = [];
    for (const definition of this.devices.values()) {
      const state = await this.safeSnapshot(definition).catch(() => null);
      plugs.push(toNormalizedPlug(definition, state?.sysInfo || {}, state?.emeter || {}));
    }

    // Attempt LAN discovery when possible
    try {
      const client = await this.ensureClient();
      const discovered = await new Promise((resolve, reject) => {
        const found = new Map();
        const discovery = client.startDiscovery({ discoveryTimeout: this.discoveryTimeoutMs });
        discovery.on('device-new', (device) => {
          found.set(device.id || device.deviceId || device.sysInfo?.deviceId, device);
        });
        discovery.on('end', () => resolve(Array.from(found.values())));
        discovery.on('error', reject);
      });
      for (const device of discovered) {
        const sysInfo = await device.getSysInfo().catch(() => device.sysInfo || {});
        const emeter = await device.emeter?.getRealtime().catch(() => ({})) || {};
        const shortId = sysInfo?.deviceId || device.id || device.deviceId;
        const id = `plug:kasa:${shortId}`;
        plugs.push(toNormalizedPlug({
          id,
          vendor: 'kasa',
          name: sysInfo?.alias || shortId,
          model: sysInfo?.model,
          manual: false,
          connection: { deviceId: shortId }
        }, sysInfo, emeter));
      }
    } catch (error) {
      console.warn('[automation] Kasa discovery skipped:', error.message);
    }

    const unique = new Map();
    for (const plug of plugs) {
      unique.set(plug.id, plug);
    }
    return Array.from(unique.values());
  }

  async safeSnapshot(definition) {
    try {
      const sysInfo = await this.getSysInfo(definition.id);
      const emeter = await this.readEmeter(definition.id).catch(() => ({}));
      return { sysInfo, emeter };
    } catch (error) {
      return null;
    }
  }

  resolveDefinition(id) {
    const definition = this.devices.get(id);
    if (definition) return definition;
    if (!id.startsWith('plug:kasa:')) {
      throw new Error(`Unsupported Kasa plug identifier: ${id}`);
    }
    return {
      id,
      vendor: 'kasa',
      manual: false,
      connection: { deviceId: id.split('plug:kasa:')[1] }
    };
  }

  async getDeviceHandle(definition) {
    const client = await this.ensureClient();
    const connection = definition.connection || {};
    const lookup = connection.host
      ? { host: connection.host }
      : connection.deviceId
      ? { deviceId: connection.deviceId }
      : null;
    if (!lookup) {
      throw new Error('Kasa device requires host or deviceId');
    }
    return client.getDevice(lookup);
  }

  async getSysInfo(id) {
    const definition = this.resolveDefinition(id);
    try {
      const device = await this.getDeviceHandle(definition);
      const sysInfo = await device.getSysInfo();
      return sysInfo;
    } catch (error) {
      throw new Error(`Kasa getSysInfo failed: ${error.message}`);
    }
  }

  async readEmeter(id) {
    const definition = this.resolveDefinition(id);
    const device = await this.getDeviceHandle(definition);
    if (!device.emeter) {
      throw new Error('Emeter not available');
    }
    return device.emeter.getRealtime();
  }

  async getState(id) {
    const sysInfo = await this.getSysInfo(id);
    const emeter = await this.readEmeter(id).catch(() => ({}));
    return {
      online: true,
      on: Boolean(sysInfo.relay_state === 1 || sysInfo.relay_state === true),
      powerW: typeof emeter.power === 'number' ? Number(emeter.power.toFixed(2)) : null,
      lastSeen: new Date().toISOString()
    };
  }

  async setOn(id, on) {
    const definition = this.resolveDefinition(id);
    const device = await this.getDeviceHandle(definition);
    await device.setPowerState(Boolean(on));
    return this.getState(id);
  }

  async readPower(id) {
    const emeter = await this.readEmeter(id);
    const power = typeof emeter.power === 'number' ? emeter.power : null;
    return power === null ? null : Number(power.toFixed(2));
  }
}
