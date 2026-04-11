import express from 'express';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In Cloud Run, /app/data is a GCS FUSE mount — recipes live there so edits persist.
// /opt/recipes-v2 holds the Docker-baked seed CSVs (read-only fallback).
const RECIPES_DIR = process.env.DEPLOYMENT_MODE === 'cloud'
    ? '/app/data/recipes-v2'
    : path.join(__dirname, '../data/recipes-v2');

const SEED_DIR = '/opt/recipes-v2';

// One-time seed: populate GCS-backed recipes dir from baked-in CSVs if empty.
(async () => {
  if (process.env.DEPLOYMENT_MODE !== 'cloud') return;
  try {
    await fs.mkdir(RECIPES_DIR, { recursive: true });
    const existing = await fs.readdir(RECIPES_DIR);
    const csvs = existing.filter(f => f.endsWith('.csv'));
    if (csvs.length === 0) {
      const seeds = await fs.readdir(SEED_DIR);
      await Promise.all(seeds.map(f => fs.copyFile(
        path.join(SEED_DIR, f),
        path.join(RECIPES_DIR, f)
      )));
      console.log(`[Recipes] Seeded ${seeds.length} recipes from /opt/recipes-v2 to GCS`);
    }
  } catch (err) {
    console.warn('[Recipes] Seed from /opt/recipes-v2 failed:', err.message);
  }
})();

// Load crop descriptions from lighting-recipes.json
const RECIPES_JSON_PATH = path.join(__dirname, '../public/data/lighting-recipes.json');
let cropDescriptions = {};
try {
    const jsonData = JSON.parse(readFileSync(RECIPES_JSON_PATH, 'utf-8'));
    if (jsonData.crops) {
        for (const [name, entry] of Object.entries(jsonData.crops)) {
            cropDescriptions[name.toLowerCase()] = entry.description || '';
        }
    }
} catch (err) {
    console.warn('[Recipes] Could not load lighting-recipes.json for descriptions:', err.message);
}

// Recipe metadata: persists user-chosen category + description across loads
const RECIPE_META_PATH = path.join(RECIPES_DIR, '_recipe-meta.json');
const LEGACY_META_PATH = path.join(RECIPES_DIR, '_category-meta.json');

async function loadRecipeMeta() {
    try {
        const raw = await fs.readFile(RECIPE_META_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch {
        // Migrate from legacy _category-meta.json if it exists
        try {
            const legacy = JSON.parse(await fs.readFile(LEGACY_META_PATH, 'utf-8'));
            const migrated = {};
            for (const [name, val] of Object.entries(legacy)) {
                migrated[name] = typeof val === 'string' ? { category: val } : val;
            }
            await saveRecipeMeta(migrated);
            return migrated;
        } catch { return {}; }
    }
}

async function saveRecipeMeta(meta) {
    await fs.writeFile(RECIPE_META_PATH, JSON.stringify(meta, null, 2), 'utf-8');
}
/**
 * Derive a recipe category from its name using keyword matching.
 * Returns 'Vegetables' as fallback when no keyword matches.
 */
function deriveCategory(name) {
    const lowerName = (name || '').toLowerCase();

    if (lowerName.startsWith('microgreen')) return 'Microgreens';
    if (lowerName.startsWith('sprout')) return 'Sprouts';

    if (lowerName.includes('basil') || lowerName.includes('cilantro') ||
        lowerName.includes('parsley') || lowerName.includes('thyme') ||
        lowerName.includes('oregano') || lowerName.includes('rosemary') ||
        lowerName.includes('sage') || lowerName.includes('dill') ||
        lowerName.includes('tarragon') || lowerName.includes('marjoram') ||
        lowerName.includes('mint') || lowerName.includes('chervil') ||
        lowerName.includes('lovage') || lowerName.includes('lemon balm') ||
        lowerName.includes('sorrel')) return 'Herbs';

    if (lowerName.includes('lettuce') || lowerName.includes('arugula') ||
        lowerName.includes('spinach') || lowerName.includes('kale') ||
        lowerName.includes('chard') || lowerName.includes('endive') ||
        lowerName.includes('escarole') || lowerName.includes('frisée') ||
        lowerName.includes('romaine') || lowerName.includes('oakleaf') ||
        lowerName.includes('butterhead') || lowerName.includes('pelleted') ||
        lowerName.includes('eazyleaf') || lowerName.includes('little gem') ||
        lowerName.includes('watercress') || lowerName.includes('mizuna') ||
        lowerName.includes('tatsoi') || lowerName.includes('pak choi') ||
        lowerName.includes('komatsuna') ||
        lowerName.includes('amaze') || lowerName.includes('ilema') ||
        lowerName.includes('spretnak') || lowerName.includes('alkindus')) return 'Leafy Greens';

    if (lowerName.includes('tomato') || lowerName.includes('boy') ||
        lowerName.includes('brandywine') || lowerName.includes('celebrity') ||
        lowerName.includes('heatmaster') || lowerName.includes('marzano') ||
        lowerName.includes('gold')) return 'Tomatoes';

    if (lowerName.includes('strawberry') || lowerName.includes('albion') ||
        lowerName.includes('chandler') || lowerName.includes('eversweet') ||
        lowerName.includes('mara') || lowerName.includes('monterey') ||
        lowerName.includes('ozark') || lowerName.includes('seascape') ||
        lowerName.includes('sequoia') || lowerName.includes('tribute') ||
        lowerName.includes('tristar') || lowerName.includes('fort laramie') ||
        lowerName.includes('jewel')) return 'Berries';

    return 'Vegetables';
}

/**
 * Parse a recipe CSV file and return structured data
 */
async function parseRecipeCSV(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    
    if (lines.length < 3) {
        throw new Error('Invalid recipe file format');
    }
    
    const tableName = lines[0].trim();
    const headers = lines[1].split(',').map(h => h.trim());
    const dataLines = lines.slice(2);
    
    const phases = dataLines.map(line => {
        const values = line.split(',').map(v => v.trim());
        const phase = {};
        
        headers.forEach((header, index) => {
            const value = values[index];
            // Convert numeric values
            if (value && !isNaN(value) && value !== '') {
                phase[header] = parseFloat(value);
            } else {
                phase[header] = value || '';
            }
        });
        
        return phase;
    });
    
    return {
        tableName,
        headers,
        phases,
        totalDays: dataLines.length
    };
}

/**
 * GET /api/admin/recipes
 * List all available recipes with full details
 */
router.get('/', async (req, res) => {
    try {
        const { search, limit = 100 } = req.query;
        
        // Read all CSV files from recipes directory
        const files = await fs.readdir(RECIPES_DIR);
        const recipeFiles = files.filter(f => f.endsWith('.csv') && !f.startsWith('_'));
        
        // Load persisted recipe metadata (category + description)
        const recipeMeta = await loadRecipeMeta();
        
        // Load recipe details from CSV files
        const recipesPromises = recipeFiles.map(async file => {
            // Remove "-Table 1.csv" suffix
            const originalName = file.replace(/-Table 1\.csv$/, '');
            
            // Use persisted category if available, otherwise derive from name
            const meta = recipeMeta[originalName] || {};
            const category = meta.category || deriveCategory(meta.displayName || originalName);
            const name = meta.displayName || originalName;
            
            // Parse CSV to get schedule data
            try {
                const filePath = path.join(RECIPES_DIR, file);
                const recipeData = await parseRecipeCSV(filePath);
                
                return {
                    id: file.replace('.csv', ''),
                    name: name,
                    category: category,
                    file: file,
                    description: meta.description || cropDescriptions[originalName.toLowerCase()] || `Growing recipe for ${name}`,
                    total_days: recipeData.totalDays,
                    schedule_length: recipeData.phases.length,
                    data: {
                        schedule: recipeData.phases,
                        headers: recipeData.headers
                    }
                };
            } catch (error) {
                console.error(`[Recipes] Error parsing ${file}:`, error);
                return {
                    id: file.replace('.csv', ''),
                    name: name,
                    category: category,
                    file: file,
                    description: meta.description || cropDescriptions[originalName.toLowerCase()] || `Growing recipe for ${name}`,
                    total_days: 0,
                    schedule_length: 0,
                    data: null
                };
            }
        });
        
        let recipes = await Promise.all(recipesPromises);
        
        // Filter by search if provided
        if (search) {
            const searchLower = search.toLowerCase();
            recipes = recipes.filter(r => 
                r.name.toLowerCase().includes(searchLower) ||
                r.category.toLowerCase().includes(searchLower)
            );
        }
        
        // Apply limit
        recipes = recipes.slice(0, parseInt(limit));
        
        res.json({
            success: true,
            recipes: recipes,
            total: recipes.length,
            page: 1,
            limit: parseInt(limit)
        });
        
    } catch (error) {
        console.error('[Recipes] Error listing recipes:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load recipes',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/recipes/:id
 * Get detailed recipe data including all phases
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Reconstruct filename - id should be like "Albion-Table 1"
        let filename = `${id}.csv`;
        
        // If id doesn't include "-Table 1", add it
        if (!id.includes('-Table')) {
            filename = `${id}-Table 1.csv`;
        }
        
        const filePath = path.join(RECIPES_DIR, filename);
        
        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({
                success: false,
                error: 'Recipe not found',
                message: `Recipe "${id}" does not exist`
            });
        }
        
        // Parse the recipe
        const recipeData = await parseRecipeCSV(filePath);
        
        // Extract recipe name
        const originalName = filename.replace(/-Table 1\.csv$/, '');
        
        // Resolve category: persisted override > name derivation
        const recipeMeta = await loadRecipeMeta();
        const meta = recipeMeta[originalName] || {};
        const category = meta.category || deriveCategory(meta.displayName || originalName);
        const name = meta.displayName || originalName;
        
        res.json({
            success: true,
            recipe: {
                id: id,
                name: name,
                category: category,
                description: meta.description || cropDescriptions[originalName.toLowerCase()] || `Growing recipe for ${name}`,
                table_name: recipeData.tableName,
                headers: recipeData.headers,
                phases: recipeData.phases,
                total_days: recipeData.totalDays,
                file: filename
            }
        });
        
    } catch (error) {
        console.error('[Recipes] Error loading recipe:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load recipe',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/recipes/categories/list
 * List all recipe categories
 */
router.get('/categories/list', async (req, res) => {
    try {
        const categories = [
            'Leafy Greens',
            'Herbs',
            'Microgreens',
            'Sprouts',
            'Tomatoes',
            'Berries',
            'Vegetables'
        ];
        
        res.json({
            success: true,
            categories: categories
        });
        
    } catch (error) {
        console.error('[Recipes] Error listing categories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load categories',
            message: error.message
        });
    }
});

// CSV header row matching the existing recipe file format
const CSV_HEADERS = [
    'Day', 'Stage', 'DLI Target (mol/m\u00b2/d)', 'Temp Target (\u00b0C)',
    'Blue (%)', 'Green (%)', 'Red (%)', 'Far-Red (%)',
    'PPFD Target (\u00b5mol/m\u00b2/s)', 'VPD Target (kPa)',
    'Max Humidity (%)', 'EC Target (dS/m)', 'pH Target', 'Veg', 'Fruit'
];

// Map client field names to CSV header positions
const FIELD_TO_CSV = {
    day: 0, stage: 1, dli_target: 2, temperature: 3,
    blue: 4, green: 5, red: 6, far_red: 7,
    ppfd: 8, vpd_target: 9, max_humidity: 10,
    ec: 11, ph: 12, veg: 13, fruit: 14
};

function scheduleToCsv(name, schedule) {
    const lines = ['Table 1', CSV_HEADERS.join(',')];
    for (const row of schedule) {
        const values = CSV_HEADERS.map((_, i) => {
            const field = Object.keys(FIELD_TO_CSV).find(k => FIELD_TO_CSV[k] === i);
            if (!field) return '';
            const val = row[field];
            return val !== undefined && val !== null ? String(val) : '';
        });
        lines.push(values.join(','));
    }
    return lines.join('\n') + '\n';
}

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}

/**
 * POST /api/admin/recipes
 * Create a new recipe
 */
router.post('/', async (req, res) => {
    try {
        const { name, category, description, data } = req.body;
        if (!name || !data?.schedule || !Array.isArray(data.schedule) || data.schedule.length === 0) {
            return res.status(400).json({ success: false, error: 'Name and schedule data are required' });
        }

        const safeName = sanitizeFilename(name);
        if (!safeName) {
            return res.status(400).json({ success: false, error: 'Invalid recipe name' });
        }

        const filename = `${safeName}-Table 1.csv`;
        const filePath = path.join(RECIPES_DIR, filename);

        // Check if recipe already exists
        try {
            await fs.access(filePath);
            return res.status(409).json({ success: false, error: 'A recipe with this name already exists' });
        } catch {
            // File doesn't exist - good
        }

        const csv = scheduleToCsv(safeName, data.schedule);
        await fs.writeFile(filePath, csv, 'utf-8');

        // Persist user-chosen category + description
        const resolvedCategory = category || deriveCategory(safeName);
        if (category || description) {
            const recipeMeta = await loadRecipeMeta();
            recipeMeta[safeName] = recipeMeta[safeName] || {};
            if (category) recipeMeta[safeName].category = category;
            if (description) recipeMeta[safeName].description = description;
            await saveRecipeMeta(recipeMeta);
        }

        res.json({
            success: true,
            recipe: {
                id: `${safeName}-Table 1`,
                name: safeName,
                category: resolvedCategory,
                file: filename,
                total_days: data.schedule.length
            }
        });
    } catch (error) {
        console.error('[Recipes] Error creating recipe:', error);
        res.status(500).json({ success: false, error: 'Failed to create recipe', message: error.message });
    }
});

/**
 * PUT /api/admin/recipes/:id
 * Update an existing recipe
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, description, data } = req.body;
        if (!data?.schedule || !Array.isArray(data.schedule) || data.schedule.length === 0) {
            return res.status(400).json({ success: false, error: 'Schedule data is required' });
        }

        // Find existing file
        let filename = `${id}.csv`;
        if (!id.includes('-Table')) {
            filename = `${id}-Table 1.csv`;
        }

        const filePath = path.join(RECIPES_DIR, filename);
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ success: false, error: 'Recipe not found' });
        }

        const originalName = id.replace(/-Table 1$/, '');
        const csv = scheduleToCsv(originalName, data.schedule);
        await fs.writeFile(filePath, csv, 'utf-8');

        // Persist display name, category, and description (CSV file stays unchanged)
        const recipeMeta = await loadRecipeMeta();
        recipeMeta[originalName] = recipeMeta[originalName] || {};
        if (name && name !== originalName) recipeMeta[originalName].displayName = name;
        if (category) recipeMeta[originalName].category = category;
        if (description) recipeMeta[originalName].description = description;
        await saveRecipeMeta(recipeMeta);

        const resolvedCategory = recipeMeta[originalName].category || category || deriveCategory(name || originalName);

        res.json({
            success: true,
            recipe: {
                id: id,
                name: recipeMeta[originalName].displayName || originalName,
                category: resolvedCategory,
                file: filename,
                total_days: data.schedule.length
            }
        });
    } catch (error) {
        console.error('[Recipes] Error updating recipe:', error);
        res.status(500).json({ success: false, error: 'Failed to update recipe', message: error.message });
    }
});

/**
 * DELETE /api/admin/recipes/:id
 * Delete a recipe
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let filename = `${id}.csv`;
        if (!id.includes('-Table')) {
            filename = `${id}-Table 1.csv`;
        }

        const filePath = path.join(RECIPES_DIR, filename);
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ success: false, error: 'Recipe not found' });
        }

        await fs.unlink(filePath);

        res.json({ success: true, message: 'Recipe deleted' });
    } catch (error) {
        console.error('[Recipes] Error deleting recipe:', error);
        res.status(500).json({ success: false, error: 'Failed to delete recipe', message: error.message });
    }
});

export default router;
