#!/usr/bin/env node
/**
 * Discover and save actual SwitchBot devices
 * This script waits for rate limits to clear and saves real device data
 */

import crypto from 'crypto';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = '4e6fc805b4a0dd7ed693af1dcf89d9731113d4706b2d796759aafe09cf8f07aed370d35bab4fb4799e1bda57d03c0aed';
const SECRET = '141c0bc9906ab1f4f73dd9f0c298046b';
const API_HOST = 'api.switch-bot.com';
const API_BASE = '/v1.1';

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
      hostname: API_HOST,
      path: API_BASE + path,
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

async function discoverRealDevices() {
  console.log('🔍 Discovering actual SwitchBot devices...');
  
  let attempts = 0;
  const maxAttempts = 5;
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`\n📡 Attempt ${attempts}/${maxAttempts}: Fetching device list...`);
    
    try {
      const response = await httpsGet('/devices');
      
      if (response.status === 429) {
        const retryAfter = response.headers['retry-after'] || 600;
        console.log(`⏰ Rate limited. Waiting ${retryAfter} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      
      if (response.status !== 200) {
        console.error(`❌ API Error: ${response.status}`, response.body);
        throw new Error(`API returned status ${response.status}`);
      }
      
      if (response.body.statusCode !== 100) {
        console.error('❌ SwitchBot API Error:', response.body);
        throw new Error(`SwitchBot API error: ${response.body.message}`);
      }
      
      const deviceList = response.body.body?.deviceList || [];
      console.log(`✅ Found ${deviceList.length} real devices!`);
      
      if (deviceList.length === 0) {
        console.warn('⚠️  No devices found in your SwitchBot account');
        return null;
      }
      
      // Save raw API response for reference
      const rawDataPath = path.join(__dirname, '../../public/data/switchbot-devices-real.json');
      const realDeviceData = {
        timestamp: new Date().toISOString(),
        source: 'SwitchBot API v1.1',
        apiResponse: response.body,
        devices: deviceList.map(device => ({
          id: device.deviceId,
          name: device.deviceName,
          type: device.deviceType,
          status: 'active',
          hubDeviceId: device.hubDeviceId,
          enableCloudService: device.enableCloudService,
          discoveredAt: new Date().toISOString()
        }))
      };
      
      fs.writeFileSync(rawDataPath, JSON.stringify(realDeviceData, null, 2));
      console.log(`💾 Saved real device data to: ${rawDataPath}`);
      
      // Print device summary
      console.log('\n📋 Discovered Devices:');
      deviceList.forEach((device, index) => {
        console.log(`  ${index + 1}. ${device.deviceName} (${device.deviceType})`);
        console.log(`     ID: ${device.deviceId}`);
        console.log(`     Hub: ${device.hubDeviceId || 'Direct'}`);
        console.log('');
      });
      
      return realDeviceData;
      
    } catch (error) {
      console.error(`❌ Attempt ${attempts} failed:`, error.message);
      if (attempts < maxAttempts) {
        console.log('⏳ Waiting 30 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
  }
  
  console.error('❌ Failed to discover devices after all attempts');
  return null;
}

async function main() {
  console.log('🚀 SwitchBot Real Device Discovery');
  console.log('==================================');
  
  const realDevices = await discoverRealDevices();
  
  if (realDevices) {
    console.log('\n✅ SUCCESS: Real device data captured and saved!');
    console.log(`📁 Check: public/data/switchbot-devices-real.json`);
    console.log('\n🔄 You can now use this data to replace mock devices in your application.');
  } else {
    console.log('\n❌ FAILED: Could not discover real devices');
    console.log('💡 This could be due to:');
    console.log('   - Rate limiting (try again later)');
    console.log('   - No devices in your SwitchBot account');
    console.log('   - Invalid API credentials');
  }
}

main().catch(console.error);