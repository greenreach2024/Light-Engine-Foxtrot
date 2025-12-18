/**
 * Sync Queue
 * 
 * Manages offline queue for sync operations:
 * - Queue operations when offline
 * - Retry with exponential backoff
 * - Persist queue to disk
 * - Process queue when back online
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import edgeConfig from './edge-config.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUEUE_FILE = path.join(__dirname, '../config/sync-queue.json');
const MAX_RETRIES = 5;
const INITIAL_BACKOFF = 1000; // 1 second

class SyncQueue {
  constructor() {
    this.queue = [];
    this.loadQueue();
  }

  /**
   * Load queue from disk
   */
  loadQueue() {
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        const data = fs.readFileSync(QUEUE_FILE, 'utf8');
        this.queue = JSON.parse(data);
        console.log(`✓ Loaded ${this.queue.length} queued sync operations`);
      }
    } catch (error) {
      console.warn('Warning: Could not load sync queue:', error.message);
      this.queue = [];
    }
  }

  /**
   * Save queue to disk
   */
  saveQueue() {
    try {
      const queueDir = path.dirname(QUEUE_FILE);
      if (!fs.existsSync(queueDir)) {
        fs.mkdirSync(queueDir, { recursive: true });
      }
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2));
    } catch (error) {
      console.error('Error saving sync queue:', error);
    }
  }

  /**
   * Add operation to queue
   */
  enqueue(type, data, priority = 'normal') {
    const operation = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      priority,
      retries: 0,
      createdAt: new Date().toISOString(),
      nextRetry: new Date().toISOString()
    };

    this.queue.push(operation);
    this.saveQueue();

    console.log(`✓ Queued ${type} operation (${this.queue.length} in queue)`);
    return operation.id;
  }

  /**
   * Remove operation from queue
   */
  dequeue(operationId) {
    const index = this.queue.findIndex(op => op.id === operationId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.saveQueue();
      return true;
    }
    return false;
  }

  /**
   * Get queue size
   */
  getSize() {
    return this.queue.length;
  }

  /**
   * Clear entire queue
   */
  clear() {
    this.queue = [];
    this.saveQueue();
    console.log('✓ Sync queue cleared');
  }

  /**
   * Process queue
   */
  async processQueue() {
    if (edgeConfig.isOfflineMode()) {
      console.log('Offline mode, skipping queue processing');
      return 0;
    }

    if (this.queue.length === 0) {
      return 0;
    }

    console.log(`Processing ${this.queue.length} queued operations...`);

    const now = new Date();
    let processed = 0;

    // Sort by priority and nextRetry time
    const sortedQueue = [...this.queue].sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (a.priority !== 'high' && b.priority === 'high') return 1;
      return new Date(a.nextRetry) - new Date(b.nextRetry);
    });

    for (const operation of sortedQueue) {
      // Check if it's time to retry
      if (new Date(operation.nextRetry) > now) {
        continue;
      }

      try {
        await this.executeOperation(operation);
        this.dequeue(operation.id);
        processed++;
        console.log(`✓ Processed queued ${operation.type}`);
      } catch (error) {
        console.error(`✗ Failed to process ${operation.type}:`, error.message);
        
        // Update retry count and backoff
        operation.retries++;
        
        if (operation.retries >= MAX_RETRIES) {
          console.error(`Max retries reached for ${operation.id}, removing from queue`);
          this.dequeue(operation.id);
        } else {
          // Exponential backoff
          const backoffMs = INITIAL_BACKOFF * Math.pow(2, operation.retries);
          operation.nextRetry = new Date(Date.now() + backoffMs).toISOString();
          this.saveQueue();
          console.log(`Will retry in ${backoffMs / 1000}s (attempt ${operation.retries + 1}/${MAX_RETRIES})`);
        }
      }
    }

    return processed;
  }

  /**
   * Execute a queued operation
   */
  async executeOperation(operation) {
    const farmId = edgeConfig.getFarmId();
    const apiKey = edgeConfig.getApiKey();
    const centralUrl = edgeConfig.getCentralApiUrl();

    switch (operation.type) {
      case 'inventory_sync':
        await axios.post(
          `${centralUrl}/api/inventory/${farmId}/sync`,
          { products: operation.data.products },
          {
            headers: {
              'X-API-Key': apiKey,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );
        break;

      case 'heartbeat':
        await axios.post(
          `${centralUrl}/api/farms/${farmId}/heartbeat`,
          operation.data,
          {
            headers: {
              'X-API-Key': apiKey,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );
        break;

      case 'order_fulfillment':
        await axios.put(
          `${centralUrl}/api/wholesale/orders/${operation.data.order_id}/items/${operation.data.item_id}/fulfill`,
          { fulfillment_status: operation.data.status },
          {
            headers: {
              'X-API-Key': apiKey,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );
        break;

      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const stats = {
      total: this.queue.length,
      byType: {},
      byPriority: {
        high: 0,
        normal: 0,
        low: 0
      },
      oldestOperation: null
    };

    this.queue.forEach(op => {
      // Count by type
      stats.byType[op.type] = (stats.byType[op.type] || 0) + 1;
      
      // Count by priority
      stats.byPriority[op.priority]++;
      
      // Track oldest
      if (!stats.oldestOperation || new Date(op.createdAt) < new Date(stats.oldestOperation)) {
        stats.oldestOperation = op.createdAt;
      }
    });

    return stats;
  }
}

// Export singleton instance
export default new SyncQueue();
