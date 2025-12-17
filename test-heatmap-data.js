#!/usr/bin/env node

// Test heatmap data flow to diagnose sensor display issue

async function testHeatmapDataFlow() {
  const baseUrl = 'http://localhost:8091';
  
  console.log('=== Testing Heatmap Data Flow ===\n');
  
  // 1. Test room-map endpoint
  console.log('1. Testing /data/room-map.json...');
  try {
    const res = await fetch(`${baseUrl}/data/room-map.json`);
    const roomMap = await res.json();
    
    console.log(`   [OK] Loaded room map: ${roomMap.name}`);
    console.log(`   [OK] Grid: ${roomMap.gridSize}x${roomMap.gridSize}`);
    console.log(`   [OK] Zones: ${roomMap.zones.length}`);
    console.log(`   [OK] Devices: ${roomMap.devices.length}`);
    
    // Check device structure
    const device = roomMap.devices[0];
    console.log(`\n   First device structure:`);
    console.log(`   - deviceId: ${device.deviceId}`);
    console.log(`   - position: (${device.x}, ${device.y})`);
    console.log(`   - snapshot.name: ${device.snapshot?.name}`);
    console.log(`   - snapshot.type: ${device.snapshot?.type}`);
    console.log(`   - snapshot.category: ${device.snapshot?.category}`);
    console.log(`   - snapshot.zone: ${device.snapshot?.zone}`);
    console.log(`   - has telemetry: ${!!device.snapshot?.telemetry}`);
    
    if (device.snapshot?.telemetry) {
      const t = device.snapshot.telemetry;
      console.log(`   - telemetry.temperature: ${t.temperature?.toFixed(2)}°C`);
      console.log(`   - telemetry.humidity: ${t.humidity?.toFixed(2)}%`);
      console.log(`   - telemetry.vpd: ${t.vpd?.toFixed(3)} kPa`);
    }
    
    // Simulate frontend filtering
    console.log(`\n   Simulating frontend filtering logic:`);
    const sensors = roomMap.devices.filter(d => {
      // Check position
      if (d.x == null || d.y == null) {
        console.log(`   [FAIL] Device ${d.deviceId} rejected: no position`);
        return false;
      }
      
      // Check if sensor
      const type = (d.snapshot?.type || '').toLowerCase();
      const category = (d.snapshot?.category || '').toLowerCase();
      const isSensor = type.includes('sensor') || category.includes('sensor');
      if (!isSensor) {
        console.log(`   [FAIL] Device ${d.deviceId} rejected: not a sensor (type: ${d.snapshot?.type}, category: ${d.snapshot?.category})`);
        return false;
      }
      
      // Check name validity
      const name = (d.snapshot?.name || '').trim().toLowerCase();
      if (!name || name === 'none' || name === 'null' || name === 'undefined') {
        console.log(`   [FAIL] Device ${d.deviceId} rejected: invalid name "${d.snapshot?.name}"`);
        return false;
      }
      
      console.log(`   [OK] Device ${d.deviceId} accepted: ${d.snapshot?.name}`);
      return true;
    });
    
    console.log(`\n   [OK] Filtered sensors: ${sensors.length}/${roomMap.devices.length}`);
    
  } catch (err) {
    console.error(`   [FAIL] Failed to load room-map:`, err.message);
    return;
  }
  
  // 2. Test env endpoint
  console.log(`\n2. Testing /env endpoint...`);
  try {
    const res = await fetch(`${baseUrl}/env?hours=24`);
    const envData = await res.json();
    
    console.log(`   [OK] Loaded env data`);
    console.log(`   [OK] Zones: ${envData.zones?.length || 0}`);
    
    if (envData.zones?.length > 0) {
      const zone = envData.zones[0];
      console.log(`\n   First zone structure:`);
      console.log(`   - id: ${zone.id}`);
      console.log(`   - name: ${zone.name}`);
      console.log(`   - has sensors: ${!!zone.sensors}`);
      if (zone.sensors) {
        console.log(`   - sensors.tempC.current: ${zone.sensors.tempC?.current}`);
        console.log(`   - sensors.rh.current: ${zone.sensors.rh?.current}`);
        console.log(`   - sensors.vpd.current: ${zone.sensors.vpd?.current}`);
        console.log(`   - history length: ${zone.sensors.tempC?.history?.length || 0} points`);
      }
    }
    
  } catch (err) {
    console.error(`   [FAIL] Failed to load env data:`, err.message);
  }
  
  console.log(`\n=== Test Complete ===`);
}

testHeatmapDataFlow().catch(console.error);
