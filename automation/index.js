import PreAutomationEngine from './engine.js';
import EnvStore from './env-store.js';
import RulesStore from './rules-store.js';
import PlugRegistry from './plug-registry.js';
import AutomationLogger from './logger.js';
import PlugManager from './plug-manager.js';
import FanRotationController from './fan-rotation.js';

export function createPreAutomationLayer(options = {}) {
  const envStore = options.envStore || new EnvStore(options);
  const rulesStore = options.rulesStore || new RulesStore(options);
  const registry = options.registry || new PlugRegistry(options);
  const logger = options.logger || new AutomationLogger(options);
  const plugManager = options.plugManager || new PlugManager({ registry, logger });

  // Initialize fan rotation controller
  const fanRotationEnabled = options.fanRotation?.enabled !== false;
  const fanRotation = fanRotationEnabled 
    ? new FanRotationController({
        plugManager,
        logger,
        config: {
          rotationIntervalMs: options.fanRotation?.intervalMs || (15 * 60 * 1000), // 15 minutes default
          enabled: true
        }
      })
    : null;

  const engine = new PreAutomationEngine({
    ...options,
    envStore,
    rulesStore,
    registry,
    logger,
    plugManager,
    fanRotation
  });

  if (options.autoStart !== false) {
    engine.start();
    if (fanRotation) {
      fanRotation.start();
      console.log('[automation] Fan rotation controller started (15-minute cycles)');
    }
  }

  return {
    engine,
    envStore,
    rulesStore,
    registry,
    logger,
    plugManager,
    fanRotation
  };
}

export default PreAutomationEngine;
