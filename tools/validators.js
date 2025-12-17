// Simple validators used by RoomWizard and test harness (ESM)
export function validateRs485UnitId(v) {
  if (v === null || v === undefined || v === '') return { ok: true };
  const n = Number(v);
  if (!Number.isInteger(n)) return { ok: false, error: 'Unit ID must be an integer' };
  if (n < 1 || n > 247) return { ok: false, error: 'Unit ID must be between 1 and 247' };
  return { ok: true };
}

export function validate0v10Channel(ch) {
  if (!ch) return { ok: false, error: 'Channel required' };
  return { ok: true };
}

export function validate0v10Scale(s) {
  if (s === null || s === undefined || s === '') return { ok: true };
  const n = Number(s);
  if (Number.isNaN(n)) return { ok: false, error: 'Scale must be numeric' };
  if (n < 0 || n > 1000) return { ok: false, error: 'Scale out of expected range (0-1000)' };
  return { ok: true };
}
