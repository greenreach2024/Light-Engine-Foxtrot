import { Router } from 'express';
import { getGeminiClient, GEMINI_FLASH, estimateGeminiCost, isGeminiConfigured } from '../lib/gemini-client.js';
import { query } from '../config/database.js';
import { trackAiUsage, estimateChatCost } from '../lib/ai-usage-tracker.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Gemini client
let gemini = null;
async function ensureGemini() {
  if (gemini) return gemini;
  gemini = await getGeminiClient();
  return gemini;
}

if (!isGeminiConfigured()) {
  console.warn('[AI Insights] No Gemini credentials - AI insights will not be available');
}

/**
 * GET /api/ai-insights/:farmId
 * Generate AI-powered insights and recommendations based on current farm conditions
 */
router.get('/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;

    // 1. Fetch farm metadata (type, name, configuration)
    const farmResult = await query(
      'SELECT * FROM farms WHERE farm_id = $1',
      [farmId]
    );
    
    if (farmResult.rows.length === 0) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    const farm = farmResult.rows[0];

    // 2. Fetch current environmental data (telemetry)
    const telemetryResult = await query(
      `SELECT data, updated_at FROM farm_data 
       WHERE farm_id = $1 AND data_type = 'telemetry' 
       ORDER BY updated_at DESC LIMIT 1`,
      [farmId]
    );
    
    let currentConditions = null;
    if (telemetryResult.rows.length > 0) {
      const telemetry = telemetryResult.rows[0].data || {};
      const zones = telemetry.environmental?.zones || telemetry.zones || [];
      const zone = Array.isArray(zones) && zones.length > 0 ? zones[0] : null;

      if (zone) {
        const sensors = zone.sensors && typeof zone.sensors === 'object' ? zone.sensors : {};
        const temp = Number(
          sensors.tempC?.current ??
          sensors.temperature?.current ??
          zone.temperature_c ??
          zone.temperature ??
          zone.tempC ??
          zone.temp
        );
        const humidity = Number(
          sensors.rh?.current ??
          sensors.humidity?.current ??
          zone.humidity ??
          zone.rh
        );
        const pressure = Number(
          sensors.pressure?.current ??
          zone.pressure_hpa ??
          zone.pressure
        );

        let vpd = null;
        if (!Number.isNaN(temp) && !Number.isNaN(humidity)) {
          const SVP = 0.6108 * Math.exp((17.27 * temp) / (temp + 237.3));
          vpd = SVP * (1 - humidity / 100);
        }

        currentConditions = {
          temperature_c: Number.isNaN(temp) ? null : temp,
          humidity: Number.isNaN(humidity) ? null : humidity,
          pressure_hpa: Number.isNaN(pressure) ? null : pressure,
          vpd_kpa: vpd,
          zone_id: zone.id || zone.zone_id || zone.zoneId || null,
          zone_name: zone.name || zone.zone_name || zone.location || zone.id || null
        };
      }
    }
    
    if (!currentConditions) {
      return res.status(404).json({ error: 'No environmental data available' });
    }

    // 3. Fetch active recipes and their targets
    const groupsResult = await query(
      `SELECT data FROM farm_data 
       WHERE farm_id = $1 AND data_type = 'groups' 
       ORDER BY updated_at DESC LIMIT 1`,
      [farmId]
    );
    
    let activeRecipes = [];
    let recipeTargets = null;
    
    if (groupsResult.rows.length > 0) {
      const groupsData = groupsResult.rows[0].data;
      if (Array.isArray(groupsData)) {
        // Extract active recipes
        for (const group of groupsData) {
          const recipeName = group.active_recipe || group.recipe_name || group.recipeName;
          if (recipeName && recipeName !== 'None') {
            activeRecipes.push({
              name: recipeName,
              group_id: group.group_id,
              trays: group.trays?.length || 0
            });
          }
        }
        
        // If we have active recipes, load target data from first recipe
        if (activeRecipes.length > 0) {
          const recipeName = activeRecipes[0].name;
          const recipePath = path.join(__dirname, '..', 'data', 'recipes-v2', `${recipeName}.csv`);
          
          try {
            const csvContent = await fs.readFile(recipePath, 'utf-8');
            const lines = csvContent.split('\n').filter(line => line.trim());
            
            if (lines.length > 1) {
              let tempSum = 0, humiditySum = 0, count = 0;
              
              for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts.length >= 3) {
                  const temp = parseFloat(parts[1]);
                  const humidity = parseFloat(parts[2]);
                  if (!isNaN(temp) && !isNaN(humidity)) {
                    tempSum += temp;
                    humiditySum += humidity;
                    count++;
                  }
                }
              }
              
              if (count > 0) {
                recipeTargets = {
                  temperature_c: tempSum / count,
                  humidity: humiditySum / count,
                  recipe_name: recipeName
                };
              }
            }
          } catch (err) {
            console.error('Error loading recipe targets:', err);
          }
        }
      }
    }
    
    // Use default targets if no recipe
    if (!recipeTargets) {
      recipeTargets = {
        temperature_c: 20,
        humidity: 60,
        recipe_name: 'Default (Leafy Greens)'
      };
    }

    // 4. Fetch farm devices/equipment
    let equipment = [];
    try {
      const devicesResult = await query(
        'SELECT * FROM devices WHERE farm_id = $1',
        [farmId]
      );

      equipment = devicesResult.rows.map(device => ({
        type: device.device_type,
        name: device.device_name,
        status: device.status,
        capabilities: device.capabilities || {}
      }));
    } catch (deviceError) {
      if (/relation\s+"devices"\s+does\s+not\s+exist/i.test(deviceError.message || '')) {
        console.warn('[AI Insights] devices table missing; continuing with empty equipment list');
        equipment = [];
      } else {
        throw deviceError;
      }
    }

    // 5. Fetch historical data (last 24 hours)
    const historyResult = await query(
      `SELECT data, updated_at FROM farm_data 
       WHERE farm_id = $1 AND data_type = 'telemetry' 
       AND updated_at > NOW() - INTERVAL '24 hours'
       ORDER BY updated_at DESC LIMIT 48`,
      [farmId]
    );
    
    let historicalTrends = null;
    if (historyResult.rows.length > 1) {
      const temps = [];
      const humidities = [];
      
      for (const row of historyResult.rows) {
        const telemetry = row.data;
        if (telemetry.environmental && telemetry.environmental.zones && telemetry.environmental.zones.length > 0) {
          const zone = telemetry.environmental.zones[0];
          const sensor = zone.sensors && zone.sensors.length > 0 ? zone.sensors[0] : null;
          if (sensor && sensor.readings) {
            if (sensor.readings.temperature_c !== undefined) temps.push(sensor.readings.temperature_c);
            if (sensor.readings.humidity !== undefined) humidities.push(sensor.readings.humidity);
          }
        }
      }
      
      if (temps.length > 1 && humidities.length > 1) {
        historicalTrends = {
          temperature: {
            min: Math.min(...temps),
            max: Math.max(...temps),
            avg: temps.reduce((a, b) => a + b, 0) / temps.length,
            trend: temps[0] - temps[temps.length - 1] // positive = increasing
          },
          humidity: {
            min: Math.min(...humidities),
            max: Math.max(...humidities),
            avg: humidities.reduce((a, b) => a + b, 0) / humidities.length,
            trend: humidities[0] - humidities[humidities.length - 1]
          }
        };
      }
    }

    let insights;
    let aiResponse = null;
    let tokensUsed = null;
    let source = 'rule-based-fallback';

    if (isGeminiConfigured()) {
      const prompt = buildAIPrompt({
        farm,
        currentConditions,
        recipeTargets,
        activeRecipes,
        equipment,
        historicalTrends
      });

      const client = await ensureGemini();
      const completion = await client.chat.completions.create({
        model: GEMINI_FLASH,
        messages: [
          {
            role: "system",
            content: "You are an expert agricultural AI assistant specializing in controlled environment agriculture, particularly aeroponic farming systems. You provide actionable, equipment-specific recommendations based on current conditions and available farm equipment."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 800
      });

      aiResponse = completion.choices?.[0]?.message?.content || '';
      insights = parseAIResponse(aiResponse, currentConditions, recipeTargets);
      tokensUsed = completion.usage?.total_tokens || null;
      source = 'gemini';

      trackAiUsage({
        farm_id: farmId,
        endpoint: 'ai-insights',
        model: 'gpt-4',
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
        total_tokens: tokensUsed,
        estimated_cost: estimateChatCost('gpt-4', completion.usage?.prompt_tokens || 0, completion.usage?.completion_tokens || 0),
        status: 'success'
      });
    } else {
      insights = buildRuleBasedInsights(currentConditions, recipeTargets);
    }

    const transparency = buildRecommendationTransparency({
      source,
      degradedMode: !openai
    });

    res.json({
      success: true,
      farm_id: farmId,
      farm_name: farm.name,
      timestamp: new Date().toISOString(),
      current_conditions: currentConditions,
      recipe_targets: recipeTargets,
      active_recipes: activeRecipes,
      equipment_available: equipment.map(e => e.type),
      insights: insights,
      raw_ai_response: aiResponse,
      tokens_used: tokensUsed,
      source,
      degraded_mode: !openai,
      transparency,
      message: openai ? 'AI insights generated with OpenAI' : 'OpenAI API key not configured; returned rule-based fallback insights'
    });

  } catch (error) {
    console.error('AI Insights error:', error);
    res.status(500).json({ 
      error: 'Failed to generate AI insights',
      message: error.message 
    });
  }
});

/**
 * Build comprehensive prompt for GPT-4
 */
function buildAIPrompt({ farm, currentConditions, recipeTargets, activeRecipes, equipment, historicalTrends }) {
  let prompt = `Analyze the following aeroponic farm conditions and provide actionable recommendations:\n\n`;
  
  // Farm info
  prompt += `FARM: ${farm.name}\n`;
  prompt += `Type: Aeroponic controlled environment\n\n`;
  
  // Current conditions
  prompt += `CURRENT CONDITIONS:\n`;
  prompt += `- Temperature: ${currentConditions.temperature_c}°C\n`;
  prompt += `- Humidity: ${currentConditions.humidity}%\n`;
  if (currentConditions.vpd_kpa !== null) {
    prompt += `- VPD: ${currentConditions.vpd_kpa.toFixed(2)} kPa\n`;
  }
  if (currentConditions.pressure_hpa !== undefined) {
    prompt += `- Pressure: ${currentConditions.pressure_hpa} hPa\n`;
  }
  prompt += `\n`;
  
  // Recipe targets
  prompt += `RECIPE TARGETS (${recipeTargets.recipe_name}):\n`;
  prompt += `- Target Temperature: ${recipeTargets.temperature_c.toFixed(1)}°C (±10% = ${(recipeTargets.temperature_c * 0.9).toFixed(1)}-${(recipeTargets.temperature_c * 1.1).toFixed(1)}°C)\n`;
  prompt += `- Target Humidity: ${recipeTargets.humidity.toFixed(1)}% (±10% = ${(recipeTargets.humidity * 0.9).toFixed(1)}-${(recipeTargets.humidity * 1.1).toFixed(1)}%)\n`;
  prompt += `- Target VPD: 0.8-1.2 kPa (optimal range for leafy greens)\n\n`;
  
  // Active recipes
  if (activeRecipes.length > 0) {
    prompt += `ACTIVE RECIPES:\n`;
    activeRecipes.forEach(recipe => {
      prompt += `- ${recipe.name} (Group ${recipe.group_id}, ${recipe.trays} trays)\n`;
    });
    prompt += `\n`;
  }
  
  // Available equipment
  if (equipment.length > 0) {
    prompt += `AVAILABLE EQUIPMENT:\n`;
    equipment.forEach(device => {
      prompt += `- ${device.type}: ${device.name} (${device.status})\n`;
    });
    prompt += `\n`;
  } else {
    prompt += `AVAILABLE EQUIPMENT:\n`;
    prompt += `- Aeroponic misting system (irrigation cycles adjustable)\n`;
    prompt += `- Environmental sensors (BME680)\n`;
    prompt += `- Note: No HVAC, humidifier, or air circulation devices registered in database\n\n`;
  }
  
  // Historical trends
  if (historicalTrends) {
    prompt += `24-HOUR TRENDS:\n`;
    prompt += `- Temperature: ${historicalTrends.temperature.min.toFixed(1)}-${historicalTrends.temperature.max.toFixed(1)}°C (avg ${historicalTrends.temperature.avg.toFixed(1)}°C, ${historicalTrends.temperature.trend > 0 ? 'increasing' : 'decreasing'})\n`;
    prompt += `- Humidity: ${historicalTrends.humidity.min.toFixed(1)}-${historicalTrends.humidity.max.toFixed(1)}% (avg ${historicalTrends.humidity.avg.toFixed(1)}%, ${historicalTrends.humidity.trend > 0 ? 'increasing' : 'decreasing'})\n\n`;
  }
  
  // Request specific format
  prompt += `INSTRUCTIONS:\n`;
  prompt += `1. Identify which environmental parameters are outside target ranges\n`;
  prompt += `2. For each issue, provide 3-5 SPECIFIC, ACTIONABLE recommendations using ONLY the equipment available at this farm\n`;
  prompt += `3. If the farm lacks equipment needed to address an issue, suggest considering adding specific equipment as the last recommendation\n`;
  prompt += `4. For an aeroponic farm, common adjustments include:\n`;
  prompt += `   - Adjusting misting/irrigation cycle frequency or duration\n`;
  prompt += `   - Adjusting EC (electrical conductivity) of nutrient solution\n`;
  prompt += `   - Temperature adjustments (if HVAC available)\n`;
  prompt += `   - Air circulation adjustments (if fans available)\n`;
  prompt += `   - Adding humidifiers/dehumidifiers (if humidity control needed)\n`;
  prompt += `5. Format your response as:\n`;
  prompt += `   STATUS: [brief overall status]\n`;
  prompt += `   TEMPERATURE: [assessment and recommendations if needed]\n`;
  prompt += `   HUMIDITY: [assessment and recommendations if needed]\n`;
  prompt += `   VPD: [assessment and recommendations if needed]\n`;
  prompt += `   PRIORITY ACTIONS: [top 3 most important actions to take now]\n`;
  
  return prompt;
}

/**
 * Parse GPT-4 response into structured insights
 */
function parseAIResponse(aiResponse, currentConditions, recipeTargets) {
  // Extract sections from AI response
  const sections = {
    status: '',
    temperature: '',
    humidity: '',
    vpd: '',
    priority_actions: []
  };
  
  const lines = aiResponse.split('\n');
  let currentSection = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('STATUS:')) {
      currentSection = 'status';
      sections.status = trimmed.replace('STATUS:', '').trim();
    } else if (trimmed.startsWith('TEMPERATURE:')) {
      currentSection = 'temperature';
      sections.temperature = trimmed.replace('TEMPERATURE:', '').trim();
    } else if (trimmed.startsWith('HUMIDITY:')) {
      currentSection = 'humidity';
      sections.humidity = trimmed.replace('HUMIDITY:', '').trim();
    } else if (trimmed.startsWith('VPD:')) {
      currentSection = 'vpd';
      sections.vpd = trimmed.replace('VPD:', '').trim();
    } else if (trimmed.startsWith('PRIORITY ACTIONS:')) {
      currentSection = 'priority_actions';
    } else if (currentSection === 'priority_actions' && (trimmed.match(/^\d+\./) || trimmed.startsWith('-'))) {
      sections.priority_actions.push(trimmed.replace(/^\d+\.\s*/, '').replace(/^-\s*/, ''));
    } else if (currentSection && currentSection !== 'priority_actions') {
      sections[currentSection] += ' ' + trimmed;
    }
  }
  
  // Calculate deviations
  const tempDev = ((currentConditions.temperature_c - recipeTargets.temperature_c) / recipeTargets.temperature_c * 100).toFixed(1);
  const humidityDev = ((currentConditions.humidity - recipeTargets.humidity) / recipeTargets.humidity * 100).toFixed(1);
  
  return {
    overall_status: sections.status,
    parameters: {
      temperature: {
        current: currentConditions.temperature_c,
        target: recipeTargets.temperature_c,
        deviation_percent: parseFloat(tempDev),
        assessment: sections.temperature
      },
      humidity: {
        current: currentConditions.humidity,
        target: recipeTargets.humidity,
        deviation_percent: parseFloat(humidityDev),
        assessment: sections.humidity
      },
      vpd: {
        current: currentConditions.vpd_kpa,
        target_range: '0.8-1.2 kPa',
        assessment: sections.vpd
      }
    },
    priority_actions: sections.priority_actions,
    timestamp: new Date().toISOString()
  };
}

function buildRuleBasedInsights(currentConditions, recipeTargets) {
  const tempCurrent = Number(currentConditions.temperature_c);
  const humidityCurrent = Number(currentConditions.humidity);
  const tempTarget = Number(recipeTargets.temperature_c);
  const humidityTarget = Number(recipeTargets.humidity);
  const vpdCurrent = Number(currentConditions.vpd_kpa);

  const tempDeviation = Number.isFinite(tempCurrent) && Number.isFinite(tempTarget) && tempTarget !== 0
    ? ((tempCurrent - tempTarget) / tempTarget) * 100
    : 0;
  const humidityDeviation = Number.isFinite(humidityCurrent) && Number.isFinite(humidityTarget) && humidityTarget !== 0
    ? ((humidityCurrent - humidityTarget) / humidityTarget) * 100
    : 0;

  const tempAssessment = Math.abs(tempDeviation) <= 10
    ? 'Temperature is within target tolerance.'
    : tempDeviation > 10
      ? 'Temperature is above target range; reduce heat load or increase cooling/air exchange.'
      : 'Temperature is below target range; increase heating setpoint or reduce cooling.';

  const humidityAssessment = Math.abs(humidityDeviation) <= 10
    ? 'Humidity is within target tolerance.'
    : humidityDeviation > 10
      ? 'Humidity is above target range; increase dehumidification or airflow.'
      : 'Humidity is below target range; increase humidification or reduce dry-air exchange.';

  const vpdAssessment = Number.isFinite(vpdCurrent)
    ? (vpdCurrent < 0.8
      ? 'VPD is below optimal range (0.8-1.2 kPa); increase VPD by lowering humidity or raising temperature slightly.'
      : vpdCurrent > 1.2
        ? 'VPD is above optimal range (0.8-1.2 kPa); lower VPD by raising humidity or lowering temperature slightly.'
        : 'VPD is within optimal range (0.8-1.2 kPa).')
    : 'VPD unavailable; ensure temperature and humidity sensors are reporting.';

  const priorityActions = [];
  if (Math.abs(tempDeviation) > 10) {
    priorityActions.push(tempDeviation > 0
      ? 'Reduce temperature toward recipe target using available cooling/air exchange controls.'
      : 'Raise temperature toward recipe target using available heating controls.');
  }
  if (Math.abs(humidityDeviation) > 10) {
    priorityActions.push(humidityDeviation > 0
      ? 'Reduce humidity with dehumidification or increased circulation.'
      : 'Increase humidity with humidification or reduced dry-air exchange.');
  }
  if (Number.isFinite(vpdCurrent) && (vpdCurrent < 0.8 || vpdCurrent > 1.2)) {
    priorityActions.push('Correct VPD into 0.8-1.2 kPa by coordinated temperature/humidity adjustment.');
  }
  if (priorityActions.length === 0) {
    priorityActions.push('Maintain current settings and continue monitoring trend stability.');
  }

  const overallStatus = priorityActions.length === 1 && priorityActions[0].includes('Maintain current settings')
    ? 'Conditions are stable and within target ranges.'
    : 'Some parameters are outside target ranges; corrective action recommended.';

  return {
    overall_status: overallStatus,
    parameters: {
      temperature: {
        current: tempCurrent,
        target: tempTarget,
        deviation_percent: Number(tempDeviation.toFixed(1)),
        assessment: tempAssessment
      },
      humidity: {
        current: humidityCurrent,
        target: humidityTarget,
        deviation_percent: Number(humidityDeviation.toFixed(1)),
        assessment: humidityAssessment
      },
      vpd: {
        current: Number.isFinite(vpdCurrent) ? vpdCurrent : null,
        target_range: '0.8-1.2 kPa',
        assessment: vpdAssessment
      }
    },
    priority_actions: priorityActions,
    timestamp: new Date().toISOString()
  };
}

function buildRecommendationTransparency({ source, degradedMode }) {
  if (source === 'openai') {
    return {
      data_source: 'farm_data_and_openai_model',
      confidence: 0.72,
      sample_size: null,
      expected_impact: 'Operator guidance for bringing environment parameters back into target range.',
      rollback_plan: 'Revert any accepted adjustments within 1-2 monitoring cycles if conditions or crop response worsen.',
      degraded_mode: degradedMode
    };
  }

  return {
    data_source: 'farm_data_rule_based_fallback',
    confidence: 0.6,
    sample_size: null,
    expected_impact: 'Baseline corrective guidance using recipe target deviations and VPD bounds.',
    rollback_plan: 'Revert manual adjustments to prior setpoints if trend stability declines over 1-2 monitoring cycles.',
    degraded_mode: degradedMode
  };
}

export default router;
