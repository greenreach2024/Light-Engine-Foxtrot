/**
 * Lights Database Access Module
 * 
 * Provides easy access to the grow lights catalog from cards and wizards
 * 
 * Usage:
 *   import lightsDB from './lib/lights-database.js';
 *   const allLights = await lightsDB.getAll();
 *   const light = await lightsDB.findById('light_123');
 *   const filtered = await lightsDB.search({ manufacturer: 'Fluence' });
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, '../public/data/lights-catalog.json');
const CSV_PATH = path.resolve(__dirname, '../public/data/lights-catalog.csv');

class LightsDatabase {
  constructor() {
    this.cache = null;
    this.lastLoad = null;
    this.cacheDuration = 60000; // 1 minute
  }

  /**
   * Load lights from JSON file
   */
  async load() {
    const now = Date.now();
    
    // Return cached data if still fresh
    if (this.cache && this.lastLoad && (now - this.lastLoad) < this.cacheDuration) {
      return this.cache;
    }

    try {
      const data = await fs.readFile(DB_PATH, 'utf-8');
      this.cache = JSON.parse(data);
      this.lastLoad = now;
      return this.cache;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, return empty structure
        this.cache = { version: '1.0', lights: [], count: 0 };
        return this.cache;
      }
      throw error;
    }
  }

  /**
   * Get all lights
   */
  async getAll() {
    const db = await this.load();
    return db.lights || [];
  }

  /**
   * Find light by ID
   */
  async findById(id) {
    const lights = await this.getAll();
    return lights.find(light => light.id === id);
  }

  /**
   * Search lights by criteria
   * @param {Object} criteria - Search criteria (e.g., { manufacturer: 'Fluence', wattage: 600 })
   */
  async search(criteria) {
    const lights = await this.getAll();
    
    return lights.filter(light => {
      return Object.keys(criteria).every(key => {
        const value = criteria[key];
        
        // Handle different comparison types
        if (typeof value === 'object' && value !== null) {
          // Range queries: { wattage: { min: 500, max: 1000 } }
          if (value.min !== undefined && light[key] < value.min) return false;
          if (value.max !== undefined && light[key] > value.max) return false;
          return true;
        }
        
        // String matching (case-insensitive)
        if (typeof light[key] === 'string' && typeof value === 'string') {
          return light[key].toLowerCase().includes(value.toLowerCase());
        }
        
        // Exact match
        return light[key] === value;
      });
    });
  }

  /**
   * Get unique values for a field
   */
  async getUniqueValues(field) {
    const lights = await this.getAll();
    const values = lights.map(light => light[field]).filter(Boolean);
    return [...new Set(values)].sort();
  }

  /**
   * Get manufacturers list
   */
  async getManufacturers() {
    return this.getUniqueValues('manufacturer');
  }

  /**
   * Get lights by manufacturer
   */
  async getByManufacturer(manufacturer) {
    return this.search({ manufacturer });
  }

  /**
   * Get database stats
   */
  async getStats() {
    const db = await this.load();
    const lights = db.lights || [];
    
    return {
      total: lights.length,
      manufacturers: (await this.getManufacturers()).length,
      updated_at: db.updated_at,
      version: db.version
    };
  }

  /**
   * Add a new light
   */
  async add(lightData) {
    const db = await this.load();
    
    const newLight = {
      ...lightData,
      id: lightData.id || `light_${Date.now()}`,
      added_at: new Date().toISOString()
    };
    
    db.lights.push(newLight);
    db.count = db.lights.length;
    db.updated_at = new Date().toISOString();
    
    await this.save(db);
    return newLight;
  }

  /**
   * Update a light
   */
  async update(id, updates) {
    const db = await this.load();
    const index = db.lights.findIndex(light => light.id === id);
    
    if (index === -1) {
      throw new Error(`Light not found: ${id}`);
    }
    
    db.lights[index] = {
      ...db.lights[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    
    db.updated_at = new Date().toISOString();
    await this.save(db);
    
    return db.lights[index];
  }

  /**
   * Delete a light
   */
  async delete(id) {
    const db = await this.load();
    const initialLength = db.lights.length;
    
    db.lights = db.lights.filter(light => light.id !== id);
    
    if (db.lights.length === initialLength) {
      throw new Error(`Light not found: ${id}`);
    }
    
    db.count = db.lights.length;
    db.updated_at = new Date().toISOString();
    
    await this.save(db);
    return true;
  }

  /**
   * Save database to file
   */
  async save(db) {
    await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
    this.cache = db;
    this.lastLoad = Date.now();
  }

  /**
   * Clear cache (force reload on next access)
   */
  clearCache() {
    this.cache = null;
    this.lastLoad = null;
  }
}

// Export singleton instance
const lightsDB = new LightsDatabase();
export default lightsDB;
