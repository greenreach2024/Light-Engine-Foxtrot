#!/usr/bin/env node

/**
 * Grow3 Controller Discovery and Diagnostic Tool
 * 
 * This script helps locate and test Grow3 light controllers on the local network.
 * 
 * Usage:
 *   node scripts/discover-grow3.cjs                    # Scan common ports
 *   node scripts/discover-grow3.cjs 192.168.2.80      # Test specific IP
 *   node scripts/discover-grow3.cjs 192.168.2.1-254   # Scan IP range
 */

const http = require('http');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const COMMON_PORTS = [3000, 8080, 80, 8000, 5000];
const TIMEOUT = 2000; // 2 second timeout per test

function testUrl(url) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = http.get(url, { timeout: TIMEOUT }, (res) => {
      const duration = Date.now() - startTime;
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ 
            url, 
            success: true, 
            status: res.statusCode, 
            duration,
            data: json
          });
        } catch {
          resolve({ 
            url, 
            success: true, 
            status: res.statusCode, 
            duration,
            data: data.substring(0, 100)
          });
        }
      });
    });
    
    req.on('error', (error) => {
      resolve({ 
        url, 
        success: false, 
        error: error.message,
        code: error.code
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ url, success: false, error: 'Timeout' });
    });
  });
}

async function getLocalSubnet() {
  try {
    const { stdout } = await execAsync("ifconfig | grep 'inet ' | grep -v 127.0.0.1 | head -1 | awk '{print $2}'");
    const ip = stdout.trim();
    if (ip && ip.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      const parts = ip.split('.');
      return `${parts[0]}.${parts[1]}.${parts[2]}`;
    }
  } catch (error) {
    console.error('Failed to detect local subnet:', error.message);
  }
  return '192.168.2'; // Default fallback
}

async function scanIP(ip, ports = COMMON_PORTS) {
  const results = [];
  
  for (const port of ports) {
    // Test /healthz endpoint (Grow3 standard)
    const healthzUrl = `http://${ip}:${port}/healthz`;
    const healthzResult = await testUrl(healthzUrl);
    
    if (healthzResult.success) {
      results.push({ ...healthzResult, endpoint: 'healthz' });
    }
    
    // Test /api/devicedatas endpoint (Grow3 device list)
    const devicesUrl = `http://${ip}:${port}/api/devicedatas`;
    const devicesResult = await testUrl(devicesUrl);
    
    if (devicesResult.success) {
      const deviceCount = Array.isArray(devicesResult.data?.data) ? devicesResult.data.data.length :
                         Array.isArray(devicesResult.data) ? devicesResult.data.length : 0;
      results.push({ 
        ...devicesResult, 
        endpoint: 'devices',
        deviceCount
      });
    }
  }
  
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  
  console.log('🔍 Grow3 Controller Discovery Tool\n');
  
  if (args.length === 0) {
    // Scan local subnet with common IPs
    const subnet = await getLocalSubnet();
    console.log(`📡 Scanning local network: ${subnet}.0/24`);
    console.log(`   Common Grow3 addresses: .80, .100, .1\n`);
    
    const commonIPs = [
      `${subnet}.80`,   // Default Grow3
      `${subnet}.100`,  // Common static
      `${subnet}.1`,    // Gateway/router
      `${subnet}.50`    // Alternative
    ];
    
    for (const ip of commonIPs) {
      process.stdout.write(`Testing ${ip}...`);
      const results = await scanIP(ip);
      
      if (results.length > 0) {
        console.log(` ✅ FOUND!`);
        results.forEach(r => {
          console.log(`  ↳ ${r.url}`);
          console.log(`    Status: ${r.status} | Duration: ${r.duration}ms`);
          if (r.deviceCount !== undefined) {
            console.log(`    Devices: ${r.deviceCount}`);
          }
        });
        console.log();
      } else {
        console.log(` ❌ No response`);
      }
    }
    
  } else if (args[0].includes('-')) {
    // IP range scan
    const [start, end] = args[0].split('-').map(s => s.trim());
    const subnet = start.split('.').slice(0, 3).join('.');
    const startNum = parseInt(start.split('.')[3]);
    const endNum = parseInt(end);
    
    console.log(`📡 Scanning ${subnet}.${startNum}-${endNum} on ports: ${COMMON_PORTS.join(', ')}\n`);
    
    for (let i = startNum; i <= endNum; i++) {
      const ip = `${subnet}.${i}`;
      const results = await scanIP(ip);
      
      if (results.length > 0) {
        console.log(`✅ ${ip} - Controller found!`);
        results.forEach(r => {
          console.log(`  ${r.endpoint}: ${r.status} (${r.duration}ms)`);
          if (r.deviceCount !== undefined) {
            console.log(`  Devices: ${r.deviceCount}`);
          }
        });
      }
    }
    
  } else {
    // Test specific IP
    const ip = args[0];
    console.log(`🔍 Testing ${ip} on ports: ${COMMON_PORTS.join(', ')}\n`);
    
    const results = await scanIP(ip);
    
    if (results.length > 0) {
      console.log(`✅ Controller found at ${ip}!\n`);
      results.forEach(r => {
        console.log(`📍 ${r.url}`);
        console.log(`   Status: ${r.status}`);
        console.log(`   Duration: ${r.duration}ms`);
        if (r.deviceCount !== undefined) {
          console.log(`   Devices: ${r.deviceCount}`);
        }
        console.log();
      });
      
      // Suggest environment variable
      const port = results[0].url.match(/:(\d+)/)[1];
      const controllerUrl = `http://${ip}:${port}`;
      console.log('💡 To use this controller, set the CTRL environment variable:');
      console.log(`   export CTRL="${controllerUrl}"`);
      console.log(`   CTRL="${controllerUrl}" npm start`);
      
    } else {
      console.log(`❌ No Grow3 controller found at ${ip}`);
      console.log('\n💡 Troubleshooting:');
      console.log('   1. Verify the controller is powered on');
      console.log('   2. Check that you\'re on the same network');
      console.log('   3. Try scanning the network: node scripts/discover-grow3.cjs');
    }
  }
  
  console.log('\n📚 Documentation:');
  console.log('   - Grow3 controllers typically run on port 3000');
  console.log('   - Default IP is often 192.168.2.80');
  console.log('   - Check controller display for actual IP address');
}

main().catch(error => {
  console.error('❌ Discovery failed:', error);
  process.exit(1);
});
