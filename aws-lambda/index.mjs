/**
 * AWS Lambda Function for Light Engine Charlie
 * Aggregates SwitchBot sensor data, persists to DynamoDB (optional), and returns data.
 * 
 * Deploy: Upload as Lambda function with Node.js 20.x runtime
 * Memory: 256 MB
 * Timeout: 10 seconds
 */

import crypto from 'crypto';
import { DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// SwitchBot API Configuration
const SWITCHBOT_TOKEN = process.env.SWITCHBOT_TOKEN;
const SWITCHBOT_SECRET = process.env.SWITCHBOT_SECRET;
const SWITCHBOT_API_BASE = 'https://api.switch-bot.com';

// DynamoDB (optional)
const DDB_TABLE = process.env.DDB_TABLE || '';
const DDB_TTL_DAYS = Number(process.env.DDB_TTL_DAYS || '0'); // 0 = no TTL
const ddb = DDB_TABLE ? new DynamoDBClient({}) : null;

/**
 * Generate SwitchBot API signature
 */
function generateSignature(token, secret, timestamp, nonce) {
  const data = token + timestamp + nonce;
  const signatureHash = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest();
  return signatureHash.toString('base64');
}

/**
 * Fetch devices from SwitchBot API
 */
async function getSwitchBotDevices() {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID();
  const signature = generateSignature(SWITCHBOT_TOKEN, SWITCHBOT_SECRET, timestamp, nonce);

  const response = await fetch(`${SWITCHBOT_API_BASE}/v1.1/devices`, {
    method: 'GET',
    headers: {
      'Authorization': SWITCHBOT_TOKEN,
      'sign': signature,
      't': timestamp,
      'nonce': nonce,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`SwitchBot API error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Fetch device status from SwitchBot API
 */
async function getSwitchBotStatus(deviceId) {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID();
  const signature = generateSignature(SWITCHBOT_TOKEN, SWITCHBOT_SECRET, timestamp, nonce);

  const response = await fetch(`${SWITCHBOT_API_BASE}/v1.1/devices/${deviceId}/status`, {
    method: 'GET',
    headers: {
      'Authorization': SWITCHBOT_TOKEN,
      'sign': signature,
      't': timestamp,
      'nonce': nonce,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    console.warn(`Failed to get status for device ${deviceId}: ${response.status}`);
    return null;
  }

  return await response.json();
}

function isoNow() {
  return new Date().toISOString();
}

function toEpochSeconds(iso) {
  try {
    return Math.floor(new Date(iso).getTime() / 1000);
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

async function persistReading(reading) {
  if (!ddb || !DDB_TABLE) return;
  try {
    const ttl = DDB_TTL_DAYS > 0 ? toEpochSeconds(reading.timestamp) + DDB_TTL_DAYS * 86400 : undefined;
    const item = marshall({
      pk: reading.zone,
      sk: reading.timestamp,
      zone: reading.zone,
      zoneName: reading.zoneName,
      deviceId: reading.deviceId,
      temperature: reading.temperature,
      humidity: reading.humidity,
      co2: reading.co2,
      battery: reading.battery,
      rssi: reading.rssi,
      ttl
    }, { removeUndefinedValues: true });
    await ddb.send(new PutItemCommand({ TableName: DDB_TABLE, Item: item }));
  } catch (e) {
    console.warn('Persist failed:', e?.message || String(e));
  }
}

async function queryHistory({ zone, sinceIso, untilIso, limit = 1000 }) {
  if (!ddb || !DDB_TABLE) {
    return { items: [], source: 'live-only' };
  }
  // If zone provided, query by partition key; else fallback to scan (small datasets only)
  if (zone) {
    const params = {
      TableName: DDB_TABLE,
      KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :from AND :to',
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
      ExpressionAttributeValues: marshall({ ':pk': zone, ':from': sinceIso, ':to': untilIso }),
      Limit: limit,
      ScanIndexForward: true
    };
    const out = await ddb.send(new QueryCommand(params));
    const items = (out.Items || []).map((it) => unmarshall(it));
    return { items, source: 'ddb-query' };
  }
  const scanParams = {
    TableName: DDB_TABLE,
    Limit: limit
  };
  const out = await ddb.send(new ScanCommand(scanParams));
  const items = (out.Items || []).map((it) => unmarshall(it)).filter((r) => r.sk >= sinceIso && r.sk <= untilIso);
  return { items, source: 'ddb-scan' };
}

/**
 * Main Lambda handler
 */
export const handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Check for required environment variables
    if (!SWITCHBOT_TOKEN || !SWITCHBOT_SECRET) {
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'SWITCHBOT_TOKEN and SWITCHBOT_SECRET must be set as environment variables'
        })
      };
    }

    // Get query parameters
    const queryParams = event.queryStringParameters || {};
    const filterZone = queryParams.zone;
    const filterDeviceId = queryParams.deviceId;
    const hours = Number(queryParams.hours || queryParams.rangeHours || 0);
    const since = queryParams.since;

    // History mode if hours/since provided and DynamoDB configured
    if ((hours > 0 || (since && since.trim())) && ddb && DDB_TABLE) {
      const untilIso = isoNow();
      const sinceIso = since && since.trim() ? since.trim() : new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const { items, source } = await queryHistory({ zone: filterZone, sinceIso, untilIso, limit: 5000 });
      const readings = items.map((it) => ({
        zone: it.zone || it.pk,
        zoneName: it.zoneName || it.zone || it.pk,
        deviceId: it.deviceId,
        temperature: it.temperature,
        humidity: it.humidity,
        co2: it.co2,
        battery: it.battery,
        rssi: it.rssi,
        timestamp: it.sk
      }));
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify(readings),
        meta: JSON.stringify({ provider: source })
      };
    }

    // Live fetch path: fetch all devices, optionally filter, persist each reading
    const devicesResponse = await getSwitchBotDevices();
    const devices = devicesResponse.body?.deviceList || [];

    const sensors = devices.filter(d => 
      d.deviceType === 'Meter' || 
      d.deviceType === 'MeterPlus' ||
      d.deviceType === 'WoIOSensor'
    );

    console.log(`Found ${sensors.length} sensor devices`);

    const sensorReadings = [];
    for (const sensor of sensors) {
      try {
        const statusResponse = await getSwitchBotStatus(sensor.deviceId);
        const status = statusResponse?.body;
        if (!status) continue;

        const zoneName = sensor.deviceName || sensor.deviceId;
        const zoneId = `zone-${sensor.deviceId}`;

        if (filterZone && zoneId !== filterZone) continue;
        if (filterDeviceId && sensor.deviceId !== filterDeviceId) continue;

        const reading = {
          zone: zoneId,
          zoneName: zoneName,
          deviceId: sensor.deviceId,
          temperature: status.temperature,
          humidity: status.humidity,
          battery: status.battery,
          timestamp: isoNow()
        };
        if (typeof status.CO2 === 'number') {
          reading.co2 = status.CO2;
        }

        sensorReadings.push(reading);
        // Best-effort persistence
        await persistReading(reading);

        console.log(`Sensor ${sensor.deviceId}: ${status.temperature}°C, ${status.humidity}%`);
      } catch (err) {
        console.error(`Error processing sensor ${sensor.deviceId}:`, err.message);
      }
    }

    console.log(`Returning ${sensorReadings.length} sensor readings`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(sensorReadings)
    };

  } catch (error) {
    console.error('Lambda error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
