import express from 'express';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In Cloud Run, /app/data is a GCS FUSE mount that shadows the local data/ dir.
const RECIPES_DIR = process.env.DEPLOYMENT_MODE === 'cloud'
    ? '/opt/recipes-v2'
    : path.join(__dirname, '../data/recipes-v2');

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
        const recipeFiles = files.filter(f => f.endsWith('.csv'));
        
        // Load recipe details from CSV files
        const recipesPromises = recipeFiles.map(async file => {
            // Remove "-Table 1.csv" suffix
            const name = file.replace(/-Table 1\.csv$/, '');
            
            // Determine category based on name
            let category = 'Vegetables';
            const lowerName = name.toLowerCase();
            
            if (lowerName.startsWith('microgreen')) {
                category = 'Microgreens';
            } else if (lowerName.startsWith('sprout')) {
                category = 'Sprouts';
            } else if (lowerName.includes('basil') || lowerName.includes('cilantro') || 
                lowerName.includes('parsley') || lowerName.includes('thyme') ||
                lowerName.includes('oregano') || lowerName.includes('rosemary') ||
                lowerName.includes('sage') || lowerName.includes('dill') ||
                lowerName.includes('tarragon') || lowerName.includes('marjoram') ||
                lowerName.includes('mint') || lowerName.includes('chervil') ||
                lowerName.includes('lovage') || lowerName.includes('lemon balm') ||
                lowerName.includes('sorrel')) {
                category = 'Herbs';
            } else if (lowerName.includes('lettuce') || lowerName.includes('arugula') ||
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
                       lowerName.includes('spretnak')) {
                category = 'Leafy Greens';
            } else if (lowerName.includes('tomato') || lowerName.includes('boy') ||
                       lowerName.includes('brandywine') || lowerName.includes('celebrity') ||
                       lowerName.includes('heatmaster') || lowerName.includes('marzano') ||
                       lowerName.includes('gold')) {
                category = 'Tomatoes';
            } else if (lowerName.includes('strawberry') || lowerName.includes('albion') ||
                       lowerName.includes('chandler') || lowerName.includes('eversweet') ||
                       lowerName.includes('mara') || lowerName.includes('monterey') ||
                       lowerName.includes('ozark') || lowerName.includes('seascape') ||
                       lowerName.includes('sequoia') || lowerName.includes('tribute') ||
                       lowerName.includes('tristar') || lowerName.includes('fort laramie') ||
                       lowerName.includes('jewel')) {
                category = 'Berries';
            }
            
            // Parse CSV to get schedule data
            try {
                const filePath = path.join(RECIPES_DIR, file);
                const recipeData = await parseRecipeCSV(filePath);
                
                return {
                    id: file.replace('.csv', ''),
                    name: name,
                    category: category,
                    file: file,
                    description: cropDescriptions[name.toLowerCase()] || `Growing recipe for ${name}`,
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
                    description: cropDescriptions[name.toLowerCase()] || `Growing recipe for ${name}`,
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
        const name = filename.replace(/-Table 1\.csv$/, '');
        
        res.json({
            success: true,
            recipe: {
                id: id,
                name: name,
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

        res.json({
            success: true,
            recipe: {
                id: `${safeName}-Table 1`,
                name: safeName,
                category: category || 'Vegetables',
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

        const recipeName = (name || id).replace(/-Table 1$/, '');
        const csv = scheduleToCsv(recipeName, data.schedule);
        await fs.writeFile(filePath, csv, 'utf-8');

        // If name changed, rename the file
        if (name) {
            const safeName = sanitizeFilename(name);
            const newFilename = `${safeName}-Table 1.csv`;
            if (newFilename !== filename) {
                const newPath = path.join(RECIPES_DIR, newFilename);
                await fs.rename(filePath, newPath);
            }
        }

        res.json({
            success: true,
            recipe: {
                id: id,
                name: recipeName,
                category: category || 'Vegetables',
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
