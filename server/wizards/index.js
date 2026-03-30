const DEFAULT_DISCOVERY_TIMEOUT = 10;

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeService(service) {
  if (!service) return null;
  if (typeof service === 'string') {
    const [namePart, portPart] = service.split(':').map(part => part && part.trim());
    const port = portPart ? Number.parseInt(portPart, 10) : undefined;
    return { name: namePart || undefined, port: Number.isFinite(port) ? port : undefined };
  }

  if (typeof service === 'object') {
    const { name, type, service: svcName, protocol, id, port, number } = service;
    const normalizedName = name || type || svcName || protocol || id;
    const normalizedPort = port ?? number;
    return {
      ...service,
      name: normalizedName,
      port: typeof normalizedPort === 'number' ? normalizedPort : undefined
    };
  }

  return null;
}

function collectServiceMap(services = []) {
  const entries = ensureArray(services).map(normalizeService).filter(Boolean);
  const serviceMap = new Map();

  for (const entry of entries) {
    if (!entry.name) continue;
    const key = String(entry.name).toLowerCase();
    serviceMap.set(key, {
      name: entry.name,
      port: entry.port
    });
  }

  return serviceMap;
}

function deriveNetworkContext(context = {}) {
  const devices = ensureArray(context.devices?.length ? context.devices : context.device || context);
  const primary = devices.find(Boolean) || {};

  const services = collectServiceMap(primary.services || context.services || []);
  const ip = primary.ip || primary.address || primary.host || context.ip || context.address;
  const hostname = primary.hostname || primary.name || context.hostname || context.name;

  const mqttSecure = Array.from(services.keys()).some(name => name.includes('tls') || name.includes('ssl')) ||
    Array.from(services.values()).some(entry => entry.port === 8883);

  const mqttPortEntry = Array.from(services.entries()).find(([name]) => name.includes('mqtt'));
  const defaultMqttPort = mqttSecure ? 8883 : 1883;
  const mqttPort = mqttPortEntry?.[1]?.port ?? defaultMqttPort;

  return {
    devices,
    primary,
    services,
    ip,
    hostname,
    mqtt: {
      port: mqttPort,
      secure: mqttSecure
    }
  };
}

function applyFieldDefaults(fields = [], defaults = {}) {
  return fields.map(field => {
    if (!field || typeof field !== 'object') return field;
    const defaultValue = defaults[field.name];
    if (defaultValue === undefined) {
      return { ...field };
    }
    return {
      ...field,
      default: defaultValue
    };
  });
}

export const sharedStepFactories = {
  brokerCredentials(defaults = {}) {
    const normalizedDefaults = {
      host: defaults.host ?? defaults.hostname ?? '',
      port: defaults.port ?? (defaults.secure ? 8883 : 1883),
      secure: defaults.secure ?? false,
      username: defaults.username ?? '',
      password: defaults.password ?? ''
    };

    return {
      id: 'broker-connection',
      name: 'Broker Connection',
      description: 'Configure MQTT broker connection settings',
      fields: applyFieldDefaults([
        { name: 'host', type: 'text', label: 'MQTT Broker Host', required: true },
        { name: 'port', type: 'number', label: 'Port', default: 1883, required: true },
        { name: 'secure', type: 'boolean', label: 'Use TLS/SSL', default: false },
        { name: 'username', type: 'text', label: 'Username (optional)' },
        { name: 'password', type: 'password', label: 'Password (optional)' }
      ], normalizedDefaults)
    };
  },

  deviceDiscovery(options = {}) {
    const {
      id = 'device-discovery',
      name = 'Device Discovery',
      description = 'Discover compatible devices',
      defaults = {},
      fields = [
        { name: 'discoveryTimeout', type: 'number', label: 'Discovery Timeout (seconds)', default: DEFAULT_DISCOVERY_TIMEOUT },
        { name: 'targetIP', type: 'text', label: 'Target IP (optional)', placeholder: '192.168.x.x' }
      ],
      dynamic = false
    } = options;

    return {
      id,
      name,
      description,
      dynamic,
      fields: applyFieldDefaults(fields, defaults)
    };
  },

  deviceAssignment(options = {}) {
    const {
      id = 'device-assignment',
      name = 'Device Assignment',
      description = 'Assign the discovered device to a zone or role',
      defaults = {},
      fields = [
        { name: 'deviceIp', type: 'text', label: 'Device IP', required: true },
        { name: 'deviceHostname', type: 'text', label: 'Device Hostname' },
        { name: 'zone', type: 'text', label: 'Assigned Zone/Area' }
      ],
      dynamic = false
    } = options;

    return {
      id,
      name,
      description,
      dynamic,
      fields: applyFieldDefaults(fields, defaults)
    };
  }
};

const wizardFactories = {
  'mqtt-setup': (context = {}) => {
    const network = deriveNetworkContext(context);
    const brokerDefaults = {
      host: network.hostname || network.ip || '',
      port: network.mqtt.port,
      secure: network.mqtt.secure
    };

    const topicDefault = network.hostname ? `${network.hostname}/#` : undefined;

    return {
      id: 'mqtt-setup',
      name: 'MQTT Device Integration',
      description: 'Configure MQTT broker connection and device subscriptions',
      targetDevices: ['mqtt', 'mqtt-tls'],
      steps: [
        sharedStepFactories.brokerCredentials(brokerDefaults),
        {
          id: 'topic-discovery',
          name: 'Topic Discovery',
          description: 'Discover available MQTT topics and sensors',
          fields: applyFieldDefaults([
            { name: 'baseTopic', type: 'text', label: 'Base Topic Pattern', default: 'farm/#' },
            { name: 'discoverTime', type: 'number', label: 'Discovery Time (seconds)', default: 30 }
          ], { baseTopic: topicDefault })
        },
        {
          id: 'sensor-mapping',
          name: 'Sensor Mapping',
          description: 'Map discovered topics to sensor types',
          dynamic: true
        }
      ]
    };
  },

  'web-device-setup': (context = {}) => {
    const network = deriveNetworkContext(context);
    const defaultDeviceUrl = network.hostname ? `http://${network.hostname}` : network.ip ? `http://${network.ip}` : undefined;

    return {
      id: 'web-device-setup',
      name: 'Web-Enabled IoT Device Setup',
      description: 'Configure web-based IoT devices with HTTP/HTTPS interfaces',
      targetDevices: ['http', 'https', 'http-alt', 'http-mgmt'],
      steps: [
        {
          id: 'device-identification',
          name: 'Device Identification',
          description: 'Identify device type and capabilities',
          fields: applyFieldDefaults([
            { name: 'deviceUrl', type: 'url', label: 'Device URL', required: true },
            {
              name: 'deviceType',
              type: 'select',
              label: 'Device Type',
              options: ['environmental-controller', 'sensor-hub', 'lighting-controller', 'irrigation-controller', 'other']
            }
          ], { deviceUrl: defaultDeviceUrl })
        },
        {
          id: 'authentication',
          name: 'Authentication Setup',
          description: 'Configure device authentication',
          fields: [
            {
              name: 'authType',
              type: 'select',
              label: 'Authentication Type',
              options: ['none', 'basic', 'bearer', 'api-key']
            },
            { name: 'username', type: 'text', label: 'Username', conditional: 'authType=basic' },
            { name: 'password', type: 'password', label: 'Password', conditional: 'authType=basic' }
          ]
        },
        {
          id: 'data-integration',
          name: 'Data Integration',
          description: 'Configure data polling and integration settings',
          fields: [
            { name: 'pollInterval', type: 'number', label: 'Polling Interval (seconds)', default: 60 },
            { name: 'enableAlerts', type: 'boolean', label: 'Enable Alerts', default: true }
          ]
        }
      ]
    };
  },

  'switchbot-setup': (context = {}) => {
    const network = deriveNetworkContext(context);

    return {
      id: 'switchbot-setup',
      name: 'SwitchBot Device Setup',
      description: 'Configure SwitchBot cloud-connected devices',
      targetDevices: ['switchbot'],
      steps: [
        {
          id: 'api-credentials',
          name: 'API Credentials',
          description: 'Configure SwitchBot Cloud API access',
          fields: [
            { name: 'token', type: 'text', label: 'SwitchBot Token', required: true },
            { name: 'secret', type: 'text', label: 'SwitchBot Secret', required: true }
          ]
        },
        sharedStepFactories.deviceDiscovery({
          id: 'device-discovery',
          name: 'Device Discovery',
          description: 'Discover SwitchBot devices in your account',
          defaults: {
            targetIP: network.ip,
            deviceHostname: network.hostname
          },
          dynamic: true,
          fields: []
        })
      ]
    };
  },

  'modbus-setup': (context = {}) => {
    const network = deriveNetworkContext(context);

    return {
      id: 'modbus-setup',
      name: 'Modbus Device Configuration',
      description: 'Configure Modbus RTU/TCP devices for industrial sensors',
      targetDevices: ['modbus', 'modbus-tcp'],
      steps: [
        {
          id: 'connection-setup',
          name: 'Connection Setup',
          description: 'Configure Modbus connection parameters',
          fields: applyFieldDefaults([
            { name: 'host', type: 'text', label: 'Device IP/Host', required: true },
            { name: 'port', type: 'number', label: 'Port', default: 502, required: true },
            { name: 'unitId', type: 'number', label: 'Unit ID', default: 1, min: 1, max: 247 },
            { name: 'timeout', type: 'number', label: 'Timeout (ms)', default: 3000 },
            { name: 'protocol', type: 'select', label: 'Protocol', options: ['TCP', 'RTU'], default: 'TCP' }
          ], { host: network.ip || network.hostname })
        },
        {
          id: 'register-mapping',
          name: 'Register Mapping',
          description: 'Map Modbus registers to sensor readings',
          fields: [
            { name: 'startAddress', type: 'number', label: 'Starting Register Address', default: 0 },
            { name: 'registerCount', type: 'number', label: 'Number of Registers', default: 10 },
            {
              name: 'dataType',
              type: 'select',
              label: 'Data Type',
              options: ['int16', 'uint16', 'float32', 'custom'],
              default: 'int16'
            },
            { name: 'pollInterval', type: 'number', label: 'Polling Interval (seconds)', default: 30 }
          ]
        }
      ]
    };
  },

  'kasa-setup': (context = {}) => {
    const network = deriveNetworkContext(context);
    const aliasCandidate = network.hostname?.split('.')?.[0] || network.primary?.name || 'Kasa Device';

    return {
      id: 'kasa-setup',
      name: 'TP-Link Kasa Device Setup',
      description: 'Configure TP-Link Kasa smart devices for farm automation',
      targetDevices: ['kasa', 'tplink'],
      steps: [
        sharedStepFactories.deviceDiscovery({
          description: 'Discover Kasa devices on the network',
          defaults: {
            discoveryTimeout: DEFAULT_DISCOVERY_TIMEOUT,
            targetIP: network.ip
          }
        }),
        sharedStepFactories.deviceAssignment({
          id: 'device-configuration',
          name: 'Device Configuration',
          description: 'Configure discovered Kasa devices',
          dynamic: true,
          defaults: {
            alias: aliasCandidate,
            location: 'Default Zone',
            scheduleEnabled: false
          },
          fields: [
            { name: 'alias', type: 'text', label: 'Device Alias', required: true },
            { name: 'location', type: 'text', label: 'Location/Zone', placeholder: 'e.g., Greenhouse A' },
            { name: 'scheduleEnabled', type: 'boolean', label: 'Enable Scheduling', default: false }
          ]
        })
      ]
    };
  },

  'sensor-hub-setup': (context = {}) => {
    const network = deriveNetworkContext(context);

    return {
      id: 'sensor-hub-setup',
      name: 'Multi-Sensor Hub Configuration',
      description: 'Configure multi-protocol sensor hubs for comprehensive monitoring',
      targetDevices: ['sensor-hub', 'multi-sensor'],
      steps: [
        {
          id: 'hub-identification',
          name: 'Hub Identification',
          description: 'Identify and connect to sensor hub',
          fields: applyFieldDefaults([
            {
              name: 'hubType',
              type: 'select',
              label: 'Hub Type',
              options: ['Arduino-based', 'Raspberry Pi', 'ESP32', 'Commercial Hub']
            },
            {
              name: 'connectionType',
              type: 'select',
              label: 'Connection Type',
              options: ['WiFi', 'Ethernet', 'USB', 'Serial']
            },
            { name: 'endpoint', type: 'text', label: 'Hub Endpoint', placeholder: 'IP:Port or device path' }
          ], { endpoint: network.ip ? `${network.ip}:502` : undefined })
        },
        {
          id: 'sensor-configuration',
          name: 'Sensor Configuration',
          description: 'Configure individual sensors on the hub',
          dynamic: true,
          fields: [
            {
              name: 'sensorType',
              type: 'select',
              label: 'Sensor Type',
              options: ['Temperature', 'Humidity', 'Soil Moisture', 'Light', 'pH', 'EC', 'CO2', 'Air Quality']
            },
            { name: 'channel', type: 'number', label: 'Channel/Pin', min: 0, max: 255 },
            { name: 'calibrationFactor', type: 'number', label: 'Calibration Factor', default: 1.0, step: 0.001 }
          ]
        },
        {
          id: 'data-processing',
          name: 'Data Processing',
          description: 'Configure data processing and alerts',
          fields: [
            { name: 'sampleRate', type: 'number', label: 'Sample Rate (seconds)', default: 60 },
            { name: 'enableAveraging', type: 'boolean', label: 'Enable Data Averaging', default: true },
            { name: 'alertThresholds', type: 'boolean', label: 'Configure Alert Thresholds', default: false }
          ]
        }
      ]
    };
  }
};

export function buildSetupWizards(discoveryContextMap = {}) {
  return Object.fromEntries(
    Object.entries(wizardFactories).map(([id, factory]) => [id, factory(discoveryContextMap[id] || {})])
  );
}

export function mergeDiscoveryPayload(existingContext = {}, devicePayload = {}) {
  const normalizedPayload = {
    ...devicePayload,
    services: ensureArray(devicePayload.services).map(normalizeService).filter(Boolean)
  };

  const devices = Array.from(existingContext.devices || []);
  const matchIndex = devices.findIndex(device => {
    if (!device) return false;
    if (device.id && normalizedPayload.id && device.id === normalizedPayload.id) return true;
    if (device.ip && normalizedPayload.ip && device.ip === normalizedPayload.ip) return true;
    if (device.hostname && normalizedPayload.hostname && device.hostname === normalizedPayload.hostname) return true;
    return false;
  });

  if (matchIndex >= 0) {
    devices[matchIndex] = { ...devices[matchIndex], ...normalizedPayload };
  } else {
    devices.push(normalizedPayload);
  }

  return {
    ...existingContext,
    devices,
    lastUpdated: new Date().toISOString()
  };
}

export function getWizardDefaultInputs(wizardId, context = {}) {
  const factory = wizardFactories[wizardId];
  if (!factory) return {};
  const wizard = factory(context);
  const defaults = {};

  for (const step of wizard.steps) {
    if (!step || !step.fields || step.fields.length === 0) continue;
    const stepDefaults = {};
    for (const field of step.fields) {
      if (Object.prototype.hasOwnProperty.call(field, 'default')) {
        stepDefaults[field.name] = field.default;
      }
    }
    if (Object.keys(stepDefaults).length > 0) {
      defaults[step.id] = stepDefaults;
    }
  }

  return defaults;
}

export function cloneWizardStep(step) {
  return step ? JSON.parse(JSON.stringify(step)) : null;
}

export function getWizardFactory(id) {
  return wizardFactories[id];
}

