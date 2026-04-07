/**
 * AI Recommendations Pusher Service
 * 
 * Periodically analyzes all farms using GPT-4 and pushes recommendations to farm servers
 */

import { getGeminiClient, GEMINI_FLASH, estimateGeminiCost, isGeminiConfigured } from '../lib/gemini-client.js';
import { query, isDatabaseAvailable } from '../config/database.js';
import { trackAiUsage, estimateChatCost } from '../lib/ai-usage-tracker.js';
import fetch from 'node-fetch';
import { getCropBenchmarksForPush, getEnvironmentBenchmarksForPush } from '../routes/experiment-records.js';
import { analyzeDemandPatterns } from '../services/wholesaleMemoryStore.js';
import { getNetworkModifiers } from '../jobs/yield-regression.js';
import { generateNetworkRiskAlerts } from '../jobs/supply-demand-balancer.js';
import { getAnomalyCorrelations } from '../jobs/anomaly-correlation.js';
import { getExperimentsForFarm } from '../jobs/experiment-orchestrator.js';
import { getLatestAnalyses } from '../services/market-analysis-agent.js';
import { getMarketDataAsync } from '../routes/market-intelligence.js';
import { getDatabase } from '../config/database.js';

const MODEL = GEMINI_FLASH;
const PUSH_INTERVAL_MS = 30 * 60 * 1000;

const runtimeStatus = {
  configured: isGeminiConfigured(),
  enabled: false,
  model: MODEL,
  push_interval_minutes: PUSH_INTERVAL_MS / 60000,
  started_at: null,
  last_run_started_at: null,
  last_run_completed_at: null,
  last_run_status: 'idle',
  last_error: null,
  next_run_at: null,
  totals: {
    runs: 0,
    analyzed_farms: 0,
    pushed_farms: 0,
    failed_runs: 0
  },
  last_result: null
};

function snapshotRuntimeStatus() {
  return {
    ...runtimeStatus,
    totals: { ...runtimeStatus.totals },
    last_result: runtimeStatus.last_result ? { ...runtimeStatus.last_result } : null
  };
}

function markRunStart() {
  runtimeStatus.last_run_started_at = new Date().toISOString();
  runtimeStatus.last_run_status = 'running';
  runtimeStatus.last_error = null;
  runtimeStatus.totals.runs += 1;
}

function markRunComplete(status, result = null, errorMessage = null) {
  runtimeStatus.last_run_completed_at = new Date().toISOString();
  runtimeStatus.last_run_status = status;
  runtimeStatus.last_error = errorMessage;
  runtimeStatus.last_result = result;
  if (status === 'error') {
    runtimeStatus.totals.failed_runs += 1;
  }
  runtimeStatus.next_run_at = runtimeStatus.enabled
    ? new Date(Date.now() + PUSH_INTERVAL_MS).toISOString()
    : null;
}

export function getAIPusherRuntimeStatus() {
  return snapshotRuntimeStatus();
}

let gemini = null;
async function ensureGemini() {
  if (gemini) return gemini;
  gemini = await getGeminiClient();
  return gemini;
}

if (isGeminiConfigured()) {
  console.log('[AI Pusher] Gemini configured');
} else {
  console.warn('[AI Pusher] No Gemini credentials - service disabled');
}

// API key for authenticating with farm servers
const EDGE_API_KEY = process.env.GREENREACH_API_KEY || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// ============================================================
// DEVICE INTEGRATION RECOMMENDATIONS — Tickets I-4.9, I-4.10
// ============================================================

/**
 * Get recommended drivers based on network success rates
 * Ticket I-4.9: Push integration recommendations
 * 
 * Returns top drivers per protocol with high success rates
 */
async function getDeviceIntegrationRecommendations() {
  if (!isDatabaseAvailable()) return null;
  
  try {
    const minSamples = 3;
    const minSuccessRate = 80;
    
    const result = await query(`
      WITH driver_stats AS (
        SELECT 
          driver_id,
          driver_version,
          protocol,
          COUNT(*) as usage_count,
          COUNT(DISTINCT farm_id_hash) as farm_count,
          ROUND(100.0 * SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)::numeric, 1) as success_rate,
          ROUND(AVG(validation_signal_quality)::numeric, 1) as avg_signal,
          ROW_NUMBER() OVER (PARTITION BY protocol ORDER BY 
            (100.0 * SUM(CASE WHEN validation_passed = true THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) DESC,
            COUNT(*) DESC
          ) as rank
        FROM device_integrations
        WHERE driver_id IS NOT NULL
        GROUP BY driver_id, driver_version, protocol
        HAVING COUNT(*) >= $1
      )
      SELECT *
      FROM driver_stats
      WHERE rank = 1 AND success_rate >= $2
      ORDER BY protocol
    `, [minSamples, minSuccessRate]);
    
    if (result.rows.length === 0) return null;
    
    // Format recommendations
    const recommendations = {};
    for (const row of result.rows) {
      recommendations[row.protocol] = {
        recommended_driver: row.driver_id,
        version: row.driver_version,
        success_rate: parseFloat(row.success_rate),
        farm_count: parseInt(row.farm_count),
        avg_signal: parseFloat(row.avg_signal) || null,
        message: `${Math.round(row.success_rate)}% of farms using ${row.driver_id} report stable operation`
      };
    }
    
    return recommendations;
  } catch (err) {
    console.warn('[AI Pusher] Device recommendations query failed:', err.message);
    return null;
  }
}

/**
 * Get warnings for problematic driver versions
 * Ticket I-4.10: Driver version warnings
 * 
 * Returns drivers with >20% failure rate across network
 */
async function getDriverVersionWarnings() {
  if (!isDatabaseAvailable()) return [];
  
  try {
    const failureThreshold = 20; // 20% failure rate
    const minSamples = 5;
    
    const result = await query(`
      SELECT 
        driver_id,
        driver_version,
        protocol,
        COUNT(*) as usage_count,
        COUNT(DISTINCT farm_id_hash) as affected_farms,
        ROUND(100.0 * SUM(CASE WHEN validation_passed = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)::numeric, 1) as failure_rate,
        ROUND(AVG(validation_dropout_rate)::numeric, 3) as avg_dropout
      FROM device_integrations
      WHERE driver_id IS NOT NULL
      GROUP BY driver_id, driver_version, protocol
      HAVING 
        COUNT(*) >= $1 AND
        (100.0 * SUM(CASE WHEN validation_passed = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) >= $2
      ORDER BY failure_rate DESC
      LIMIT 10
    `, [minSamples, failureThreshold]);
    
    return result.rows.map(row => ({
      driver_id: row.driver_id,
      driver_version: row.driver_version,
      protocol: row.protocol,
      failure_rate: parseFloat(row.failure_rate),
      affected_farms: parseInt(row.affected_farms),
      avg_dropout: parseFloat(row.avg_dropout) || null,
      severity: parseFloat(row.failure_rate) >= 50 ? 'critical' : 'warning',
      message: `Driver ${row.driver_id} v${row.driver_version} has ${Math.round(row.failure_rate)}% failure rate across ${row.affected_farms} farm(s). Consider upgrading.`
    }));
  } catch (err) {
    console.warn('[AI Pusher] Driver warnings query failed:', err.message);
    return [];
  }
}

/**
 * Analyze a single farm and generate recommendations
 */
async function analyzeFarm(farm) {
  try {
    // 1. Fetch environmental telemetry
    const telemetryResult = await query(
      `SELECT data FROM farm_data 
       WHERE farm_id = $1 AND data_type = 'telemetry' 
       ORDER BY updated_at DESC LIMIT 1`,
      [farm.farm_id]
    );
    
    if (telemetryResult.rows.length === 0) {
      console.log(`[AI Pusher] No telemetry for ${farm.farm_id}`);
      return null;
    }

    const telemetry = telemetryResult.rows[0].data;
    const zones = telemetry.environmental?.zones || [];
    
    if (zones.length === 0) {
      console.log(`[AI Pusher] No zones for ${farm.farm_id}`);
      return null;
    }

    // 2. Build analysis prompt
    let prompt = `Analyze this farm's environmental conditions and provide actionable recommendations:\n\n`;
    prompt += `FARM: ${farm.name} (${farm.farm_id})\n`;
    prompt += `Type: ${farm.farm_type || 'Controlled Environment Agriculture'}\n\n`;
    
    prompt += `CURRENT CONDITIONS:\n`;
    zones.forEach(zone => {
      const sensor = zone.sensors?.[0];
      if (sensor && sensor.readings) {
        prompt += `Zone "${zone.zone_name || zone.zone_id}":\n`;
        prompt += `  - Temperature: ${sensor.readings.temperature_c}°C\n`;
        prompt += `  - Humidity: ${sensor.readings.humidity}%\n`;
        if (sensor.readings.pressure_hpa) {
          prompt += `  - Pressure: ${sensor.readings.pressure_hpa} hPa\n`;
        }
      }
    });
    
    prompt += `\n`;
    prompt += `Provide 1-3 HIGH PRIORITY actionable recommendations. Format as:\n`;
    prompt += `1. [RECOMMENDATION TEXT]\n`;
    prompt += `2. [RECOMMENDATION TEXT]\n`;
    prompt += `Focus on: Temperature/humidity optimization, equipment adjustments, crop health.\n`;

    // 3. Call AI model (uses MODEL env var, defaults to gpt-4o-mini)
    const client = await ensureGemini();
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: "You are an expert agricultural AI monitoring multiple farms. Provide brief, actionable recommendations (1-2 sentences each) for farm operators."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    const aiResponse = completion.choices[0].message.content;

    trackAiUsage({
      farm_id: farm.farm_id,
      endpoint: 'recommendations-pusher',
      model: MODEL,
      prompt_tokens: completion.usage?.prompt_tokens,
      completion_tokens: completion.usage?.completion_tokens,
      total_tokens: completion.usage?.total_tokens,
      estimated_cost: estimateChatCost(MODEL, completion.usage?.prompt_tokens || 0, completion.usage?.completion_tokens || 0),
      status: 'success'
    });
    
    // 4. Parse recommendations
    const recommendations = [];
    const lines = aiResponse.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      // Match numbered recommendations: "1. Text" or "1) Text" or "• Text"
      const match = line.match(/^(?:\d+[\.\)]\s*|[•\-]\s*)(.+)$/);
      if (match) {
        const text = match[1].trim();
        recommendations.push({
          message: text,
          recommendation: text,
          zones: zones.map(z => z.zone_name || z.zone_id),
          priority: 'high',
          source: 'GPT-4 Analysis',
          timestamp: new Date().toISOString()
        });
      }
    }

    if (recommendations.length === 0) {
      console.log(`[AI Pusher] No structured recommendations from GPT-4 for ${farm.farm_id}`);
      return null;
    }

    return recommendations;

  } catch (error) {
    console.error(`[AI Pusher] Error analyzing ${farm.farm_id}:`, error.message);
    return null;
  }
}

/**
 * Push recommendations to farm server
 */
async function pushToFarm(farm, recommendations, networkIntelligence) {
  if (!farm.url) {
    console.log(`[AI Pusher] No URL for farm ${farm.farm_id}`);
    return false;
  }

  const payload = {
    farm_id: farm.farm_id,
    generated_at: new Date().toISOString(),
    recommendations: recommendations,
    // Phase 1 Task 1.9 — Central-first intelligence channel (Rule 7.2)
    network_intelligence: networkIntelligence || null,
    // Phase 4 Ticket 4.7: Active A/B experiments for this farm
    experiments: []
  };

  // Load active experiments assigned to this farm
  try {
    payload.experiments = await getExperimentsForFarm(farm.farm_id);
  } catch (expErr) {
    // Non-fatal — experiments are optional
  }

  try {
    const response = await fetch(`${farm.url}/api/health/ai-recommendations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': EDGE_API_KEY
      },
      body: JSON.stringify(payload),
      timeout: 10000
    });

    if (response.ok) {
      console.log(`[AI Pusher] ✅ Pushed ${recommendations.length} recommendations to ${farm.farm_id}`);
      return true;
    } else {
      console.error(`[AI Pusher] ❌ Farm ${farm.farm_id} returned ${response.status}`);
      return false;
    }

  } catch (error) {
    console.error(`[AI Pusher] ❌ Failed to push to ${farm.farm_id}:`, error.message);
    return false;
  }
}

/**
 * Analyze all farms and push recommendations
 */
export async function analyzeAndPushToAllFarms() {
  markRunStart();

  if (!isGeminiConfigured()) {
    console.log('[AI Pusher] Service disabled (no Gemini credentials)');
    const result = {
      analyzed: 0,
      pushed: 0,
      total: 0,
      disabled: true,
      reason: 'Gemini credentials missing'
    };
    markRunComplete('disabled', result, result.reason);
    return result;
  }

  console.log('[AI Pusher] Starting farm analysis cycle...');
  
  try {
    // Get all active farms
    const farmsResult = await query(
      `SELECT farm_id,
              name,
              COALESCE(api_url, metadata->>'url') AS url,
              farm_type
       FROM farms
       WHERE COALESCE(api_url, metadata->>'url') IS NOT NULL`
    );
    
    const farms = farmsResult.rows;
    console.log(`[AI Pusher] Found ${farms.length} farms with URLs`);

    let analyzed = 0;
    let pushed = 0;

    // Build network intelligence payload (Task 1.9 — Rule 7.2)
    let networkIntelligence = null;
    try {
      const cropBenchmarks = await getCropBenchmarksForPush();

      // Phase 2 Task 2.8: Real demand signals from wholesale orders
      let demandSignals = {};
      try {
        demandSignals = await analyzeDemandPatterns();
        if (Object.keys(demandSignals).length > 0) {
          console.log(`[AI Pusher] Loaded demand signals for ${Object.keys(demandSignals).length} crop(s)`);
        }
      } catch (demandErr) {
        console.warn('[AI Pusher] Demand analysis failed (non-fatal):', demandErr.message);
      }

      // Phase 3 Ticket 3.3: Network recipe modifiers from yield regression
      let recipeModifiers = {};
      try {
        const modData = await getNetworkModifiers();
        recipeModifiers = modData?.modifiers || {};
        if (Object.keys(recipeModifiers).length > 0) {
          console.log(`[AI Pusher] Loaded network recipe modifiers for ${Object.keys(recipeModifiers).length} crop(s)`);
        }
      } catch (modErr) {
        console.warn('[AI Pusher] Network modifiers load failed (non-fatal):', modErr.message);
      }

      // Phase 4 Ticket 4.2/4.3: Network risk alerts (harvest conflicts + supply gaps)
      let riskAlerts = [];
      try {
        riskAlerts = await generateNetworkRiskAlerts();
        if (riskAlerts.length > 0) {
          console.log(`[AI Pusher] Generated ${riskAlerts.length} network risk alert(s)`);
        }
      } catch (riskErr) {
        console.warn('[AI Pusher] Risk alert generation failed (non-fatal):', riskErr.message);
      }

      // Integration Assistant Phase 4 Ticket I-4.9: Device integration recommendations
      let deviceIntegrations = null;
      try {
        deviceIntegrations = await getDeviceIntegrationRecommendations();
        if (deviceIntegrations && Object.keys(deviceIntegrations).length > 0) {
          console.log(`[AI Pusher] Loaded device recommendations for ${Object.keys(deviceIntegrations).length} protocol(s)`);
        }
      } catch (intErr) {
        console.warn('[AI Pusher] Device recommendations failed (non-fatal):', intErr.message);
      }

      // Integration Assistant Phase 4 Ticket I-4.10: Driver version warnings
      let integrationWarnings = [];
      try {
        integrationWarnings = await getDriverVersionWarnings();
        if (integrationWarnings.length > 0) {
          console.log(`[AI Pusher] Generated ${integrationWarnings.length} driver warning(s)`);
        }
      } catch (warnErr) {
        console.warn('[AI Pusher] Driver warnings failed (non-fatal):', warnErr.message);
      }

      // AI Market Intelligence Phase 3A+: Pricing intelligence from market analysis
      let pricingIntelligence = null;
      try {
        const pool = getDatabase();
        if (pool) {
          const [marketData, aiAnalyses] = await Promise.all([
            getMarketDataAsync(pool),
            getLatestAnalyses(pool)
          ]);

          const aiMap = {};
          for (const a of aiAnalyses) aiMap[a.product] = a;

          const tips = [];
          for (const [product, data] of Object.entries(marketData)) {
            const ai = aiMap[product] || null;
            if (data.trend === 'increasing' || ai?.outlook === 'bullish') {
              tips.push({
                crop: product,
                trend: data.trend,
                trendPercent: data.trendPercent,
                latestPrice: data.latestPrice,
                unit: data.unit,
                aiOutlook: ai?.outlook || null,
                aiAction: ai?.action || null,
                aiConfidence: ai?.confidence || null,
                tip: ai?.reasoning || `${product} prices ${data.trend} (${data.trendPercent > 0 ? '+' : ''}${data.trendPercent}%)`
              });
            }
          }

          if (tips.length > 0) {
            pricingIntelligence = {
              tips,
              analysis_count: aiAnalyses.length,
              generated_at: new Date().toISOString()
            };
            console.log(`[AI Pusher] Loaded pricing intelligence: ${tips.length} tip(s)`);
          }
        }
      } catch (pricingErr) {
        console.warn('[AI Pusher] Pricing intelligence load failed (non-fatal):', pricingErr.message);
      }

      // Phase 3 Task 33: Cross-farm anomaly correlations
      let anomalyCorrelations = [];
      let plantingSuggestions = [];
      try {
        const ac = await getAnomalyCorrelations();
        anomalyCorrelations = ac.correlations || [];
        if (anomalyCorrelations.length > 0) {
          console.log(`[AI Pusher] Loaded ${anomalyCorrelations.length} anomaly correlation(s)`);
        }
      } catch (acErr) {
        console.warn('[AI Pusher] Anomaly correlations load failed (non-fatal):', acErr.message);
      }

      // Phase 2 Task 22: Environmental benchmark push
      let environmentBenchmarks = {};
      try {
        environmentBenchmarks = await getEnvironmentBenchmarksForPush();
        if (Object.keys(environmentBenchmarks).length > 0) {
          console.log(`[AI Pusher] Loaded environment benchmarks for ${Object.keys(environmentBenchmarks).length} crop(s)`);
        }
      } catch (envErr) {
        console.warn('[AI Pusher] Environment benchmarks load failed (non-fatal):', envErr.message);
      }

      if (Object.keys(cropBenchmarks).length > 0 || Object.keys(demandSignals).length > 0 || Object.keys(recipeModifiers).length > 0 || deviceIntegrations || integrationWarnings.length > 0) {
        networkIntelligence = {
          crop_benchmarks: cropBenchmarks,
          demand_signals: demandSignals,
          recipe_modifiers: recipeModifiers,
          risk_alerts: riskAlerts,
          environment_benchmarks: environmentBenchmarks,
          anomaly_correlations: anomalyCorrelations,
          planting_suggestions: plantingSuggestions,
          device_integrations: deviceIntegrations,
          integration_warnings: integrationWarnings,          pricing_intelligence: pricingIntelligence,          generated_at: new Date().toISOString()
        };
        console.log(`[AI Pusher] Loaded crop benchmarks for ${Object.keys(cropBenchmarks).length} crop(s)`);
      }
    } catch (benchErr) {
      console.warn('[AI Pusher] Failed to load crop benchmarks:', benchErr.message);
    }

    for (const farm of farms) {
      console.log(`[AI Pusher] Analyzing ${farm.name} (${farm.farm_id})...`);
      
      const recommendations = await analyzeFarm(farm);
      
      if (recommendations && recommendations.length > 0) {
        analyzed++;
        const success = await pushToFarm(farm, recommendations, networkIntelligence);
        if (success) pushed++;
        
        // Small delay between farms
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`[AI Pusher] Cycle complete: ${analyzed} analyzed, ${pushed} pushed`);
    runtimeStatus.totals.analyzed_farms += analyzed;
    runtimeStatus.totals.pushed_farms += pushed;
    const result = { analyzed, pushed, total: farms.length, disabled: false };
    markRunComplete('ok', result, null);
    return result;

  } catch (error) {
    console.error('[AI Pusher] Error in cycle:', error);
    const result = { error: error.message, analyzed: 0, pushed: 0, total: 0 };
    markRunComplete('error', result, error.message);
    return result;
  }
}

/**
 * Start periodic analysis (every 30 minutes)
 */
export function startAIPusher() {
  if (!isGeminiConfigured()) {
    console.log('[AI Pusher] Service disabled');
    runtimeStatus.enabled = false;
    runtimeStatus.last_run_status = 'disabled';
    runtimeStatus.last_error = 'Gemini credentials missing';
    runtimeStatus.next_run_at = null;
    return null;
  }

  console.log('[AI Pusher] Starting periodic service (30 min intervals)');
  runtimeStatus.enabled = true;
  runtimeStatus.started_at = runtimeStatus.started_at || new Date().toISOString();
  runtimeStatus.last_run_status = 'running';
  runtimeStatus.next_run_at = new Date(Date.now() + PUSH_INTERVAL_MS).toISOString();
  
  // Run immediately on start
  analyzeAndPushToAllFarms();
  
  // Then run every 30 minutes
  const interval = setInterval(analyzeAndPushToAllFarms, PUSH_INTERVAL_MS);
  
  return interval;
}
