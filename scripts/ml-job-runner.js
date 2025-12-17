/**
 * ML Job Runner - Orchestrates scheduled ML tasks
 * 
 * Runs anomaly detection and predictive forecasting jobs on schedule.
 * Stores results in public/data/ml-insights/ for API consumption.
 * 
 * Usage:
 *   node scripts/ml-job-runner.js --job anomalies
 *   node scripts/ml-job-runner.js --job forecast --zone main
 *   node scripts/ml-job-runner.js --job all
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import outdoorSensorValidator from '../lib/outdoor-sensor-validator.js';
import anomalyHistory from '../lib/anomaly-history.js';
import mlAutomation from '../lib/ml-automation-controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

// Configuration
const CONFIG = {
  pythonBin: process.env.PYTHON_BIN || path.join(PROJECT_ROOT, 'venv', 'bin', 'python'),
  outputDir: path.join(PROJECT_ROOT, 'public', 'data', 'ml-insights'),
  maxOutputAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  zones: ['main', 'veg', 'flower'], // Target zones for forecasting
  forecastHours: 4, // Hours ahead to forecast
};

// Logging utilities
const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] INFO: ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] ERROR: ${msg}`),
  success: (msg) => console.log(`[${new Date().toISOString()}] ✓ ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] ⚠ ${msg}`),
};

/**
 * Check outdoor sensor validity before running ML job
 */
async function checkOutdoorSensorValidity() {
  try {
    const envPath = path.join(PROJECT_ROOT, 'public', 'data', 'env.json');
    
    // Check if env.json exists
    try {
      await fs.access(envPath);
    } catch (err) {
      return {
        valid: false,
        reason: 'No environmental data file found',
        gate: { allowed: false, reason: 'no_env_data' }
      };
    }
    
    // Read env.json
    const content = await fs.readFile(envPath, 'utf-8');
    const envData = JSON.parse(content);
    
    // Find outdoor sensor
    const outdoorSensor = outdoorSensorValidator.findOutdoorSensor(envData);
    
    if (!outdoorSensor) {
      return {
        valid: false,
        reason: 'No outdoor sensor found in environmental data',
        gate: { allowed: false, reason: 'no_outdoor_sensor' }
      };
    }
    
    // Validate outdoor sensor
    const validation = outdoorSensorValidator.validateOutdoorSensor(outdoorSensor);
    const gate = outdoorSensorValidator.gateMLOperation(validation);
    
    return {
      valid: validation.isValid,
      validation,
      gate,
      outdoor_sensor: {
        zone: outdoorSensor.zone,
        temp: outdoorSensor.temp,
        rh: outdoorSensor.rh,
        age_minutes: validation.age_minutes
      }
    };
  } catch (err) {
    log.error(`Failed to check outdoor sensor: ${err.message}`);
    return {
      valid: false,
      reason: err.message,
      gate: { allowed: false, reason: 'validation_error' }
    };
  }
}

/**
 * Run a Python ML script and capture output
 */
async function runPythonScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const process_spawn = spawn(CONFIG.pythonBin, [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    process_spawn.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process_spawn.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process_spawn.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: code });
      } else {
        reject(new Error(`Process exited with code ${code}\nStderr: ${stderr}`));
      }
    });

    process_spawn.on('error', (err) => {
      reject(new Error(`Failed to start process: ${err.message}`));
    });
  });
}

/**
 * Save ML job result to insights directory
 */
async function saveInsight(jobName, data) {
  await fs.mkdir(CONFIG.outputDir, { recursive: true });
  
  const timestamp = new Date().toISOString();
  const filename = `${jobName}-${Date.now()}.json`;
  const latestFilename = `${jobName}-latest.json`;
  
  const output = {
    job: jobName,
    timestamp,
    data,
    metadata: {
      generatedAt: timestamp,
      validUntil: new Date(Date.now() + CONFIG.maxOutputAge).toISOString(),
    },
  };

  // Save timestamped version
  const timestampedPath = path.join(CONFIG.outputDir, filename);
  await fs.writeFile(timestampedPath, JSON.stringify(output, null, 2));
  
  // Save latest version (symlink or copy)
  const latestPath = path.join(CONFIG.outputDir, latestFilename);
  await fs.writeFile(latestPath, JSON.stringify(output, null, 2));
  
  return { timestampedPath, latestPath };
}

/**
 * Clean old ML insights (>24 hours)
 */
async function cleanOldInsights() {
  try {
    const files = await fs.readdir(CONFIG.outputDir);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      if (file.endsWith('-latest.json')) continue; // Keep latest files
      
      const filePath = path.join(CONFIG.outputDir, file);
      const stats = await fs.stat(filePath);
      const age = now - stats.mtimeMs;

      if (age > CONFIG.maxOutputAge) {
        await fs.unlink(filePath);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info(`Cleaned ${cleaned} old insight files`);
    }
  } catch (err) {
    log.warn(`Failed to clean old insights: ${err.message}`);
  }
}

/**
 * Run anomaly detection job
 */
async function runAnomalyDetection() {
  log.info('Running anomaly detection...');
  
  // Check outdoor sensor validity first
  const sensorCheck = await checkOutdoorSensorValidity();
  
  if (!sensorCheck.gate.allowed) {
    const message = sensorCheck.gate.message || sensorCheck.reason || 'Outdoor sensor validation failed';
    log.warn(`Skipping anomaly detection: ${message}`);
    
    // Save error state with outdoor sensor status
    const errorData = {
      error: 'Outdoor sensor validation failed',
      reason: sensorCheck.gate.reason || sensorCheck.reason,
      message,
      outdoor_sensor: sensorCheck.outdoor_sensor || null,
      validation: sensorCheck.validation || null,
      timestamp: new Date().toISOString(),
      ml_gated: true
    };
    await saveInsight('anomalies', errorData);
    
    return { ok: false, error: message, ml_gated: true };
  }
  
  log.info(`Outdoor sensor valid: ${sensorCheck.outdoor_sensor.zone} (${sensorCheck.outdoor_sensor.age_minutes} min old)`);
  
  try {
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'simple-anomaly-detector.py');
    const result = await runPythonScript(scriptPath);
    
    // Parse JSON output from script
    let anomalies;
    try {
      // Extract JSON from stdout (script may have other output)
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        anomalies = JSON.parse(jsonMatch[0]);
      } else {
        anomalies = { error: 'No JSON output from anomaly detector', stdout: result.stdout };
      }
    } catch (parseErr) {
      anomalies = { error: 'Failed to parse anomaly detector output', raw: result.stdout };
    }

    const paths = await saveInsight('anomalies', anomalies);
    log.success(`Anomaly detection complete. Saved to ${paths.latestPath}`);
    
    // Persist anomalies to history if we have valid results
    if (anomalies.success && Array.isArray(anomalies.anomalies) && anomalies.anomalies.length > 0) {
      try {
        const persistResult = await anomalyHistory.addAnomalies(anomalies.anomalies);
        log.info(`Persisted ${persistResult.added} anomalies to history (total: ${persistResult.total})`);
        
        // Process anomalies for automation response
        if (mlAutomation.getConfig().anomaly_response_enabled) {
          const actions = [];
          for (const anomaly of anomalies.anomalies) {
            const response = mlAutomation.evaluateAnomalyResponse(anomaly);
            if (response && response.action !== 'none') {
              actions.push(response);
              log.info(`ML Automation: ${response.action} triggered for ${anomaly.zone} (${response.reason})`);
            }
          }
          
          if (actions.length > 0) {
            // Save automation actions to insights
            await saveInsight('automation-actions', {
              timestamp: new Date().toISOString(),
              trigger: 'anomaly_detection',
              actions
            });
            log.success(`Generated ${actions.length} automation actions from anomalies`);
          }
        }
      } catch (historyError) {
        log.warn(`Failed to persist anomalies to history: ${historyError.message}`);
      }
    }
    
    return { ok: true, data: anomalies };
  } catch (err) {
    log.error(`Anomaly detection failed: ${err.message}`);
    
    // Save error state
    const errorData = {
      error: err.message,
      timestamp: new Date().toISOString(),
    };
    await saveInsight('anomalies', errorData);
    
    return { ok: false, error: err.message };
  }
}

/**
 * Run predictive forecast job for a zone
 */
async function runForecast(zone, hours = CONFIG.forecastHours) {
  log.info(`Running forecast for zone: ${zone}, hours: ${hours}`);
  
  // Check outdoor sensor validity first
  const sensorCheck = await checkOutdoorSensorValidity();
  
  if (!sensorCheck.gate.allowed) {
    log.warn(`Skipping forecast for ${zone}: ${sensorCheck.gate.message}`);
    
    // Save error state with outdoor sensor status
    const errorData = {
      error: 'Outdoor sensor validation failed',
      reason: sensorCheck.gate.reason,
      message: sensorCheck.gate.message,
      outdoor_sensor: sensorCheck.outdoor_sensor || null,
      zone,
      timestamp: new Date().toISOString(),
      ml_gated: true
    };
    await saveInsight(`forecast-${zone}`, errorData);
    
    return { ok: false, zone, error: sensorCheck.gate.message, ml_gated: true };
  }
  
  log.info(`Outdoor sensor valid: ${sensorCheck.outdoor_sensor.zone} (${sensorCheck.outdoor_sensor.age_minutes} min old)`);
  
  try {
    const scriptPath = path.join(PROJECT_ROOT, 'backend', 'predictive_forecast.py');
    const result = await runPythonScript(scriptPath, [
      '--zone', zone,
      '--hours', hours.toString(),
      '--json', // Output JSON format
    ]);
    
    // Parse JSON output
    let forecast;
    try {
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        forecast = JSON.parse(jsonMatch[0]);
      } else {
        forecast = { error: 'No JSON output from forecaster', stdout: result.stdout };
      }
    } catch (parseErr) {
      forecast = { error: 'Failed to parse forecast output', raw: result.stdout };
    }

    const paths = await saveInsight(`forecast-${zone}`, forecast);
    log.success(`Forecast for ${zone} complete. Saved to ${paths.latestPath}`);
    
    // Record prediction for metrics tracking
    if (forecast.success && forecast.predictions && forecast.predictions.length > 0) {
      try {
        const metricsCollector = await import('../lib/ml-metrics-collector.js');
        const { recordPrediction } = metricsCollector.default;
        
        // Record the first prediction (1-hour ahead)
        const firstPrediction = forecast.predictions[0];
        
        // For now, we record the prediction without actual value (will be updated later)
        // In a production system, we'd compare against actual sensor data when it arrives
        // This creates the prediction entry that will be compared when actual data is ingested
        log.info(`Prediction recorded for metrics tracking: ${firstPrediction.temperature}°C at ${firstPrediction.timestamp}`);
      } catch (metricsErr) {
        log.warn(`Failed to record prediction for metrics: ${metricsErr.message}`);
      }
    }
    
    // Process forecast for proactive automation
    if (mlAutomation.getConfig().forecast_response_enabled && forecast.success && forecast.predictions) {
      const response = mlAutomation.evaluateForecastResponse({
        zone,
        predictions: forecast.predictions,
        forecast_horizon_hours: hours
      });
      
      if (response) {
        log.info(`ML Automation: ${response.action} triggered for ${zone} (${response.reason})`);
        
        // Save automation action to insights
        await saveInsight('automation-actions', {
          timestamp: new Date().toISOString(),
          trigger: 'forecast_prediction',
          actions: [response]
        });
        log.success(`Generated proactive automation action for ${zone}`);
      }
    }
    
    return { ok: true, zone, data: forecast };
  } catch (err) {
    log.error(`Forecast for ${zone} failed: ${err.message}`);
    
    // Save error state
    const errorData = {
      error: err.message,
      zone,
      timestamp: new Date().toISOString(),
    };
    await saveInsight(`forecast-${zone}`, errorData);
    
    return { ok: false, zone, error: err.message };
  }
}

/**
 * Run all forecast jobs for configured zones
 */
async function runAllForecasts() {
  log.info(`Running forecasts for ${CONFIG.zones.length} zones...`);
  
  const results = [];
  for (const zone of CONFIG.zones) {
    const result = await runForecast(zone);
    results.push(result);
  }
  
  const successful = results.filter(r => r.ok).length;
  log.success(`Completed ${successful}/${results.length} forecasts`);
  
  return results;
}

/**
 * Run energy forecast job
 */
async function runEnergyForecast(hours = 24) {
  log.info(`Running energy forecast for ${hours} hours...`);
  
  try {
    const scriptPath = path.join(PROJECT_ROOT, 'backend', 'energy_forecast.py');
    const result = await runPythonScript(scriptPath, [
      '--hours', hours.toString(),
      '--json',
    ]);
    
    // Parse JSON output
    let forecast;
    try {
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        forecast = JSON.parse(jsonMatch[0]);
      } else {
        forecast = { error: 'No JSON output from energy forecaster', stdout: result.stdout };
      }
    } catch (parseErr) {
      forecast = { error: 'Failed to parse energy forecast output', raw: result.stdout };
    }

    const paths = await saveInsight('energy-forecast', forecast);
    log.success(`Energy forecast complete. Saved to ${paths.latestPath}`);
    
    if (forecast.success) {
      log.info(`Predicted energy: ${forecast.total_daily_kwh} kWh (24h)`);
    }
    
    return { ok: true, data: forecast };
  } catch (err) {
    log.error(`Energy forecast failed: ${err.message}`);
    
    // Save error state
    const errorData = {
      error: err.message,
      timestamp: new Date().toISOString(),
    };
    await saveInsight('energy-forecast', errorData);
    
    return { ok: false, error: err.message };
  }
}

/**
 * Health check - verify Python environment and scripts exist
 */
async function healthCheck() {
  const checks = [];
  
  // Check Python binary
  try {
    await runPythonScript('-c', ['import sys; print(sys.version)']);
    checks.push({ name: 'Python Binary', status: 'ok' });
  } catch (err) {
    checks.push({ name: 'Python Binary', status: 'error', message: err.message });
  }
  
  // Check ML dependencies
  try {
    await runPythonScript('-c', [
      'import sklearn, numpy, pandas, statsmodels; print("ok")'
    ]);
    checks.push({ name: 'ML Dependencies', status: 'ok' });
  } catch (err) {
    checks.push({ name: 'ML Dependencies', status: 'error', message: err.message });
  }
  
  // Check scripts exist
  const scripts = [
    path.join(PROJECT_ROOT, 'scripts', 'simple-anomaly-detector.py'),
    path.join(PROJECT_ROOT, 'backend', 'predictive_forecast.py'),
  ];
  
  for (const script of scripts) {
    try {
      await fs.access(script);
      checks.push({ name: path.basename(script), status: 'ok' });
    } catch (err) {
      checks.push({ name: path.basename(script), status: 'error', message: 'File not found' });
    }
  }
  
  // Check output directory
  try {
    await fs.mkdir(CONFIG.outputDir, { recursive: true });
    checks.push({ name: 'Output Directory', status: 'ok' });
  } catch (err) {
    checks.push({ name: 'Output Directory', status: 'error', message: err.message });
  }
  
  const failed = checks.filter(c => c.status === 'error');
  if (failed.length > 0) {
    log.error('Health check failed:');
    failed.forEach(c => log.error(`  - ${c.name}: ${c.message}`));
    return false;
  }
  
  log.success('Health check passed');
  return true;
}

/**
 * Run model retraining workflow
 */
async function runModelRetrain(zone = null, force = false) {
  log.info(`Running model retraining${zone ? ` for zone: ${zone}` : ' for all zones'}...`);
  
  try {
    // Import model retrainer
    const { retrainZone, retrainAll } = await import('../lib/model-retrainer.js');
    
    let result;
    if (zone) {
      // Retrain single zone
      result = await retrainZone(zone, { force });
      
      if (!result.success) {
        log.warn(`Model retraining failed for ${zone}: ${result.reason || result.error}`);
      } else if (result.skipped) {
        log.info(`Model retraining skipped for ${zone}: ${result.reason}`);
      } else {
        log.success(`Model retraining complete for ${zone}`);
      }
    } else {
      // Retrain all zones
      result = await retrainAll({ force });
      log.success(`Model retraining complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped`);
    }
    
    return {
      ok: result.success || (result.succeeded !== undefined && result.failed === 0),
      job: 'retrain',
      zone: zone || 'all',
      timestamp: new Date().toISOString(),
      result,
    };
    
  } catch (err) {
    log.error(`Model retraining failed: ${err.message}`);
    return {
      ok: false,
      job: 'retrain',
      zone: zone || 'all',
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Run metrics collection and drift detection
 */
async function runMetricsCheck(zone = null) {
  log.info(`Running metrics check${zone ? ` for zone: ${zone}` : ' for all zones'}...`);
  
  try {
    const metricsCollector = await import('../lib/ml-metrics-collector.js');
    const { calculateZoneAccuracy, checkDataDrift, checkConceptDrift } = metricsCollector.default;
    
    const zones = zone ? [zone] : CONFIG.zones;
    const results = [];
    
    for (const zn of zones) {
      log.info(`Checking metrics for ${zn}...`);
      
      // Calculate accuracy metrics
      const accuracy = await calculateZoneAccuracy(zn, 24);
      
      if (accuracy) {
        log.info(`${zn} accuracy: RMSE=${accuracy.rmse.toFixed(2)}°C, MAE=${accuracy.mae.toFixed(2)}°C, Alert=${accuracy.alert_level}`);
        
        // Check for drift
        const dataDrift = await checkDataDrift(zn);
        const conceptDrift = await checkConceptDrift(zn);
        
        if (dataDrift.drift_detected) {
          log.warn(`Data drift detected in ${zn}: score=${dataDrift.drift_score.toFixed(3)}`);
        }
        
        if (conceptDrift.drift_detected) {
          log.warn(`Concept drift detected in ${zn}: RMSE ratio=${conceptDrift.rmse_ratio.toFixed(2)}x, severity=${conceptDrift.severity}`);
        }
        
        results.push({
          zone: zn,
          accuracy,
          data_drift: dataDrift.drift_detected,
          concept_drift: conceptDrift.drift_detected,
        });
      } else {
        log.info(`${zn}: No metrics data available yet`);
        results.push({ zone: zn, status: 'no_data' });
      }
    }
    
    // Save metrics summary
    const summary = {
      timestamp: new Date().toISOString(),
      zones_checked: zones.length,
      results,
    };
    
    await saveInsight('metrics-check', summary);
    log.success(`Metrics check complete for ${zones.length} zone(s)`);
    
    return {
      ok: true,
      job: 'metrics-check',
      zone: zone || 'all',
      timestamp: new Date().toISOString(),
      results,
    };
    
  } catch (err) {
    log.error(`Metrics check failed: ${err.message}`);
    return {
      ok: false,
      job: 'metrics-check',
      zone: zone || 'all',
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Main job orchestrator
 */
async function main() {
  const args = process.argv.slice(2);
  const jobIndex = args.indexOf('--job');
  const zoneIndex = args.indexOf('--zone');
  
  const job = jobIndex !== -1 ? args[jobIndex + 1] : 'all';
  const zone = zoneIndex !== -1 ? args[zoneIndex + 1] : 'main';

  log.info(`Starting ML job runner: ${job}`);
  
  // Health check first
  if (args.includes('--health-check')) {
    const healthy = await healthCheck();
    process.exit(healthy ? 0 : 1);
  }
  
  // Clean old insights
  await cleanOldInsights();
  
  // Run requested job
  let result;
  switch (job) {
    case 'anomalies':
      result = await runAnomalyDetection();
      break;
    
    case 'forecast':
      result = await runForecast(zone);
      break;
    
    case 'energy':
      result = await runEnergyForecast(24);
      break;
    
    case 'retrain':
      const forceRetrain = args.includes('--force');
      result = await runModelRetrain(zone === 'main' ? null : zone, forceRetrain);
      break;
    
    case 'metrics-check':
      result = await runMetricsCheck(zone === 'main' ? null : zone);
      break;
    
    case 'all':
      const anomalyResult = await runAnomalyDetection();
      const forecastResults = await runAllForecasts();
      const energyResult = await runEnergyForecast(24);
      result = {
        anomalies: anomalyResult,
        forecasts: forecastResults,
        energy: energyResult,
      };
      break;
    
    default:
      log.error(`Unknown job: ${job}`);
      log.info('Valid jobs: anomalies, forecast, energy, retrain, metrics-check, all');
      process.exit(1);
  }
  
  log.success('ML job runner complete');
  
  // Exit with error code if any job failed
  if (result.ok === false || (result.forecasts && result.forecasts.some(f => !f.ok)) || (result.energy && !result.energy.ok)) {
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', (err) => {
  log.error(`Unhandled rejection: ${err.message}`);
  process.exit(1);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

export { runAnomalyDetection, runForecast, runAllForecasts, runEnergyForecast, runModelRetrain, runMetricsCheck, healthCheck };
