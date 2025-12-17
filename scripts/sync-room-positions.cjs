#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('=== Room Map Position Sync Test ===\n');

// Load room map
const roomMapPath = path.join(__dirname, '../public/data/room-map.json');
const roomMap = JSON.parse(fs.readFileSync(roomMapPath, 'utf8'));

console.log('Room map devices:');
roomMap.devices.slice(0, 3).forEach(d => {
  console.log(`  - ${d.deviceId}: x=${d.x}, y=${d.y}, zone=${d.snapshot?.zone}`);
});

// Load IoT devices
const iotDevicesPath = path.join(__dirname, '../public/data/iot-devices.json');
const iotDevices = JSON.parse(fs.readFileSync(iotDevicesPath, 'utf8'));

// Find matching sensors
const sensor1Before = iotDevices.find(d => d.deviceId === 'CE2A8606558E');
const sensor2Before = iotDevices.find(d => d.deviceId === 'CE2A82461382');

console.log('\nIoT devices BEFORE sync:');
console.log(`  - CE2A8606558E: x=${sensor1Before?.x}, y=${sensor1Before?.y}, zone=${sensor1Before?.zone}`);
console.log(`  - CE2A82461382: x=${sensor2Before?.x}, y=${sensor2Before?.y}, zone=${sensor2Before?.zone}`);

// Simulate the sync
const deviceInfo = new Map();
for (const devicePos of roomMap.devices || []) {
  if (devicePos.deviceId) {
    const snapshot = devicePos.snapshot || {};
    deviceInfo.set(devicePos.deviceId, {
      zone: snapshot.zone ?? null,
      room: snapshot.room ?? null,
      x: devicePos.x ?? null,
      y: devicePos.y ?? null
    });
  }
}

let updatedCount = 0;
for (const iotDevice of iotDevices) {
  const deviceId = iotDevice.id || iotDevice.deviceId;
  if (!deviceId) continue;
  
  const info = deviceInfo.get(deviceId);
  if (info) {
    if (iotDevice.zone !== info.zone || 
        iotDevice.room !== info.room || 
        iotDevice.x !== info.x || 
        iotDevice.y !== info.y) {
      iotDevice.zone = info.zone;
      iotDevice.room = info.room;
      iotDevice.x = info.x;
      iotDevice.y = info.y;
      updatedCount++;
    }
  }
}

console.log(`\nWould update ${updatedCount} devices`);

// Show what would be updated
const sensor1After = iotDevices.find(d => d.deviceId === 'CE2A8606558E');
const sensor2After = iotDevices.find(d => d.deviceId === 'CE2A82461382');

console.log('\nIoT devices AFTER sync:');
console.log(`  - CE2A8606558E: x=${sensor1After?.x}, y=${sensor1After?.y}, zone=${sensor1After?.zone}`);
console.log(`  - CE2A82461382: x=${sensor2After?.x}, y=${sensor2After?.y}, zone=${sensor2After?.zone}`);

// Actually save the file
fs.writeFileSync(iotDevicesPath, JSON.stringify(iotDevices, null, 2));
console.log('\n✅ Saved updated iot-devices.json');
console.log('\nNow you can test the heat map at http://localhost:8091/views/heat-map.html');
