#!/usr/bin/env node
/**
 * Wait for SwitchBot rate limit to clear and capture real devices
 * This script monitors the API and saves real device data when available
 */

import crypto from 'crypto';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = '4e6fc805b4a0dd7ed693af1dcf89d9731113d4706b2d796759aafe09cf8f07aed370d35bab4fb4799e1bda57d03c0aed';
const SECRET = '141c0bc9906ab1f4f73dd9f0c298046b';

function sbHeaders() {
  const t = Date.now().toString();
  const nonce = crypto.randomBytes(8).toString('hex');
  const strToSign = TOKEN + t + nonce;
  const sign = crypto.createHmac('sha256', SECRET).update(strToSign).digest('base64');
  return {
    'Authorization': TOKEN,
    't': t,
    'sign': sign,
    'nonce': nonce,
    'Content-Type': 'application/json; charset=utf8'
  };
}

function httpsGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.switch-bot.com',
      path: `/v1.1${path}`,
      method: 'GET',
      headers: sbHeaders()
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ 
            status: res.statusCode, 
            body: parsed,
            headers: res.headers 
          });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function waitForApiAccess() {
  console.log('🕐 Waiting for SwitchBot API rate limit to clear...');
  
  let attempt = 0;
  while (true) {
    attempt++;
    console.log(`\n📡 Attempt ${attempt}: Checking API status...`);
    
    try {
      const response = await httpsGet('/devices');
      
      if (response.status === 429) {
        const retryAfter = response.headers['retry-after'] || 60;
        console.log(`⏰ Still rate limited. Waiting ${retryAfter} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      
      if (response.status === 200 && response.body.statusCode === 100) {
        console.log('✅ API access restored!');
        return response.body;
      }
      
      console.log(`⚠️  Unexpected response: ${response.status}`, response.body);
      await new Promise(resolve => setTimeout(resolve, 30000));
      
    } catch (error) {
      console.error(`❌ Request failed:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

async function main() {
  console.log('🚀 SwitchBot Real Device Capture');
  console.log('================================');
  console.log('Waiting for rate limit to clear and capturing real devices...\n');
  
  try {
    const apiData = await waitForApiAccess();
    const deviceList = apiData.body?.deviceList || [];
    
    if (deviceList.length === 0) {
      console.log('⚠️  No devices found in your SwitchBot account');
      return;
    }
    
    console.log(`🎉 SUCCESS! Found ${deviceList.length} real SwitchBot devices:`);
    console.log('================================================');
    
    deviceList.forEach((device, index) => {
      console.log(`${index + 1}. "${device.deviceName}" (${device.deviceType})`);
      console.log(`   Device ID: ${device.deviceId}`);
      console.log(`   Hub: ${device.hubDeviceId || 'Direct connection'}`);
      console.log(`   Cloud Service: ${device.enableCloudService ? 'Enabled' : 'Disabled'}`);
      console.log('');
    });
    
    // Save the real device data
    const realDeviceFile = path.join(__dirname, '../../public/data/switchbot-devices-REAL.json');
    const realData = {
      timestamp: new Date().toISOString(),
      source: 'SwitchBot API v1.1 - Direct Discovery',
      deviceCount: deviceList.length,
      devices: deviceList.map(device => ({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        hubDeviceId: device.hubDeviceId,
        enableCloudService: device.enableCloudService,
        discoveredAt: new Date().toISOString()
      })),
      apiResponse: apiData
    };
    
    fs.writeFileSync(realDeviceFile, JSON.stringify(realData, null, 2));
    console.log(`💾 Real device data saved to: ${realDeviceFile}`);
    
    // Now update the server cache by calling the local API
    console.log('\\n🔄 Updating server cache with real devices...');
    try {
      const http = await import('http');
      const req = http.request('http://localhost:8091/api/switchbot/devices?refresh=1', (res) => {
        console.log(`✅ Server cache updated (HTTP ${res.statusCode})`);
      });
      req.on('error', (e) => {
        console.log(`⚠️  Could not update server cache: ${e.message}`);
      });
      req.end();
    } catch (e) {
      console.log('⚠️  Server may not be running - cache update skipped');
    }
    
    console.log('\\n🎯 NEXT STEPS:');
    console.log('1. The real device data has been captured and saved');
    console.log('2. You can now use this data in your application');
    console.log('3. The mock devices should be replaced with these real ones');
    
  } catch (error) {
    console.error('❌ FAILED:', error.message);
  }
}

main().catch(console.error);