'use strict';

const ACTION = 'safe_delivery_profile_enable_next_v1';
const OPERATION = 'host_action.safe_delivery_profile_enable_next_v1';
const ROLLOUT_ORDER = Object.freeze([
  'drtarjomeh_prod',
  'rahekomak',
  'cfpark_front_prod',
  'titan_front_prod',
  'imotion_front_prod'
]);
const MUTABLE_TARGETS = Object.freeze([
  'cfpark_front_prod',
  'titan_front_prod',
  'imotion_front_prod'
]);
const STATE_VERSION = 1;

function fail(code) { throw new Error(code); }

function validateRawState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('safe_delivery_state_invalid');
  if (value.version !== STATE_VERSION) fail('safe_delivery_state_version_invalid');
  if (!value.enabled || typeof value.enabled !== 'object' || Array.isArray(value.enabled)) {
    fail('safe_delivery_state_enabled_invalid');
  }
  const keys = Object.keys(value.enabled).sort();
  const expected = [...ROLLOUT_ORDER].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) fail('safe_delivery_state_keys_invalid');

  let seenDisabled = false;
  for (const project of ROLLOUT_ORDER) {
    const enabled = value.enabled[project];
    if (typeof enabled !== 'boolean') fail('safe_delivery_state_boolean_invalid');
    if (!enabled) seenDisabled = true;
    else if (seenDisabled) fail('safe_delivery_state_non_contiguous');
  }
  return value;
}

function deriveNextProject(value) {
  validateRawState(value);
  return ROLLOUT_ORDER.find(project => value.enabled[project] === false) || null;
}

function assertMutableTarget(project) {
  if (project === null) return null;
  if (!MUTABLE_TARGETS.includes(project)) fail('safe_delivery_rollout_baseline_regressed');
  return project;
}

function validateTransition(before, after, target) {
  validateRawState(before);
  validateRawState(after);
  const expectedTarget = deriveNextProject(before);
  if (target !== expectedTarget) fail('safe_delivery_transition_target_invalid');
  assertMutableTarget(target);
  if (before.enabled[target] !== false || after.enabled[target] !== true) {
    fail('safe_delivery_transition_invalid');
  }
  for (const project of ROLLOUT_ORDER) {
    if (project === target) continue;
    if (before.enabled[project] !== after.enabled[project]) fail('safe_delivery_transition_invalid');
  }
  return after;
}

module.exports = {
  ACTION,
  OPERATION,
  ROLLOUT_ORDER,
  MUTABLE_TARGETS,
  STATE_VERSION,
  validateRawState,
  deriveNextProject,
  assertMutableTarget,
  validateTransition
};
