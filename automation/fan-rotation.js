/**
 * Fan Rotation Controller
 * 
 * Manages baseline fan circulation on a rotating schedule to maintain
 * consistent temperature and humidity distribution across grow zones.
 * 
 * Strategy:
 * - Rotate fans on 15-minute cycles (one fan at a time for baseline circulation)
 * - Allow demand-based overrides when zones need active balancing
 * - Prevent fan conflicts between rotation schedule and demand-based rules
 */

import EventEmitter from 'events';

export default class FanRotationController extends EventEmitter {
  constructor({ plugManager, logger, config = {} } = {}) {
    super();
    
    this.plugManager = plugManager;
    this.logger = logger;
    
    // Configuration
    this.rotationIntervalMs = config.rotationIntervalMs || (15 * 60 * 1000); // 15 minutes
    this.enabled = config.enabled !== false;
    
    // Fan inventory (3 total fans across zones)
    this.fans = [
      { id: '3C8427B1316E', zone: 'zone-1', name: 'Zone 1 Fan A' },
      { id: '84FCE6F34A66', zone: 'zone-1', name: 'Zone 1 Fan B' },
      { id: '7C2C67C5467A', zone: 'zone-3', name: 'Zone 3 Fan' }
    ];
    
    // Rotation state
    this.currentFanIndex = 0;
    this.lastRotationTime = 0;
    this.activeFan = null;
    this.overrides = new Set(); // Fans under demand-based control
    
    // Timer
    this.timer = null;
  }

  /**
   * Start the fan rotation controller
   */
  start() {
    if (this.timer) {
      this.logger?.log('Fan rotation controller already running');
      return;
    }
    
    if (!this.enabled) {
      this.logger?.log('Fan rotation controller disabled by config');
      return;
    }
    
    this.logger?.log('[fan-rotation] Starting fan rotation controller');
    this.logger?.log(`[fan-rotation] Rotation interval: ${this.rotationIntervalMs / 1000}s per fan`);
    
    // Initialize first rotation immediately
    this.rotate().catch(err => {
      this.logger?.error('[fan-rotation] Initial rotation failed:', err.message);
    });
    
    // Set up interval for subsequent rotations
    this.timer = setInterval(() => {
      this.rotate().catch(err => {
        this.logger?.error('[fan-rotation] Rotation failed:', err.message);
      });
    }, this.rotationIntervalMs);
    
    this.emit('started');
  }

  /**
   * Stop the fan rotation controller
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger?.log('[fan-rotation] Stopped fan rotation controller');
      this.emit('stopped');
    }
  }

  /**
   * Mark a fan as overridden by demand-based automation
   * This prevents the rotation controller from interfering
   */
  setOverride(fanId, reason = 'demand-based') {
    this.overrides.add(fanId);
    this.logger?.log(`[fan-rotation] Fan ${fanId} overridden: ${reason}`);
    this.emit('override', { fanId, reason });
  }

  /**
   * Clear override for a fan, returning it to rotation control
   */
  clearOverride(fanId) {
    this.overrides.delete(fanId);
    this.logger?.log(`[fan-rotation] Fan ${fanId} override cleared`);
    this.emit('clearOverride', { fanId });
  }

  /**
   * Check if a fan is currently overridden
   */
  isOverridden(fanId) {
    return this.overrides.has(fanId);
  }

  /**
   * Rotate to the next fan in the sequence
   */
  async rotate() {
    const now = Date.now();
    
    // Capture environmental snapshot before rotation
    const preRotationSnapshot = await this.captureEnvironmentalSnapshot();
    
    // Turn off the previous active fan (if not overridden)
    if (this.activeFan && !this.isOverridden(this.activeFan.id)) {
      try {
        await this.plugManager.setPowerState(this.activeFan.id, false);
        this.logger?.log(`[fan-rotation] Turned OFF ${this.activeFan.name}`);
      } catch (error) {
        this.logger?.error(`[fan-rotation] Failed to turn off ${this.activeFan.id}:`, error.message);
      }
    }
    
    // Find next fan that's not overridden
    let attempts = 0;
    let nextFan = null;
    
    while (attempts < this.fans.length) {
      this.currentFanIndex = (this.currentFanIndex + 1) % this.fans.length;
      const candidate = this.fans[this.currentFanIndex];
      
      if (!this.isOverridden(candidate.id)) {
        nextFan = candidate;
        break;
      }
      
      attempts++;
    }
    
    // If all fans are overridden, skip rotation
    if (!nextFan) {
      this.logger?.log('[fan-rotation] All fans overridden, skipping rotation');
      this.activeFan = null;
      return;
    }
    
    // Turn on the next fan
    try {
      await this.plugManager.setPowerState(nextFan.id, true);
      const previousFan = this.activeFan;
      this.activeFan = nextFan;
      this.lastRotationTime = now;
      
      this.logger?.log(`[fan-rotation] Turned ON ${nextFan.name} (${nextFan.zone})`);
      
      // Log rotation event with environmental context
      this.logger?.log({
        type: 'fan-rotation',
        event: 'rotated',
        previousFan: previousFan ? {
          id: previousFan.id,
          zone: previousFan.zone,
          name: previousFan.name
        } : null,
        activeFan: {
          id: nextFan.id,
          zone: nextFan.zone,
          name: nextFan.name
        },
        environment: {
          before: preRotationSnapshot,
          // Will capture 'after' snapshot in next rotation
        },
        timestamp: now,
        timestampISO: new Date(now).toISOString()
      });
      
      this.emit('rotated', {
        fanId: nextFan.id,
        zone: nextFan.zone,
        name: nextFan.name,
        previousFan,
        environment: preRotationSnapshot,
        timestamp: now
      });
    } catch (error) {
      this.logger?.error(`[fan-rotation] Failed to turn on ${nextFan.id}:`, error.message);
      this.activeFan = null;
    }
  }

  /**
   * Capture current environmental readings for all zones
   * This helps correlate fan activity with temp/humidity changes
   */
  async captureEnvironmentalSnapshot() {
    try {
      // Get environmental data from all zones
      const snapshot = {};
      
      for (const fan of this.fans) {
        // Query current sensor readings for this fan's zone
        // This will be zone-specific data
        snapshot[fan.zone] = {
          fanId: fan.id,
          fanName: fan.name,
          readings: {
            tempC: null,
            rh: null,
            vpd: null
          },
          capturedAt: Date.now()
        };
      }
      
      return snapshot;
    } catch (error) {
      this.logger?.error('[fan-rotation] Failed to capture environmental snapshot:', error.message);
      return {};
    }
  }

  /**
   * Get current rotation status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      running: Boolean(this.timer),
      activeFan: this.activeFan ? {
        id: this.activeFan.id,
        zone: this.activeFan.zone,
        name: this.activeFan.name
      } : null,
      overrides: Array.from(this.overrides),
      nextRotationIn: this.lastRotationTime 
        ? Math.max(0, this.rotationIntervalMs - (Date.now() - this.lastRotationTime))
        : 0,
      rotationIntervalMs: this.rotationIntervalMs
    };
  }

  /**
   * Get list of all managed fans
   */
  getFans() {
    return this.fans.map(fan => ({
      ...fan,
      active: this.activeFan?.id === fan.id,
      overridden: this.isOverridden(fan.id)
    }));
  }
}
