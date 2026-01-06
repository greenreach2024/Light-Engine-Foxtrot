#!/usr/bin/env node

/**
 * Import Grow Recipes v2 - New Format
 * 
 * Reads CSV files from data/recipes-v2/ and imports them into the database
 * New format includes: DLI, VPD, Max Humidity, EC, pH, Veg/Fruit markers
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const csv = require('csv-parser');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false
});

// Category mapping based on variety names
const CATEGORY_MAP = {
  'Lettuce': 'Leafy Greens',
  'Arugula': 'Leafy Greens',
  'Spinach': 'Leafy Greens',
  'Kale': 'Leafy Greens',
  'Chard': 'Leafy Greens',
  'Bok Choy': 'Leafy Greens',
  'Pak Choi': 'Leafy Greens',
  'Mustard': 'Leafy Greens',
  'Mizuna': 'Leafy Greens',
  'Tatsoi': 'Leafy Greens',
  'Watercress': 'Leafy Greens',
  'Endive': 'Leafy Greens',
  'Escarole': 'Leafy Greens',
  'Frisée': 'Leafy Greens',
  'Romaine': 'Leafy Greens',
  
  'Basil': 'Herbs',
  'Cilantro': 'Herbs',
  'Parsley': 'Herbs',
  'Dill': 'Herbs',
  'Chervil': 'Herbs',
  'Thyme': 'Herbs',
  'Oregano': 'Herbs',
  'Sage': 'Herbs',
  'Rosemary': 'Herbs',
  'Marjoram': 'Herbs',
  'Tarragon': 'Herbs',
  'Mint': 'Herbs',
  'Spearmint': 'Herbs',
  'Lemon Balm': 'Herbs',
  'Lovage': 'Herbs',
  'Sorrel': 'Herbs',
  
  'Tomato': 'Fruiting Crops',
  'Strawberry': 'Fruiting Crops'
};

/**
 * Determine category from variety name
 */
function getCategoryFromName(name) {
  for (const [key, category] of Object.entries(CATEGORY_MAP)) {
    if (name.includes(key)) {
      return category;
    }
  }
  return 'Other';
}

/**
 * Parse a CSV file and return recipe data
 */
async function parseRecipeCSV(filePath) {
  return new Promise((resolve, reject) => {
    const schedule = [];
    let recipeName = '';
    let isFirstRow = true;
    
    // Extract name from filename (e.g., "Albion-Table 1.csv" -> "Albion")
    recipeName = path.basename(filePath, '.csv').replace('-Table 1', '');
    
    fs.createReadStream(filePath)
      .pipe(csv({
        skipLines: 1 // Skip "Table 1" header
      }))
      .on('data', (row) => {
        // Parse the row data
        const dayData = {
          day: parseFloat(row.Day) || 0,
          stage: row.Stage || '',
          dli_target: parseFloat(row['DLI Target (mol/m²/d)']) || 0,
          temperature: parseFloat(row['Temp Target (°C)']) || 0,
          tempC: parseFloat(row['Temp Target (°C)']) || 0,
          blue: parseFloat(row['Blue (%)']) || 0,
          green: parseFloat(row['Green (%)']) || 0,
          red: parseFloat(row['Red (%)']) || 0,
          far_red: parseFloat(row['Far-Red (%)']) || 0,
          ppfd: parseFloat(row['PPFD Target (µmol/m²/s)']) || 0,
          vpd_target: parseFloat(row['VPD Target (kPa)']) || 0,
          max_humidity: parseFloat(row['Max Humidity (%)']) || 0,
          ec: parseFloat(row['EC Target (dS/m)']) || 0,
          ph: parseFloat(row['pH Target']) || 0,
          veg: parseInt(row.Veg) || 0,
          fruit: parseInt(row.Fruit) || 0,
          
          // Calculate light hours from DLI and PPFD (DLI = PPFD * hours * 3600 / 1,000,000)
          light_hours: row['PPFD Target (µmol/m²/s)'] && parseFloat(row['DLI Target (mol/m²/d)'])
            ? (parseFloat(row['DLI Target (mol/m²/d)']) * 1000000) / (parseFloat(row['PPFD Target (µmol/m²/s)']) * 3600)
            : 16
        };
        
        schedule.push(dayData);
      })
      .on('end', () => {
        if (schedule.length === 0) {
          return reject(new Error(`No data found in ${filePath}`));
        }
        
        const totalDays = Math.ceil(Math.max(...schedule.map(d => d.day)));
        const category = getCategoryFromName(recipeName);
        
        resolve({
          name: recipeName,
          category,
          description: `${recipeName} grow recipe with optimized environmental parameters including DLI, VPD, and spectrum control.`,
          total_days: totalDays,
          schedule
        });
      })
      .on('error', reject);
  });
}

/**
 * Insert or update recipe in database
 */
async function upsertRecipe(recipe) {
  const client = await pool.connect();
  try {
    // Check if recipe exists
    const existingResult = await client.query(
      'SELECT id FROM recipes WHERE name = $1',
      [recipe.name]
    );
    
    const recipeData = {
      schedule: recipe.schedule
    };
    
    if (existingResult.rows.length > 0) {
      // Update existing recipe
      const recipeId = existingResult.rows[0].id;
      await client.query(
        `UPDATE recipes 
         SET category = $1, 
             description = $2, 
             total_days = $3, 
             data = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [recipe.category, recipe.description, recipe.total_days, JSON.stringify(recipeData), recipeId]
      );
      console.log(`✓ Updated: ${recipe.name} (${recipe.schedule.length} days)`);
      return { updated: true, id: recipeId };
    } else {
      // Insert new recipe
      const result = await client.query(
        `INSERT INTO recipes (name, category, description, total_days, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
        [recipe.name, recipe.category, recipe.description, recipe.total_days, JSON.stringify(recipeData)]
      );
      console.log(`✓ Created: ${recipe.name} (${recipe.schedule.length} days)`);
      return { created: true, id: result.rows[0].id };
    }
  } finally {
    client.release();
  }
}

/**
 * Main import function
 */
async function importRecipes() {
  console.log('🌱 Importing Grow Recipes v2...\n');
  
  const recipesDir = path.join(__dirname, '../data/recipes-v2');
  const files = fs.readdirSync(recipesDir).filter(f => f.endsWith('.csv'));
  
  console.log(`Found ${files.length} recipe files\n`);
  
  let created = 0;
  let updated = 0;
  let errors = 0;
  
  for (const file of files) {
    try {
      const filePath = path.join(recipesDir, file);
      const recipe = await parseRecipeCSV(filePath);
      const result = await upsertRecipe(recipe);
      
      if (result.created) created++;
      if (result.updated) updated++;
    } catch (error) {
      console.error(`✗ Error processing ${file}:`, error.message);
      errors++;
    }
  }
  
  console.log(`\n📊 Import Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total: ${files.length}`);
  
  await pool.end();
  
  if (errors > 0) {
    process.exit(1);
  }
}

// Run import
if (require.main === module) {
  importRecipes()
    .then(() => {
      console.log('\n✅ Import completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Import failed:', error);
      process.exit(1);
    });
}

module.exports = { importRecipes, parseRecipeCSV };
