/**
 * Add Device Wizard Controller
 * 
 * Ticket I-2.10: Add Device Wizard MVP
 * 
 * A multi-step wizard that guides growers through adding new devices:
 * 1. Select device protocol/type
 * 2. Configure connection (manual or auto-discovery)
 * 3. Test connectivity
 * 4. Assign to room/zone
 * 5. Save integration record
 * 
 * @module lib/device-wizard
 */

import { driverRegistry, DeviceDriver } from './device-driver.js';

/**
 * Wizard step definitions
 */
export const WIZARD_STEPS = {
  PROTOCOL_SELECT: 'protocol_select',
  CONNECTION_CONFIG: 'connection_config',
  DEVICE_DISCOVERY: 'device_discovery',
  CONNECTIVITY_TEST: 'connectivity_test',
  ROOM_ASSIGNMENT: 'room_assignment',
  REVIEW_SAVE: 'review_save'
};

/**
 * Supported protocols with discovery methods
 */
export const PROTOCOL_OPTIONS = [
  {
    id: 'switchbot',
    name: 'SwitchBot',
    icon: '🔄',
    description: 'SwitchBot smart devices (plugs, sensors, hub)',
    requiresHub: true,
    discoveryMethod: 'api',
    configFields: ['token', 'secret']
  },
  {
    id: 'kasa',
    name: 'TP-Link Kasa',
    icon: '💡',
    description: 'Kasa smart plugs, lights, and switches',
    requiresHub: false,
    discoveryMethod: 'network',
    configFields: [] // Auto-discover via mDNS
  },
  {
    id: 'mqtt',
    name: 'MQTT Device',
    icon: '📡',
    description: 'Custom MQTT sensors and controllers',
    requiresHub: false,
    discoveryMethod: 'manual',
    configFields: ['broker', 'topic', 'clientId']
  },
  {
    id: 'tasmota',
    name: 'Tasmota',
    icon: '⚡',
    description: 'Tasmota-flashed devices (Sonoff, etc.)',
    requiresHub: false,
    discoveryMethod: 'network',
    configFields: ['host']
  },
  {
    id: 'modbus',
    name: 'Modbus TCP/RTU',
    icon: '🔌',
    description: 'Industrial Modbus devices',
    requiresHub: false,
    discoveryMethod: 'manual',
    configFields: ['host', 'port', 'unitId', 'registers']
  },
  {
    id: 'generic',
    name: 'Generic / Manual',
    icon: '📦',
    description: 'Manual device entry (no auto-discovery)',
    requiresHub: false,
    discoveryMethod: 'manual',
    configFields: ['name', 'type', 'host']
  }
];

/**
 * Device types for room assignment
 */
export const DEVICE_TYPES = [
  { id: 'light', name: 'Grow Light', icon: '💡' },
  { id: 'sensor', name: 'Environment Sensor', icon: '🌡️' },
  { id: 'plug', name: 'Smart Plug', icon: '🔌' },
  { id: 'hvac', name: 'HVAC / Climate', icon: '❄️' },
  { id: 'irrigation', name: 'Irrigation Controller', icon: '💧' },
  { id: 'co2', name: 'CO2 Controller', icon: '🫧' },
  { id: 'camera', name: 'Camera / Monitoring', icon: '📷' },
  { id: 'other', name: 'Other Device', icon: '📦' }
];

/**
 * Wizard state machine
 */
export class DeviceWizard {
  constructor(options = {}) {
    this.currentStep = WIZARD_STEPS.PROTOCOL_SELECT;
    this.state = {
      protocol: null,
      config: {},
      discoveredDevices: [],
      selectedDevice: null,
      connectivityResult: null,
      roomAssignment: {
        roomId: null,
        zoneId: null,
        groupId: null,
        function: null
      },
      integrationRecord: null
    };
    
    this.options = {
      onStepChange: options.onStepChange || (() => {}),
      onError: options.onError || console.error,
      onComplete: options.onComplete || (() => {}),
      integrationDB: options.integrationDB || null,
      skipDiscovery: options.skipDiscovery || false
    };
    
    this.driver = null;
  }

  /**
   * Get current wizard state
   */
  getState() {
    return {
      step: this.currentStep,
      ...this.state,
      availableProtocols: PROTOCOL_OPTIONS,
      deviceTypes: DEVICE_TYPES,
      canGoBack: this.currentStep !== WIZARD_STEPS.PROTOCOL_SELECT,
      canContinue: this._canContinue()
    };
  }

  /**
   * Select protocol and move to config step
   * @param {string} protocolId 
   */
  async selectProtocol(protocolId) {
    const protocol = PROTOCOL_OPTIONS.find(p => p.id === protocolId);
    if (!protocol) {
      throw new Error(`Unknown protocol: ${protocolId}`);
    }
    
    this.state.protocol = protocol;
    this.state.config = {};
    
    // Get or create driver
    this.driver = driverRegistry.getDriver(protocolId) || new DeviceDriver({ protocol: protocolId });
    
    this._goToStep(WIZARD_STEPS.CONNECTION_CONFIG);
    return this.getState();
  }

  /**
   * Set connection configuration
   * @param {Object} config - Protocol-specific config
   */
  async setConfig(config) {
    this.state.config = { ...this.state.config, ...config };
    return this.getState();
  }

  /**
   * Attempt to connect and discover devices
   */
  async discoverDevices() {
    if (!this.state.protocol) {
      throw new Error('Protocol not selected');
    }
    
    this._goToStep(WIZARD_STEPS.DEVICE_DISCOVERY);
    
    try {
      // Connect to hub/network
      const connectResult = await this.driver.connect(this.state.config);
      if (!connectResult.ok) {
        this.state.discoveredDevices = [];
        this.options.onError(connectResult.error || 'Connection failed');
        return this.getState();
      }
      
      // Discover devices
      const discoverResult = await this.driver.discover({ timeout: 15000 });
      this.state.discoveredDevices = discoverResult.devices || [];
      
      console.log(`[device-wizard] Discovered ${this.state.discoveredDevices.length} device(s)`);
      
      return this.getState();
    } catch (error) {
      this.options.onError(error.message);
      this.state.discoveredDevices = [];
      return this.getState();
    }
  }

  /**
   * Select a discovered device or input manual device
   * @param {Object} device - Device info object
   */
  async selectDevice(device) {
    this.state.selectedDevice = {
      deviceId: device.deviceId || device.id || `manual-${Date.now()}`,
      name: device.name || 'Unknown Device',
      type: device.type || 'other',
      model: device.model || device.device_make_model || 'Unknown',
      manufacturer: device.manufacturer || 'Unknown',
      protocol: this.state.protocol?.id || 'generic',
      capabilities: device.capabilities || { telemetry: [], commands: [] }
    };
    
    this._goToStep(WIZARD_STEPS.CONNECTIVITY_TEST);
    return this.testConnectivity();
  }

  /**
   * Test connectivity to selected device
   */
  async testConnectivity() {
    if (!this.state.selectedDevice) {
      throw new Error('No device selected');
    }
    
    try {
      const statusResult = await this.driver.getStatus(this.state.selectedDevice.deviceId);
      
      // Calculate signal quality based on response time and success
      const startTime = Date.now();
      let signalQuality = 0;
      let latencyMs = 0;
      
      if (statusResult.ok) {
        latencyMs = Date.now() - startTime;
        // Signal quality formula: 100 - (latency_ms / 10), clamped to 0-100
        signalQuality = Math.max(0, Math.min(100, 100 - (latencyMs / 10)));
      }
      
      this.state.connectivityResult = {
        success: statusResult.ok && statusResult.status?.online !== false,
        online: statusResult.status?.online ?? statusResult.ok,
        latencyMs,
        signalQuality: Math.round(signalQuality),
        dropoutRate: 0, // Will be calculated over time
        status: statusResult.status,
        testedAt: new Date().toISOString()
      };
      
      console.log(`[device-wizard] Connectivity test: ${this.state.connectivityResult.success ? 'PASS' : 'FAIL'}`);
      
      return this.getState();
    } catch (error) {
      this.state.connectivityResult = {
        success: false,
        online: false,
        error: error.message,
        testedAt: new Date().toISOString()
      };
      return this.getState();
    }
  }

  /**
   * Assign device to room/zone
   * @param {Object} assignment 
   */
  async assignToRoom(assignment) {
    this.state.roomAssignment = {
      roomId: assignment.roomId || null,
      zoneId: assignment.zoneId || null,
      groupId: assignment.groupId || null,
      function: assignment.function || this.state.selectedDevice?.type || null
    };
    
    this._goToStep(WIZARD_STEPS.REVIEW_SAVE);
    return this.getState();
  }

  /**
   * Skip room assignment (can assign later)
   */
  async skipRoomAssignment() {
    this._goToStep(WIZARD_STEPS.REVIEW_SAVE);
    return this.getState();
  }

  /**
   * Finalize and save the integration record
   */
  async saveIntegration() {
    if (!this.state.selectedDevice || !this.state.protocol) {
      throw new Error('Wizard not complete');
    }
    
    const record = {
      device_type: this.state.selectedDevice.type,
      device_make_model: `${this.state.selectedDevice.manufacturer} ${this.state.selectedDevice.model}`.trim(),
      protocol: this.state.protocol.id,
      driver_id: this.driver?.driverId || `${this.state.protocol.id}.generic.v1`,
      driver_version: this.driver?.driverVersion || '1.0.0',
      config: this._sanitizeConfig(this.state.config),
      room_id: this.state.roomAssignment.roomId,
      zone_id: this.state.roomAssignment.zoneId,
      group_id: this.state.roomAssignment.groupId,
      function: this.state.roomAssignment.function,
      capabilities: this.state.selectedDevice.capabilities,
      install_context: {
        wizard_version: '1.0.0',
        discovery_method: this.state.protocol.discoveryMethod,
        auto_discovered: this.state.discoveredDevices.length > 0
      },
      validation: {
        passed: this.state.connectivityResult?.success === true,
        signal_quality: this.state.connectivityResult?.signalQuality || null,
        dropout_rate: this.state.connectivityResult?.dropoutRate || 0,
        latency_ms: this.state.connectivityResult?.latencyMs || null,
        tested_at: this.state.connectivityResult?.testedAt
      },
      feedback: null // Grower can add later
    };
    
    this.state.integrationRecord = record;
    
    // Save to integration DB if available
    if (this.options.integrationDB) {
      try {
        // Generate record ID
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        record._id = `INT-${date}-${random}`;
        record.created_at = new Date().toISOString();
        record.updated_at = new Date().toISOString();
        
        await this.options.integrationDB.insert(record);
        console.log(`[device-wizard] Saved integration record: ${record._id}`);
      } catch (error) {
        this.options.onError(`Failed to save integration: ${error.message}`);
      }
    }
    
    this.options.onComplete(record);
    return {
      ...this.getState(),
      complete: true,
      record
    };
  }

  /**
   * Go back to previous step
   */
  goBack() {
    const stepOrder = Object.values(WIZARD_STEPS);
    const currentIndex = stepOrder.indexOf(this.currentStep);
    
    if (currentIndex > 0) {
      this._goToStep(stepOrder[currentIndex - 1]);
    }
    
    return this.getState();
  }

  /**
   * Reset wizard to initial state
   */
  reset() {
    this.currentStep = WIZARD_STEPS.PROTOCOL_SELECT;
    this.state = {
      protocol: null,
      config: {},
      discoveredDevices: [],
      selectedDevice: null,
      connectivityResult: null,
      roomAssignment: {
        roomId: null,
        zoneId: null,
        groupId: null,
        function: null
      },
      integrationRecord: null
    };
    this.driver = null;
    
    return this.getState();
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  _goToStep(step) {
    this.currentStep = step;
    this.options.onStepChange(step, this.getState());
  }

  _canContinue() {
    switch (this.currentStep) {
      case WIZARD_STEPS.PROTOCOL_SELECT:
        return !!this.state.protocol;
      case WIZARD_STEPS.CONNECTION_CONFIG:
        return this._hasRequiredConfig();
      case WIZARD_STEPS.DEVICE_DISCOVERY:
        return this.state.discoveredDevices.length > 0 || this.options.skipDiscovery;
      case WIZARD_STEPS.CONNECTIVITY_TEST:
        return !!this.state.connectivityResult;
      case WIZARD_STEPS.ROOM_ASSIGNMENT:
        return true; // Room assignment is optional
      case WIZARD_STEPS.REVIEW_SAVE:
        return !!this.state.selectedDevice;
      default:
        return false;
    }
  }

  _hasRequiredConfig() {
    if (!this.state.protocol) return false;
    
    const required = this.state.protocol.configFields || [];
    for (const field of required) {
      if (!this.state.config[field]) return false;
    }
    return true;
  }

  _sanitizeConfig(config) {
    // Remove sensitive data before storing
    const sanitized = { ...config };
    
    // Keep track of what was provided, not the actual values
    if (sanitized.token) sanitized.token = '***';
    if (sanitized.secret) sanitized.secret = '***';
    if (sanitized.password) sanitized.password = '***';
    if (sanitized.apiKey) sanitized.apiKey = '***';
    
    return sanitized;
  }
}

/**
 * Create wizard API routes
 * @param {Datastore} integrationDB - NeDB store for integrations
 * @returns {Object} Express router-compatible handlers
 */
export function createWizardHandlers(integrationDB) {
  // Store active wizard sessions
  const sessions = new Map();
  
  return {
    /**
     * Start new wizard session
     * POST /api/device-wizard/start
     */
    start: async (req, res) => {
      const sessionId = `wizard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const wizard = new DeviceWizard({
        integrationDB,
        onError: (err) => console.warn(`[wizard:${sessionId}]`, err)
      });
      
      sessions.set(sessionId, wizard);
      
      // Clean up old sessions (older than 1 hour)
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const [id, wiz] of sessions) {
        if (parseInt(id.split('-')[1]) < oneHourAgo) {
          sessions.delete(id);
        }
      }
      
      res.json({
        ok: true,
        sessionId,
        state: wizard.getState()
      });
    },

    /**
     * Get wizard state
     * GET /api/device-wizard/:sessionId
     */
    getState: async (req, res) => {
      const { sessionId } = req.params;
      const wizard = sessions.get(sessionId);
      
      if (!wizard) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      
      res.json({ ok: true, sessionId, state: wizard.getState() });
    },

    /**
     * Select protocol
     * POST /api/device-wizard/:sessionId/protocol
     */
    selectProtocol: async (req, res) => {
      const { sessionId } = req.params;
      const { protocolId } = req.body;
      const wizard = sessions.get(sessionId);
      
      if (!wizard) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      
      try {
        const state = await wizard.selectProtocol(protocolId);
        res.json({ ok: true, state });
      } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
      }
    },

    /**
     * Set configuration
     * POST /api/device-wizard/:sessionId/config
     */
    setConfig: async (req, res) => {
      const { sessionId } = req.params;
      const wizard = sessions.get(sessionId);
      
      if (!wizard) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      
      const state = await wizard.setConfig(req.body);
      res.json({ ok: true, state });
    },

    /**
     * Discover devices
     * POST /api/device-wizard/:sessionId/discover
     */
    discover: async (req, res) => {
      const { sessionId } = req.params;
      const wizard = sessions.get(sessionId);
      
      if (!wizard) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      
      const state = await wizard.discoverDevices();
      res.json({ ok: true, state });
    },

    /**
     * Select device
     * POST /api/device-wizard/:sessionId/select-device
     */
    selectDevice: async (req, res) => {
      const { sessionId } = req.params;
      const wizard = sessions.get(sessionId);
      
      if (!wizard) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      
      try {
        const state = await wizard.selectDevice(req.body);
        res.json({ ok: true, state });
      } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
      }
    },

    /**
     * Assign to room
     * POST /api/device-wizard/:sessionId/assign-room
     */
    assignRoom: async (req, res) => {
      const { sessionId } = req.params;
      const wizard = sessions.get(sessionId);
      
      if (!wizard) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      
      const state = await wizard.assignToRoom(req.body);
      res.json({ ok: true, state });
    },

    /**
     * Save integration
     * POST /api/device-wizard/:sessionId/save
     */
    save: async (req, res) => {
      const { sessionId } = req.params;
      const wizard = sessions.get(sessionId);
      
      if (!wizard) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      
      try {
        const result = await wizard.saveIntegration();
        sessions.delete(sessionId); // Clean up session
        res.json({ ok: true, ...result });
      } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
      }
    },

    /**
     * Go back
     * POST /api/device-wizard/:sessionId/back
     */
    goBack: async (req, res) => {
      const { sessionId } = req.params;
      const wizard = sessions.get(sessionId);
      
      if (!wizard) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      
      const state = wizard.goBack();
      res.json({ ok: true, state });
    },

    /**
     * Cancel/reset session
     * DELETE /api/device-wizard/:sessionId
     */
    cancel: async (req, res) => {
      const { sessionId } = req.params;
      sessions.delete(sessionId);
      res.json({ ok: true, message: 'Session cancelled' });
    }
  };
}

export default DeviceWizard;
