/**
 * Schedule Executor - Automated Plan/Schedule Application
 * 
 * This service runs continuously and applies lighting schedules based on
 * configured plans, schedules, and group assignments.
 * 
 * Supports multiple device types:
 * - Grow3/Code3 controllers (4-channel spectrum control)
 * - Kasa smart plugs (on/off control)
 * - SwitchBot plugs (on/off control via cloud API)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { 
  recipeToHex, 
  getCurrentRecipe, 
  isScheduleActive
} from './hex-converter.js';
import { solveSpectrum } from './spectral-solver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ScheduleExecutor {
  constructor(options = {}) {
    this.interval = options.interval || 60000; // Default: 1 minute
    this.baseUrl = options.baseUrl || 'http://127.0.0.1:8091';
    this.grow3Target = options.grow3Target || 'http://192.168.2.80:3000';
    this.enabled = options.enabled !== false; // Default: enabled
    this.intervalId = null;
    this.isRunning = false;
    this.lastExecution = null;
    this.executionCount = 0;
    this.errorCount = 0;
    this._lightingRecipes = null; // lazy-loaded recipes dataset index
    
    // ML Anomaly Detection
    this.mlEnabled = options.mlEnabled !== false; // Default: enabled
    this.mlInterval = options.mlInterval || 300000; // Default: 5 minutes
    this.lastMLRun = null;
    this.mlAnomalies = []; // Store latest anomalies
    this.mlLastError = null;
    
    // Data directory for JSON files
    this.dataDir = options.dataDir || path.join(__dirname, '../public/data');
    
    // Device registry: maps light IDs to Grow3 controller device IDs
    this.deviceRegistry = options.deviceRegistry || {
      'F00001': 2,
      'F00002': 3,
      'F00003': 4,
      'F00004': 6,
      'F00005': 5
    };
    
    console.log('[ScheduleExecutor] Initialized with interval:', this.interval, 'ms');
    console.log('[ScheduleExecutor] Data directory:', this.dataDir);
  }
  
  /**
   * Start the executor service
   */
  start() {
    if (this.isRunning) {
      console.warn('[ScheduleExecutor] Already running');
      return;
    }
    
    if (!this.enabled) {
      console.log('[ScheduleExecutor] Disabled, not starting');
      return;
    }
    
    console.log('[ScheduleExecutor] Starting...');
    this.isRunning = true;
    
    // Execute immediately on start
    this.tick().catch(err => {
      console.error('[ScheduleExecutor] Initial tick failed:', err);
    });
    
    // Then run on interval
    this.intervalId = setInterval(() => {
      this.tick().catch(err => {
        console.error('[ScheduleExecutor] Tick failed:', err);
      });
    }, this.interval);
    
    console.log('[ScheduleExecutor] Started successfully');
  }
  
  /**
   * Stop the executor service
   */
  stop() {
    if (!this.isRunning) {
      console.warn('[ScheduleExecutor] Not running');
      return;
    }
    
    console.log('[ScheduleExecutor] Stopping...');
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    console.log('[ScheduleExecutor] Stopped');
  }
  
  /**
   * Main execution tick - called on interval
   */
  async tick() {
    if (!this.enabled || !this.isRunning) return;
    
    const startTime = Date.now();
    const now = new Date();
    
    try {
      console.log(`[ScheduleExecutor] Tick #${this.executionCount + 1} at ${now.toISOString()}`);
      
      // Run ML anomaly detection every 5 minutes
      if (this.mlEnabled && this.shouldRunML(now)) {
        this.runMLAnomalyDetection().catch(err => {
          console.error('[ScheduleExecutor] ML anomaly detection failed:', err.message);
          this.mlLastError = err.message;
        });
      }
      
      // Load data
      const [groups, plans, schedules] = await Promise.all([
        this.loadGroups(),
        this.loadPlans(),
        this.loadSchedules()
      ]);
      
      console.log(`[ScheduleExecutor] Loaded ${groups.length} groups, ${plans.length} plans, ${schedules.length} schedules`);
      
      // Process each group
      const results = [];
      for (const group of groups) {
        try {
          const result = await this.processGroup(group, plans, schedules, now);
          if (result) results.push(result);
        } catch (error) {
          console.error(`[ScheduleExecutor] Failed to process group ${group.id}:`, error.message);
          this.errorCount++;
        }
      }
      
      this.lastExecution = now;
      this.executionCount++;
      
      const duration = Date.now() - startTime;
      console.log(`[ScheduleExecutor] Tick completed in ${duration}ms, processed ${results.length} groups`);
      
      return results;
      
    } catch (error) {
      console.error('[ScheduleExecutor] Tick failed:', error);
      this.errorCount++;
      throw error;
    }
  }
  
  /**
   * Check if ML anomaly detection should run
   */
  shouldRunML(now) {
    if (!this.lastMLRun) return true;
    const timeSinceLastRun = now - this.lastMLRun;
    return timeSinceLastRun >= this.mlInterval;
  }
  
  /**
   * Run ML anomaly detection
   */
  async runMLAnomalyDetection() {
    const startTime = Date.now();
    console.log('[ML] Running anomaly detection with outdoor context...');
    
    try {
      const scriptPath = path.join(__dirname, '../scripts/simple-anomaly-detector.py');
      const result = await this.executePythonScript(scriptPath, ['--json']);
      
      if (result.success && result.anomalies) {
        this.mlAnomalies = result.anomalies;
        this.mlLastError = null;
        this.lastMLRun = new Date();
        
        const { critical_count = 0, warning_count = 0, info_count = 0 } = result;
        const duration = Date.now() - startTime;
        
        console.log(`[ML]  Detected ${result.count} anomalies in ${duration}ms (${critical_count} critical, ${warning_count} warning, ${info_count} info)`);
        
        // Log warnings and critical anomalies with outdoor context
        const important = this.mlAnomalies.filter(a => a.severity === 'critical' || a.severity === 'warning');
        important.forEach(anomaly => {
          const outdoorContext = `outdoor ${anomaly.outdoor_temp}°C/${anomaly.outdoor_rh}% RH`;
          console.warn(`[ML]   ${anomaly.severity.toUpperCase()}: ${anomaly.zone} - ${anomaly.reason} (${outdoorContext})`);
        });
        
      } else {
        throw new Error('ML script returned no anomalies data');
      }
      
    } catch (error) {
      this.mlLastError = error.message;
      console.error('[ML]  Anomaly detection failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Execute Python script and return parsed JSON output
   */
  executePythonScript(scriptPath, args = []) {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn('python3', [scriptPath, ...args]);
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          // Check for missing dependencies
          if (stderr.includes('ModuleNotFoundError') || stderr.includes('sklearn')) {
            reject(new Error('ML dependencies not installed (scikit-learn required)'));
          } else {
            reject(new Error(`Python script exited with code ${code}: ${stderr}`));
          }
          return;
        }
        
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse ML output: ${error.message}`));
        }
      });
      
      pythonProcess.on('error', (error) => {
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        pythonProcess.kill();
        reject(new Error('ML script timed out after 30 seconds'));
      }, 30000);
    });
  }
  
  /**
   * Process a single group
   */
  async processGroup(group, plans, schedules, now) {
    // Skip groups without plan or schedule
    if (!group.plan || !group.schedule) {
      return null;
    }
    
    // Skip groups without lights or controller assignment
    // Group V2: controller/iotDevice field takes precedence over lights array
    const hasLights = group.lights && Array.isArray(group.lights) && group.lights.length > 0;
    const hasController = group.controller || group.iotDevice;
    
    if (!hasLights && !hasController) {
      return null;
    }
    
  // Find plan and schedule (robust matching across id/key/name and preview tokens)
  const plan = await this.resolvePlan(plans, group);
    const schedule = schedules.find(s => s.id === group.schedule || s.groupId === group.id);
    
    if (!schedule) {
      console.warn(`[ScheduleExecutor] Schedule ${group.schedule} not found for group ${group.id}`);
      return null;
    }
    
    // Check if schedule is active
    const active = isScheduleActive(schedule, now);
    
    console.log(`[ScheduleExecutor] Group ${group.id}: schedule ${active ? 'ACTIVE' : 'INACTIVE'}`);
    
    // Get current recipe based on plan config
    let recipe = null;
    if (plan) {
      try {
        recipe = getCurrentRecipe(plan, group.planConfig || {}, now);
      } catch (error) {
        console.warn(`[ScheduleExecutor] Using fallback recipe for group ${group.id}: ${error.message}`);
      }
    } else {
      console.warn(`[ScheduleExecutor] Plan ${group.plan} not found for group ${group.id}, using safe fallback recipe`);
    }
    
    // Determine target state
    let hexPayload;
    let status;
    
    if (active) {
      // Schedule is active - apply recipe (or safe fallback if plan missing)
      if (!recipe) {
        // Safe default: moderate intensity (64/255 = 25%)
        hexPayload = '404040404040404040404040';
      } else {
        // Convert recipe (blue, green, red percentages) to hardware channels (bl, rd, ww, cw)
        const targetPPFD = recipe.ppfd || 100;
        
        // Map property names: recipe may have bl/gn/rd or blue/green/red
        const blue = recipe.blue ?? recipe.bl ?? 0;
        const green = recipe.green ?? recipe.gn ?? 0;
        const red = recipe.red ?? recipe.rd ?? 0;
        
        const solution = solveSpectrum({
          blue: blue,
          green: green,
          red: red
        }, targetPPFD);
        
        // Convert to channel recipe with percentages
        const channelRecipe = {
          bl: (solution.bl / targetPPFD) * 100,
          rd: (solution.rd / targetPPFD) * 100,
          ww: (solution.ww / targetPPFD) * 100,
          cw: (solution.cw / targetPPFD) * 100
        };
        
        hexPayload = await recipeToHex(channelRecipe);
      }
      status = 'on';
    } else {
      // Schedule is inactive - turn off
      hexPayload = null;
      status = 'off';
    }
    
    console.log(`[ScheduleExecutor] Group ${group.id}: ${status.toUpperCase()} with payload ${hexPayload || 'null'}`);
    
    // Apply to controller/iotDevice if assigned (Group V2), otherwise use lights array
    const deviceResults = [];
    const controller = group.controller || group.iotDevice;
    
    if (controller) {
      // Group V2: Use assigned controller (SwitchBot/Kasa plug)
      try {
        const result = await this.controlLight(controller, status, hexPayload);
        deviceResults.push({ light: controller.deviceId || controller.id, success: true, result });
      } catch (error) {
        console.error(`[ScheduleExecutor] Failed to control controller ${controller.deviceId || controller.id}:`, error.message);
        deviceResults.push({ light: controller.deviceId || controller.id, success: false, error: error.message });
      }
    } else if (group.lights && Array.isArray(group.lights)) {
      // Legacy: Use lights array
      for (const light of group.lights) {
        try {
          const result = await this.controlLight(light, status, hexPayload);
          deviceResults.push({ light: light.id, success: true, result });
        } catch (error) {
          console.error(`[ScheduleExecutor] Failed to control light ${light.id}:`, error.message);
          deviceResults.push({ light: light.id, success: false, error: error.message });
        }
      }
    }
    
    return {
      group: group.id,
      plan: plan ? (plan.name || plan.id) : (group.plan || null),
      schedule: schedule.name || schedule.id,
      active,
      recipe: active ? recipe : null,
      hexPayload,
      devices: deviceResults,
      timestamp: now.toISOString()
    };
  }

  /**
   * Resolve a group's plan by matching across multiple tokens and sources.
   * All plans are loaded from lighting-recipes.json (single source of truth)
   * Matches by id/name/key (case-insensitive, slug-aware)
   */
  async resolvePlan(plans, group) {
    const tokens = this.buildPlanTokens(group)
      .filter(Boolean)
      .map(t => this.slugify(t));
    if (tokens.length === 0) {
      console.warn(`[ScheduleExecutor] No plan tokens found for group ${group?.id || group?.name}`);
      return null;
    }

    console.log(`[ScheduleExecutor] Resolving plan for group "${group?.name}" with tokens:`, tokens);

    // Try direct match from loaded plans (all from lighting-recipes.json)
    const plan = plans.find(p => {
      const fields = [p.id, p.name, p.key, p.planId, p.planID, p.planKey, p.crop]
        .filter(Boolean)
        .map(x => this.slugify(String(x)));
      return tokens.some(tok => fields.includes(tok));
    });
    
    if (plan) {
      console.log(`[ScheduleExecutor]  Found plan "${plan.name}" (id: ${plan.id}) for group "${group?.name}"`);
      return plan;
    }

    // Try lighting-recipes fallback (redundant but kept for safety)
    try {
      const recipePlan = await this.resolveFromLightingRecipes(tokens);
      if (recipePlan) {
        console.log(`[ScheduleExecutor]  Found plan via lighting-recipes fallback for group "${group?.name}"`);
        return recipePlan;
      }
    } catch (err) {
      console.warn('[ScheduleExecutor] Lighting recipes resolution failed:', err.message);
    }

    console.error(`[ScheduleExecutor] ✗ No plan found for group "${group?.name}" with tokens:`, tokens);
    console.error(`[ScheduleExecutor] Available plans:`, plans.map(p => ({ id: p.id, name: p.name })).slice(0, 10));
    return null;
  }

  buildPlanTokens(group) {
    const g = group || {};
    return [
      g.plan,
      g.planId, g.planID, g.planKey, g.planName,
      g?.planConfig?.planId,
      g?.planConfig?.preview?.planId,
      g?.planConfig?.anchor?.planId
    ].filter(Boolean).map(String);
  }

  slugify(val) {
    if (!val) return '';
    let s = String(val).trim().toLowerCase();
    // strip common prefixes
    s = s.replace(/^(crop|plan|schedule)[-_:\s]+/g, '');
    // replace non-alnum with hyphens and collapse
    s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s;
  }

  async resolveFromLightingRecipes(tokens) {
    if (!this._lightingRecipes) {
      this._lightingRecipes = await this.loadLightingRecipesIndex();
    }
    const idx = this._lightingRecipes;
    if (!idx) return null;

    // Try exact slug match first
    let matchToken = tokens.find(tok => idx.bySlug[tok]);
    let name = matchToken ? idx.bySlug[matchToken] : null;
    
    // Fallback: try alias lookup (partial/fuzzy matches)
    if (!name) {
      matchToken = tokens.find(tok => idx.byAlias[tok]);
      name = matchToken ? idx.byAlias[matchToken] : null;
    }
    
    // Last resort: try substring matching on recipe keys
    if (!name) {
      const recipeSlugs = Object.keys(idx.bySlug);
      for (const token of tokens) {
        const match = recipeSlugs.find(recipeSlug => 
          recipeSlug.includes(token) || token.includes(recipeSlug)
        );
        if (match) {
          name = idx.bySlug[match];
          matchToken = token;
          console.log(`[ScheduleExecutor] Fuzzy match: "${token}" → "${name}"`);
          break;
        }
      }
    }
    
    if (!name) return null;

    const entries = idx.data[name];
    if (!Array.isArray(entries) || entries.length === 0) return null;

    console.log(`[ScheduleExecutor] Resolved plan "${matchToken}" → recipe "${name}" with ${entries.length} day entries`);

    // Synthesize a plan object from recipe entries
    // Mapping docs: see ../docs/LIGHTING_RECIPES_MAPPING.md
    const days = entries.map(e => ({
      day: Number(e.day ?? e.d ?? 1),
      stage: e.stage || undefined,
      // Map recipe channels to Grow3 mix: split green into CW/WW, ignore far_red
      cw: typeof e.green === 'number' ? e.green / 2 : 0,
      ww: typeof e.green === 'number' ? e.green / 2 : 0,
      bl: typeof e.blue === 'number' ? e.blue : (typeof e.bl === 'number' ? e.bl : 0),
      rd: typeof e.red === 'number' ? e.red : (typeof e.rd === 'number' ? e.rd : 0)
    })).filter(d => Number.isFinite(d.day))
      .sort((a, b) => a.day - b.day);

    return {
      id: name,
      name,
      kind: 'synthesizedFromLightingRecipes',
      days
    };
  }

  async loadLightingRecipesIndex() {
    try {
      const filePath = path.join(this.dataDir, 'lighting-recipes.json');
      const fileContent = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      // data is an object mapping recipe name -> array of day entries
      const bySlug = {};
      const byAlias = {};
      
      for (const key of Object.keys(data)) {
        const slug = this.slugify(key);
        bySlug[slug] = key;
        
        // Add common alias variations to improve lookup reliability
        // Example: "Astro Arugula" → also match "astro", "arugula", "astro-arugula"
        const words = key.toLowerCase().split(/\s+/).filter(Boolean);
        
        // Single word aliases (e.g., "astro", "arugula")
        words.forEach(word => {
          const cleanWord = word.replace(/[^a-z0-9]/g, '');
          if (cleanWord && cleanWord.length > 3) {
            byAlias[cleanWord] = key;
          }
        });
        
        // Two-word combos (e.g., "astro-arugula" from "Astro Arugula")
        if (words.length >= 2) {
          const combo = words.join('-').replace(/[^a-z0-9-]/g, '');
          byAlias[combo] = key;
        }
        
        // Store original slug as alias too
        byAlias[slug] = key;
      }
      
      console.log('[ScheduleExecutor] Loaded lighting-recipes index with', Object.keys(bySlug).length, 'entries and', Object.keys(byAlias).length, 'aliases');
      return { data, bySlug, byAlias };
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn('[ScheduleExecutor] lighting-recipes.json not found');
        return null;
      }
      console.error('[ScheduleExecutor] Failed to load lighting-recipes.json:', error.message);
      return null;
    }
  }
  
  /**
   * Control a single light (supports Grow3, Kasa, and SwitchBot)
   */
  async controlLight(light, status, hexPayload) {
    const lightId = light.id || light.deviceId || light.name;
    const protocol = (light.protocol || '').toLowerCase();
    
    console.log(`[ScheduleExecutor] Controlling light ${lightId} (protocol: ${protocol})`);
    
    // Route based on protocol
    if (protocol === 'grow3' || protocol === 'code3') {
      return await this.controlGrow3Light(light, status, hexPayload);
    } else if (protocol === 'kasa') {
      return await this.controlKasaPlug(light, status);
    } else if (protocol === 'switchbot') {
      return await this.controlSwitchBotPlug(light, status);
    } else {
      // Default: try Grow3 registry lookup for backwards compatibility
      const deviceId = this.deviceRegistry[lightId];
      if (deviceId) {
        console.log(`[ScheduleExecutor] No protocol specified, using Grow3 registry for ${lightId}`);
        return await this.controlGrow3Light(light, status, hexPayload);
      }
      
      console.warn(`[ScheduleExecutor] Light ${lightId} has unknown protocol "${protocol}" and not in Grow3 registry, skipping`);
      return null;
    }
  }
  
  /**
   * Control Grow3/Code3 light via controller
   */
  async controlGrow3Light(light, status, hexPayload) {
    const lightId = light.id || light.deviceId || light.name;
    
    // Map light ID to Grow3 controller device ID
    const deviceId = this.deviceRegistry[lightId];
    
    if (!deviceId) {
      console.warn(`[ScheduleExecutor] Grow3 light ${lightId} not in device registry, skipping`);
      return null;
    }
    
    // Send command via /grow3 proxy (routes to controller with /api prefix)
    const baseUrl = this.baseUrl || 'http://127.0.0.1:8091';
    const url = `${baseUrl}/grow3/devicedatas/device/${deviceId}`;
    const payload = {
      status,
      channelsValue: hexPayload
    };
    
    console.log(`[ScheduleExecutor] PATCH ${url}`, payload);
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    const result = await response.json();
    return result;
  }
  
  /**
   * Control Kasa smart plug (on/off only)
   */
  async controlKasaPlug(light, status) {
    const host = light.host || light.ip || light.address;
    
    if (!host) {
      throw new Error(`Kasa plug ${light.id} missing host/ip/address property`);
    }
    
    // Convert status to on/off state
    const state = status === 'on' ? 'on' : 'off';
    
    const url = `${this.baseUrl}/api/kasa/device/${host}/power`;
    const payload = { state };
    
    console.log(`[ScheduleExecutor] POST ${url}`, payload);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    const result = await response.json();
    return result;
  }
  
  /**
   * Control SwitchBot plug via cloud API (turnOn/turnOff commands)
   */
  async controlSwitchBotPlug(light, status) {
    const deviceId = light.deviceId || light.id;
    
    if (!deviceId) {
      throw new Error(`SwitchBot plug ${light.id} missing deviceId property`);
    }
    
    // Validate deviceId format (reject composite keys)
    if (deviceId.includes('|')) {
      throw new Error(`Invalid SwitchBot deviceId "${deviceId}" - appears to be composite key`);
    }
    
    // Convert status to SwitchBot command
    const command = status === 'on' ? 'turnOn' : 'turnOff';
    
    const url = `${this.baseUrl}/api/switchbot/devices/${deviceId}/commands`;
    const payload = { command };
    
    console.log(`[ScheduleExecutor] POST ${url}`, payload);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    const result = await response.json();
    return result;
  }
  
  /**
   * Load groups from JSON file
   */
  async loadGroups() {
    try {
      const filePath = path.join(this.dataDir, 'groups.json');
      const fileContent = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      return data.groups || [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn('[ScheduleExecutor] groups.json not found, returning empty array');
        return [];
      }
      console.error('[ScheduleExecutor] Failed to load groups:', error);
      return [];
    }
  }
  
  /**
   * Load plans from JSON file, including merged lighting recipes
   */
  async loadPlans() {
    try {
      // Load lighting recipes as the primary and only source
      const recipesPath = path.join(this.dataDir, 'lighting-recipes.json');
      const recipesContent = await fs.readFile(recipesPath, 'utf8');
      const recipesData = JSON.parse(recipesContent);
      
      if (!recipesData || !recipesData.crops || typeof recipesData.crops !== 'object') {
        console.warn('[ScheduleExecutor] lighting-recipes.json has no crops data');
        return [];
      }
      
      const slugify = (str) => String(str || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      // Create plan objects from recipes (limit processing to avoid hang)
      const recipePlans = [];
      const MAX_RECIPES = 200; // Safety limit
      let recipeCount = 0;
      
      for (const [cropName, days] of Object.entries(recipesData.crops)) {
        if (recipeCount >= MAX_RECIPES) {
          console.warn(`[ScheduleExecutor] Recipe limit reached (${MAX_RECIPES}), skipping remaining recipes`);
          break;
        }
        
        if (!Array.isArray(days) || !days.length) continue;
        
        const id = `crop-${slugify(cropName)}`;
        const lightDays = days.map(row => ({
          day: Number(row.day),
          stage: String(row.stage || ''),
          ppfd: Number(row.ppfd),
          mix: {
            cw: 0, // Will be calculated from R/B/G
            ww: 0,
            bl: Number(row.blue || 0),
            gn: Number(row.green || 0),
            rd: Number(row.red || 0),
            fr: Number(row.far_red || 0)
          }
        }));
        
        const envDays = days
          .filter(row => row.temperature != null)
          .map(row => ({
            day: Number(row.day),
            tempC: Number(row.temperature)
          }));
        
        recipePlans.push({
          id,
          key: id,
          name: String(cropName),
          crop: String(cropName),
          kind: 'recipe',
          description: `Lighting recipe for ${cropName}`,
          light: { days: lightDays },
          ...(envDays.length ? { env: { days: envDays } } : {}),
          meta: {
            source: 'lighting-recipes',
            appliesTo: { category: ['Crop'], varieties: [] }
          },
          defaults: { photoperiod: 12 }
        });
        
        recipeCount++;
      }
      
      console.log(`[ScheduleExecutor] Loaded ${recipePlans.length} recipe plans from lighting-recipes.json`);
      return recipePlans;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error('[ScheduleExecutor] lighting-recipes.json not found! This file is required for all light plans.');
        return [];
      }
      console.error('[ScheduleExecutor] Failed to load lighting-recipes.json:', error);
      return [];
    }
  }
  
  /**
   * Load schedules from JSON file
   */
  async loadSchedules() {
    try {
      const filePath = path.join(this.dataDir, 'schedules.json');
      const fileContent = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      return data.schedules || [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn('[ScheduleExecutor] schedules.json not found, returning empty array');
        return [];
      }
      console.error('[ScheduleExecutor] Failed to load schedules:', error);
      return [];
    }
  }
  
  /**
   * Get executor status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      running: this.isRunning,
      interval: this.interval,
      lastExecution: this.lastExecution,
      executionCount: this.executionCount,
      errorCount: this.errorCount,
      deviceRegistry: Object.keys(this.deviceRegistry).length
    };
  }
  
  /**
   * Update device registry
   */
  updateDeviceRegistry(registry) {
    this.deviceRegistry = { ...this.deviceRegistry, ...registry };
    console.log('[ScheduleExecutor] Device registry updated:', Object.keys(this.deviceRegistry).length, 'devices');
  }
}

export default ScheduleExecutor;
