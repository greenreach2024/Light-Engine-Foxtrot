// IoT Device Registry Manager
const IOT_DEVICES_PATH = 'public/data/iot.devices.json';
const iotDevicesDb = new Datastore({ filename: IOT_DEVICES_PATH, autoload: true });

// Initialize IoT device registry
async function initIotRegistry() {
  const registry = await fs.promises.readFile(IOT_DEVICES_PATH, 'utf8')
    .then(data => JSON.parse(data))
    .catch(() => ({ devices: [], version: '1.0.0', lastScan: null, scanInProgress: false }));
  await fs.promises.writeFile(IOT_DEVICES_PATH, JSON.stringify(registry, null, 2));
  return registry;
}

// Three-stage device discovery pipeline
async function runDiscoveryPipeline() {
  // Update scan status
  const registry = await initIotRegistry();
  registry.scanInProgress = true;
  registry.lastScan = new Date().toISOString();
  await fs.promises.writeFile(IOT_DEVICES_PATH, JSON.stringify(registry, null, 2));

  try {
    // Stage 1: Known drivers
    const knownDevices = await Promise.all([
      prePlugManager.drivers.get('kasa')?.discover().catch(e => ({ error: e.message, devices: [] })),
      prePlugManager.drivers.get('shelly')?.discover().catch(e => ({ error: e.message, devices: [] })),
      prePlugManager.drivers.get('switchbot')?.discover().catch(e => ({ error: e.message, devices: [] })),
      // Add other driver discoveries here
    ]);

    // Stage 2: Setup for identified devices
    const identifiedDevices = knownDevices.flatMap(result => result.devices || [])
      .map(device => ({
        id: device.id || crypto.randomUUID(),
        name: device.name || 'Unknown Device',
        protocol: device.vendor || device.protocol || 'unknown',
        type: device.type || 'unknown',
        lastSeen: new Date().toISOString(),
        config: device
      }));

    // Stage 3: Network probe for remaining devices
    // Basic TCP port scan for common IoT protocols
    const probeResults = await probeNetwork();
    
    // Update registry with discovered devices
    registry.devices = [...identifiedDevices, ...probeResults];
    registry.scanInProgress = false;
    await fs.promises.writeFile(IOT_DEVICES_PATH, JSON.stringify(registry, null, 2));

    return registry;
  } catch (error) {
    registry.scanInProgress = false;
    await fs.promises.writeFile(IOT_DEVICES_PATH, JSON.stringify(registry, null, 2));
    throw error;
  }
}

// Network probe helper
async function probeNetwork() {
  const commonPorts = [80, 443, 1883, 502, 8883]; // HTTP, HTTPS, MQTT, Modbus, MQTT TLS
  const results = [];
  
  // Basic TCP port scan
  const scanHost = async (host, port) => {
    return new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve({ host, port, open: true });
      });
      
      socket.on('error', () => {
        socket.destroy();
        resolve({ host, port, open: false });
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ host, port, open: false });
      });
      
      socket.connect(port, host);
    });
  };

  // Scan local network
  const localIp = Object.values(require('os').networkInterfaces())
    .flat()
    .find(ip => ip.family === 'IPv4' && !ip.internal)
    ?.address;
  
  if (localIp) {
    const subnet = localIp.split('.').slice(0, 3).join('.');
    const hosts = Array.from({length: 255}, (_, i) => `${subnet}.${i + 1}`);
    
    for (const host of hosts) {
      for (const port of commonPorts) {
        const result = await scanHost(host, port);
        if (result.open) {
          results.push({
            id: crypto.randomUUID(),
            name: `Device at ${host}:${port}`,
            protocol: 'unknown',
            type: 'unknown',
            lastSeen: new Date().toISOString(),
            config: {
              host,
              port,
              protocol: port === 1883 ? 'mqtt' : 
                       port === 502 ? 'modbus' : 
                       'http'
            }
          });
        }
      }
    }
  }
  
  return results;
}

// IoT device registry endpoints
app.get('/iot/devices', asyncHandler(async (req, res) => {
  const registry = await initIotRegistry();
  res.json(registry);
}));

app.post('/iot/devices/scan', asyncHandler(async (req, res) => {
  const registry = await runDiscoveryPipeline();
  res.json(registry);
}));

app.patch('/iot/devices/:deviceId', asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const updates = req.body;
  
  const registry = await initIotRegistry();
  const deviceIndex = registry.devices.findIndex(d => d.id === deviceId);
  
  if (deviceIndex === -1) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  
  // Update allowed fields
  const allowedUpdates = ['name', 'room', 'zone', 'group', 'equipment'];
  allowedUpdates.forEach(field => {
    if (updates[field] !== undefined) {
      registry.devices[deviceIndex][field] = updates[field];
    }
  });
  
  await fs.promises.writeFile(IOT_DEVICES_PATH, JSON.stringify(registry, null, 2));
  res.json(registry.devices[deviceIndex]);
}));

app.delete('/iot/devices/:deviceId', asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  
  const registry = await initIotRegistry();
  registry.devices = registry.devices.filter(d => d.id !== deviceId);
  
  await fs.promises.writeFile(IOT_DEVICES_PATH, JSON.stringify(registry, null, 2));
  res.json({ success: true });
}));