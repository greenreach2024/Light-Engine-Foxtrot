// controller/coreAllocator.js
/**
 * Core environmental control allocator
 * Room-level multi-zone control strategy
 * Uses ALL room equipment for ANY active zone exceeding targets
 */

/**
 * Find all active zones (zones with active/deployed groups)
 * @param {Array} allZones - All zones
 * @param {Array} groups - All growing groups
 * @returns {Array} Active zone IDs
 */
function getActiveZones(allZones, groups) {
  if (!groups?.length) {
    console.log('[allocator] No groups provided to getActiveZones');
    return [];
  }
  
  console.log(`[allocator] Checking ${groups.length} groups for active status`);
  
  const activeZoneIds = new Set();
  groups.forEach(g => {
    // Check both g.active (boolean) and g.status (string: "deployed", "active", etc.)
    const isActive = g.active === true || 
                     g.status === 'deployed' || 
                     g.status === 'active';
    
    console.log(`[allocator] Group "${g.name}": zone=${g.zone}, status=${g.status}, active=${g.active}, isActive=${isActive}`);
    
    if (isActive && g.zone) {
      activeZoneIds.add(`zone-${g.zone}`);
    }
  });
  
  console.log(`[allocator] Found ${activeZoneIds.size} active zones: ${Array.from(activeZoneIds).join(', ')}`);
  return Array.from(activeZoneIds);
}

/**
 * Check if ANY active zone exceeds environmental targets
 * @param {Array} zones - Zones to check
 * @param {Array} activeZoneIds - Active zone IDs
 * @param {Object} targets - Target ranges per zone
 * @returns {Object} Exceeded status
 */
function checkExceededTargets(zones, activeZoneIds, targets) {
  const exceeded = {
    rh: { high: false, low: false, maxValue: -Infinity, minValue: Infinity, zones: [] },
    temp: { high: false, low: false, maxValue: -Infinity, minValue: Infinity, zones: [] }
  };
  
  for (const zone of zones) {
    if (!activeZoneIds.includes(zone.id)) continue;
    
    const rh = zone.sensors?.rh?.current;
    const tempC = zone.sensors?.tempC?.current;
    const zoneTargets = targets?.[zone.id] || {};
    
    // Check RH
    if (Number.isFinite(rh)) {
      const rhMax = zoneTargets.rh_max || zoneTargets.rhMax || 70;
      const rhMin = zoneTargets.rh_min || zoneTargets.rhMin || 60;
      
      if (rh > rhMax) {
        exceeded.rh.high = true;
        exceeded.rh.zones.push({ id: zone.id, value: rh, target: rhMax });
        exceeded.rh.maxValue = Math.max(exceeded.rh.maxValue, rh);
      }
      if (rh < rhMin) {
        exceeded.rh.low = true;
        exceeded.rh.zones.push({ id: zone.id, value: rh, target: rhMin });
        exceeded.rh.minValue = Math.min(exceeded.rh.minValue, rh);
      }
    }
    
    // Check Temperature
    if (Number.isFinite(tempC)) {
      const tempMax = zoneTargets.temp_max || zoneTargets.tempMax || 24;
      const tempMin = zoneTargets.temp_min || zoneTargets.tempMin || 18;
      
      if (tempC > tempMax) {
        exceeded.temp.high = true;
        exceeded.temp.zones.push({ id: zone.id, value: tempC, target: tempMax });
        exceeded.temp.maxValue = Math.max(exceeded.temp.maxValue, tempC);
      }
      if (tempC < tempMin) {
        exceeded.temp.low = true;
        exceeded.temp.zones.push({ id: zone.id, value: tempC, target: tempMin });
        exceeded.temp.minValue = Math.min(exceeded.temp.minValue, tempC);
      }
    }
  }
  
  return exceeded;
}

/**
 * Core allocation function - room-level environmental control
 * @param {Array} zones - All zones with sensor data
 * @param {Array} iotDevices - IoT devices (actuators)
 * @param {Object} ml - ML effect matrices (optional)
 * @param {Object} options - Additional options
 */
export async function coreAllocator(zones, iotDevices, ml, options = {}) {
  const { plugManager, groups, targets, lastActions, outdoorContext } = options;
  
  // Log outdoor conditions for context
  if (outdoorContext?.outdoor) {
    const o = outdoorContext.outdoor;
    const h = outdoorContext.hallway;
    console.log(`[allocator] 🌡️  Outdoor: ${o.temperature}°C/${o.humidity}%RH` + 
                (h ? ` | Hallway: ${h.temperature}°C/${h.humidity}%RH` : ''));
  }
  
  // 1) Find active zones (zones with active/deployed groups)
  const activeZoneIds = getActiveZones(zones, groups);
  
  if (activeZoneIds.length === 0) {
    console.log('[allocator] No active zones found, skipping control');
    return;
  }
  
  console.log(`[allocator] Active zones: ${activeZoneIds.join(', ')}`);
  
  // 2) Check if ANY active zone exceeds targets
  const exceeded = checkExceededTargets(zones, activeZoneIds, targets);
  
  console.log(`[allocator] Exceeded check - RH high: ${exceeded.rh.high}, RH low: ${exceeded.rh.low}, Temp high: ${exceeded.temp.high}, Temp low: ${exceeded.temp.low}`);
  if (exceeded.rh.high || exceeded.rh.low) {
    console.log(`[allocator] RH details - max: ${exceeded.rh.maxValue}, min: ${exceeded.rh.minValue}`);
  }
  
  // 3) Find ALL room equipment (not filtered by zone)
  const dehumidifiers = iotDevices.filter(d => 
    d.automationControl === true &&
    (d.name || '').toLowerCase().includes('dehumid')
  );
  
  const humidifiers = iotDevices.filter(d => 
    d.automationControl === true &&
    (d.name || '').toLowerCase().includes('humidif')
  );
  
  const fans = iotDevices.filter(d => 
    d.automationControl === true &&
    ((d.name || '').toLowerCase().includes('fan') ||
     (d.name || '').toLowerCase().includes('circulation'))
  );
  
  // 4) Apply zone-specific + room-wide control logic with escalation
  const now = Date.now();
  const cooldown = 5 * 60 * 1000; // 5 minute cooldown between actions
  const zoneCooldown = 2 * 60 * 1000; // 2 minute cooldown per zone
  const escalationThreshold = 15 * 60 * 1000; // 15 minutes before escalating to 2nd dehumidifier
  
  // Initialize escalation tracking if not exists
  if (!lastActions._rhEscalation) {
    lastActions._rhEscalation = {
      startTime: null,
      startRH: null,
      singleDehumidifierActive: false
    };
  }
  
  // Strategy: 
  // - If 1 zone high: activate its dehumidifier only
  // - If RH still high after 15 min OR no drop in RH: escalate to ALL dehumidifiers
  // - If 2+ zones high: activate ALL dehumidifiers + circulation fans (room-wide issue)
  // - Learn cross-zone effects with ML for future optimization
  
  if (exceeded.rh.high && dehumidifiers.length > 0) {
    const highZones = exceeded.rh.zones;
    const multiZoneProblem = highZones.length > 1;
    
    console.log(`[allocator] [WATER] HIGH RH detected in ${highZones.length} zone(s) (max: ${exceeded.rh.maxValue.toFixed(1)}%)`);
    highZones.forEach(z => {
      console.log(`  - ${z.id}: ${z.value.toFixed(1)}% > ${z.target}%`);
    });
    
    if (multiZoneProblem) {
      // Room-wide humidity issue - activate everything
      const key = 'rh-high-multizone';
      if (!lastActions[key] || (now - lastActions[key]) > cooldown) {
        console.log(`[allocator] 🏠 Multi-zone RH problem detected - activating ALL equipment`);
        
        // Activate ALL dehumidifiers
        for (const device of dehumidifiers) {
          try {
            console.log(`[allocator] → Activating dehumidifier: ${device.name} (zone ${device.zone})`);
            const result = await plugManager.turnOn(device.deviceId);
            console.log(`[allocator] [OK] ${device.name} activation result:`, result?.on ? 'ON' : result);
            
            // Log action detail for API
            lastActions[`zone-${device.zone}-dehumidifier`] = {
              timestamp: new Date().toISOString(),
              action: 'activated',
              device: device.name,
              state: 'ON',
              trigger: 'multi-zone-high-rh'
            };
          } catch (error) {
            console.warn(`[allocator] Failed to activate ${device.name}:`, error.message);
          }
        }
        
                  // Activate circulation fans to distribute drying effect across zones
        for (const fan of fans) {
          try {
            console.log(`[allocator] → Activating circulation fan: ${fan.name} (zone ${fan.zone})`);
            const result = await plugManager.turnOn(fan.deviceId);
            console.log(`[allocator] [OK] ${fan.name} activation result:`, result?.on ? 'ON' : result);
            
            // Log action detail for API
            lastActions[`zone-${fan.zone}-fan`] = {
              timestamp: new Date().toISOString(),
              action: 'activated',
              device: fan.name,
              state: 'ON',
              trigger: 'multi-zone-high-rh'
            };
          } catch (error) {
            console.warn(`[allocator] Failed to activate ${fan.name}:`, error.message);
          }
        }
        
        lastActions[key] = now;
        console.log(`[allocator] [STATS] ML will learn: How do Zone-1 & Zone-3 dehumidifiers affect each other?`);
      }
    } else {
      // Single zone issue - check if we need to escalate to both dehumidifiers
      const problemZone = highZones[0];
      const zoneNum = problemZone.id.replace('zone-', '');
      const key = `rh-high-zone-${zoneNum}`;
      const escalation = lastActions._rhEscalation;
      
      // Check if we should escalate to both dehumidifiers
      const shouldEscalate = escalation.singleDehumidifierActive && 
                            escalation.startTime && 
                            (now - escalation.startTime) > escalationThreshold;
      
      const rhNotImproving = escalation.singleDehumidifierActive &&
                            escalation.startRH &&
                            problemZone.value >= escalation.startRH - 1; // Less than 1% drop
      
      if (shouldEscalate || rhNotImproving) {
        // Escalate: activate ALL dehumidifiers
        const escalateKey = 'rh-high-escalated';
        if (!lastActions[escalateKey] || (now - lastActions[escalateKey]) > cooldown) {
          if (shouldEscalate) {
            console.log(`[allocator] [WARNING] ESCALATION: RH still high after 15 minutes - activating ALL dehumidifiers`);
          } else {
            console.log(`[allocator] [WARNING] ESCALATION: No RH improvement detected - activating ALL dehumidifiers`);
          }
          console.log(`[allocator]    Start: ${escalation.startRH?.toFixed(1)}% @ ${new Date(escalation.startTime).toLocaleTimeString()}`);
          console.log(`[allocator]    Now: ${problemZone.value.toFixed(1)}% @ ${new Date(now).toLocaleTimeString()}`);
          
          // Activate ALL dehumidifiers
          for (const device of dehumidifiers) {
            try {
              console.log(`[allocator] → Activating dehumidifier: ${device.name} (zone ${device.zone})`);
              const result = await plugManager.turnOn(device.deviceId);
              console.log(`[allocator] [OK] ${device.name} activation result:`, result?.on ? 'ON' : result);
              
              // Log action detail for API
              lastActions[`zone-${device.zone}-dehumidifier`] = {
                timestamp: new Date().toISOString(),
                action: 'activated',
                device: device.name,
                state: 'ON',
                trigger: shouldEscalate ? '15min-escalation' : 'no-improvement-escalation'
              };
            } catch (error) {
              console.warn(`[allocator] Failed to activate ${device.name}:`, error.message);
            }
          }
          
          // Activate ALL circulation fans
          for (const fan of fans) {
            try {
              console.log(`[allocator] → Activating circulation fan: ${fan.name} (zone ${fan.zone})`);
              const result = await plugManager.turnOn(fan.deviceId);
              console.log(`[allocator] [OK] ${fan.name} activation result:`, result?.on ? 'ON' : result);
              
              // Log action detail for API
              lastActions[`zone-${fan.zone}-fan`] = {
                timestamp: new Date().toISOString(),
                action: 'activated',
                device: fan.name,
                state: 'ON',
                trigger: 'escalation-circulation'
              };
            } catch (error) {
              console.warn(`[allocator] Failed to activate ${fan.name}:`, error.message);
            }
          }
          
          lastActions[escalateKey] = now;
          escalation.singleDehumidifierActive = false; // Reset since we escalated
          console.log(`[allocator] [STATS] ML will learn: Escalation effectiveness for stubborn RH`);
        }
      } else if (!escalation.singleDehumidifierActive || (!lastActions[key] || (now - lastActions[key]) > zoneCooldown)) {
        // Start with single zone-specific dehumidifier
        console.log(`[allocator] [TARGET] Single zone problem (${problemZone.id}) - targeted dehumidification`);
        
        // Track escalation start time FIRST (before activating)
        if (!escalation.singleDehumidifierActive) {
          escalation.startTime = now;
          escalation.startRH = problemZone.value;
          escalation.singleDehumidifierActive = true;
          console.log(`[allocator] [TIME] Starting 15-minute escalation timer at RH ${problemZone.value.toFixed(1)}%`);
        } else {
          // Timer already running - show progress
          const elapsed = Math.round((now - escalation.startTime) / 1000 / 60);
          const remaining = 15 - elapsed;
          console.log(`[allocator] ⏱️  Escalation timer: ${elapsed} min elapsed, ${remaining} min remaining (RH: ${escalation.startRH?.toFixed(1)}% → ${problemZone.value.toFixed(1)}%)`);
        }
        
        // Find dehumidifier for this specific zone
        const zoneDehumidifier = dehumidifiers.find(d => String(d.zone) === String(zoneNum));
        
        if (zoneDehumidifier) {
          try {
            console.log(`[allocator] → Activating ${zoneDehumidifier.name} for ${problemZone.id}`);
            const result = await plugManager.turnOn(zoneDehumidifier.deviceId);
            console.log(`[allocator] [OK] ${zoneDehumidifier.name} activation result:`, result?.on ? 'ON' : result);
            
            // Log action detail for API
            lastActions[problemZone.id] = {
              timestamp: new Date().toISOString(),
              action: 'dehumidifier_on',
              device: zoneDehumidifier.name,
              state: 'ON',
              trigger: `high-rh-${problemZone.value.toFixed(1)}%`
            };
          } catch (error) {
            console.warn(`[allocator] Failed to activate ${zoneDehumidifier.name}:`, error.message);
          }
          
          // Activate circulation fan in the problem zone to distribute dehumidified air
          const zoneFan = fans.find(f => String(f.zone) === String(zoneNum));
          if (zoneFan) {
            try {
              console.log(`[allocator] → Activating circulation fan: ${zoneFan.name}`);
              const result = await plugManager.turnOn(zoneFan.deviceId);
              console.log(`[allocator] [OK] ${zoneFan.name} activation result:`, result?.on ? 'ON' : result);
              
              // Log action detail for API
              lastActions[`${problemZone.id}-fan`] = {
                timestamp: new Date().toISOString(),
                action: 'fan_on',
                device: zoneFan.name,
                state: 'ON',
                trigger: `circulation-for-zone-${zoneNum}`
              };
            } catch (error) {
              console.warn(`[allocator] Failed to activate ${zoneFan.name}:`, error.message);
            }
          }
          
          lastActions[key] = now;
          console.log(`[allocator] [STATS] ML will learn: How effective is Zone-${zoneNum} dehumidifier at reducing RH?`);
        } else {
          console.warn(`[allocator] No dehumidifier found for ${problemZone.id}`);
          
          // Fallback: If no zone-specific equipment, activate nearest/all
          const key = 'rh-high-fallback';
          if (!lastActions[key] || (now - lastActions[key]) > cooldown) {
            console.log(`[allocator] → Fallback: Activating all available dehumidifiers`);
            for (const device of dehumidifiers) {
              try {
                console.log(`[allocator] → Activating ${device.name}`);
                await plugManager.turnOn(device.deviceId);
              } catch (error) {
                console.warn(`[allocator] Failed to activate ${device.name}:`, error.message);
              }
            }
            lastActions[key] = now;
          }
        }
      }
    }
  }
  
  // LOW HUMIDITY: Deactivate dehumidifiers, activate humidifiers
  if (exceeded.rh.low && (dehumidifiers.length > 0 || humidifiers.length > 0)) {
    const key = 'rh-low';
    if (!lastActions[key] || (now - lastActions[key]) > cooldown) {
      console.log(`[allocator] [WATER] LOW RH detected (min: ${exceeded.rh.minValue.toFixed(1)}%)`);
      
      // Deactivate dehumidifiers
      for (const device of dehumidifiers) {
        try {
          await plugManager.turnOff(device.deviceId);
        } catch (error) {
          console.warn(`[allocator] Failed to deactivate ${device.name}:`, error.message);
        }
      }
      
      // Activate humidifiers
      for (const device of humidifiers) {
        try {
          console.log(`[allocator] → Activating humidifier: ${device.name}`);
          await plugManager.turnOn(device.deviceId);
        } catch (error) {
          console.warn(`[allocator] Failed to activate ${device.name}:`, error.message);
        }
      }
      
      lastActions[key] = now;
    }
  }
  
  // RH NORMAL: Deactivate humidity control equipment per zone
  if (!exceeded.rh.high && !exceeded.rh.low) {
    // All zones are within target - turn off all dehumidifiers
    console.log(`[allocator] [OK] All zones within RH targets - deactivating equipment`);
    
    // Reset escalation tracking
    if (lastActions._rhEscalation) {
      lastActions._rhEscalation.singleDehumidifierActive = false;
      lastActions._rhEscalation.startTime = null;
      lastActions._rhEscalation.startRH = null;
      console.log(`[allocator] [REFRESH] Reset escalation timer - RH normalized`);
    }
    
    for (const device of dehumidifiers) {
      try {
        const status = await plugManager.getStatus(device.deviceId);
        if (status?.on === true || status?.power === 'on') {
          console.log(`[allocator] → Deactivating ${device.name} (zone ${device.zone})`);
          const result = await plugManager.turnOff(device.deviceId);
          console.log(`[allocator] [OK] ${device.name} deactivation result:`, result?.on === false ? 'OFF' : result);
          
          // Log action detail for API
          lastActions[`zone-${device.zone}`] = {
            timestamp: new Date().toISOString(),
            action: 'dehumidifier_off',
            device: device.name,
            state: 'OFF',
            trigger: 'rh-normalized'
          };
        }
      } catch (error) {
        console.warn(`[allocator] Error checking/deactivating ${device.name}:`, error.message);
      }
    }
  } else if (exceeded.rh.high) {
    // Some zones still high, but check if individual zones have normalized
    for (const device of dehumidifiers) {
      const deviceZoneNum = String(device.zone);
      const deviceZoneId = `zone-${deviceZoneNum}`;
      
      // Check if this device's zone is still in the exceeded list
      const zoneStillHigh = exceeded.rh.zones.some(z => z.id === deviceZoneId);
      
      if (!zoneStillHigh) {
        // This zone normalized but others haven't
        try {
          const status = await plugManager.getStatus(device.deviceId);
          if (status?.on === true || status?.power === 'on') {
            console.log(`[allocator] [OK] ${deviceZoneId} normalized → Deactivating ${device.name}`);
            const result = await plugManager.turnOff(device.deviceId);
            console.log(`[allocator] [OK] ${device.name} deactivation result:`, result?.on === false ? 'OFF' : result);
          }
        } catch (error) {
          console.warn(`[allocator] Error checking/deactivating ${device.name}:`, error.message);
        }
      }
    }
  }
  
  // Temperature control (similar pattern)
  // TODO: Add heaters, coolers, exhaust fans
  
  // 5) Record data for ML learning
  // Log current state for effects learning (how equipment affects zones over time)
  const activeEquipment = [];
  for (const device of dehumidifiers) {
    try {
      const status = await plugManager.getStatus(device.deviceId);
      if (status?.on === true || status?.power === 'on') {
        activeEquipment.push({ type: 'dehumidifier', zone: device.zone, name: device.name });
      }
    } catch (e) {
      // Ignore status check errors
    }
  }
  
  if (activeEquipment.length > 0) {
    console.log(`[allocator] [STATS] ML Learning State: ${activeEquipment.length} device(s) active`);
    activeEquipment.forEach(eq => {
      console.log(`  - ${eq.type} in zone-${eq.zone}: "${eq.name}"`);
    });
    
    // Log current RH in all active zones for comparison in next cycle
    const rhSnapshot = {};
    for (const zoneId of activeZoneIds) {
      const zone = zones.find(z => z.id === zoneId);
      if (zone?.sensors?.rh?.current) {
        rhSnapshot[zoneId] = zone.sensors.rh.current;
      }
    }
    console.log(`[allocator] [STATS] RH Snapshot:`, JSON.stringify(rhSnapshot));
    
    // Store for ML effect analysis (effects-learner.py can read server logs)
    // Format: timestamp, equipment_state, zone_rh_values
    // ML will learn: "When Zone-1 dehumidifier runs, how much does Zone-3 RH change?"
  }
  
  console.log('[allocator] Control cycle complete');
}
