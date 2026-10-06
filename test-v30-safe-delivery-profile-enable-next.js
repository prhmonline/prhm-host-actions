'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const IMPL = path.join(__dirname, 'safe-delivery-profile-enable-next-v1.js');
function load(){ delete require.cache[require.resolve(IMPL)]; return require(IMPL); }

const state = enabled => ({ version: 1, enabled });
const base = {
  drtarjomeh_prod: true,
  rahekomak: true,
  cfpark_front_prod: false,
  titan_front_prod: false,
  imotion_front_prod: false
};

test('exports fixed Safe Delivery enable-next contract', () => {
  const m = load();
  assert.equal(m.ACTION, 'safe_delivery_profile_enable_next_v1');
  assert.equal(m.OPERATION, 'host_action.safe_delivery_profile_enable_next_v1');
  assert.deepEqual(m.ROLLOUT_ORDER, [
    'drtarjomeh_prod','rahekomak','cfpark_front_prod','titan_front_prod','imotion_front_prod'
  ]);
  assert.deepEqual(m.MUTABLE_TARGETS, ['cfpark_front_prod','titan_front_prod','imotion_front_prod']);
});

test('current canonical state derives CF Park as next target', () => {
  const m = load();
  assert.equal(m.deriveNextProject(state(base)), 'cfpark_front_prod');
});

test('derives Titan and iMotion only after prior profiles are enabled', () => {
  const m = load();
  assert.equal(m.deriveNextProject(state({...base, cfpark_front_prod:true})), 'titan_front_prod');
  assert.equal(m.deriveNextProject(state({...base, cfpark_front_prod:true, titan_front_prod:true})), 'imotion_front_prod');
});

test('terminal all-enabled state returns null', () => {
  const m = load();
  assert.equal(m.deriveNextProject(state(Object.fromEntries(m.ROLLOUT_ORDER.map(k => [k,true])))), null);
});

test('invalid schema and non-contiguous rollout fail closed', () => {
  const m = load();
  assert.throws(() => m.validateRawState({version:2, enabled:base}), /safe_delivery_state_version_invalid/);
  assert.throws(() => m.validateRawState(state({...base, extra:false})), /safe_delivery_state_keys_invalid/);
  assert.throws(() => m.validateRawState(state({...base, titan_front_prod:true})), /safe_delivery_state_non_contiguous/);
  assert.throws(() => m.validateRawState(state({...base, cfpark_front_prod:'false'})), /safe_delivery_state_boolean_invalid/);
});

test('regressed baseline refuses DrTarjomeh or RahKomak as mutable targets', () => {
  const m = load();
  const allFalse = state(Object.fromEntries(m.ROLLOUT_ORDER.map(k => [k,false])));
  assert.equal(m.deriveNextProject(allFalse), 'drtarjomeh_prod');
  assert.throws(() => m.assertMutableTarget(m.deriveNextProject(allFalse)), /safe_delivery_rollout_baseline_regressed/);
  const rahNext = state({drtarjomeh_prod:true,rahekomak:false,cfpark_front_prod:false,titan_front_prod:false,imotion_front_prod:false});
  assert.throws(() => m.assertMutableTarget(m.deriveNextProject(rahNext)), /safe_delivery_rollout_baseline_regressed/);
});

test('transition must change exactly the derived next profile false to true', () => {
  const m = load();
  const before = state(base);
  const after = state({...base, cfpark_front_prod:true});
  assert.deepEqual(m.validateTransition(before, after, 'cfpark_front_prod'), after);
  assert.throws(() => m.validateTransition(before, state({...base, titan_front_prod:true}), 'cfpark_front_prod'), /safe_delivery_state_non_contiguous/);
  assert.throws(() => m.validateTransition(before, state({...base, cfpark_front_prod:true,titan_front_prod:true}), 'cfpark_front_prod'), /safe_delivery_transition_invalid/);
  assert.throws(() => m.validateTransition(before, after, 'titan_front_prod'), /safe_delivery_transition_target_invalid/);
});

test('public contract contains no arbitrary mutation inputs', () => {
  const m = load();
  const src = require('node:fs').readFileSync(IMPL,'utf8');
  for (const forbidden of ['process.argv','process.env.TARGET','process.env.PROJECT','eval(','child_process.exec(']) {
    assert.equal(src.includes(forbidden), false, forbidden);
  }
  assert.equal(typeof m.validateRawState, 'function');
  assert.equal(typeof m.deriveNextProject, 'function');
  assert.equal(typeof m.validateTransition, 'function');
  assert.equal(typeof m.assertMutableTarget, 'function');
});
