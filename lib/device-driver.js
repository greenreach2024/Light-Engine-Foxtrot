/**
 * Device Driver Interface
 * 
 * Ticket I-2.9: Minimal driver interface (5 methods)
 * 
 * Provides a standardized interface for device drivers to implement.
 * Drivers abstract protocol-specific details (SwitchBot, Kasa, MQTT, etc.)
 * and expose a consistent API for device management.
 * 
 * @module lib/device-driver
 */

/**
 * Base device driver class
 * All protocol-specific drivers should extend this class
 */
export class DeviceDriver {
  /**
   * @param {Object} config - Driver configuration
   * @param {string} config.protocol - Protocol type (switchbot, kasa, mqtt, zigbee, etc.)
   * @param {string} [config.driverVersion] - Driver version (default: 1.0.0)
   * @param {Object} [config.options] - Protocol-specific options
   */
  constructor(config = {}) {
    this.protocol = config.protocol || 'generic';
    this.driverVersion = config.driverVersion || '1.0.0';
    this.options = config.options || {};
    this.connected = false;
    this.lastError = null;
    this.devices = new Map(); // device_id -> device state
  }

  /**
   * Get driver identifier
   * @returns {string} Driver ID in format: {protocol}.{type}.v{version}
   */
  get driverId() {
    return `${this.protocol}.generic.v${this.driverVersion.split('.')[0]}`;
  }

  // ============================================================
  // CORE INTERFACE - 5 Required Methods
  // ============================================================

  /**
   * 1. connect() - Establish connection to device/hub
   * 
   * Initializes communication with the device or hub.
   * For hub-based protocols (SwitchBot Hub, Zigbee coordinator),
   * this connects to the hub. For direct protocols, connects to device.
   * 
   * @param {Object} connectionConfig - Connection parameters
   * @param {string} [connectionConfig.host] - Hub/device IP or hostname
   * @param {number} [connectionConfig.port] - Connection port
   * @param {string} [connectionConfig.token] - Authentication token
   * @param {string} [connectionConfig.secret] - Authentication secret
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async connect(connectionConfig = {}) {
    // Override in subclass
    this.connected = true;
    return { ok: true };
  }

  /**
   * 2. disconnect() - Close connection cleanly
   * 
   * Releases resources and closes connections.
   * Should be idempotent (safe to call multiple times).
   * 
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async disconnect() {
    // Override in subclass
    this.connected = false;
    return { ok: true };
  }

  /**
   * 3. discover() - Find devices on network
   * 
   * Scans for compatible devices. For hub-based protocols,
   * queries the hub for paired devices. For direct protocols,
   * performs network discovery (mDNS, UDP broadcast, etc.).
   * 
   * @param {Object} [options] - Discovery options
   * @param {number} [options.timeout] - Discovery timeout in ms (default: 10000)
   * @param {string} [options.filter] - Optional device type filter
   * @returns {Promise<{ok: boolean, devices: DeviceInfo[], error?: string}>}
   */
  async discover(options = {}) {
    // Override in subclass
    return { ok: true, devices: [] };
  }

  /**
   * 4. getStatus(deviceId) - Get current device state
   * 
   * Queries the device for its current state.
   * Returns telemetry data (power, temperature, humidity, etc.)
   * and operational status (online, offline, error).
   * 
   * @param {string} deviceId - Device identifier
   * @returns {Promise<{ok: boolean, status: DeviceStatus, error?: string}>}
   */
  async getStatus(deviceId) {
    // Override in subclass
    return { 
      ok: true, 
      status: {
        deviceId,
        online: false,
        power: 'unknown',
        lastSeen: null,
        telemetry: {}
      }
    };
  }

  /**
   * 5. sendCommand(deviceId, command, params) - Execute device command
   * 
   * Sends a command to the device. Common commands:
   * - "turnOn" / "turnOff" - Power control
   * - "setLevel" - Dimmer/brightness level (0-100)
   * - "setTemperature" - Thermostat setpoint
   * - "setColor" - RGB/HSV color
   * 
   * @param {string} deviceId - Device identifier
   * @param {string} command - Command name
   * @param {Object} [params] - Command parameters
   * @returns {Promise<{ok: boolean, result?: any, error?: string}>}
   */
  async sendCommand(deviceId, command, params = {}) {
    // Override in subclass
    return { ok: false, error: 'Not implemented' };
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  /**
   * Check if driver is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get all discovered devices
   * @returns {Array<DeviceInfo>}
   */
  getDevices() {
    return Array.from(this.devices.values());
  }

  /**
   * Get device by ID
   * @param {string} deviceId 
   * @returns {DeviceInfo|undefined}
   */
  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }

  /**
   * Get driver capabilities
   * @returns {DriverCapabilities}
   */
  getCapabilities() {
    return {
      protocol: this.protocol,
      driverId: this.driverId,
      version: this.driverVersion,
      commands: ['turnOn', 'turnOff'], // Override in subclass
      telemetry: [], // Override in subclass
      supportsDiscovery: true,
      supportsGroups: false // Override if protocol supports native groups
    };
  }

  /**
   * Validate device configuration
   * @param {Object} config - Device config to validate
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateConfig(config) {
    const errors = [];
    
    if (!config) {
      errors.push('Configuration is required');
    }
    
    // Override in subclass for protocol-specific validation
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * @typedef {Object} DeviceInfo
 * @property {string} deviceId - Unique device identifier
 * @property {string} name - Human-readable device name
 * @property {string} type - Device type (light, sensor, plug, switch, etc.)
 * @property {string} model - Device model/product name
 * @property {string} manufacturer - Device manufacturer
 * @property {string} protocol - Communication protocol
 * @property {Object} capabilities - Device capabilities
 * @property {boolean} [isHub] - True if device is a hub/coordinator
 */

/**
 * @typedef {Object} DeviceStatus
 * @property {string} deviceId - Device identifier
 * @property {boolean} online - True if device is reachable
 * @property {string} power - Power state: 'on', 'off', 'unknown'
 * @property {number} [level] - Brightness/power level (0-100)
 * @property {Date|string} lastSeen - Last successful communication
 * @property {Object} telemetry - Protocol-specific telemetry data
 * @property {string} [error] - Error message if device has issues
 */

/**
 * @typedef {Object} DriverCapabilities
 * @property {string} protocol - Protocol name
 * @property {string} driverId - Full driver identifier
 * @property {string} version - Driver version
 * @property {string[]} commands - Supported command names
 * @property {string[]} telemetry - Available telemetry types
 * @property {boolean} supportsDiscovery - Can discover devices
 * @property {boolean} supportsGroups - Supports native device groups
 */

// ============================================================
// DRIVER REGISTRY
// ============================================================

/**
 * Registry of available device drivers
 */
class DriverRegistry {
  constructor() {
    this.drivers = new Map(); // protocol -> DriverClass
    this.instances = new Map(); // driverId -> DriverInstance
  }

  /**
   * Register a driver class
   * @param {string} protocol - Protocol identifier
   * @param {typeof DeviceDriver} DriverClass - Driver class to register
   */
  register(protocol, DriverClass) {
    this.drivers.set(protocol, DriverClass);
    console.log(`[driver-registry] Registered driver for protocol: ${protocol}`);
  }

  /**
   * Get a driver instance for a protocol
   * @param {string} protocol - Protocol identifier
   * @param {Object} [config] - Driver configuration
   * @returns {DeviceDriver|null}
   */
  getDriver(protocol, config = {}) {
    const DriverClass = this.drivers.get(protocol);
    if (!DriverClass) {
      console.warn(`[driver-registry] No driver registered for protocol: ${protocol}`);
      return null;
    }
    
    const driverId = `${protocol}.${config.type || 'generic'}.v${config.version || '1'}`;
    
    // Return cached instance if exists
    if (this.instances.has(driverId)) {
      return this.instances.get(driverId);
    }
    
    // Create new instance
    const instance = new DriverClass({ ...config, protocol });
    this.instances.set(driverId, instance);
    return instance;
  }

  /**
   * Get list of registered protocols
   * @returns {string[]}
   */
  getProtocols() {
    return Array.from(this.drivers.keys());
  }

  /**
   * Check if a protocol is supported
   * @param {string} protocol 
   * @returns {boolean}
   */
  hasProtocol(protocol) {
    return this.drivers.has(protocol);
  }
}

// Singleton registry instance
export const driverRegistry = new DriverRegistry();

// ============================================================
// BUILT-IN GENERIC DRIVER
// ============================================================

/**
 * Generic driver for testing and fallback
 * Implements all 5 methods with mock responses
 */
export class GenericDriver extends DeviceDriver {
  constructor(config = {}) {
    super({ ...config, protocol: 'generic' });
  }

  async connect(connectionConfig = {}) {
    this.connected = true;
    console.log(`[generic-driver] Connected (mock)`);
    return { ok: true };
  }

  async disconnect() {
    this.connected = false;
    return { ok: true };
  }

  async discover(options = {}) {
    // Return empty device list for generic driver
    return { 
      ok: true, 
      devices: [],
      message: 'Generic driver does not support discovery'
    };
  }

  async getStatus(deviceId) {
    const device = this.devices.get(deviceId);
    return { 
      ok: true, 
      status: {
        deviceId,
        online: !!device,
        power: device?.power || 'unknown',
        lastSeen: device?.lastSeen || null,
        telemetry: device?.telemetry || {}
      }
    };
  }

  async sendCommand(deviceId, command, params = {}) {
    console.log(`[generic-driver] Mock command: ${command} -> ${deviceId}`, params);
    return { 
      ok: true, 
      result: { 
        command, 
        deviceId, 
        params,
        simulated: true 
      }
    };
  }

  getCapabilities() {
    return {
      ...super.getCapabilities(),
      commands: ['turnOn', 'turnOff', 'setLevel'],
      telemetry: [],
      supportsDiscovery: false,
      supportsGroups: false
    };
  }
}

// Register generic driver as fallback
driverRegistry.register('generic', GenericDriver);

export default DeviceDriver;
