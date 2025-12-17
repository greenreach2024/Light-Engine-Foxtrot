#!/usr/bin/env node
/**
 * Import Lights CSV to JSON Database
 * 
 * Converts a CSV file of grow lights into the application's JSON format
 * and saves it to public/data/lights-catalog.json
 * 
 * Usage: node scripts/import-lights-csv.js path/to/lights.csv
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CSV line
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  
  return values;
}

// Parse CSV to JSON
function parseCSV(csvContent) {
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  const lights = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const light = {};
    
    headers.forEach((header, index) => {
      const key = header.toLowerCase().replace(/\s+/g, '_');
      let value = values[index] || '';
      
      // Remove quotes
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      
      // Convert numeric fields
      if (['wattage', 'ppfd', 'coverage_area', 'price', 'weight'].includes(key)) {
        value = parseFloat(value) || 0;
      }
      
      light[key] = value;
    });
    
    // Add metadata
    light.id = `light_${i}`;
    light.added_at = new Date().toISOString();
    
    lights.push(light);
  }
  
  return lights;
}

// Main function
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node scripts/import-lights-csv.js path/to/lights.csv');
    process.exit(1);
  }
  
  const csvPath = path.resolve(args[0]);
  const outputPath = path.resolve(__dirname, '../public/data/lights-catalog.json');
  
  console.log('📄 Reading CSV file:', csvPath);
  
  if (!fs.existsSync(csvPath)) {
    console.error('❌ File not found:', csvPath);
    process.exit(1);
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lights = parseCSV(csvContent);
  
  console.log('✅ Parsed', lights.length, 'lights');
  
  // Create output object
  const output = {
    version: '1.0',
    updated_at: new Date().toISOString(),
    source: path.basename(csvPath),
    count: lights.length,
    lights: lights
  };
  
  // Write JSON file
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log('💾 Saved to:', outputPath);
  
  // Also save CSV copy
  const csvOutputPath = path.resolve(__dirname, '../public/data/lights-catalog.csv');
  fs.copyFileSync(csvPath, csvOutputPath);
  console.log('📋 CSV copy saved to:', csvOutputPath);
  
  console.log('\n✨ Import complete!');
  console.log('Access via:');
  console.log('  - JSON: http://127.0.0.1:8091/data/lights-catalog.json');
  console.log('  - CSV:  http://127.0.0.1:8091/data/lights-catalog.csv');
}

main();
