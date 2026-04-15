import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { calculateOptimalLayoutColumns, inferRoomDimensionsMeters, deriveScientificLayoutDefaults, executeTool } from '../routes/farm-ops-agent.js';
import { shouldEnterFarmHandMode, shouldHandleDirectLayoutRequest, shouldHandleDirectLayoutFollowup, shouldHandleDirectFanFollowup, buildDirectLayoutPlan, shouldUseDeliberativeSupport, buildRelevantHistoryReview, shouldRequestGwenReview, shouldForceGroundedRewrite } from '../routes/assistant-chat.js';

function expect(value) {
  return {
    toBe(expected) {
      assert.equal(value, expected);
    },
    toContain(expected) {
      if (typeof value === 'string') {
        assert.equal(value.includes(expected), true);
        return;
      }
      if (Array.isArray(value)) {
        assert.equal(value.includes(expected), true);
        return;
      }
      throw new Error('toContain only supports strings and arrays');
    },
    toBeGreaterThan(expected) {
      assert.equal(value > expected, true);
    },
    toBeGreaterThanOrEqual(expected) {
      assert.equal(value >= expected, true);
    },
    toBeLessThan(expected) {
      assert.equal(value < expected, true);
    },
    toBeLessThanOrEqual(expected) {
      assert.equal(value <= expected, true);
    }
  };
}

describe('calculateOptimalLayoutColumns', () => {
  test('direct layout mode activates for zipgrow spacing requests', () => {
    expect(shouldHandleDirectLayoutRequest('optimize the grow room spacing and update the zipgrow towers')).toBe(true);
    expect(shouldHandleDirectLayoutRequest('space the zipgrow towers evenly across the room')).toBe(true);
    expect(shouldHandleDirectLayoutRequest('review the current grow room. the grow room has towers on the left and right in groups of three. update the 3d viewer and correctly space them in even rows.')).toBe(true);
    expect(shouldHandleDirectLayoutRequest('what powers you')).toBe(false);

    const plan = buildDirectLayoutPlan('review the current grow room. the grow room has towers on the left and right in groups of three. update the 3d viewer and correctly space them in even rows.', 'room-3xxjln');
    expect(plan.room_id).toBe('room-3xxjln');
    expect(plan.match_name).toContain('ZipGrow');
    expect(plan.target).toBe('groups');
    expect(plan.columns).toBe(3);
  });

  test('follow-up layout requests inherit prior tower context', () => {
    const history = [
      {
        role: 'user',
        content: 'review the current grow room. the grow room has towers on the left and right in groups of three. update the 3d viewer and correctly space them in even rows.'
      },
      {
        role: 'assistant',
        content: 'I reviewed the grow room and updated the ZipGrow tower spacing.'
      }
    ];

    expect(shouldHandleDirectLayoutFollowup('make the center aisle wider for easier access', history)).toBe(true);

    const plan = buildDirectLayoutPlan(
      'make the center aisle wider for easier access and more airflow',
      'room-3xxjln',
      history.map(entry => entry.content).join('\n')
    );

    expect(plan.match_name).toContain('ZipGrow');
    expect(plan.columns).toBe(3);
    expect(plan.walkway_m).toBeGreaterThanOrEqual(1.2);
    expect(plan.spacing_m).toBeGreaterThanOrEqual(0.8);
  });

  test('follow-up wall and fan requests inherit prior room context', () => {
    const history = [
      {
        role: 'user',
        content: 'space the zipgrow towers evenly across the room in groups of three on each side.'
      },
      {
        role: 'assistant',
        content: 'I reviewed the grow room and updated the ZipGrow tower spacing.'
      }
    ];

    expect(shouldHandleDirectLayoutFollowup('move them closer to the east and west walls and increase the spacing between the groups', history)).toBe(true);
    expect(shouldHandleDirectFanFollowup('pin the fans to those walls', history)).toBe(true);

    const plan = buildDirectLayoutPlan(
      'move them closer to the east and west walls and increase the spacing between the groups',
      'room-3xxjln',
      history.map(entry => entry.content).join('\n')
    );

    expect(plan.match_name).toContain('ZipGrow');
    expect(plan.columns).toBe(3);
    expect(plan.edge_alignment).toBe('walls');
    expect(plan.wall_clearance_m).toBeLessThanOrEqual(0.2);
    expect(plan.spacing_m).toBeGreaterThanOrEqual(1.0);
  });

  test('farm-hand mode activates for environment support asks', () => {
    expect(shouldEnterFarmHandMode('help me establish and maintain the growing environment')).toBe(true);
    expect(shouldEnterFarmHandMode('check the climate and humidity in the grow room')).toBe(true);
    expect(shouldEnterFarmHandMode('what powers you')).toBe(false);
  });

  test('deliberative support activates for reasoning complaints and reviews recent history', () => {
    const history = [
      { role: 'user', content: 'Review the grow room and fix the spacing.' },
      { role: 'assistant', content: 'I updated the spacing.' },
      { role: 'user', content: 'That did not address airflow or access.' }
    ];

    expect(shouldUseDeliberativeSupport('evie does not review chat history or review with gwen', history)).toBe(true);
    const review = buildRelevantHistoryReview(history, 'fix the spacing and airflow issue');
    expect(review).toContain('Review the grow room and fix the spacing.');
    expect(review).toContain('That did not address airflow or access.');
  });

  test('gwen review and grounded rewrite heuristics activate for substantive reasoning asks', () => {
    expect(shouldRequestGwenReview('Why is this ZipGrow layout weak for airflow and access?')).toBe(true);
    expect(shouldForceGroundedRewrite(
      'evie responded with bullshit when the answer is easily found',
      'I need more information to help with that. Let me know if you would like me to look into it.',
      []
    )).toBe(true);
    expect(shouldForceGroundedRewrite(
      'evie responded with bullshit when the answer is easily found',
      'I reviewed the prior room-layout conversation, the applicable grow-room control guidance, and the GWEN note before answering.',
      []
    )).toBe(false);
  });

  test('infers room dimensions from grid size and cell size', () => {
    const dims = inferRoomDimensionsMeters({}, {
      gridSize: 30,
      cellSize: 40,
      zones: [
        { x1: 0, y1: 0, x2: 13, y2: 18 },
        { x1: 15, y1: 0, x2: 29, y2: 18 }
      ]
    });

    expect(dims.length_m).toBe(12);
    expect(dims.width_m).toBe(7.6);
    expect(dims.source).toBe('grid-cell-inference');
  });

  test('does not default to 3 columns for dense square-room layouts', () => {
    const columns = calculateOptimalLayoutColumns({
      itemCount: 78,
      roomGridW: 30,
      roomGridD: 30,
      margin: 2,
      walkwayGrid: 0,
      maxFootprintX: 2,
      maxFootprintY: 2
    });

    expect(columns).toBeGreaterThan(3);
  });

  test('uses science-based airflow and access defaults for tower rooms', () => {
    const science = deriveScientificLayoutDefaults({
      itemCount: 78,
      roomLength: 12,
      roomWidth: 7.6,
      maxFootprintLengthM: 1.8,
      maxFootprintWidthM: 0.5,
      plantSites: 1170,
      totalLightWatts: 15600
    });

    expect(science.walkway_m).toBeGreaterThanOrEqual(1.0);
    expect(science.airflow_gap_m).toBeGreaterThanOrEqual(0.55);
    expect(science.wall_clearance_m).toBeGreaterThanOrEqual(0.3);
  });

  test('real zipgrow room does not collapse to a single tower column', async () => {
    const result = await executeTool('optimize_layout', {
      farm_id: 'FARM-MLTP9LVH-B0B85039',
      room_id: 'room-3xxjln',
      match_name: 'ZipGrow',
      target: 'groups'
    });

    expect(result.ok).toBe(true);
    expect(result.columns).toBeGreaterThan(1);
    expect(result.science_basis.walkway_m).toBeGreaterThanOrEqual(1.0);
  });

  test('wall-aligned layouts push tower banks toward the room edges', async () => {
    const result = await executeTool('optimize_layout', {
      farm_id: 'FARM-MLTP9LVH-B0B85039',
      room_id: 'room-3xxjln',
      match_name: 'ZipGrow',
      target: 'groups',
      columns: 3,
      spacing_m: 1,
      edge_alignment: 'walls',
      wall_clearance_m: 0.2
    });

    expect(result.ok).toBe(true);
    expect(result.edge_alignment).toBe('walls');
    const xs = result.layout.map(item => item.x);
    expect(Math.min(...xs)).toBeLessThanOrEqual(4);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(22);
  });

  test('fan wall alignment pins matching equipment to the outer walls', async () => {
    const result = await executeTool('align_equipment_to_walls', {
      farm_id: 'FARM-MLTP9LVH-B0B85039',
      room_id: 'room-3xxjln',
      match_name: 'fan',
      wall_mode: 'outer'
    });

    expect(result.ok).toBe(true);
    expect(result.updated).toBeGreaterThan(0);
    expect(result.placements.every(item => item.x === 0 || item.x === 29)).toBe(true);
  });

  test('uses fewer columns in narrow rooms', () => {
    const columns = calculateOptimalLayoutColumns({
      itemCount: 24,
      roomGridW: 12,
      roomGridD: 30,
      margin: 2,
      walkwayGrid: 0,
      maxFootprintX: 2,
      maxFootprintY: 2
    });

    expect(columns).toBeLessThanOrEqual(4);
  });
});
