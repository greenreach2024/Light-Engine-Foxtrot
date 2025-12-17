#!/bin/bash
# Setup Demo Data for Light Engine
# Generates physical JSON files in public/data/ for demo mode
#
# Usage:
#   ./scripts/setup-demo.sh
#   # Or on remote server:
#   ssh ubuntu@SERVER 'cd ~/Light-Engine-Delta && bash scripts/setup-demo.sh'

set -e

echo "🎭 Setting up demo data..."

# Ensure public/data directory exists
mkdir -p public/data

# Generate demo data using the generator
node -e "
import('./lib/demo-data-generator.js').then(async module => {
  const DemoDataGenerator = module.default;
  const fs = await import('fs');
  const path = await import('path');
  
  console.log('📊 Generating demo farm data...');
  const generator = new DemoDataGenerator('DEMO-FARM-001');
  const farmData = generator.generateFarm();
  
  const dataDir = './public/data';
  
  // Write farm.json
  const farmJson = {
    farmId: farmData.farmId,
    name: farmData.name,
    status: farmData.status,
    region: farmData.region,
    url: farmData.url,
    contact: farmData.contact,
    coordinates: farmData.coordinates
  };
  
  fs.writeFileSync(
    path.join(dataDir, 'farm.json'),
    JSON.stringify(farmJson, null, 2)
  );
  console.log('✅ Created public/data/farm.json');
  
  // Write rooms.json (with 'id' field for frontend compatibility)
  fs.writeFileSync(
    path.join(dataDir, 'rooms.json'),
    JSON.stringify({ rooms: farmData.rooms }, null, 2)
  );
  console.log('✅ Created public/data/rooms.json');
  
  console.log('');
  console.log('📋 Demo Data Summary:');
  console.log('   Farm:', farmData.name);
  console.log('   Farm ID:', farmData.farmId);
  console.log('   Status:', farmData.status);
  console.log('   Rooms:', farmData.rooms.length);
  console.log('   Zones:', farmData.rooms.reduce((sum, r) => sum + r.zones.length, 0));
  console.log('   Devices:', farmData.devices.lights.length + farmData.devices.sensors.length);
  console.log('   Trays:', farmData.inventory.length);
  console.log('');
  console.log('🎉 Demo setup complete!');
  console.log('🌐 Start server and visit http://localhost:8091');
  
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
"

echo ""
echo "✅ Demo data generated successfully!"
echo "   Files: public/data/farm.json, public/data/rooms.json"
echo ""
echo "To deploy on AWS:"
echo "   scp public/data/*.json ubuntu@SERVER:~/Light-Engine-Delta/public/data/"
echo "   ssh ubuntu@SERVER 'pm2 restart light-engine'"
