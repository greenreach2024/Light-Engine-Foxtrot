#!/usr/bin/env node
/**
 * Recipe Import Script for Light Engine Foxtrot
 * 
 * Imports 70+ CSV recipe files from docs/Updated Light recipe/All_Combined_Recipes_with_EC_PH_Veg_Fruit-6
 * into PostgreSQL recipes table.
 * 
 * Usage: node scripts/import-recipes-to-db.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const csv = require('csv-parser');

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'lightengine',
  user: process.env.DB_USER || 'lightengine',
  password: process.env.DB_PASSWORD || 'LePphcacxDs35ciLLhnkhaXr7',
  ssl: { rejectUnauthorized: false }
});

const RECIPES_DIR = path.join(__dirname, '../docs/Updated Light recipe/All_Combined_Recipes_with_EC_PH_Veg_Fruit-6');
const DRY_RUN = process.argv.includes('--dry-run');

// Category mapping based on variety names
const CATEGORY_MAP = {
  // Leafy greens
  'Arugula': 'Leafy Greens',
  'Kale': 'Leafy Greens',
  'Lettuce': 'Leafy Greens',
  'Spinach': 'Leafy Greens',
  'Pak Choi': 'Leafy Greens',
  'Swiss Chard': 'Leafy Greens',
  'Endive': 'Leafy Greens',
  'Escarole': 'Leafy Greens',
  'Watercress': 'Leafy Greens',
  'Mustard': 'Leafy Greens',
  'Tatsoi': 'Leafy Greens',
  'Mizuna': 'Leafy Greens',
  'Komatsuna': 'Leafy Greens',
  'Romaine': 'Leafy Greens',
  'Oakleaf': 'Leafy Greens',
  'Butterhead': 'Leafy Greens',
  'Buttercrunch': 'Leafy Greens',
  
  // Herbs
  'Basil': 'Herbs',
  'Cilantro': 'Herbs',
  'Parsley': 'Herbs',
  'Thyme': 'Herbs',
  'Oregano': 'Herbs',
  'Sage': 'Herbs',
  'Rosemary': 'Herbs',
  'Dill': 'Herbs',
  'Chervil': 'Herbs',
  'Tarragon': 'Herbs',
  'Lemon Balm': 'Herbs',
  'Marjoram': 'Herbs',
  'Spearmint': 'Herbs',
  'Lovage': 'Herbs',
  'Sorrel': 'Herbs',
  
  // Fruiting crops
  'Tomato': 'Fruiting Crops',
  'Strawberry': 'Fruiting Crops',
  'Strawberries': 'Fruiting Crops',
  'Brandywine': 'Fruiting Crops',
  'Cherokee Purple': 'Fruiting Crops',
  'San Marzano': 'Fruiting Crops',
  'Better Boy': 'Fruiting Crops',
  'Celebrity': 'Fruiting Crops',
  'Heatmaster': 'Fruiting Crops',
  'Black Krim': 'Fruiting Crops',
  'Green Zebra': 'Fruiting Crops',
  'Mortgage Lifter': 'Fruiting Crops',
  'Big Beef': 'Fruiting Crops',
  'Early Girl': 'Fruiting Crops',
  'Yellow Pear': 'Fruiting Crops',
  'Roma': 'Fruiting Crops',
  'Juliet': 'Fruiting Crops',
  'Mountain Fresh': 'Fruiting Crops',
  'Sun Gold': 'Fruiting Crops',
  'Chandler': 'Fruiting Crops',
  'Albion': 'Fruiting Crops',
  'Seascape': 'Fruiting Crops',
  'Monterey': 'Fruiting Crops',
  'Mara de Bois': 'Fruiting Crops',
  'Eversweet': 'Fruiting Crops',
  'Sequoia': 'Fruiting Crops',
  'Tribute': 'Fruiting Crops',
  'Tristar': 'Fruiting Crops',
  'Jewel': 'Fruiting Crops',
  'Ozark Beauty': 'Fruiting Crops',
  'Fort Laramie': 'Fruiting Crops',
  'Evie': 'Fruiting Crops',
  'Sparkle': 'Fruiting Crops',
  'Portola': 'Fruiting Crops',
  'Fortune': 'Fruiting Crops'
};

function determineCategory(varietyName) {
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (varietyName.includes(keyword)) {
      return category;
    }
  }
  return 'Other';
}

function parseCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

async function createRecipesTable() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS recipes (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      category VARCHAR(100) NOT NULL,
      description TEXT,
      total_days INTEGER,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
    CREATE INDEX IF NOT EXISTS idx_recipes_name ON recipes(name);
  `;
  
  if (DRY_RUN) {
    console.log('DRY RUN: Would create table with SQL:');
    console.log(createTableSQL);
    return;
  }
  
  await pool.query(createTableSQL);
  console.log('✓ Recipes table created/verified');
}

async function importRecipe(fileName, csvData) {
  // Extract variety name from filename
  const varietyName = fileName.replace(/-Table.*\.csv$/, '').trim();
  const category = determineCategory(varietyName);
  
  // Parse CSV data into structured format
  const schedule = csvData.map(row => ({
    day: parseFloat(row.Day) || 0,
    stage: row.Stage || '',
    temperature: row['Temperature (°C)'] || '',
    blue: parseFloat(row['Blue (450 nm)']) || 0,
    green: parseFloat(row['Green (%)']) || 0,
    red: parseFloat(row['Red (660 nm)']) || 0,
    far_red: parseFloat(row['Far-Red (730 nm)']) || 0,
    ppfd: parseFloat(row['PPFD (µmol/m²/s)']) || 0,
    vpd: parseFloat(row['Target VPD (kPa)']) || 0,
    max_humidity: parseFloat(row['Max Humidity (%)']) || 0,
    afternoon_temp: parseFloat(row['Afternoon Temp (°C)']) || null,
    night_temp: parseFloat(row['Night Temp (°C)']) || null,
    ec: parseFloat(row.EC) || 0,
    ph: parseFloat(row.PH) || 0,
    veg: parseInt(row.Veg) || 0,
    fruit: parseInt(row.Fruit) || 0
  }));
  
  const totalDays = Math.max(...schedule.map(s => Math.ceil(s.day)));
  
  const description = `${category} - ${varietyName} grow recipe with ${totalDays} day schedule`;
  
  const insertSQL = `
    INSERT INTO recipes (name, category, description, total_days, data)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (name) DO UPDATE 
    SET category = $2, description = $3, total_days = $4, data = $5, updated_at = NOW()
    RETURNING id;
  `;
  
  if (DRY_RUN) {
    console.log(`DRY RUN: Would import ${varietyName} (${category}) - ${schedule.length} rows, ${totalDays} days`);
    return null;
  }
  
  const result = await pool.query(insertSQL, [
    varietyName,
    category,
    description,
    totalDays,
    JSON.stringify({ schedule, version: '1.0' })
  ]);
  
  return result.rows[0].id;
}

async function main() {
  console.log('=== Light Engine Recipe Import ===\n');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE IMPORT'}`);
  console.log(`Source: ${RECIPES_DIR}\n`);
  
  // Check if directory exists
  if (!fs.existsSync(RECIPES_DIR)) {
    console.error(`Error: Recipe directory not found: ${RECIPES_DIR}`);
    process.exit(1);
  }
  
  // Get all CSV files
  const files = fs.readdirSync(RECIPES_DIR).filter(f => f.endsWith('.csv'));
  console.log(`Found ${files.length} CSV recipe files\n`);
  
  // Create table
  await createRecipesTable();
  
  // Import each recipe
  let imported = 0;
  let errors = 0;
  
  for (const file of files) {
    try {
      const filePath = path.join(RECIPES_DIR, file);
      const csvData = await parseCSVFile(filePath);
      
      if (csvData.length === 0) {
        console.warn(`⚠ Skipping empty file: ${file}`);
        continue;
      }
      
      const recipeId = await importRecipe(file, csvData);
      if (!DRY_RUN) {
        console.log(`✓ Imported: ${file} (ID: ${recipeId})`);
      }
      imported++;
      
    } catch (err) {
      console.error(`✗ Error importing ${file}:`, err.message);
      errors++;
    }
  }
  
  console.log(`\n=== Import Complete ===`);
  console.log(`Total files: ${files.length}`);
  console.log(`Successfully imported: ${imported}`);
  console.log(`Errors: ${errors}`);
  
  if (!DRY_RUN) {
    // Get summary statistics
    const stats = await pool.query(`
      SELECT category, COUNT(*) as count 
      FROM recipes 
      GROUP BY category 
      ORDER BY count DESC
    `);
    
    console.log('\n=== Recipe Database Summary ===');
    stats.rows.forEach(row => {
      console.log(`${row.category}: ${row.count} recipes`);
    });
    
    const total = await pool.query('SELECT COUNT(*) as total FROM recipes');
    console.log(`\nTotal recipes in database: ${total.rows[0].total}`);
  }
  
  await pool.end();
}

// Run the import
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
