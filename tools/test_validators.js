// Simple Node test harness for validators (ESM)
import assert from 'assert';
import { validateRs485UnitId, validate0v10Channel, validate0v10Scale } from './validators.js';

console.log('Running validators tests...');

(async function run() {
	// RS-485 Unit ID
	assert.deepStrictEqual(validateRs485UnitId(''), { ok: true });
	assert.deepStrictEqual(validateRs485UnitId(null), { ok: true });
	assert.deepStrictEqual(validateRs485UnitId(1), { ok: true });
	assert.deepStrictEqual(validateRs485UnitId(247), { ok: true });
	assert.strictEqual(validateRs485UnitId(0).ok, false);
	assert.strictEqual(validateRs485UnitId(248).ok, false);
	assert.strictEqual(validateRs485UnitId('abc').ok, false);

	// 0-10V Channel
	assert.deepStrictEqual(validate0v10Channel('A'), { ok: true });
	assert.strictEqual(validate0v10Channel('').ok, false);
	assert.strictEqual(validate0v10Channel(null).ok, false);

	// 0-10V Scale
	assert.deepStrictEqual(validate0v10Scale(''), { ok: true });
	assert.deepStrictEqual(validate0v10Scale(null), { ok: true });
	assert.deepStrictEqual(validate0v10Scale(0), { ok: true });
	assert.deepStrictEqual(validate0v10Scale(100), { ok: true });
	assert.strictEqual(validate0v10Scale('abc').ok, false);
	assert.strictEqual(validate0v10Scale(-1).ok, false);
	assert.strictEqual(validate0v10Scale(1001).ok, false);

	console.log('All validator tests passed');
})();
