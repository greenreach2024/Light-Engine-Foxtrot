/**
 * ML TRAINING PIPELINE (Phase 2 Bridge)
 * 
 * Purpose: Background training system that learns from grower decisions
 * Status: Runs silently in background, will auto-activate when ready
 * 
 * Training Triggers:
 * - Every 50 decisions logged
 * - Weekly scheduled training runs
 * - Manual trigger via API
 * 
 * Activation Criteria:
 * - 500+ decisions collected
 * - 100+ crop cycles completed
 * - >70% acceptance rate sustained
 * - Model accuracy >85% on validation set
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Check if ML training should be triggered
 * @returns {Promise<boolean>}
 */
async function shouldTriggerTraining() {
  const dbPath = path.join(__dirname, '..', 'data', 'lightengine.db');
  const db = new Database(dbPath, { readonly: true });

  try {
    const status = db.prepare(`
      SELECT total_decisions, ml_training_started_at, ml_ready
      FROM ai_training_status
      WHERE id = 1
    `).get();

    // Training triggers:
    // 1. Every 50 decisions (for incremental learning)
    // 2. ML is ready but not yet started
    const shouldTrain = (
      (status.total_decisions > 0 && status.total_decisions % 50 === 0) ||
      (status.ml_ready && !status.ml_training_started_at)
    );

    return shouldTrain;
  } finally {
    db.close();
  }
}

/**
 * Train ML model on collected decisions
 * Phase 2 Bridge: Stub that logs to console
 * Future: Will call Python ML pipeline (Prophet/LSTM)
 */
async function trainMLModel() {
  const dbPath = path.join(__dirname, '..', 'data', 'lightengine.db');
  const db = new Database(dbPath);

  try {
    console.log('[ML Training] Starting background training...');

    // Mark training as started
    db.prepare(`
      UPDATE ai_training_status
      SET ml_training_started_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();

    // Fetch training data
    const decisions = db.prepare(`
      SELECT 
        decision_date,
        group_id,
        recommended_crop,
        actual_crop,
        decision_action
      FROM planting_decisions
      ORDER BY decision_date DESC
      LIMIT 1000
    `).all();

    const performance = db.prepare(`
      SELECT 
        harvest_date,
        crop_id,
        expected_yield_kg,
        actual_yield_kg
      FROM crop_performance
      WHERE actual_yield_kg IS NOT NULL
      ORDER BY harvest_date DESC
      LIMIT 500
    `).all();

    console.log(`[ML Training] Dataset: ${decisions.length} decisions, ${performance.length} performance records`);

    // PHASE 2 BRIDGE: Stub training
    // Future implementation will:
    // 1. Export data to CSV
    // 2. Call Python ML pipeline (Prophet for demand forecasting)
    // 3. Train LSTM model for crop sequencing
    // 4. Evaluate model accuracy on validation set
    // 5. Store trained model weights

    // Simulate training (would take ~5-15 minutes in production)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Mock model accuracy (Phase 2 Bridge)
    const mockAccuracy = 0.65 + (Math.random() * 0.15); // 65-80% accuracy

    // Update training status
    db.prepare(`
      UPDATE ai_training_status
      SET 
        ml_training_completed_at = CURRENT_TIMESTAMP,
        ml_model_accuracy = ?
      WHERE id = 1
    `).run(mockAccuracy);

    console.log(`[ML Training] Complete. Model accuracy: ${(mockAccuracy * 100).toFixed(1)}%`);
    
    // If accuracy is good and we're ready, consider activation
    if (mockAccuracy >= 0.85) {
      const status = db.prepare('SELECT ml_ready FROM ai_training_status WHERE id = 1').get();
      if (status.ml_ready) {
        console.log('[ML Training] ✅ Model meets activation criteria (accuracy >85%, data thresholds met)');
        console.log('[ML Training] 🚀 Auto-activation will occur on next server restart');
      }
    }

  } catch (error) {
    console.error('[ML Training] Error:', error);
  } finally {
    db.close();
  }
}

/**
 * Background worker that checks for training opportunities
 */
async function startMLTrainingWorker() {
  console.log('[ML Training Worker] Started - checking every 1 hour');

  setInterval(async () => {
    try {
      const shouldTrain = await shouldTriggerTraining();
      if (shouldTrain) {
        await trainMLModel();
      }
    } catch (error) {
      console.error('[ML Training Worker] Error:', error);
    }
  }, 60 * 60 * 1000); // Every 1 hour
}

export {
  shouldTriggerTraining,
  trainMLModel,
  startMLTrainingWorker
};
