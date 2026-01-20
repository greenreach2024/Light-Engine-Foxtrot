#!/usr/bin/env node

/**
 * Convert 50 CSV recipe files to lighting-recipes.json format
 * Reads from data/recipes-v2/*.csv
 * Outputs to public/data/lighting-recipes.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_DIR = path.join(__dirname, '../data/recipes-v2');
const OUTPUT_FILE = path.join(__dirname, '../public/data/lighting-recipes.json');

function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 3) return null; // Need at least header + 1 data row
  
  // Skip "Table 1" line, use second line as headers
  const headers = lines[1].split(',').map(h => h.trim());
  const data = [];
  
  for (let i = 2; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length !== headers.length) continue;
    
    const row = {};
    headers.forEach((header, index) => {
      const value = values[index].trim();
      // Convert numeric fields
      if (value && !isNaN(value)) {
        row[header] = parseFloat(value);
      } else {
        row[header] = value;
      }
    });
    data.push(row);
  }
  
  return data;
}

function convertToRecipeFormat(csvData, recipeName) {
  // Convert CSV format to the format expected by server-foxtrot.js
  return csvData.map(row => ({
    day: row['Day'] || 1,
    stage: row['Stage'] || 'Vegetative',
    temperature: row['Temp Target (°C)'] || 20,
    ppfd: row['PPFD Target (µmol/m²/s)'] || 200,
    dli: row['DLI Target (mol/m²/d)'] || 12,
    blue: row['Blue (%)'] || 30,
    green: row['Green (%)'] || 15,
    red: row['Red (%)'] || 50,
    far_red: row['Far-Red (%)'] || 5,
    vpd: row['VPD Target (kPa)'] || 0.9,
    max_humidity: row['Max Humidity (%)'] || 65,
    ec: row['EC Target (dS/m)'] || 1.0,
    ph: row['pH Target'] || 5.8,
    veg: row['Veg'] || 1,
    fruit: row['Fruit'] || 0
  }));
}

function main() {
  console.log('🌱 Converting CSV recipes to JSON format...');
  console.log(`📂 Reading from: ${CSV_DIR}`);
  
  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
  console.log(`📄 Found ${files.length} CSV files`);
  
  const crops = {};
  let successCount = 0;
  let errorCount = 0;
  
  for (const file of files) {
    try {
      const recipeName = file.replace('-Table 1.csv', '').replace('--Table 1.csv', '');
      const filePath = path.join(CSV_DIR, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      const csvData = parseCSV(content);
      if (!csvData || csvData.length === 0) {
        console.log(`⚠️  Skipping ${recipeName} - no data`);
        errorCount++;
        continue;
      }
      
      crops[recipeName] = convertToRecipeFormat(csvData, recipeName);
      successCount++;
      console.log(`✅ ${recipeName} - ${crops[recipeName].length} days`);
      
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error.message);
      errorCount++;
    }
  }
  
  // Create output object
  const output = {
    version: '2.0.0',
    source: 'Grow Recipes V2',
    generated: new Date().toISOString(),
    count: Object.keys(crops).length,
    crops
  };
  
  // Write to file
  console.log(`\n💾 Writing to: ${OUTPUT_FILE}`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  
  // Verify file
  const fileSize = fs.statSync(OUTPUT_FILE).size;
  console.log(`✅ File written: ${(fileSize / 1024).toFixed(2)} KB`);
  
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Success: ${successCount} recipes`);
  console.log(`   ❌ Errors: ${errorCount} recipes`);
  console.log(`   📦 Total crops in JSON: ${Object.keys(crops).length}`);
  
  // List all crops
  console.log(`\n🌿 Recipes included:`);
  Object.keys(crops).sort().forEach((name, i) => {
    console.log(`   ${(i + 1).toString().padStart(2, '0')}. ${name} (${crops[name].length} days)`);
  });
}

main();
