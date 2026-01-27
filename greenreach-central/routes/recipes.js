import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to recipes directory
const RECIPES_DIR = path.join(__dirname, '../../data/recipes-v2');

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
 * GET /api/recipes
 * List all available recipes (public endpoint)
 */
router.get('/', async (req, res) => {
    try {
        const { search, category, limit = 100, page = 1 } = req.query;
        
        // Read all CSV files from recipes directory
        const files = await fs.readdir(RECIPES_DIR);
        const recipeFiles = files.filter(f => f.endsWith('.csv'));
        
        // Extract recipe names and categorize
        let recipes = recipeFiles.map(file => {
            // Remove "-Table 1.csv" suffix
            const name = file.replace(/-Table 1\.csv$/, '');
            
            // Determine category based on name
            let recipeCategory = 'Vegetables';
            const lowerName = name.toLowerCase();
            
            if (lowerName.includes('basil') || lowerName.includes('cilantro') || 
                lowerName.includes('parsley') || lowerName.includes('thyme') ||
                lowerName.includes('oregano') || lowerName.includes('rosemary') ||
                lowerName.includes('sage') || lowerName.includes('dill') ||
                lowerName.includes('tarragon') || lowerName.includes('marjoram') ||
                lowerName.includes('mint') || lowerName.includes('chervil') ||
                lowerName.includes('lovage') || lowerName.includes('lemon balm')) {
                recipeCategory = 'Herbs';
            } else if (lowerName.includes('lettuce') || lowerName.includes('arugula') ||
                       lowerName.includes('spinach') || lowerName.includes('kale') ||
                       lowerName.includes('chard') || lowerName.includes('endive') ||
                       lowerName.includes('escarole') || lowerName.includes('frisée') ||
                       lowerName.includes('romaine') || lowerName.includes('oakleaf') ||
                       lowerName.includes('butterhead') || lowerName.includes('pak choi') ||
                       lowerName.includes('mizuna') || lowerName.includes('tatsoi') ||
                       lowerName.includes('komatsuna') || lowerName.includes('mustard') ||
                       lowerName.includes('watercress') || lowerName.includes('sorrel')) {
                recipeCategory = 'Leafy Greens';
            } else if (lowerName.includes('tomato') || lowerName.includes('boy') ||
                       lowerName.includes('brandywine') || lowerName.includes('celebrity') ||
                       lowerName.includes('heatmaster') || lowerName.includes('marzano') ||
                       lowerName.includes('gold')) {
                recipeCategory = 'Tomatoes';
            } else if (lowerName.includes('strawberry') || lowerName.includes('albion') ||
                       lowerName.includes('chandler') || lowerName.includes('eversweet') ||
                       lowerName.includes('mara') || lowerName.includes('monterey') ||
                       lowerName.includes('ozark') || lowerName.includes('seascape') ||
                       lowerName.includes('sequoia') || lowerName.includes('tribute') ||
                       lowerName.includes('tristar') || lowerName.includes('fort laramie') ||
                       lowerName.includes('jewel')) {
                recipeCategory = 'Berries';
            }
            
            return {
                id: file.replace('.csv', ''),
                name: name,
                category: recipeCategory,
                file: file,
                description: `Growing recipe for ${name}`,
                duration_days: null, // Will be populated when file is loaded
                stages: []
            };
        });
        
        // Filter by search if provided
        if (search) {
            const searchLower = search.toLowerCase();
            recipes = recipes.filter(r => 
                r.name.toLowerCase().includes(searchLower) ||
                r.category.toLowerCase().includes(searchLower)
            );
        }
        
        // Filter by category if provided
        if (category) {
            const categoryLower = category.toLowerCase();
            recipes = recipes.filter(r => 
                r.category.toLowerCase() === categoryLower
            );
        }
        
        // Calculate pagination
        const total = recipes.length;
        const limitNum = parseInt(limit);
        const pageNum = parseInt(page);
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;
        
        // Apply pagination
        recipes = recipes.slice(startIndex, endIndex);
        
        res.json({
            success: true,
            recipes: recipes,
            total: total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
        });
        
    } catch (error) {
        console.error('[Recipes API] Error listing recipes:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load recipes',
            message: error.message
        });
    }
});

/**
 * GET /api/recipes/categories
 * List all recipe categories
 */
router.get('/categories', async (req, res) => {
    try {
        const categories = [
            {
                id: 'leafy-greens',
                name: 'Leafy Greens',
                description: 'Lettuce, spinach, kale, and other leafy vegetables',
                count: 0
            },
            {
                id: 'herbs',
                name: 'Herbs',
                description: 'Basil, cilantro, parsley, and other culinary herbs',
                count: 0
            },
            {
                id: 'tomatoes',
                name: 'Tomatoes',
                description: 'Various tomato varieties',
                count: 0
            },
            {
                id: 'berries',
                name: 'Berries',
                description: 'Strawberries and other berry crops',
                count: 0
            },
            {
                id: 'vegetables',
                name: 'Vegetables',
                description: 'Other vegetable crops',
                count: 0
            }
        ];
        
        // Count recipes per category
        const files = await fs.readdir(RECIPES_DIR);
        const recipeFiles = files.filter(f => f.endsWith('.csv'));
        
        recipeFiles.forEach(file => {
            const name = file.replace(/-Table 1\.csv$/, '');
            const lowerName = name.toLowerCase();
            
            if (lowerName.includes('lettuce') || lowerName.includes('arugula') ||
                lowerName.includes('spinach') || lowerName.includes('kale') ||
                lowerName.includes('chard') || lowerName.includes('pak choi') ||
                lowerName.includes('mizuna') || lowerName.includes('tatsoi')) {
                categories[0].count++;
            } else if (lowerName.includes('basil') || lowerName.includes('cilantro') ||
                       lowerName.includes('parsley') || lowerName.includes('thyme')) {
                categories[1].count++;
            } else if (lowerName.includes('tomato') || lowerName.includes('boy') ||
                       lowerName.includes('brandywine') || lowerName.includes('celebrity')) {
                categories[2].count++;
            } else if (lowerName.includes('strawberry') || lowerName.includes('albion') ||
                       lowerName.includes('chandler') || lowerName.includes('eversweet')) {
                categories[3].count++;
            } else {
                categories[4].count++;
            }
        });
        
        res.json({
            success: true,
            categories: categories
        });
        
    } catch (error) {
        console.error('[Recipes API] Error listing categories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load categories',
            message: error.message
        });
    }
});

/**
 * GET /api/recipes/:id
 * Get detailed recipe data including all phases (public endpoint)
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Find matching CSV file
        const files = await fs.readdir(RECIPES_DIR);
        let filename = files.find(f => f.replace('.csv', '') === id);
        
        // Fallback: try adding "-Table 1.csv" suffix
        if (!filename) {
            filename = files.find(f => f === `${id}-Table 1.csv`);
        }
        
        if (!filename) {
            return res.status(404).json({
                success: false,
                error: 'Recipe not found',
                message: `Recipe "${id}" does not exist`
            });
        }
        
        const filePath = path.join(RECIPES_DIR, filename);
        
        // Check if file exists
        try {
            await fs.access(filePath);
        } catch (err) {
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
                id: filename.replace('.csv', ''),
                name: name,
                table_name: recipeData.tableName,
                headers: recipeData.headers,
                phases: recipeData.phases,
                total_days: recipeData.totalDays,
                file: filename
            }
        });
        
    } catch (error) {
        console.error('[Recipes API] Error loading recipe:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load recipe',
            message: error.message
        });
    }
});

export default router;
