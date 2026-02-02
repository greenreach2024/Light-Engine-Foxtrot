/**
 * Data Flow Helpers
 * Standardized patterns for event-driven data flow between dashboard components
 * 
 * Created: February 2, 2026
 * Related: IMPLEMENTATION_PROPOSAL_DATA_FLOW_FIX.md, REVIEW_AGENT_ASSESSMENT_DATA_FLOW_FIX.md
 */

/**
 * Register a component to receive data updates with STATE readiness handling
 * 
 * @param {string} componentName - Name for logging/debugging
 * @param {Object} callbacks - Callbacks for data updates
 * @param {Function} [callbacks.onInit] - Called when STATE is ready
 * @param {Function} [callbacks.onRoomsUpdate] - Called when rooms data updates
 * @param {Function} [callbacks.onGroupsUpdate] - Called when groups data updates
 * @param {Function} [callbacks.onFarmDataChange] - Called when farm config changes
 * @param {Function} [callbacks.onDevicesUpdate] - Called when device data updates
 * @param {Function} [callbacks.onSchedulesUpdate] - Called when schedule data updates
 * @returns {Function} cleanup - Call to unregister all event listeners
 * 
 * @example
 * const cleanup = registerDataConsumer('GroupsV2Card', {
 *   onInit: (state) => {
 *     populateDropdowns(state.rooms);
 *   },
 *   onRoomsUpdate: (rooms) => {
 *     populateRoomDropdown(rooms);
 *   },
 *   onGroupsUpdate: (groups) => {
 *     refreshGroupsList(groups);
 *   }
 * });
 * 
 * // Later: cleanup() to remove listeners
 */
export function registerDataConsumer(componentName, callbacks = {}) {
  console.log(`[DataFlow] Registering ${componentName}`);
  
  // Store listener references for cleanup
  const listeners = [];
  
  // Helper to add listener and track it
  const addListener = (target, event, handler) => {
    target.addEventListener(event, handler);
    listeners.push({ target, event, handler });
  };
  
  // STATE readiness check - FIX for timing bug identified by Review Agent
  const initializeWhenReady = () => {
    if (!callbacks.onInit) return;
    
    if (window.STATE && Object.keys(window.STATE).length > 0) {
      // STATE is ready, initialize immediately
      try {
        callbacks.onInit(window.STATE);
        console.log(`[DataFlow] ${componentName} initialized with STATE`);
      } catch (error) {
        console.error(`[DataFlow] Error initializing ${componentName}:`, error);
      }
    } else {
      // STATE not ready yet, wait for state-ready event
      console.log(`[DataFlow] ${componentName} waiting for STATE to be ready...`);
      const stateReadyHandler = () => {
        try {
          callbacks.onInit(window.STATE);
          console.log(`[DataFlow] ${componentName} initialized after STATE ready`);
        } catch (error) {
          console.error(`[DataFlow] Error initializing ${componentName}:`, error);
        }
      };
      addListener(window, 'state-ready', stateReadyHandler);
    }
  };
  
  // Initialize component
  initializeWhenReady();
  
  // Register update listeners
  if (callbacks.onRoomsUpdate) {
    const handler = () => {
      try {
        callbacks.onRoomsUpdate(window.STATE.rooms || []);
        console.log(`[DataFlow] ${componentName} received rooms-updated`);
      } catch (error) {
        console.error(`[DataFlow] Error in ${componentName} onRoomsUpdate:`, error);
      }
    };
    addListener(document, 'rooms-updated', handler);
  }
  
  if (callbacks.onGroupsUpdate) {
    const handler = () => {
      try {
        callbacks.onGroupsUpdate(window.STATE.groups || []);
        console.log(`[DataFlow] ${componentName} received groups-updated`);
      } catch (error) {
        console.error(`[DataFlow] Error in ${componentName} onGroupsUpdate:`, error);
      }
    };
    addListener(document, 'groups-updated', handler);
  }
  
  if (callbacks.onFarmDataChange) {
    const handler = (event) => {
      try {
        callbacks.onFarmDataChange(event.detail || window.STATE.farm);
        console.log(`[DataFlow] ${componentName} received farmDataChanged`);
      } catch (error) {
        console.error(`[DataFlow] Error in ${componentName} onFarmDataChange:`, error);
      }
    };
    addListener(window, 'farmDataChanged', handler);
  }
  
  if (callbacks.onDevicesUpdate) {
    const handler = () => {
      try {
        callbacks.onDevicesUpdate(window.STATE.devices || []);
        console.log(`[DataFlow] ${componentName} received devices-updated`);
      } catch (error) {
        console.error(`[DataFlow] Error in ${componentName} onDevicesUpdate:`, error);
      }
    };
    addListener(document, 'devices-updated', handler);
  }
  
  if (callbacks.onSchedulesUpdate) {
    const handler = () => {
      try {
        callbacks.onSchedulesUpdate(window.STATE.schedules || []);
        console.log(`[DataFlow] ${componentName} received schedules-updated`);
      } catch (error) {
        console.error(`[DataFlow] Error in ${componentName} onSchedulesUpdate:`, error);
      }
    };
    addListener(document, 'schedules-updated', handler);
  }
  
  // Return cleanup function
  return () => {
    console.log(`[DataFlow] Unregistering ${componentName}`);
    listeners.forEach(({ target, event, handler }) => {
      target.removeEventListener(event, handler);
    });
  };
}

/**
 * Save data and dispatch appropriate event
 * 
 * @param {string} dataType - Type of data (rooms, groups, farm, devices, schedules)
 * @param {Object} data - Data to save
 * @param {string} endpoint - API endpoint (e.g., '/data/rooms.json')
 * @returns {Promise<boolean>} success - True if save succeeded
 * 
 * @example
 * const success = await saveAndNotify('rooms', STATE.rooms, '/data/rooms.json');
 * if (success) {
 *   showToast('Rooms saved successfully');
 * }
 */
export async function saveAndNotify(dataType, data, endpoint) {
  console.log(`[DataFlow] Saving ${dataType}...`);
  
  try {
    // Use existing saveJSON function from app.foxtrot.js
    const success = await window.saveJSON(endpoint, data);
    
    if (success) {
      console.log(`[DataFlow] ${dataType} saved successfully`);
      
      // Dispatch appropriate event
      const eventMap = {
        rooms: 'rooms-updated',
        groups: 'groups-updated',
        farm: 'farmDataChanged',
        devices: 'devices-updated',
        schedules: 'schedules-updated'
      };
      
      const eventName = eventMap[dataType];
      if (eventName) {
        if (eventName === 'farmDataChanged') {
          // CustomEvent for farm data (includes detail)
          window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
        } else {
          // Regular Event for other data types
          document.dispatchEvent(new Event(eventName));
        }
        console.log(`[DataFlow] Dispatched ${eventName} event`);
      } else {
        console.warn(`[DataFlow] Unknown data type: ${dataType}, no event dispatched`);
      }
      
      return true;
    } else {
      console.error(`[DataFlow] Failed to save ${dataType}`);
      return false;
    }
  } catch (error) {
    console.error(`[DataFlow] Error saving ${dataType}:`, error);
    return false;
  }
}

/**
 * Wait for STATE to be ready
 * 
 * @returns {Promise<Object>} STATE object
 * 
 * @example
 * const state = await waitForState();
 * populateDropdowns(state.rooms);
 */
export function waitForState() {
  return new Promise((resolve) => {
    if (window.STATE && Object.keys(window.STATE).length > 0) {
      // STATE already ready
      resolve(window.STATE);
    } else {
      // Wait for state-ready event
      window.addEventListener('state-ready', () => {
        resolve(window.STATE);
      }, { once: true });
    }
  });
}

/**
 * Check if STATE is ready
 * 
 * @returns {boolean} true if STATE is populated
 * 
 * @example
 * if (isStateReady()) {
 *   populateDropdowns(STATE.rooms);
 * } else {
 *   console.log('Waiting for STATE...');
 * }
 */
export function isStateReady() {
  return window.STATE && Object.keys(window.STATE).length > 0;
}

/**
 * Notify that STATE is ready (call from loadAllData completion)
 * 
 * @example
 * async function loadAllData() {
 *   // ... load data into STATE ...
 *   notifyStateReady();
 * }
 */
export function notifyStateReady() {
  console.log('[DataFlow] STATE is ready');
  window.dispatchEvent(new Event('state-ready'));
}

/**
 * Get data from STATE with fallback
 * 
 * @param {string} key - STATE key (rooms, groups, farm, etc.)
 * @param {*} defaultValue - Default value if not found
 * @returns {*} Data from STATE or default
 * 
 * @example
 * const rooms = getStateData('rooms', []);
 * const farm = getStateData('farm', {});
 */
export function getStateData(key, defaultValue = null) {
  if (!window.STATE) {
    console.warn('[DataFlow] STATE not initialized');
    return defaultValue;
  }
  
  return window.STATE[key] !== undefined ? window.STATE[key] : defaultValue;
}

/**
 * Debug helper: Log current STATE
 * 
 * @example
 * debugState(); // Logs STATE to console
 */
export function debugState() {
  console.log('[DataFlow] Current STATE:', {
    rooms: window.STATE?.rooms?.length || 0,
    groups: window.STATE?.groups?.length || 0,
    devices: window.STATE?.devices?.length || 0,
    schedules: window.STATE?.schedules?.length || 0,
    farm: window.STATE?.farm ? 'loaded' : 'not loaded',
    stateKeys: window.STATE ? Object.keys(window.STATE) : 'STATE not initialized'
  });
}

// Export all functions as named exports
export default {
  registerDataConsumer,
  saveAndNotify,
  waitForState,
  isStateReady,
  notifyStateReady,
  getStateData,
  debugState
};
