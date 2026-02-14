import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import validator from 'validator';
import { query, isDatabaseAvailable } from '../config/database.js';
import { requireAuth, checkFarmOwnership } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { getMarketData } from './market-intelligence.js';
import { getCropPricing } from './crop-pricing.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RECIPES_DIR = path.join(__dirname, '../data/recipes-v2');
const CROP_PRICING_PATH = path.join(__dirname, '../public/data/crop-pricing.json');

// ============================================================================
// Recipe-based crop profiles — loaded from 50 CSV recipes at startup
// ============================================================================

let RECIPE_PROFILES = {};   // keyed by normalized recipe id
let CROP_PRICING = [];      // from crop-pricing.json
let _loaded = false;

function parseRecipeToProfile(csvText, recipeName) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 3) return null;

  const headers = lines[1].split(',').map(h => h.trim());
  const rows = lines.slice(2).map(line => {
    const values = line.split(',').map(v => v.trim());
    const row = {};
    headers.forEach((h, i) => {
      const val = values[i];
      row[h] = val && !isNaN(val) && val !== '' ? parseFloat(val) : (val || '');
    });
    return row;
  });

  if (!rows.length) return null;

  const stageMap = {};
  let peakPPFD = 0, peakDLI = 0;

  for (const row of rows) {
    const stage = String(row['Stage'] || '').trim();
    if (!stage) continue;
    if (!stageMap[stage]) stageMap[stage] = { dli: [], ec: [], ph: [], vpd: [], ppfd: [], temp: [], days: 0 };

    const dli  = row['DLI Target (mol/m²/d)'];
    const ec   = row['EC Target (dS/m)'];
    const ph   = row['pH Target'];
    const vpd  = row['VPD Target (kPa)'];
    const ppfd = row['PPFD Target (µmol/m²/s)'];
    const temp = row['Temp Target (°C)'];

    if (Number.isFinite(dli))  { stageMap[stage].dli.push(dli);  if (dli > peakDLI) peakDLI = dli; }
    if (Number.isFinite(ec))   stageMap[stage].ec.push(ec);
    if (Number.isFinite(ph))   stageMap[stage].ph.push(ph);
    if (Number.isFinite(vpd))  stageMap[stage].vpd.push(vpd);
    if (Number.isFinite(ppfd)) { stageMap[stage].ppfd.push(ppfd); if (ppfd > peakPPFD) peakPPFD = ppfd; }
    if (Number.isFinite(temp)) stageMap[stage].temp.push(temp);
    stageMap[stage].days++;
  }

  const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const vegStage = stageMap['Vegetative'] || stageMap['Flowering'] || stageMap['Fruiting'] || stageMap['Seedling'];

  const idealDLI  = avg(vegStage?.dli  || []) || peakDLI || 14;
  const idealEC   = avg(vegStage?.ec   || []) || 1.5;
  const idealPH   = avg(vegStage?.ph   || []) || 5.8;
  const idealVPD  = avg(vegStage?.vpd  || []) || 1.0;
  const idealTemp = avg(vegStage?.temp  || []) || 20;

  let cropClass = 'leafy';
  if (stageMap['Fruiting']) cropClass = 'fruiting';
  else if (stageMap['Flowering']) cropClass = 'flowering';

  const lower = recipeName.toLowerCase();
  let category = 'Vegetables';
  if (/basil|cilantro|parsley|thyme|oregano|rosemary|sage|dill|tarragon|marjoram|mint|chervil|lovage|lemon balm|sorrel/.test(lower)) {
    category = 'Herbs';
  } else if (/lettuce|arugula|spinach|kale|chard|endive|escarole|frisée|romaine|oakleaf|butterhead|pak choi|mizuna|tatsoi|komatsuna|mustard|watercress/.test(lower)) {
    category = 'Leafy Greens';
  } else if (/tomato|boy|brandywine|celebrity|heatmaster|marzano|gold/.test(lower)) {
    category = 'Tomatoes';
  } else if (/strawberry|albion|chandler|eversweet|mara|monterey|ozark|seascape|sequoia|tribute|tristar|fort laramie|jewel/.test(lower)) {
    category = 'Berries';
  }

  return {
    recipeName,
    durationDays: rows.length,
    cropClass,
    category,
    ideal: {
      dli:      Number(idealDLI.toFixed(2)),
      ec:       Number(idealEC.toFixed(2)),
      ph:       Number(idealPH.toFixed(2)),
      vpd:      Number(idealVPD.toFixed(3)),
      temp:     Number(idealTemp.toFixed(1)),
      peakPPFD: Number(peakPPFD.toFixed(1)),
      peakDLI:  Number(peakDLI.toFixed(2))
    },
    stages: Object.fromEntries(
      Object.entries(stageMap).map(([stage, d]) => [stage, {
        days:    d.days,
        avgDLI:  Number((avg(d.dli)  || 0).toFixed(2)),
        avgPPFD: Number((avg(d.ppfd) || 0).toFixed(1)),
        avgEC:   Number((avg(d.ec)   || 0).toFixed(2)),
        avgPH:   Number((avg(d.ph)   || 0).toFixed(2)),
        avgVPD:  Number((avg(d.vpd)  || 0).toFixed(3))
      }])
    )
  };
}

function normalizeRecipeId(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function loadAllProfiles() {
  if (_loaded) return;
  try {
    const files = await fs.readdir(RECIPES_DIR);
    for (const file of files.filter(f => f.endsWith('.csv'))) {
      try {
        const content = await fs.readFile(path.join(RECIPES_DIR, file), 'utf-8');
        const recipeName = file.replace(/--?Table 1\.csv$/, '');
        const profile = parseRecipeToProfile(content, recipeName);
        if (profile) {
          const id = normalizeRecipeId(recipeName);
          RECIPE_PROFILES[id] = { ...profile, cropId: id };
        }
      } catch (e) {
        console.warn(`[Planting] Failed to parse recipe ${file}:`, e.message);
      }
    }
    console.log(`[Planting] Loaded ${Object.keys(RECIPE_PROFILES).length} recipe profiles from CSV`);
  } catch (e) {
    console.warn('[Planting] Could not read recipes dir:', e.message);
  }

  try {
    const raw = await fs.readFile(CROP_PRICING_PATH, 'utf-8');
    const doc = JSON.parse(raw);
    CROP_PRICING = Array.isArray(doc.crops) ? doc.crops : [];
    console.log(`[Planting] Loaded ${CROP_PRICING.length} crop pricing entries`);
  } catch (e) {
    console.warn('[Planting] Could not load crop pricing:', e.message);
    CROP_PRICING = [];
  }

  _loaded = true;
}

// ============================================================================
// Scoring helpers
// ============================================================================

function clampScore(v) { return Math.max(0, Math.min(100, Math.round(v))); }

function scoreDimension(target, ideal, tolerance) {
  if (target == null || !Number.isFinite(Number(target))) return 70;
  return clampScore(100 - (Math.abs(Number(target) - Number(ideal)) / tolerance) * 100);
}

/** DLI (mol/m²/d) = PPFD × hours × 3600 / 1 000 000 */
function ppfdToDLI(ppfd, hours = 16) {
  if (!Number.isFinite(ppfd) || ppfd <= 0) return null;
  return Number((ppfd * hours * 3600 / 1000000).toFixed(2));
}

/** Revenue score from crop-pricing.json (0-100) */
function computePricingScore(recipeName) {
  if (!CROP_PRICING.length) return 70;
  const lr = recipeName.toLowerCase();
  const match = CROP_PRICING.find(c => {
    const words = c.crop.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    return words.some(w => lr.includes(w));
  });
  if (!match) return 65;
  const price = match.retailPrice || 5;
  const priceScore = clampScore(50 + ((price - 4) / 6) * 50);
  const spread = (match.retailPrice || 5) - (match.wholesalePrice || 3.5);
  const spreadScore = clampScore(50 + (spread / 3) * 50);
  return clampScore(priceScore * 0.7 + spreadScore * 0.3);
}

/** Seasonal multiplier by crop category (0.85 – 1.15) */
function seasonalMultiplier(category) {
  const m = new Date().getMonth();
  const T = {
    'Leafy Greens': [1.12,1.10,1.05,1.00,0.95,0.90,0.88,0.90,0.95,1.00,1.08,1.12],
    'Herbs':        [1.08,1.05,1.02,1.00,0.98,0.95,0.93,0.95,1.00,1.05,1.08,1.10],
    'Tomatoes':     [0.85,0.88,0.92,0.98,1.05,1.12,1.15,1.12,1.05,0.95,0.88,0.85],
    'Berries':      [0.88,0.90,0.95,1.02,1.08,1.12,1.15,1.10,1.05,0.95,0.90,0.88],
    'Vegetables':   [1,1,1,1,1,1,1,1,1,1,1,1]
  };
  return (T[category] || T['Vegetables'])[m] || 1;
}

/** Full recommendation scoring with diversity, rotation, and market intelligence */
function computeRecommendation(profile, context, currentProfile = null, diversityContext = null, marketData = null) {
  const ecScore  = scoreDimension(context.ec, profile.ideal.ec, 1.2);
  const phScore  = scoreDimension(context.ph, profile.ideal.ph, 0.8);
  const nutrientFit     = clampScore(ecScore * 0.6 + phScore * 0.4);
  const lightEfficiency = scoreDimension(context.dliCapacity, profile.ideal.dli, 8);
  const vpdFit          = scoreDimension(context.vpd, profile.ideal.vpd, 0.8);
  const harvestStagger  = clampScore(100 - Math.max(0, profile.durationDays - 25) * 1.5);
  const revenueScore    = computePricingScore(profile.recipeName);
  const seasonal        = seasonalMultiplier(profile.category);
  const seasonalScore   = clampScore(revenueScore * seasonal);

  // Market intelligence score — boost/penalize based on real market trends
  let marketScore = 70; // neutral baseline
  if (marketData && typeof marketData === 'object') {
    const cropNameLower = profile.recipeName.toLowerCase();
    for (const [product, data] of Object.entries(marketData)) {
      const productLower = product.toLowerCase();
      const firstWord = cropNameLower.split(/\s+/)[0];
      if (cropNameLower.includes(productLower) || productLower.includes(firstWord)) {
        const trendPct = data.trendPercent || 0;
        if (data.trend === 'increasing' && trendPct >= 7) {
          // Strong market opportunity — price rising, grower gets premium
          marketScore = clampScore(70 + trendPct * 1.5);
        } else if (data.trend === 'decreasing' && Math.abs(trendPct) >= 7) {
          // Market caution — price falling, oversupply
          marketScore = clampScore(70 + trendPct * 1.2); // trendPct is negative
        } else if (data.trend === 'stable') {
          // Stable market — slight positive signal
          marketScore = 75;
        }
        break; // use first match
      }
    }
  }

  // **NEW: Diversity scoring** - Penalize overrepresented crops/categories
  let diversityScore = 100;
  let rotationBonus = 0;
  
  if (diversityContext) {
    const totalFarmCrops = Object.values(diversityContext.cropCounts).reduce((sum, count) => sum + count, 0);
    
    // Penalize this specific crop if already heavily planted
    const thisCount = diversityContext.cropCounts[profile.cropId] || 0;
    if (totalFarmCrops > 0 && thisCount > 0) {
      const proportion = thisCount / totalFarmCrops;
      // Heavy penalty if crop represents >30% of farm, moderate if >15%
      if (proportion > 0.30) diversityScore -= 40;
      else if (proportion > 0.15) diversityScore -= 25;
      else if (proportion > 0.08) diversityScore -= 12;
    }
    
    // Penalize overrepresented categories (e.g., too much "Leafy Greens")
    const categoryCount = diversityContext.categoryCounts[profile.category] || 0;
    if (totalFarmCrops > 0 && categoryCount > 0) {
      const categoryProportion = categoryCount / totalFarmCrops;
      if (categoryProportion > 0.60) diversityScore -= 20;
      else if (categoryProportion > 0.45) diversityScore -= 10;
    }
    
    // Penalize overrepresented crop classes (leafy, fruiting, flowering)
    const classCount = diversityContext.classCounts[profile.cropClass] || 0;
    if (totalFarmCrops > 0 && classCount > 0) {
      const classProportion = classCount / totalFarmCrops;
      if (classProportion > 0.70) diversityScore -= 15;
      else if (classProportion > 0.50) diversityScore -= 8;
    }
  }
  
  // **NEW: Crop rotation bonus** - Boost crops different from current
  if (currentProfile) {
    // Boost if switching crop families
    if (currentProfile.cropId !== profile.cropId) rotationBonus += 8;
    
    // Extra boost if switching categories (e.g., Herbs → Leafy Greens)
    if (currentProfile.category !== profile.category) rotationBonus += 12;
    
    // Maximum boost if switching crop classes (leafy → fruiting → flowering rotation)
    if (currentProfile.cropClass !== profile.cropClass) rotationBonus += 15;
  }
  
  diversityScore = clampScore(diversityScore);

  const overall = clampScore(
    nutrientFit     * 0.15 +
    lightEfficiency * 0.14 +
    seasonalScore   * 0.14 +
    marketScore     * 0.12 +
    harvestStagger  * 0.12 +
    vpdFit          * 0.07 +
    revenueScore    * 0.08 +
    diversityScore  * 0.10 +
    rotationBonus   * 0.08
  );

  return { nutrientFit, lightEfficiency, vpdFit, harvestStagger, revenueScore, seasonalScore, marketScore, diversityScore, rotationBonus, overall };
}

function matchRecipeId(crop) {
  if (!crop) return null;
  const c = normalizeRecipeId(crop);
  if (RECIPE_PROFILES[c]) return c;
  // Fuzzy: best word-overlap
  const words = c.split('-').filter(w => w.length > 2);
  let best = null, bestN = 0;
  for (const key of Object.keys(RECIPE_PROFILES)) {
    let n = 0;
    for (const w of words) if (key.includes(w)) n++;
    if (n > bestN) { bestN = n; best = key; }
  }
  return best;
}

function parseSeedDate(value) {
  if (!value) { const d = new Date(); d.setHours(0,0,0,0); return d; }
  const s = String(value).slice(0,10), p = s.split('-').map(Number);
  if (p.length === 3 && p.every(Number.isFinite)) {
    const d = new Date(p[0], p[1]-1, p[2]); d.setHours(0,0,0,0); return d;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0,0,0,0); return d;
}

function toIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// In-memory schedule store (Activity Hub sync)
const scheduleStore = new Map();

// ============================================================================
// Routes
// ============================================================================

/** GET /api/planting/recipes — all recipe profiles */
router.get('/recipes', async (req, res) => {
  await loadAllProfiles();
  const { category, search } = req.query;
  let profiles = Object.values(RECIPE_PROFILES);
  if (category) profiles = profiles.filter(p => p.category.toLowerCase() === category.toLowerCase());
  if (search) { const s = search.toLowerCase(); profiles = profiles.filter(p => p.recipeName.toLowerCase().includes(s) || p.cropId.includes(s)); }
  res.json({
    success: true,
    count: profiles.length,
    recipes: profiles.map(p => ({
      cropId: p.cropId, name: p.recipeName, category: p.category,
      cropClass: p.cropClass, durationDays: p.durationDays, ideal: p.ideal, stages: p.stages
    }))
  });
});

/** POST /api/planting/recommendations — ranked crop recommendations using all 50 recipes + pricing + seasonal + market intelligence */
router.post('/recommendations', async (req, res) => {
  await loadAllProfiles();
  try {
    const { 
      groupId, currentCrop, availableCrops, excludeCrops, excludeCategories, excludeClasses,
      targetSeedDate, zoneConditions, farmDiversity 
    } = req.body || {};
    
    if (!groupId) return res.status(400).json({ error: 'groupId is required' });

    const context = {
      ec:          zoneConditions?.ec ?? null,
      ph:          zoneConditions?.ph ?? null,
      vpd:         zoneConditions?.vpd ?? null,
      dliCapacity: zoneConditions?.dli_capacity ?? null
    };

    const seedDate = parseSeedDate(targetSeedDate) || new Date();

    let pool;
    if (Array.isArray(availableCrops) && availableCrops.length) {
      pool = availableCrops.map(c => matchRecipeId(c)).filter(Boolean).map(id => RECIPE_PROFILES[id]).filter(Boolean);
    }
    if (!pool || !pool.length) pool = Object.values(RECIPE_PROFILES);
    
    // Exclude specific crops (for "Remix Recommendations" feature)
    if (Array.isArray(excludeCrops) && excludeCrops.length) {
      const excludeIds = excludeCrops.map(c => matchRecipeId(c)).filter(Boolean);
      pool = pool.filter(profile => !excludeIds.includes(profile.cropId));
      logger.info(`[Planting] Excluded ${excludeIds.length} specific crops from recommendations pool`);
    }
    
    // Exclude by category (e.g., exclude all "Herbs")
    if (Array.isArray(excludeCategories) && excludeCategories.length) {
      const excludeCats = excludeCategories.map(c => c.toLowerCase());
      pool = pool.filter(profile => !excludeCats.includes(profile.category.toLowerCase()));
      logger.info(`[Planting] Excluded categories: ${excludeCategories.join(', ')}`);
    }
    
    // Exclude by crop class (e.g., exclude all "fruiting" crops)
    if (Array.isArray(excludeClasses) && excludeClasses.length) {
      const excludeClassNames = excludeClasses.map(c => c.toLowerCase());
      pool = pool.filter(profile => !excludeClassNames.includes(profile.cropClass.toLowerCase()));
      logger.info(`[Planting] Excluded crop classes: ${excludeClasses.join(', ')}`);
    }

    const currentId = matchRecipeId(currentCrop);
    const currentProfile = currentId ? RECIPE_PROFILES[currentId] : null;

    // Build farm diversity context: count crops by category and class
    const diversityContext = {
      categoryCounts: {},
      classCounts: {},
      cropCounts: {}
    };
    
    if (Array.isArray(farmDiversity)) {
      for (const crop of farmDiversity) {
        const cropId = matchRecipeId(crop);
        if (!cropId) continue;
        const profile = RECIPE_PROFILES[cropId];
        if (!profile) continue;
        
        diversityContext.categoryCounts[profile.category] = (diversityContext.categoryCounts[profile.category] || 0) + 1;
        diversityContext.classCounts[profile.cropClass] = (diversityContext.classCounts[profile.cropClass] || 0) + 1;
        diversityContext.cropCounts[cropId] = (diversityContext.cropCounts[cropId] || 0) + 1;
      }
    }

    // Fetch market intelligence data for scoring AND justifications
    const marketData = getMarketData();
    
    const allScored = pool.map(profile => {
      const scores = computeRecommendation(profile, context, currentProfile, diversityContext, marketData);
      const isCurrent = profile.cropId === currentId;

      const harvestDate = new Date(seedDate);
      harvestDate.setDate(harvestDate.getDate() + profile.durationDays);

      // Generate AI justification notes based on scoring factors
      const justifications = [];
      
      // Market intelligence justifications
      const cropNameLower = profile.recipeName.toLowerCase();
      for (const [product, data] of Object.entries(marketData)) {
        const productLower = product.toLowerCase();
        // Match crop to market data (fuzzy matching)
        if (cropNameLower.includes(productLower) || productLower.includes(cropNameLower.split(' ')[0])) {
          const absChange = Math.abs(data.trendPercent);
          if (data.trend === 'increasing' && absChange >= 7) {
            justifications.push({
              type: 'market_opportunity',
              severity: 'high',
              message: `${product} prices up ${data.trendPercent}% due to supply constraints. Strong market opportunity.`,
              source: data.articles[0]?.source || 'Market Analysis',
              confidence: data.articles.length > 0 ? 'high' : 'medium'
            });
          } else if (data.trend === 'decreasing' && absChange >= 10) {
            justifications.push({
              type: 'market_caution',
              severity: 'medium',
              message: `${product} prices down ${Math.abs(data.trendPercent)}% due to regional oversupply. Consider alternatives or plan for volume sales.`,
              source: 'Market Analysis',
              confidence: 'medium'
            });
          }
        }
      }
      
      // Diversity justifications
      if (scores.diversityScore < 80) {
        justifications.push({
          type: 'diversity_concern',
          severity: 'medium',
          message: 'This crop is already well-represented on your farm. Consider diversifying into other categories.',
          source: 'Farm Diversity Analysis'
        });
      }
      
      // Rotation bonus justifications
      if (scores.rotationBonus >= 15) {
        justifications.push({
          type: 'rotation_benefit',
          severity: 'low',
          message: `Excellent crop rotation: switching from ${currentProfile?.cropClass || 'current'} to ${profile.cropClass} class. Reduces pest pressure and nutrient depletion.`,
          source: 'Crop Rotation Strategy'
        });
      } else if (scores.rotationBonus >= 8) {
        justifications.push({
          type: 'rotation_benefit',
          severity: 'low',
          message: 'Good crop rotation: switching to a different crop family helps maintain soil health.',
          source: 'Crop Rotation Strategy'
        });
      }
      
      // Seasonal justifications
      const seasonal = seasonalMultiplier(profile.category);
      if (seasonal >= 1.3) {
        justifications.push({
          type: 'seasonal_advantage',
          severity: 'low',
          message: 'In-season crop: optimal growing conditions and consumer demand.',
          source: 'Seasonal Analysis'
        });
      } else if (seasonal <= 0.7) {
        justifications.push({
          type: 'seasonal_caution',
          severity: 'low',
          message: 'Off-season crop: may require additional resources or have lower demand.',
          source: 'Seasonal Analysis'
        });
      }

      return {
        cropId: profile.cropId,
        cropName: profile.recipeName,
        category: profile.category,
        cropClass: profile.cropClass,
        durationDays: profile.durationDays,
        expectedHarvestDate: toIsoDate(harvestDate),
        isCurrent,
        justifications, // NEW: AI-generated reasoning for this recommendation
        scores: {
          nutrient_fit:     scores.nutrientFit,
          light_efficiency: scores.lightEfficiency,
          vpd_fit:          scores.vpdFit,
          harvest_stagger:  scores.harvestStagger,
          revenue:          scores.revenueScore,
          seasonal:         scores.seasonalScore,
          market:           scores.marketScore,
          diversity:        scores.diversityScore,
          rotation:         scores.rotationBonus,
          overall:          scores.overall
        },
        deltas: {
          ec:  Number(((profile.ideal.ec)  - (context.ec  ?? profile.ideal.ec)).toFixed(2)),
          ph:  Number(((profile.ideal.ph)  - (context.ph  ?? profile.ideal.ph)).toFixed(2)),
          dli: Number(((profile.ideal.dli) - (context.dliCapacity ?? profile.ideal.dli)).toFixed(2))
        },
        ideal: profile.ideal
      };
    }).sort((a, b) => b.scores.overall - a.scores.overall);

    return res.json({
      groupId,
      targetSeedDate: toIsoDate(seedDate),
      currentCrop: currentId,
      excludedCount: excludeCrops?.length || 0,
      topRecommendation: allScored[0] || null,
      alternatives: allScored.slice(1, 6),
      allScored
    });
  } catch (error) {
    console.error('[Planting] recommendations error:', error);
    return res.status(500).json({ error: 'Failed to generate planting recommendations', detail: error.message });
  }
});

/** POST /api/planting/plan — scoped schedule + auto Activity Hub sync */
router.post('/plan', async (req, res) => {
  await loadAllProfiles();
  try {
    const { scope, cadence, cropId, cropName, items, maintainCrop } = req.body || {};

    if (!scope || !['tray', 'group', 'zone', 'room'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be one of tray, group, zone, room' });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }

    const recipeId = matchRecipeId(cropId || cropName || '');
    const profile  = recipeId ? RECIPE_PROFILES[recipeId] : null;
    const displayName  = cropName || profile?.recipeName || 'Unknown Crop';
    const durationDays = profile?.durationDays || 30;
    const normalizedCadence = (cadence || 'one_time').toLowerCase();

    const cleanedItems = items.map(item => {
      const sd = parseSeedDate(item.seedDate);
      if (!sd) return null;
      return {
        taskId: item.taskId || null, trayId: item.trayId || 'UNKNOWN',
        groupId: item.groupId || 'UNKNOWN', location: item.location || 'Unknown',
        quantity: Math.max(0, Number(item.quantity) || 0), seedDate: sd
      };
    }).filter(Boolean);

    if (!cleanedItems.length) return res.status(400).json({ error: 'No valid items with seedDate' });

    cleanedItems.sort((a, b) => a.seedDate - b.seedDate);
    const baseSeedDate = cleanedItems[0].seedDate;

    let batchCount = 1, intervalDays = 0;
    if (normalizedCadence === 'weekly') {
      batchCount = 4; intervalDays = 7;
    } else if (normalizedCadence === 'monthly') {
      batchCount = 2; intervalDays = 28;
    }

    // Check if items already have staggered seed dates (room+weekly from frontend)
    const uniqueSeedDates = [...new Set(cleanedItems.map(item => toIsoDate(item.seedDate)))];
    const itemsHaveStaggeredDates = uniqueSeedDates.length > 1;

    let batches;
    if (itemsHaveStaggeredDates && normalizedCadence === 'weekly') {
      // Group items by their actual seed date (frontend already staggered them)
      const byDate = new Map();
      cleanedItems.forEach(item => {
        const key = toIsoDate(item.seedDate);
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push(item);
      });
      let batchNum = 0;
      batches = Array.from(byDate.entries()).map(([seedDateStr, items]) => {
        batchNum++;
        const sd = parseSeedDate(seedDateStr);
        const hd = new Date(sd); hd.setDate(hd.getDate() + durationDays);
        return {
          batchNumber: batchNum, seedDate: seedDateStr, expectedHarvestDate: toIsoDate(hd),
          trayCount: items.length, totalPlants: items.reduce((s,r) => s + r.quantity, 0),
          trays: items.map(r => r.trayId),
          groups: [...new Set(items.map(r => r.groupId))]
        };
      });
    } else {
      // Original logic: round-robin items into batches with computed dates
      const perBatch = Array.from({ length: batchCount }, () => []);
      cleanedItems.forEach((item, i) => perBatch[batchCount > 1 ? i % batchCount : 0].push(item));

      batches = perBatch.map((bi, idx) => {
        if (!bi.length) return null;
        const sd = new Date(baseSeedDate); sd.setDate(sd.getDate() + intervalDays * idx);
        const hd = new Date(sd); hd.setDate(hd.getDate() + durationDays);
        return {
          batchNumber: idx + 1, seedDate: toIsoDate(sd), expectedHarvestDate: toIsoDate(hd),
          trayCount: bi.length, totalPlants: bi.reduce((s,r) => s + r.quantity, 0),
          trays: bi.map(r => r.trayId)
        };
      }).filter(Boolean);
    }

    const activityHubTasks = batches.map(b => ({
      id: `task-${Date.now()}-${b.batchNumber}`,
      title: `Seeding Batch ${b.batchNumber} - ${displayName}`,
      type: 'seeding', dueDate: b.seedDate, expectedHarvestDate: b.expectedHarvestDate,
      trayCount: b.trayCount, quantity: b.totalPlants,
      scope: scope.toUpperCase(), cadence: normalizedCadence.toUpperCase(),
      instructions: `Seed ${b.totalPlants} plants across ${b.trayCount} trays (${scope.toUpperCase()} · ${normalizedCadence.toUpperCase()})`,
      recipeId: recipeId || null, recipeName: displayName, status: 'scheduled', source: 'planting-scheduler'
    }));

    const scheduleId = `sched-${Date.now()}`;
    const plan = {
      scheduleId,
      planSummary: {
        scope, cadence: normalizedCadence, cropId: recipeId || cropId,
        cropName: displayName, recipeId, trays: cleanedItems.length,
        totalPlants: cleanedItems.reduce((s,r) => s + r.quantity, 0),
        estimatedHarvestDays: durationDays, maintainCrop: !!maintainCrop
      },
      batches, activityHubTasks, createdAt: new Date().toISOString()
    };

    scheduleStore.set(scheduleId, plan);
    return res.json(plan);
  } catch (error) {
    console.error('[Planting] plan error:', error);
    return res.status(500).json({ error: 'Failed to generate scope schedule plan', detail: error.message });
  }
});

/** GET /api/planting/schedules — all saved schedules for Activity Hub */
router.get('/schedules', (_req, res) => {
  const schedules = [...scheduleStore.values()].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, schedules });
});

/** GET /api/planting/activity-hub-tasks — pending Activity Hub tasks */
router.get('/activity-hub-tasks', (_req, res) => {
  const tasks = [];
  for (const plan of scheduleStore.values()) {
    if (Array.isArray(plan.activityHubTasks)) tasks.push(...plan.activityHubTasks);
  }
  tasks.sort((a,b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  res.json({ success: true, tasks });
});

/** POST /api/planting/feedback — record AI recommendation feedback */
router.post('/feedback', (req, res) => {
  const { groupId, recommendedCrop, actualCrop, action } = req.body || {};
  console.log(`[Planting Feedback] group=${groupId} recommended=${recommendedCrop} actual=${actualCrop} action=${action}`);
  res.json({ success: true, recorded: true });
});

// ============================================================================
// Planting Assignments — Database persistence for crop selections
// ============================================================================

/** Validation helper for planting assignment input */
function validateAssignmentInput(data) {
  const errors = [];
  
  if (!data.farm_id || typeof data.farm_id !== 'string') {
    errors.push('farm_id is required and must be a string');
  }
  if (!data.group_id || typeof data.group_id !== 'string') {
    errors.push('group_id is required and must be a string');
  }
  if (!data.crop_id || typeof data.crop_id !== 'string') {
    errors.push('crop_id is required and must be a string');
  }
  if (!data.crop_name || typeof data.crop_name !== 'string') {
    errors.push('crop_name is required and must be a string');
  }
  if (!data.seed_date || !validator.isISO8601(data.seed_date)) {
    errors.push('seed_date is required and must be valid ISO8601 date');
  }
  
  // Optional fields validation
  if (data.harvest_date && !validator.isISO8601(data.harvest_date)) {
    errors.push('harvest_date must be valid ISO8601 date if provided');
  }
  if (data.status && !['planned', 'in_progress', 'completed', 'cancelled'].includes(data.status)) {
    errors.push('status must be one of: planned, in_progress, completed, cancelled');
  }
  
  return errors;
}

/** POST /api/planting/assignments — Save/update crop assignment for a group */
router.post('/assignments', requireAuth, checkFarmOwnership, async (req, res) => {
  if (!isDatabaseAvailable()) {
    return res.status(503).json({ 
      error: 'Database unavailable', 
      detail: 'Planting assignments require database connection' 
    });
  }

  try {
    const { farm_id, group_id, tray_id, crop_id, crop_name, seed_date, harvest_date, status, notes } = req.body;
    
    // Validate input
    const validationErrors = validateAssignmentInput(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', errors: validationErrors });
    }
    
    // Verify farm_id matches authenticated user's farm
    if (req.farmId && farm_id !== req.farmId) {
      logger.warn(`[Planting] Assignment farm_id mismatch: authenticated=${req.farmId}, provided=${farm_id}`);
      return res.status(403).json({ error: 'Farm access denied' });
    }

    // UPSERT into planting_assignments table
    const upsertQuery = `
      INSERT INTO planting_assignments 
        (farm_id, group_id, tray_id, crop_id, crop_name, seed_date, harvest_date, status, notes, updated_at)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (farm_id, group_id) 
      DO UPDATE SET
        tray_id = EXCLUDED.tray_id,
        crop_id = EXCLUDED.crop_id,
        crop_name = EXCLUDED.crop_name,
        seed_date = EXCLUDED.seed_date,
        harvest_date = EXCLUDED.harvest_date,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *;
    `;
    
    const values = [
      farm_id,
      group_id,
      tray_id || null,
      crop_id,
      crop_name,
      seed_date,
      harvest_date || null,
      status || 'planned',
      notes || null
    ];
    
    const result = await query(upsertQuery, values);
    
    if (result.rows.length === 0) {
      throw new Error('UPSERT returned no rows');
    }
    
    logger.info(`[Planting] Assignment saved: farm=${farm_id}, group=${group_id}, crop=${crop_name}`);
    
    return res.json({ 
      success: true, 
      assignment: result.rows[0],
      message: 'Planting assignment saved successfully'
    });
    
  } catch (error) {
    logger.error('[Planting] Assignment save error:', error);
    return res.status(500).json({ 
      error: 'Failed to save planting assignment', 
      detail: error.message 
    });
  }
});

/** GET /api/planting/assignments — Retrieve planting assignments for a farm */
router.get('/assignments', requireAuth, checkFarmOwnership, async (req, res) => {
  if (!isDatabaseAvailable()) {
    return res.status(503).json({ 
      error: 'Database unavailable', 
      detail: 'Planting assignments require database connection' 
    });
  }

  try {
    const farmId = req.farmId || req.query.farm_id;
    
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id is required' });
    }
    
    const selectQuery = `
      SELECT * FROM planting_assignments 
      WHERE farm_id = $1 
      ORDER BY seed_date ASC, created_at DESC;
    `;
    
    const result = await query(selectQuery, [farmId]);
    
    logger.info(`[Planting] Retrieved ${result.rows.length} assignments for farm=${farmId}`);
    
    return res.json({ 
      success: true, 
      assignments: result.rows,
      count: result.rows.length
    });
    
  } catch (error) {
    logger.error('[Planting] Assignment retrieval error:', error);
    return res.status(500).json({ 
      error: 'Failed to retrieve planting assignments', 
      detail: error.message 
    });
  }
});

/** POST /api/planting/crop-info-batch — Batch resolve crop IDs to names/details */
router.post('/crop-info-batch', async (req, res) => {
  await loadAllProfiles();
  
  try {
    const { crop_ids } = req.body;
    
    if (!Array.isArray(crop_ids)) {
      return res.status(400).json({ error: 'crop_ids must be an array' });
    }
    
    const cropInfo = {};
    
    for (const cropId of crop_ids) {
      const normalized = (cropId || '').toLowerCase().replace(/[-_\s]/g, '');
      const profile = RECIPE_PROFILES[normalized];
      
      if (profile) {
        cropInfo[cropId] = {
          crop_id: cropId,
          crop_name: profile.recipeName,
          recipe_id: profile.recipeId,
          duration_days: profile.durationDays,
          peak_dli: profile.peakDLI,
          peak_ppfd: profile.peakPPFD
        };
      } else {
        // Not found in profiles, check crop pricing
        const pricingMatch = CROP_PRICING.find(c => 
          (c.name || '').toLowerCase().replace(/[-_\s]/g, '') === normalized
        );
        
        cropInfo[cropId] = pricingMatch ? {
          crop_id: cropId,
          crop_name: pricingMatch.name,
          recipe_id: null,
          duration_days: null,
          peak_dli: null,
          peak_ppfd: null
        } : {
          crop_id: cropId,
          crop_name: cropId, // Fallback to ID
          recipe_id: null,
          duration_days: null,
          peak_dli: null,
          peak_ppfd: null
        };
      }
    }
    
    return res.json({ 
      success: true, 
      crop_info: cropInfo,
      resolved: Object.keys(cropInfo).length
    });
    
  } catch (error) {
    logger.error('[Planting] Batch crop info error:', error);
    return res.status(500).json({ 
      error: 'Failed to resolve crop information', 
      detail: error.message 
    });
  }
});

export default router;
