#!/usr/bin/env node
/**
 * Push nutrient setpoints and autodose configuration to the ESP32 controller.
 *
 * Usage examples:
 *   node scripts/nutrient-push-setpoints.js --ec-target 900 --ec-dose 2.5 --ph-target 6.2 --enable
 *   NUTRIENT_MQTT_URL=mqtt://192.168.2.50:1883 node scripts/nutrient-push-setpoints.js --disable
 */

import mqtt from 'mqtt';

const DEFAULTS = {
  brokerUrl: process.env.NUTRIENT_MQTT_URL || 'mqtt://192.168.2.42:1883',
  topic: process.env.NUTRIENT_COMMAND_TOPIC || 'commands/NutrientRoom',
  autodoseEnabled: true,
  phTarget: 6.5,
  phTolerance: 0.15,
  ecTarget: 800,
  ecTolerance: 50,
  ecDoseSeconds: 2.5,
  phDownDoseSeconds: 1.0,
  minDoseIntervalSec: 60
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    switch (arg) {
      case '--broker':
        if (next) {
          opts.brokerUrl = next;
          i += 1;
        }
        break;
      case '--topic':
        if (next) {
          opts.topic = next;
          i += 1;
        }
        break;
      case '--ph-target':
        if (next) {
          opts.phTarget = Number(next);
          i += 1;
        }
        break;
      case '--ph-tolerance':
        if (next) {
          opts.phTolerance = Number(next);
          i += 1;
        }
        break;
      case '--ec-target':
        if (next) {
          opts.ecTarget = Number(next);
          i += 1;
        }
        break;
      case '--ec-tolerance':
        if (next) {
          opts.ecTolerance = Number(next);
          i += 1;
        }
        break;
      case '--ec-dose':
        if (next) {
          opts.ecDoseSeconds = Number(next);
          i += 1;
        }
        break;
      case '--ph-dose':
        if (next) {
          opts.phDownDoseSeconds = Number(next);
          i += 1;
        }
        break;
      case '--interval':
        if (next) {
          opts.minDoseIntervalSec = Number(next);
          i += 1;
        }
        break;
      case '--enable':
        opts.autodoseEnabled = true;
        break;
      case '--disable':
        opts.autodoseEnabled = false;
        break;
      default:
        console.warn(`Ignoring unknown option ${arg}`);
        break;
    }
  }
  return opts;
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  options.phTarget = clamp(options.phTarget, 4.0, 7.5);
  options.phTolerance = clamp(options.phTolerance, 0.05, 1.0);
  options.ecTarget = clamp(options.ecTarget, 100, 2500);
  options.ecTolerance = clamp(options.ecTolerance, 5, 500);
  options.ecDoseSeconds = clamp(options.ecDoseSeconds, 0.5, 20.0);
  options.phDownDoseSeconds = clamp(options.phDownDoseSeconds, 0.5, 5.0);
  options.minDoseIntervalSec = clamp(options.minDoseIntervalSec, 30, 3600);

  const payload = {
    action: 'setTargets',
    targets: {
      phTarget: Number(options.phTarget.toFixed(2)),
      phTolerance: Number(options.phTolerance.toFixed(2)),
      ecTarget: Number(options.ecTarget.toFixed(1)),
      ecTolerance: Number(options.ecTolerance.toFixed(1)),
      autodoseEnabled: options.autodoseEnabled,
      dosing: {
        enabled: options.autodoseEnabled,
        ecDoseSeconds: Number(options.ecDoseSeconds.toFixed(2)),
        phDownDoseSeconds: Number(options.phDownDoseSeconds.toFixed(2)),
        minDoseIntervalSec: Number(options.minDoseIntervalSec.toFixed(0))
      }
    }
  };

  console.log('Connecting to MQTT broker:', options.brokerUrl);
  const client = mqtt.connect(options.brokerUrl);

  await new Promise((resolve, reject) => {
    client.on('connect', resolve);
    client.on('error', reject);
    setTimeout(() => reject(new Error('MQTT connection timeout')), 8000);
  }).catch((error) => {
    console.error('Failed to connect to MQTT broker:', error.message);
    client.end(true);
    process.exit(1);
  });

  console.log('Publishing setTargets to', options.topic);
  client.publish(options.topic, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error('Publish failed:', err.message);
      client.end(true);
      process.exit(1);
    }

    console.log('Setpoints dispatched successfully.');
    client.end(true, () => {
      console.log('MQTT connection closed.');
      process.exit(0);
    });
  });
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
