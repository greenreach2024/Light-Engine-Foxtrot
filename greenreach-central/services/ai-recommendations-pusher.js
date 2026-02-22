/**
 * AI Recommendations Pusher Service
 * 
 * Periodically analyzes all farms using GPT-4 and pushes recommendations to farm servers
 */

import OpenAI from 'openai';
import { query } from '../config/database.js';
import fetch from 'node-fetch';
import { getCropBenchmarksForPush } from '../routes/experiment-records.js';
import { analyzeDemandPatterns } from '../services/wholesaleMemoryStore.js';
import { getNetworkModifiers } from '../jobs/yield-regression.js';
import { generateNetworkRiskAlerts } from '../jobs/supply-demand-balancer.js';
import { getExperimentsForFarm } from '../jobs/experiment-orchestrator.js';

let openai = null;
try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('[AI Pusher] OpenAI initialized');
  } else {
    console.warn('[AI Pusher] OPENAI_API_KEY not set - service disabled');
  }
} catch (error) {
  console.error('[AI Pusher] Failed to initialize OpenAI:', error.message);
}

// API key for authenticating with farm servers
const EDGE_API_KEY = process.env.GREENREACH_API_KEY || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/**
 * Analyze a single farm and generate recommendations
 */
async function analyzeFarm(farm) {
  try {
    // 1. Fetch environmental telemetry
    const telemetryResult = await query(
      `SELECT data FROM farm_data 
       WHERE farm_id = $1 AND data_type = 'telemetry' 
       ORDER BY timestamp DESC LIMIT 1`,
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

    // 3. Call GPT-4
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
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
  if (!openai) {
    console.log('[AI Pusher] Service disabled (no OpenAI API key)');
    return { analyzed: 0, pushed: 0 };
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

      if (Object.keys(cropBenchmarks).length > 0 || Object.keys(demandSignals).length > 0 || Object.keys(recipeModifiers).length > 0) {
        networkIntelligence = {
          crop_benchmarks: cropBenchmarks,
          demand_signals: demandSignals,
          recipe_modifiers: recipeModifiers,
          risk_alerts: riskAlerts,
          generated_at: new Date().toISOString()
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
    return { analyzed, pushed, total: farms.length };

  } catch (error) {
    console.error('[AI Pusher] Error in cycle:', error);
    return { error: error.message };
  }
}

/**
 * Start periodic analysis (every 30 minutes)
 */
export function startAIPusher() {
  if (!openai) {
    console.log('[AI Pusher] Service disabled');
    return null;
  }

  console.log('[AI Pusher] Starting periodic service (30 min intervals)');
  
  // Run immediately on start
  analyzeAndPushToAllFarms();
  
  // Then run every 30 minutes
  const interval = setInterval(analyzeAndPushToAllFarms, 30 * 60 * 1000);
  
  return interval;
}
