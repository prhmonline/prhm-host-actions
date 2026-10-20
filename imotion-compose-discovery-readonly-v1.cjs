'use strict';

/**
 * Fixed read-only iMotion Compose discovery action.
 *
 * Source-only capability adapter: it never acquires a Docker socket, starts a
 * process, executes a command, or writes host state. Only the reviewed Agent
 * runtime may supply a separately authorized container-inspection function.
 * Not installed or authorized merely by landing this source in Git.
 */
const ACTION = 'imotion_compose_discovery_readonly_v1';
const CONTAINERS = Object.freeze([
  'imotion-node', 'imotion-php', 'imotion-db',
  'imotion-redis', 'imotion-nginx', 'imotion-netns'
]);
const LABEL_KEYS = Object.freeze([
  'com.docker.compose.project',
  'com.docker.compose.project.working_dir',
  'com.docker.compose.project.config_files',
  'com.docker.compose.service'
]);

function fail(code) { throw new Error('imotion_compose_readonly_' + code); }
function textField(value, max = 1024) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > max || /[\0\r\n]/.test(value)) fail('untrusted_label');
  return value;
}
function normalizedContainer(expectedName, inspectData) {
  if (!CONTAINERS.includes(expectedName)) fail('container_not_allowlisted');
  if (!Array.isArray(inspectData) || inspectData.length !== 1) fail('container_missing');
  const actual = inspectData[0];
  if (!actual || typeof actual !== 'object' || actual.Name !== '/' + expectedName) fail('container_identity');
  const labels = actual.Config && actual.Config.Labels;
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) fail('labels_missing');
  const selected = Object.fromEntries(LABEL_KEYS.map(k => [k, textField(labels[k])]));
  // A container lacking Compose identity is not eligible for onboarding.
  if (!selected[LABEL_KEYS[0]] || !selected[LABEL_KEYS[1]] ||
      !selected[LABEL_KEYS[2]] || !selected[LABEL_KEYS[3]]) fail('compose_labels_missing');
  if (!Array.isArray(actual.Mounts) || actual.Mounts.length > 100) fail('mount_inventory_invalid');
  const mounts = actual.Mounts.map(m => {
    if (!m || typeof m !== 'object' || !['bind', 'volume', 'tmpfs'].includes(m.Type)) fail('mount_type_unknown');
    return Object.freeze({
      type: m.Type,
      destination: textField(m.Destination),
      named_volume: m.Type === 'volume' ? textField(m.Name) : null,
      has_bind_mount: m.Type === 'bind'
      // Deliberately never output Source, RW, env, image, hostname, network.
    });
  });
  return Object.freeze({name:expectedName, labels:Object.freeze(selected), mounts:Object.freeze(mounts)});
}
async function discover(authorizedInspect) {
  if (typeof authorizedInspect !== 'function') fail('trusted_inspector_required');
  const containers = [];
  for (const name of CONTAINERS) {
    // The injected inspector must itself enforce Docker READ only and these six
    // fixed names. This function never accepts caller-supplied names/commands.
    const detail = await authorizedInspect(name);
    containers.push(normalizedContainer(name, detail));
  }
  return Object.freeze({
    schema:'prhm.imotion.compose-readonly-discovery.v1',
    action:ACTION, read_only:true, production_mutation:false,
    complete:containers.length === CONTAINERS.length, containers:Object.freeze(containers)
  });
}
module.exports = Object.freeze({ACTION, CONTAINERS, LABEL_KEYS, normalizedContainer, discover});
