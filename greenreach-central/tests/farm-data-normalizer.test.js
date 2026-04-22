/**
 * Tests for the snake/camel schema-guard normalizer in lib/farm-data-store.js
 * (Gap #6). Proves:
 *   - mirror is non-destructive (never overwrites an existing key)
 *   - nested objects (one level) are walked
 *   - arrays-of-primitives pass through untouched
 *   - non-registered data types are returned as-is
 *   - deeply-nested arbitrary data isn't mangled (identity on primitives)
 */

import { normalizeFarmDataPayload } from '../lib/farm-data-store.js';

describe('normalizeFarmDataPayload', () => {
  test('mirrors snake_case keys to camelCase on registered type (farm_settings)', () => {
    const out = normalizeFarmDataPayload('farm_settings', {
      pickup_schedule: 'Mon/Wed/Fri',
      min_order_total: 50,
    });
    expect(out.pickup_schedule).toBe('Mon/Wed/Fri');
    expect(out.pickupSchedule).toBe('Mon/Wed/Fri');
    expect(out.min_order_total).toBe(50);
    expect(out.minOrderTotal).toBe(50);
  });

  test('mirrors camelCase keys to snake_case on registered type (farm_settings)', () => {
    const out = normalizeFarmDataPayload('farm_settings', {
      pickupSchedule: 'Tues/Thurs',
      minOrderTotal: 25,
    });
    expect(out.pickup_schedule).toBe('Tues/Thurs');
    expect(out.pickupSchedule).toBe('Tues/Thurs');
    expect(out.min_order_total).toBe(25);
    expect(out.minOrderTotal).toBe(25);
  });

  test('is non-destructive when both forms already exist with different values', () => {
    const out = normalizeFarmDataPayload('farm_settings', {
      pickup_schedule: 'SNAKE',
      pickupSchedule: 'CAMEL',
    });
    expect(out.pickup_schedule).toBe('SNAKE');
    expect(out.pickupSchedule).toBe('CAMEL');
  });

  test('walks one level of nested objects (room dimensions)', () => {
    const out = normalizeFarmDataPayload('rooms', [
      { id: 'r1', dimensions: { length_m: 6, width_m: 3, ceiling_height_m: 2.8 } },
    ]);
    expect(out[0].dimensions.length_m).toBe(6);
    expect(out[0].dimensions.lengthM).toBe(6);
    expect(out[0].dimensions.width_m).toBe(3);
    expect(out[0].dimensions.widthM).toBe(3);
    expect(out[0].dimensions.ceiling_height_m).toBe(2.8);
    expect(out[0].dimensions.ceilingHeightM).toBe(2.8);
  });

  test('pass-through for unregistered data types (groups stays as array)', () => {
    const input = [{ id: 'g1', room_id: 'r1', grow_units: 12 }];
    const out = normalizeFarmDataPayload('groups', input);
    expect(out).toBe(input); // identity — no walk, no clone
  });

  test('returns null/undefined unchanged', () => {
    expect(normalizeFarmDataPayload('rooms', null)).toBeNull();
    expect(normalizeFarmDataPayload('rooms', undefined)).toBeUndefined();
  });

  test('leaves arrays of primitives untouched', () => {
    const out = normalizeFarmDataPayload('farm_settings', {
      zone_names: ['Z1', 'Z2', 'Z3'],
      min_order_total: 0,
    });
    expect(out.zone_names).toEqual(['Z1', 'Z2', 'Z3']);
    expect(out.zoneNames).toEqual(['Z1', 'Z2', 'Z3']);
  });

  test('does not mirror non-identifier keys (UUIDs, dotted paths, symbols)', () => {
    const out = normalizeFarmDataPayload('farm_settings', {
      'a.b.c': 1,
      '123numeric_start': 2,
      normal_key: 3,
    });
    expect(out['a.b.c']).toBe(1);
    expect(out['123numeric_start']).toBe(2);
    expect(out.normal_key).toBe(3);
    expect(out.normalKey).toBe(3);
    // non-identifier keys should NOT have a mirror added
    expect(Object.keys(out)).not.toContain('aBC');
  });
});
