/**
 * Setup Agent Route -- /api/setup-agent
 *
 * Provides the backend intelligence for the AI-guided farm setup orchestrator.
 * Returns granular setup progress, phase-level detail, and contextual guidance
 * that EVIE uses to walk farmers through configuration step by step.
 *
 * Phases (12):
 *   1.  farm_profile    -- Business identity (name, contact, location, timezone)
 *   2.  grow_rooms      -- Physical room definitions
 *   3.  room_specs      -- Room dimensions, ceiling height, hydro system, HVAC
 *   4.  zones           -- Climate zones within rooms
 *   5.  groups          -- Grow groups (benches/racks) within zones
 *   6.  crop_assignment -- Crops assigned to groups with matching recipes
 *   7.  env_targets     -- Environment targets auto-derived from crop recipes
 *   8.  lights          -- Light fixtures registered and assigned
 *   9.  schedules       -- At least one active light schedule
 *   10. devices         -- IoT sensors/controllers paired
 *   11. planting        -- Active planting assignments exist
 *   12. integrations    -- External service credentials (SwitchBot, etc.)
 *
 * All data is read-only. Write operations go through EVIE's existing tools.
 */

import { Router } from 'express';
import farmStore from '../lib/farm-data-store.js';

const router = Router();

// -- Phase Definitions -------------------------------------------------------
const PHASES = [
  {
    id: 'farm_profile',
    label: 'Farm Profile',
    description: 'Business name, contact info, location, and timezone',
    weight: 10,
    order: 1,
    evie_prompt: 'I need to set up my farm profile. Walk me through it.',
    sidebar_target: 'farm-registration'
  },
  {
    id: 'grow_rooms',
    label: 'Grow Rooms',
    description: 'Define your physical growing spaces',
    weight: 10,
    order: 2,
    evie_prompt: 'Help me create my grow rooms.',
    sidebar_target: 'grow-rooms'
  },
  {
    id: 'room_specs',
    label: 'Room Specifications',
    description: 'Room dimensions, ceiling height, hydroponic system type, and HVAC',
    weight: 8,
    order: 3,
    evie_prompt: 'I need to add dimensions and specs to my rooms so we can build the farm layout.',
    sidebar_target: 'grow-rooms'
  },
  {
    id: 'zones',
    label: 'Climate Zones',
    description: 'Divide rooms into independently controlled zones',
    weight: 10,
    order: 4,
    evie_prompt: 'I need to set up zones in my rooms. Guide me through it.',
    sidebar_target: 'grow-rooms'
  },
  {
    id: 'groups',
    label: 'Grow Groups',
    description: 'Organize trays and benches into manageable groups',
    weight: 8,
    order: 5,
    evie_prompt: 'Help me create grow groups for my zones.',
    sidebar_target: 'groups-v2'
  },
  {
    id: 'crop_assignment',
    label: 'Crop Selection',
    description: 'Assign crops to groups -- recipes auto-set environment targets',
    weight: 10,
    order: 6,
    evie_prompt: 'What crops should I grow? Help me assign crops to my groups.',
    sidebar_target: 'groups-v2'
  },
  {
    id: 'env_targets',
    label: 'Environment Targets',
    description: 'Auto-derived from crop recipes -- temperature, humidity, VPD, EC, pH',
    weight: 10,
    order: 7,
    evie_prompt: 'Show me the environment targets derived from my crop selections.',
    sidebar_target: 'grow-rooms'
  },
  {
    id: 'lights',
    label: 'Light Fixtures',
    description: 'Register and assign light fixtures to groups',
    weight: 8,
    order: 8,
    evie_prompt: 'I need to set up my lights. What should I do?',
    sidebar_target: 'light-setup'
  },
  {
    id: 'schedules',
    label: 'Light Schedules',
    description: 'Create photoperiod schedules for your crops',
    weight: 7,
    order: 9,
    evie_prompt: 'Help me create a light schedule for my crops.',
    sidebar_target: 'groups-v2'
  },
  {
    id: 'devices',
    label: 'IoT Devices',
    description: 'Pair sensors and controllers for environment monitoring',
    weight: 7,
    order: 10,
    evie_prompt: 'I want to connect my sensors and devices.',
    sidebar_target: 'iot-devices'
  },
  {
    id: 'planting',
    label: 'Planting Plan',
    description: 'Create active planting assignments for your groups',
    weight: 7,
    order: 11,
    evie_prompt: 'Help me create my first planting plan.',
    sidebar_target: 'groups-v2'
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Connect external services (SwitchBot, payment processing)',
    weight: 5,
    order: 12,
    evie_prompt: 'Walk me through setting up my integrations.',
    sidebar_target: 'integrations'
  }
];

// -- Progress Evaluation -----------------------------------------------------

async function evaluatePhase(phaseId, farmId) {
  const result = { complete: false, items: [], detail: '', count: 0 };

  try {
    switch (phaseId) {
      case 'farm_profile': {
        const profile = await farmStore.get(farmId, 'farm_profile') || {};
        const hasName = !!(profile.name || profile.farm_name);
        const hasContact = !!(profile.contact?.name || profile.contact_name);
        const hasLocation = !!(profile.location?.city || profile.city);
        result.items = [
          { label: 'Farm name', done: hasName },
          { label: 'Contact info', done: hasContact },
          { label: 'Location', done: hasLocation }
        ];
        result.count = result.items.filter(i => i.done).length;
        result.complete = hasName && hasContact;
        result.detail = result.complete
          ? `${profile.name || profile.farm_name}`
          : 'Farm identity not configured';
        break;
      }

      case 'grow_rooms': {
        const rooms = await farmStore.get(farmId, 'rooms') || [];
        result.count = rooms.length;
        result.complete = rooms.length > 0;
        result.items = rooms.map(r => ({
          label: r.name || r.room_name || `Room ${r.id}`,
          done: true
        }));
        result.detail = result.complete
          ? `${rooms.length} room${rooms.length !== 1 ? 's' : ''} configured`
          : 'No grow rooms defined';
        break;
      }

      case 'room_specs': {
        const rooms = await farmStore.get(farmId, 'rooms') || [];
        let specsComplete = 0;
        const items = [];
        for (const r of rooms) {
          const hasDims = !!(r.dimensions || (r.length_m && r.width_m) || r.area_m2);
          const hasCeiling = !!(r.ceiling_height_m);
          const hasHydro = !!(r.hydro_system);
          const roomDone = hasDims && hasCeiling;
          if (roomDone) specsComplete++;
          items.push({
            label: `${r.name || r.room_name || 'Room'}: ${hasDims ? 'dims' : 'no dims'}, ${hasCeiling ? 'ceiling' : 'no ceiling'}, ${hasHydro ? r.hydro_system : 'no hydro'}`,
            done: roomDone
          });
        }
        result.items = items;
        result.count = specsComplete;
        result.complete = rooms.length > 0 && specsComplete === rooms.length;
        result.detail = result.complete
          ? `All ${rooms.length} room${rooms.length !== 1 ? 's have' : ' has'} dimensions and specs`
          : rooms.length === 0
            ? 'Create rooms first, then add dimensions'
            : `${specsComplete}/${rooms.length} room${rooms.length !== 1 ? 's' : ''} have full specs`;
        break;
      }

      case 'zones': {
        const rooms = await farmStore.get(farmId, 'rooms') || [];
        const groups = await farmStore.get(farmId, 'groups') || [];
        const zonesSet = new Set();
        groups.forEach(g => {
          if (g.zone || g.zone_name) zonesSet.add(g.zone || g.zone_name);
        });
        rooms.forEach(r => {
          if (r.zones && Array.isArray(r.zones)) {
            r.zones.forEach(z => zonesSet.add(z.name || z));
          }
        });
        result.count = zonesSet.size;
        result.complete = zonesSet.size > 0 && rooms.length > 0;
        result.items = Array.from(zonesSet).map(z => ({ label: z, done: true }));
        result.detail = result.complete
          ? `${zonesSet.size} zone${zonesSet.size !== 1 ? 's' : ''} across ${rooms.length} room${rooms.length !== 1 ? 's' : ''}`
          : 'No zones configured';
        break;
      }

      case 'groups': {
        const groups = await farmStore.get(farmId, 'groups') || [];
        result.count = groups.length;
        result.complete = groups.length > 0;
        const sample = groups.slice(0, 8);
        result.items = sample.map(g => ({
          label: g.name || g.group_name || `Group ${g.id}`,
          done: true
        }));
        if (groups.length > 8) {
          result.items.push({ label: `+${groups.length - 8} more`, done: true });
        }
        result.detail = result.complete
          ? `${groups.length} group${groups.length !== 1 ? 's' : ''} configured`
          : 'No grow groups created';
        break;
      }

      case 'crop_assignment': {
        const groups = await farmStore.get(farmId, 'groups') || [];
        let withCrop = 0;
        const items = [];
        for (const g of groups) {
          const hasCrop = !!(g.crop || g.crop_name || g.crop_id || g.assigned_crop);
          if (hasCrop) withCrop++;
          items.push({
            label: `${g.name || g.group_name || 'Group'}: ${hasCrop ? (g.crop || g.crop_name || g.assigned_crop) : 'no crop'}`,
            done: hasCrop
          });
        }
        result.items = items.slice(0, 10);
        result.count = withCrop;
        result.complete = groups.length > 0 && withCrop > 0;
        result.detail = result.complete
          ? `${withCrop} of ${groups.length} group${groups.length !== 1 ? 's' : ''} have crops assigned`
          : groups.length === 0
            ? 'Create groups first, then assign crops'
            : 'No crops assigned to groups';
        break;
      }

      case 'env_targets': {
        const rooms = await farmStore.get(farmId, 'rooms') || [];
        let zonesWithTargets = 0;
        let totalZones = 0;
        const items = [];

        for (const r of rooms) {
          if (r.zones && Array.isArray(r.zones)) {
            for (const z of r.zones) {
              totalZones++;
              const hasTargets = !!(z.targets || z.env_targets || z.temp_min != null || z.target_temp != null);
              if (hasTargets) zonesWithTargets++;
              items.push({
                label: `${z.name || z.id || 'Zone'}: ${hasTargets ? 'targets set' : 'no targets'}`,
                done: hasTargets
              });
            }
          }
        }

        try {
          const targetRanges = await farmStore.get(farmId, 'target_ranges') || {};
          const zoneTargets = targetRanges.zones || {};
          const configuredZones = Object.keys(zoneTargets).length;
          if (configuredZones > 0 && zonesWithTargets === 0) {
            zonesWithTargets = configuredZones;
            for (const [zid] of Object.entries(zoneTargets)) {
              items.push({ label: `Zone ${zid}: targets set (from recipes)`, done: true });
            }
          }
        } catch { /* non-fatal */ }

        result.items = items.slice(0, 10);
        result.count = zonesWithTargets;
        result.complete = zonesWithTargets > 0;
        result.detail = result.complete
          ? `${zonesWithTargets} zone${zonesWithTargets !== 1 ? 's' : ''} have recipe-derived targets`
          : totalZones === 0
            ? 'Create zones and assign crops first -- targets auto-derive from recipes'
            : 'No environment targets set -- assign crops to auto-derive from recipes';
        break;
      }

      case 'lights': {
        const groups = await farmStore.get(farmId, 'groups') || [];
        let totalLights = 0;
        let assignedLights = 0;
        groups.forEach(g => {
          if (g.lights && Array.isArray(g.lights)) {
            totalLights += g.lights.length;
            assignedLights += g.lights.filter(l => l.assigned || l.group_id).length;
          }
          if (g.light || g.light_id) assignedLights++;
        });
        result.count = totalLights;
        result.complete = totalLights > 0;
        result.items = [
          { label: `${totalLights} fixture${totalLights !== 1 ? 's' : ''} registered`, done: totalLights > 0 },
          { label: `${assignedLights} assigned to groups`, done: assignedLights > 0 }
        ];
        result.detail = result.complete
          ? `${totalLights} light${totalLights !== 1 ? 's' : ''}, ${assignedLights} assigned`
          : 'No lights registered';
        break;
      }

      case 'schedules': {
        const groups = await farmStore.get(farmId, 'groups') || [];
        let withSchedule = 0;
        groups.forEach(g => {
          if (g.schedule || g.light_schedule || (g.schedules && g.schedules.length > 0)) {
            withSchedule++;
          }
        });
        result.count = withSchedule;
        result.complete = withSchedule > 0;
        result.items = [
          { label: `${withSchedule} group${withSchedule !== 1 ? 's' : ''} with schedules`, done: withSchedule > 0 }
        ];
        result.detail = result.complete
          ? `${withSchedule} active schedule${withSchedule !== 1 ? 's' : ''}`
          : 'No light schedules configured';
        break;
      }

      case 'devices': {
        const profile = await farmStore.get(farmId, 'farm_profile') || {};
        const devices = profile.devices || [];
        const paired = devices.filter(d => d.paired || d.status === 'active');
        result.count = devices.length;
        result.complete = devices.length > 0;
        result.items = [
          { label: `${devices.length} device${devices.length !== 1 ? 's' : ''} registered`, done: devices.length > 0 },
          { label: `${paired.length} actively paired`, done: paired.length > 0 }
        ];
        result.detail = result.complete
          ? `${devices.length} device${devices.length !== 1 ? 's' : ''}, ${paired.length} active`
          : 'No IoT devices paired';
        break;
      }

      case 'planting': {
        const groups = await farmStore.get(farmId, 'groups') || [];
        let withPlanting = 0;
        const items = [];
        for (const g of groups) {
          const hasPlanting = !!(g.planting || g.planting_id || g.active_planting || g.planted_at);
          if (hasPlanting) withPlanting++;
          items.push({
            label: `${g.name || g.group_name || 'Group'}: ${hasPlanting ? 'planted' : 'not planted'}`,
            done: hasPlanting
          });
        }
        result.items = items.slice(0, 10);
        result.count = withPlanting;
        result.complete = withPlanting > 0;
        result.detail = result.complete
          ? `${withPlanting} group${withPlanting !== 1 ? 's' : ''} have active plantings`
          : groups.length === 0
            ? 'Create groups and assign crops first'
            : 'No active plantings -- create a planting plan to start growing';
        break;
      }

      case 'integrations': {
        const profile = await farmStore.get(farmId, 'farm_profile') || {};
        const integrations = profile.integrations || {};
        const configured = Object.entries(integrations).filter(([, v]) => {
          if (typeof v === 'object' && v !== null) return v.token || v.api_key || v.enabled;
          return !!v;
        });
        result.count = configured.length;
        result.complete = configured.length > 0;
        result.items = configured.map(([key]) => ({
          label: key.charAt(0).toUpperCase() + key.slice(1),
          done: true
        }));
        if (configured.length === 0) {
          result.items = [{ label: 'No integrations configured', done: false }];
        }
        result.detail = result.complete
          ? `${configured.length} integration${configured.length !== 1 ? 's' : ''} active`
          : 'No integrations configured';
        break;
      }
    }
  } catch (err) {
    result.detail = `Error checking ${phaseId}: ${err.message}`;
  }

  return result;
}

// -- GET /api/setup-agent/progress -------------------------------------------
router.get('/progress', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'] || req.query.farmId;
    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'Missing farm ID' });
    }

    const phases = [];
    let totalWeight = 0;
    let completedWeight = 0;

    for (const phase of PHASES) {
      const evaluation = await evaluatePhase(phase.id, farmId);
      const phaseResult = {
        id: phase.id,
        label: phase.label,
        description: phase.description,
        order: phase.order,
        weight: phase.weight,
        sidebar_target: phase.sidebar_target,
        evie_prompt: phase.evie_prompt,
        ...evaluation
      };
      phases.push(phaseResult);
      totalWeight += phase.weight;
      if (evaluation.complete) completedWeight += phase.weight;
    }

    const nextPhase = phases.find(p => !p.complete);
    const percentage = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
    const completedCount = phases.filter(p => p.complete).length;

    res.json({
      ok: true,
      percentage,
      completed: completedCount,
      total: phases.length,
      phases,
      next_phase: nextPhase ? {
        id: nextPhase.id,
        label: nextPhase.label,
        evie_prompt: nextPhase.evie_prompt,
        sidebar_target: nextPhase.sidebar_target
      } : null,
      all_complete: completedCount === phases.length
    });
  } catch (err) {
    console.error('[SetupAgent] Progress check failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to check setup progress' });
  }
});

// -- GET /api/setup-agent/guidance/:phaseId ----------------------------------
router.get('/guidance/:phaseId', async (req, res) => {
  try {
    const farmId = req.farmId || req.headers['x-farm-id'] || req.query.farmId;
    const { phaseId } = req.params;

    if (!farmId) {
      return res.status(400).json({ ok: false, error: 'Missing farm ID' });
    }

    const phase = PHASES.find(p => p.id === phaseId);
    if (!phase) {
      return res.status(404).json({ ok: false, error: `Unknown phase: ${phaseId}` });
    }

    const evaluation = await evaluatePhase(phaseId, farmId);

    const guidance = {
      phase: {
        id: phase.id,
        label: phase.label,
        description: phase.description,
        order: phase.order,
        sidebar_target: phase.sidebar_target
      },
      status: evaluation,
      steps: getPhaseSteps(phaseId, evaluation),
      evie_prompt: phase.evie_prompt
    };

    res.json({ ok: true, ...guidance });
  } catch (err) {
    console.error('[SetupAgent] Guidance generation failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to generate guidance' });
  }
});

// -- Phase-specific step guidance --------------------------------------------

function getPhaseSteps(phaseId, evaluation) {
  const steps = {
    farm_profile: [
      { action: 'Set your farm name', tool: 'update_farm_profile', done: evaluation.items?.[0]?.done },
      { action: 'Add contact information (name, phone, email)', tool: 'update_farm_profile', done: evaluation.items?.[1]?.done },
      { action: 'Set your location (city, province, timezone)', tool: 'update_farm_profile', done: evaluation.items?.[2]?.done }
    ],
    grow_rooms: [
      { action: 'Create your first grow room', tool: 'create_room', done: evaluation.count > 0 },
      { action: 'Add additional rooms as needed', tool: 'create_room', done: evaluation.count > 1 }
    ],
    room_specs: [
      { action: 'Tell EVIE your room dimensions (length x width in meters)', tool: 'update_room_specs', done: false },
      { action: 'Specify ceiling height', tool: 'update_room_specs', done: false },
      { action: 'Select your hydroponic system type', tool: 'update_room_specs', done: false },
      { action: 'Indicate HVAC type (mini-split, portable, central, or none)', tool: 'update_room_specs', done: false }
    ],
    zones: [
      { action: 'Define zones within each room', tool: 'create_zone', done: evaluation.count > 0 },
      { action: 'Each zone should represent an independently controlled climate area', tool: 'create_zone', done: evaluation.count > 1 }
    ],
    groups: [
      { action: 'Create grow groups (benches, racks, or trays)', tool: 'Use Groups V2 panel', done: evaluation.count > 0 },
      { action: 'Assign groups to rooms and zones', tool: 'Use Groups V2 panel', done: evaluation.count > 0 }
    ],
    crop_assignment: [
      { action: 'Tell EVIE which crops you want to grow', tool: 'assign_crop_to_group', done: evaluation.count > 0 },
      { action: 'EVIE will match crops to recipes and auto-set environment targets', tool: 'get_crop_recipe_targets', done: evaluation.count > 0 }
    ],
    env_targets: [
      { action: 'Environment targets auto-derive from crop recipes when crops are assigned', tool: 'apply_crop_environment', done: evaluation.count > 0 },
      { action: 'Review targets with EVIE -- she can show what the recipe calls for', tool: 'get_crop_recipe_targets', done: evaluation.count > 0 }
    ],
    lights: [
      { action: 'Register your light fixtures', tool: 'Use Light Setup panel', done: evaluation.items?.[0]?.done },
      { action: 'Assign lights to grow groups', tool: 'Use Groups V2 panel', done: evaluation.items?.[1]?.done }
    ],
    schedules: [
      { action: 'Create a light schedule for your crops', tool: 'set_light_schedule', done: evaluation.count > 0 },
      { action: 'Assign schedules to groups via Groups V2', tool: 'Use Groups V2 panel', done: evaluation.count > 0 }
    ],
    devices: [
      { action: 'Run a device scan to discover sensors', tool: 'scan_devices', done: evaluation.items?.[0]?.done },
      { action: 'Register and pair discovered devices', tool: 'register_device', done: evaluation.items?.[1]?.done }
    ],
    planting: [
      { action: 'Create a planting plan (EVIE can help based on your crops)', tool: 'create_planting_assignment', done: evaluation.count > 0 },
      { action: 'Assign planting dates and targets to groups', tool: 'create_planting_assignment', done: evaluation.count > 0 }
    ],
    integrations: [
      { action: 'Configure SwitchBot credentials for sensor data', tool: 'Use Integrations panel', done: evaluation.items?.[0]?.done || false },
      { action: 'Set up payment processing (optional)', tool: 'Use Payment Setup wizard', done: evaluation.items?.[1]?.done || false }
    ]
  };

  return steps[phaseId] || [];
}

export default router;
