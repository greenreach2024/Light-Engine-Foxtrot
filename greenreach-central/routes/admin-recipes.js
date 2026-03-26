import express from 'express';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to recipes directory (match public recipes API)
const RECIPES_DIR = path.join(__dirname, '../data/recipes-v2');

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

export default router;
