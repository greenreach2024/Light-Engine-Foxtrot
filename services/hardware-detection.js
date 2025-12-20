/**
 * Hardware Detection Service
 * 
 * Detects and enumerates connected hardware devices for first-run setup.
 * Supports USB sensors, RS-485 Modbus devices, and network-connected equipment.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const execAsync = promisify(exec);

/**
 * Scan USB devices using lsusb command
 */
export async function scanUSBDevices() {
  const devices = [];
  
  try {
    const { stdout } = await execAsync('lsusb');
    const lines = stdout.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      // Parse lsusb output: Bus 001 Device 002: ID 0403:6001 Future Technology Devices...
      const match = line.match(/Bus (\d+) Device (\d+): ID ([0-9a-f]{4}):([0-9a-f]{4}) (.+)/i);
      
      if (match) {
        const [, bus, device, vendorId, productId, description] = match;
        
        devices.push({
          interface: 'USB',
          bus: parseInt(bus),
          device: parseInt(device),
          vendorId: `0x${vendorId}`,
          productId: `0x${productId}`,
          description: description.trim(),
          type: categorizeUSBDevice(description)
        });
      }
    }
  } catch (error) {
    console.warn('[hardware-detect] USB scan failed:', error.message);
  }
  
  return devices;
}

/**
 * Categorize USB device by description
 */
function categorizeUSBDevice(description) {
  const lower = description.toLowerCase();
  
  if (lower.includes('camera') || lower.includes('webcam')) {
    return 'camera';
  }
  if (lower.includes('serial') || lower.includes('ftdi') || lower.includes('uart')) {
    return 'serial';
  }
  if (lower.includes('bluetooth') || lower.includes('bt')) {
    return 'bluetooth';
  }
  if (lower.includes('hub')) {
    return 'hub';
  }
  if (lower.includes('keyboard')) {
    return 'keyboard';
  }
  if (lower.includes('mouse') || lower.includes('pointer')) {
    return 'mouse';
  }
  
  return 'unknown';
}

/**
 * Scan serial ports for RS-485 Modbus devices
 */
export async function scanSerialPorts() {
  const ports = [];
  
  try {
    // List serial port devices
    const { stdout } = await execAsync('ls -1 /dev/ttyUSB* /dev/ttyACM* 2>/dev/null');
    const lines = stdout.split('\n').filter(line => line.trim());
    
    for (const port of lines) {
      ports.push({
        interface: 'Serial',
        port: port,
        type: 'serial_port',
        description: `Serial port ${port.split('/').pop()}`
      });
    }
  } catch (error) {
    console.warn('[hardware-detect] Serial port scan failed:', error.message);
  }
  
  return ports;
}

/**
 * Scan network for IP cameras and sensors
 */
export async function scanNetworkDevices(subnet = '192.168.1') {
  const devices = [];
  const commonPorts = [80, 8080, 554, 8554]; // HTTP, RTSP
  const timeout = 500; // ms
  
  // Scan first 10 IPs as a quick test
  // In production, this would be more comprehensive
  for (let i = 2; i <= 11; i++) {
    const ip = `${subnet}.${i}`;
    
    for (const port of commonPorts) {
      const isOpen = await checkPort(ip, port, timeout);
      
      if (isOpen) {
        devices.push({
          interface: 'Network',
          ip: ip,
          port: port,
          type: categorizeNetworkDevice(port),
          description: `${ip}:${port}`
        });
      }
    }
  }
  
  return devices;
}

/**
 * Check if a port is open on a host
 */
function checkPort(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    
    socket.setTimeout(timeout);
    
    socket.on('connect', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(true);
      }
    });
    
    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });
    
    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });
    
    socket.connect(port, host);
  });
}

/**
 * Categorize network device by port
 */
function categorizeNetworkDevice(port) {
  switch (port) {
    case 80:
    case 8080:
      return 'web_interface';
    case 554:
    case 8554:
      return 'ip_camera';
    default:
      return 'network_device';
  }
}

/**
 * Comprehensive hardware scan
 */
export async function scanAllHardware() {
  console.log('[hardware-detect] Starting comprehensive hardware scan...');
  
  const [usb, serial, network] = await Promise.all([
    scanUSBDevices(),
    scanSerialPorts(),
    scanNetworkDevices()
  ]);
  
  // Categorize devices
  const categorized = {
    lights: [],
    fans: [],
    sensors: [],
    cameras: [],
    serial: [],
    network: [],
    other: []
  };
  
  // Process USB devices
  for (const device of usb) {
    if (device.type === 'camera') {
      categorized.cameras.push(device);
    } else if (device.type === 'serial') {
      categorized.sensors.push(device);
    } else {
      categorized.other.push(device);
    }
  }
  
  // Process serial ports
  for (const port of serial) {
    categorized.serial.push(port);
  }
  
  // Process network devices
  for (const device of network) {
    if (device.type === 'ip_camera') {
      categorized.cameras.push(device);
    } else {
      categorized.network.push(device);
    }
  }
  
  const summary = {
    total: usb.length + serial.length + network.length,
    by_interface: {
      usb: usb.length,
      serial: serial.length,
      network: network.length
    },
    by_type: {
      lights: categorized.lights.length,
      fans: categorized.fans.length,
      sensors: categorized.sensors.length,
      cameras: categorized.cameras.length,
      serial: categorized.serial.length,
      network: categorized.network.length,
      other: categorized.other.length
    }
  };
  
  console.log('[hardware-detect] Scan complete:', summary);
  
  return {
    summary,
    devices: categorized,
    raw: { usb, serial, network }
  };
}

export default {
  scanUSBDevices,
  scanSerialPorts,
  scanNetworkDevices,
  scanAllHardware
};
