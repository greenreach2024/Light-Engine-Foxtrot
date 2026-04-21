/**
 * Setup Agent Route -- /api/setup-agent
 *
 * Provides the backend intelligence for the AI-guided farm setup orchestrator.
 * Returns granular setup progress, phase-level detail, and contextual guidance
 * that EVIE uses to walk farmers through configuration step by step.
 *
 * Phase ordering follows the unified farm-flow: Room -> Zones -> Grow Units ->
 * Lights -> Equipment -> Controllers (steps 2-7). farm_profile is the
 * prerequisite (step 1); crop/env/scheduling/planting/integrations are
 * post-setup operations (steps 8-12) that live in the Crop Scheduler / Evie
 * experience, not in the initial build-out flow.
 *
 *   category: 'setup'      -- required to finish initial farm build-out
 *     1. farm_profile    Business identity (name, contact, location, timezone)
 *     2. room_design     Room shell + dimensions + grow-system templates
 *     3. zones           Climate zones within rooms
 *     4. groups          Grow units (racks/benches/trays) -- installedSystems[]
 *     5. lights          Light fixtures registered and assigned
 *     6. build_plan      Equipment plan: lighting kW, HVAC, pumps, controllers
 *     7. devices         Controllers: IoT sensors + actuators paired
 *
 *   category: 'operations' -- post-setup, owned by Crop Scheduler + Evie
 *     8.  crop_assignment Crops assigned to groups with matching recipes
 *     9.  env_targets     Environment targets auto-derived from crop recipes
 *     10. schedules       Photoperiod schedules (Crop Scheduler owns this now)
 *     11. planting        Active planting assignments (Crop Scheduler owns)
 *     12. integrations    External service credentials (SwitchBot, etc.)
 *
 * Each setup phase exposes a `flow_anchor` hint so the orchestrator can scroll
 * the unified farm-flow breadcrumb (in grow-management.html) to the matching
 * step after navigating the sidebar panel.
 *
 * All data is read-only. Write operations go through EVIE's existing tools.
 *
 * Phase evolution log:
 *   2026-04-20: Merged grow_rooms + room_specs into room_design (template-aware).
 *               Added build_plan phase.
 *   2026-04-21: Realigned phase order + labels to the Room -> Controllers
 *               farm-flow. Added `category` and `flow_anchor`. Operations
 *               phases deprioritised now that the Crop Scheduler owns them.
 */

import { Router } from 'express';
import farmStore from '../lib/farm-data-store.js';

const router = Router();

// -- Phase Definitions -------------------------------------------------------
// Declaration order matches phase.order so /progress can iterate the array
// without re-sorting. Categories let the orchestrator render a visual divider
// between the setup funnel (1-7) and the operations phases (8-12).
const PHASES = [
  // ---- Setup funnel: Room -> Zones -> Grow Units -> Lights -> Equipment -> Controllers
  {
    id: 'farm_profile',
    label: 'Farm Profile',
    description: 'Business name, contact info, location, and timezone',
    weight: 10,
    order: 1,
    category: 'setup',
    evie_prompt: 'I need to set up my farm profile. Walk me through it.',
    sidebar_target: 'farm-registration',
    flow_anchor: null
  },
  {
    id: 'room_design',
    label: 'Room',
    description: 'Create rooms and set dimensions (length x width x height)',
    weight: 12,
    order: 2,
    category: 'setup',
    evie_prompt: 'Help me design my grow rooms -- I need to set room dimensions and pick a grow-system template.',
    sidebar_target: 'groups-v2',
    flow_anchor: 'flow-room'
  },
  {
    id: 'zones',
    label: 'Zones',
    description: 'Divide each room into independently controlled climate zones',
    weight: 10,
    order: 3,
    category: 'setup',
    evie_prompt: 'How many zones should this room have? Guide me through zoning.',
    sidebar_target: 'groups-v2',
    flow_anchor: 'flow-zones'
  },
  {
    id: 'groups',
    label: 'Grow Units',
    description: 'Select grow-system templates and the number of units per zone',
    weight: 12,
    order: 4,
    category: 'setup',
    evie_prompt: 'Help me pick the right grow-system template and how many units fit in each zone.',
    sidebar_target: 'groups-v2',
    flow_anchor: 'flow-grow-units'
  },
  {
    id: 'lights',
    label: 'Lights',
    description: 'Register and assign light fixtures to each grow unit',
    weight: 8,
    order: 5,
    category: 'setup',
    evie_prompt: 'I need to set up my lights. What should I do?',
    sidebar_target: 'groups-v2',
    flow_anchor: 'flow-lights'
  },
  {
    id: 'build_plan',
    label: 'Equipment',
    description: 'Accept the computed equipment plan -- HVAC, pumps, fans, controllers',
    weight: 8,
    order: 6,
    category: 'setup',
    evie_prompt: 'Compute my equipment plan from the room templates so I know what I need to buy or install.',
    sidebar_target: 'groups-v2',
    flow_anchor: 'flow-equipment'
  },
  {
    id: 'devices',
    label: 'Controllers',
    description: 'Pair controllers and sensors that drive the accepted equipment plan',
    weight: 8,
    order: 7,
    category: 'setup',
    evie_prompt: 'Walk me through pairing my controllers and sensors for this farm.',
    sidebar_target: 'groups-v2',
    flow_anchor: 'flow-controllers'
  },
  // ---- Operations: owned by Crop Scheduler + Evie after setup completes
  {
    id: 'crop_assignment',
    label: 'Crop Selection',
    description: 'Assign crops to groups -- recipes auto-set environment targets',
    weight: 10,
    order: 8,
    category: 'operations',
    evie_prompt: 'What crops should I grow? Help me assign crops to my groups.',
    sidebar_target: 'groups-v2',
    flow_anchor: null
  },
  {
    id: 'env_targets',
    label: 'Environment Targets',
    description: 'Auto-derived from crop recipes -- temperature, humidity, VPD, EC, pH',
    weight: 6,
    order: 9,
    category: 'operations',
    evie_prompt: 'Show me the environment targets derived from my crop selections.',
    sidebar_target: 'groups-v2',
    flow_anchor: null
  },
  {
    id: 'schedules',
    label: 'Light Schedules',
    description: 'Photoperiod schedules -- now managed in the Crop Scheduler',
    weight: 5,
    order: 10,
    category: 'operations',
    evie_prompt: 'Help me create a light schedule for my crops in the Crop Scheduler.',
    sidebar_target: 'groups-v2',
    flow_anchor: null
  },
  {
    id: 'planting',
    label: 'Planting Plan',
    description: 'Active planting assignments -- now managed in the Crop Scheduler',
    weight: 5,
    order: 11,
    category: 'operations',
    evie_prompt: 'Help me create my first planting plan in the Crop Scheduler.',
    sidebar_target: 'groups-v2',
    flow_anchor: null
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Connect external services (SwitchBot, payment processing)',
    weight: 4,
    order: 12,
    category: 'operations',
    evie_prompt: 'Walk me through setting up my integrations.',
    sidebar_target: 'integrations',
    flow_anchor: null
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

      // -- room_design: merged grow_rooms + room_specs + template selection --
      case 'room_design': {
        const rooms = await farmStore.get(farmId, 'rooms') || [];
        const items = [];
        let roomsWithSpecs = 0;
        let roomsWithTemplates = 0;

        for (const r of rooms) {
          const roomName = r.name || r.room_name || `Room ${r.id}`;
          const hasDims = !!(r.dimensions || (r.length_m && r.width_m) || r.area_m2);
          const hasCeiling = !!(r.ceiling_height_m);
          const hasTemplates = Array.isArray(r.installedSystems) && r.installedSystems.length > 0;
          const specsOk = hasDims && hasCeiling;
          if (specsOk) roomsWithSpecs++;
          if (hasTemplates) roomsWithTemplates++;

          const parts = [];
          parts.push(hasDims ? 'dims' : 'no dims');
          parts.push(hasCeiling ? 'ceiling' : 'no ceiling');
          parts.push(hasTemplates
            ? `${r.installedSystems.length} template${r.installedSystems.length !== 1 ? 's' : ''}`
            : 'no templates');
          items.push({ label: `${roomName}: ${parts.join(', ')}`, done: specsOk });
        }

        if (rooms.length === 0) {
          items.push({ label: 'No rooms created', done: false });
        }

        // Summary items for overall tracking
        const summaryItems = [
          { label: `${rooms.length} room${rooms.length !== 1 ? 's' : ''} created`, done: rooms.length > 0 },
          { label: `${roomsWithSpecs}/${rooms.length} with dimensions`, done: rooms.length > 0 && roomsWithSpecs === rooms.length },
          { label: `${roomsWithTemplates}/${rooms.length} with grow-system templates`, done: roomsWithTemplates > 0 }
        ];

        result.items = [...summaryItems, ...items];
        result.count = roomsWithSpecs;
        // Complete when rooms exist and all have dimensions + ceiling.
        // Templates are tracked but not blocking -- existing farms can progress.
        result.complete = rooms.length > 0 && roomsWithSpecs === rooms.length;
        result.detail = result.complete
          ? roomsWithTemplates > 0
            ? `All ${rooms.length} room${rooms.length !== 1 ? 's' : ''} designed, ${roomsWithTemplates} with templates`
            : `All ${rooms.length} room${rooms.length !== 1 ? 's have' : ' has'} dimensions -- add grow-system templates to unlock the build plan`
          : rooms.length === 0
            ? 'Create your first grow room to get started'
            : `${roomsWithSpecs}/${rooms.length} room${rooms.length !== 1 ? 's' : ''} have full specs`;
        break;
      }

      // -- build_plan: checks for agent-computed load math on rooms ----------
      case 'build_plan': {
        const rooms = await farmStore.get(farmId, 'rooms') || [];
        let withPlan = 0;
        const items = [];

        for (const r of rooms) {
          const roomName = r.name || r.room_name || `Room ${r.id}`;
          const hasPlan = !!(r.buildPlan || r.build_plan);
          const hasTemplates = Array.isArray(r.installedSystems) && r.installedSystems.length > 0;
          if (hasPlan) withPlan++;
          items.push({
            label: `${roomName}: ${hasPlan ? 'build plan computed' : hasTemplates ? 'templates set, plan not computed' : 'no templates assigned'}`,
            done: hasPlan
          });
        }

        if (rooms.length === 0) {
          items.push({ label: 'Create rooms and add templates first', done: false });
        }

        result.items = items;
        result.count = withPlan;
        result.complete = rooms.length > 0 && withPlan > 0;
        result.detail = result.complete
          ? `${withPlan} room${withPlan !== 1 ? 's have' : ' has'} a computed build plan`
          : rooms.length === 0
            ? 'Design rooms with templates first, then compute the build plan'
            : 'No build plans computed -- ask EVIE to run the load calculator on your rooms';
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

      // Backwards compat: old phase IDs still resolve gracefully
      case 'grow_rooms':
      case 'room_specs': {
        return evaluatePhase('room_design', farmId);
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
        category: phase.category || 'setup',
        sidebar_target: phase.sidebar_target,
        flow_anchor: phase.flow_anchor || null,
        evie_prompt: phase.evie_prompt,
        ...evaluation
      };
      phases.push(phaseResult);
      totalWeight += phase.weight;
      if (evaluation.complete) completedWeight += phase.weight;
    }

    // Prefer the next incomplete *setup* phase so the orchestrator keeps
    // steering the operator through Room -> Controllers before suggesting
    // crop assignment / schedules (which live in the Crop Scheduler).
    const setupPhases = phases.filter(p => p.category === 'setup');
    const opsPhases   = phases.filter(p => p.category === 'operations');
    const nextPhase   = setupPhases.find(p => !p.complete) || phases.find(p => !p.complete);

    const setupCompleted = setupPhases.filter(p => p.complete).length;
    const setupComplete  = setupPhases.length > 0 && setupCompleted === setupPhases.length;

    const percentage = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
    const completedCount = phases.filter(p => p.complete).length;

    res.json({
      ok: true,
      percentage,
      completed: completedCount,
      total: phases.length,
      setup: {
        completed: setupCompleted,
        total: setupPhases.length,
        complete: setupComplete
      },
      operations: {
        completed: opsPhases.filter(p => p.complete).length,
        total: opsPhases.length
      },
      phases,
      next_phase: nextPhase ? {
        id: nextPhase.id,
        label: nextPhase.label,
        category: nextPhase.category,
        evie_prompt: nextPhase.evie_prompt,
        sidebar_target: nextPhase.sidebar_target,
        flow_anchor: nextPhase.flow_anchor
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
      // Check for legacy phase IDs
      if (phaseId === 'grow_rooms' || phaseId === 'room_specs') {
        const remapped = PHASES.find(p => p.id === 'room_design');
        const evaluation = await evaluatePhase('room_design', farmId);
        return res.json({
          ok: true,
          phase: {
            id: remapped.id,
            label: remapped.label,
            description: remapped.description,
            order: remapped.order,
            sidebar_target: remapped.sidebar_target
          },
          status: evaluation,
          steps: getPhaseSteps('room_design', evaluation),
          evie_prompt: remapped.evie_prompt,
          _note: `Phase "${phaseId}" has been merged into "room_design"`
        });
      }
      return res.status(404).json({ ok: false, error: `Unknown phase: ${phaseId}` });
    }

    const evaluation = await evaluatePhase(phaseId, farmId);

    const guidance = {
      phase: {
        id: phase.id,
        label: phase.label,
        description: phase.description,
        order: phase.order,
        category: phase.category || 'setup',
        sidebar_target: phase.sidebar_target,
        flow_anchor: phase.flow_anchor || null
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
    // Step 2 of the farm-flow. Room shell only -- template selection moved
    // into `groups` (Grow Units). This keeps each farm-flow step focused.
    room_design: [
      { action: 'Create your first grow room', tool: 'create_room', done: evaluation.items?.[0]?.done },
      { action: 'Set room dimensions (length x width in meters)', tool: 'update_room_specs', done: evaluation.items?.[1]?.done },
      { action: 'Set ceiling height', tool: 'update_room_specs', done: evaluation.items?.[1]?.done }
    ],
    // Step 3 of the farm-flow. Evie recommends a zone count based on the
    // grow-system template + total unit count (see Room Build Plan advisory).
    zones: [
      { action: 'Let Evie recommend a zone count for your template + unit count', tool: 'recommend_zone_count', done: evaluation.count > 0 },
      { action: 'Create each zone with its own dimensions', tool: 'create_zone', done: evaluation.count > 0 },
      { action: 'Use zones to stagger photoperiods, cleaning, and recipes', tool: 'create_zone', done: evaluation.count > 1 }
    ],
    // Step 4 of the farm-flow. installedSystems[] on each room carries the
    // selected template + unit count that drives the Room Build Plan and the
    // 3D viewer spatial layout.
    groups: [
      { action: 'Pick a grow-system template (NFT, DWC, Microgreen, Aeroponics, ZipGrow, Drip Rail)', tool: 'assign_grow_system', done: evaluation.count > 0 },
      { action: 'Set the number of units per zone (or let the solver auto-fit)', tool: 'assign_grow_system', done: evaluation.count > 0 },
      { action: 'Confirm the 3D viewer shows no overflow (red strips)', tool: 'open_3d_viewer', done: evaluation.count > 0 }
    ],
    // Step 5 of the farm-flow. Fixtures now flow from the template's
    // defaultFixtureClass and are assignable per group inside the Grow Units
    // step; the Light Setup panel is still the canonical surface for catalog
    // edits and per-fixture tuning.
    lights: [
      { action: 'Accept the template\'s default fixture class (or override)', tool: 'assign_fixture_class', done: evaluation.items?.[0]?.done },
      { action: 'Assign fixtures to each grow unit', tool: 'Use Groups V2 panel', done: evaluation.items?.[1]?.done }
    ],
    // Step 6 of the farm-flow. Uses the persisted rooms[].buildPlan from
    // /api/setup/save-rooms (PR #59) so reloads don\'t recompute.
    build_plan: [
      { action: 'Ensure every room has templates + unit counts assigned', tool: 'assign_grow_system', done: evaluation.count > 0 || false },
      { action: 'Let Evie compute the equipment plan (lighting kW, HVAC, pumps, fans, controllers)', tool: 'compute_build_plan', done: evaluation.count > 0 },
      { action: 'Accept the plan to persist it to rooms[].buildPlan', tool: 'accept_build_plan', done: evaluation.count > 0 }
    ],
    // Step 7 of the farm-flow. Phase B device binding surfaces live here;
    // controller slots reserved in the build plan pair against discovered
    // SwitchBot / Kasa / Code3 devices.
    devices: [
      { action: 'Run a device scan to discover controllers and sensors', tool: 'scan_devices', done: evaluation.items?.[0]?.done },
      { action: 'Pair each device with the controller slot it drives', tool: 'register_device', done: evaluation.items?.[1]?.done }
    ],
    // ---- Operations phases: post-setup, owned by Crop Scheduler + Evie
    crop_assignment: [
      { action: 'Tell EVIE which crops you want to grow', tool: 'assign_crop_to_group', done: evaluation.count > 0 },
      { action: 'EVIE will match crops to recipes and auto-set environment targets', tool: 'get_crop_recipe_targets', done: evaluation.count > 0 }
    ],
    env_targets: [
      { action: 'Environment targets auto-derive from crop recipes when crops are assigned', tool: 'apply_crop_environment', done: evaluation.count > 0 },
      { action: 'Review targets with EVIE -- she can show what the recipe calls for', tool: 'get_crop_recipe_targets', done: evaluation.count > 0 }
    ],
    schedules: [
      { action: 'Open the Crop Scheduler to create a photoperiod schedule', tool: 'Use Crop Scheduler', done: evaluation.count > 0 },
      { action: 'Assign the schedule to groups from the Crop Scheduler', tool: 'Use Crop Scheduler', done: evaluation.count > 0 }
    ],
    planting: [
      { action: 'Open the Crop Scheduler to create a planting plan', tool: 'Use Crop Scheduler', done: evaluation.count > 0 },
      { action: 'EVIE can propose planting dates and harvest windows from your crops', tool: 'Use Crop Scheduler', done: evaluation.count > 0 }
    ],
    integrations: [
      { action: 'Configure SwitchBot credentials for sensor data', tool: 'Use Integrations panel', done: evaluation.items?.[0]?.done || false },
      { action: 'Set up payment processing (optional)', tool: 'Use Payment Setup wizard', done: evaluation.items?.[1]?.done || false }
    ]
  };

  return steps[phaseId] || [];
}

export default router;
