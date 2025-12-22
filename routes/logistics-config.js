/**
 * Logistics Configuration API
 * 
 * Allows administrators to adjust farm selection and routing parameters
 * without code changes. Tune the algorithm for different regions or seasons.
 */

import express from 'express';
import farmSelectionOptimizer from '../services/farm-selection-optimizer.js';

const router = express.Router();

/**
 * GET /api/logistics/config
 * Get current logistics optimization configuration
 */
router.get('/config', (req, res) => {
  const config = farmSelectionOptimizer.getConfig();
  
  res.json({
    ok: true,
    config,
    description: {
      maxRadius: 'Maximum distance (km) to search for farms',
      preferredRadius: 'Preferred distance (km) - farms within get bonus',
      clusterRadius: 'Distance (km) to consider farms as clustered',
      weights: 'Scoring weights (must sum to 100)',
      clusterBonus: 'Bonus points for being in same cluster',
      directionBonus: 'Bonus for being in same direction as other farms',
      minClusterSize: 'Minimum farms to consider a cluster',
      maxDetourPercent: 'Max % extra distance acceptable for clustering',
      oppositeDirectionPenalty: 'Penalty for farm in opposite direction',
      isolatedFarmPenalty: 'Penalty for farm requiring separate trip'
    }
  });
});

/**
 * POST /api/logistics/config
 * Update logistics configuration
 */
router.post('/config', (req, res) => {
  try {
    const updates = req.body;
    
    // Validate weights sum to 100 if provided
    if (updates.weights) {
      const sum = Object.values(updates.weights).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 100) > 0.01) {
        return res.status(400).json({
          ok: false,
          error: 'Weights must sum to 100',
          currentSum: sum
        });
      }
    }
    
    // Validate numeric ranges
    if (updates.maxRadius && (updates.maxRadius < 10 || updates.maxRadius > 500)) {
      return res.status(400).json({
        ok: false,
        error: 'maxRadius must be between 10 and 500 km'
      });
    }
    
    if (updates.preferredRadius && updates.maxRadius && 
        updates.preferredRadius > updates.maxRadius) {
      return res.status(400).json({
        ok: false,
        error: 'preferredRadius cannot exceed maxRadius'
      });
    }
    
    // Apply updates
    farmSelectionOptimizer.updateConfig(updates);
    
    res.json({
      ok: true,
      message: 'Configuration updated successfully',
      newConfig: farmSelectionOptimizer.getConfig()
    });
    
  } catch (error) {
    console.error('[Logistics Config] Update error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to update configuration',
      details: error.message
    });
  }
});

/**
 * POST /api/logistics/config/reset
 * Reset configuration to defaults
 */
router.post('/config/reset', (req, res) => {
  // Reset to defaults
  farmSelectionOptimizer.updateConfig({
    maxRadius: 150,
    preferredRadius: 75,
    clusterRadius: 25,
    weights: {
      productMatch: 30,
      certifications: 20,
      distance: 20,
      clustering: 15,
      quality: 10,
      price: 5
    },
    clusterBonus: 25,
    directionBonus: 15,
    minClusterSize: 2,
    maxDetourPercent: 20,
    oppositeDirectionPenalty: 30,
    isolatedFarmPenalty: 20
  });
  
  res.json({
    ok: true,
    message: 'Configuration reset to defaults',
    config: farmSelectionOptimizer.getConfig()
  });
});

/**
 * GET /api/logistics/presets
 * Get preset configurations for different scenarios
 */
router.get('/presets', (req, res) => {
  const presets = {
    balanced: {
      name: 'Balanced (Default)',
      description: 'Balanced between quality, price, and logistics',
      config: {
        maxRadius: 150,
        preferredRadius: 75,
        weights: { productMatch: 30, certifications: 20, distance: 20, clustering: 15, quality: 10, price: 5 }
      }
    },
    efficiency_focused: {
      name: 'Efficiency Focused',
      description: 'Prioritize route efficiency and clustering',
      config: {
        maxRadius: 100,
        preferredRadius: 50,
        weights: { productMatch: 25, certifications: 15, distance: 15, clustering: 30, quality: 10, price: 5 }
      }
    },
    quality_focused: {
      name: 'Quality Focused',
      description: 'Prioritize farm quality and certifications',
      config: {
        maxRadius: 200,
        preferredRadius: 100,
        weights: { productMatch: 30, certifications: 30, distance: 10, clustering: 10, quality: 15, price: 5 }
      }
    },
    local_first: {
      name: 'Local First',
      description: 'Prioritize nearby farms, maximize locality',
      config: {
        maxRadius: 75,
        preferredRadius: 40,
        weights: { productMatch: 25, certifications: 20, distance: 35, clustering: 10, quality: 5, price: 5 }
      }
    },
    budget_conscious: {
      name: 'Budget Conscious',
      description: 'Balance price with logistics efficiency',
      config: {
        maxRadius: 150,
        preferredRadius: 75,
        weights: { productMatch: 25, certifications: 15, distance: 15, clustering: 15, quality: 10, price: 20 }
      }
    }
  };
  
  res.json({
    ok: true,
    presets
  });
});

/**
 * POST /api/logistics/config/apply-preset
 * Apply a preset configuration
 */
router.post('/config/apply-preset', (req, res) => {
  const { preset } = req.body;
  
  const presets = {
    balanced: {
      maxRadius: 150,
      preferredRadius: 75,
      clusterRadius: 25,
      weights: { productMatch: 30, certifications: 20, distance: 20, clustering: 15, quality: 10, price: 5 }
    },
    efficiency_focused: {
      maxRadius: 100,
      preferredRadius: 50,
      clusterRadius: 20,
      weights: { productMatch: 25, certifications: 15, distance: 15, clustering: 30, quality: 10, price: 5 }
    },
    quality_focused: {
      maxRadius: 200,
      preferredRadius: 100,
      clusterRadius: 30,
      weights: { productMatch: 30, certifications: 30, distance: 10, clustering: 10, quality: 15, price: 5 }
    },
    local_first: {
      maxRadius: 75,
      preferredRadius: 40,
      clusterRadius: 15,
      weights: { productMatch: 25, certifications: 20, distance: 35, clustering: 10, quality: 5, price: 5 }
    },
    budget_conscious: {
      maxRadius: 150,
      preferredRadius: 75,
      clusterRadius: 25,
      weights: { productMatch: 25, certifications: 15, distance: 15, clustering: 15, quality: 10, price: 20 }
    }
  };
  
  if (!presets[preset]) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid preset',
      availablePresets: Object.keys(presets)
    });
  }
  
  farmSelectionOptimizer.updateConfig(presets[preset]);
  
  res.json({
    ok: true,
    message: `Applied ${preset} preset`,
    config: farmSelectionOptimizer.getConfig()
  });
});

export default router;
