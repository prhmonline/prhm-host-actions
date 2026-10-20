'use strict';
/**
 * Fixed read-only remote inspector for the reviewed iMotion discovery handler.
 *
 * This source file is NOT a registered or installed host action. The eventual
 * root-owned trusted executor must invoke it only through the reviewed fixed
 * action binding. It does not grant a general remote command interface.
 */
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {CONTAINERS,discover} = require('./imotion-compose-discovery-readonly-v1.cjs');
const execFileAsync = promisify(execFile);
const BINARY = '/usr/bin/ssh';
const HOST = 'imotion-prod-vm';
const CONFIG = '/root/.ssh/config';

function boundedArgs(name) {
  if (!CONTAINERS.includes(name)) throw Error('imotion_compose_remote_container_not_allowlisted');
  // StrictHostKeyChecking is deliberately not disabled; SSH config is a
  // trusted, root-owned fixed path, never supplied by a caller.
  return Object.freeze([
    '-F', CONFIG, '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=6',
    HOST, 'docker', 'inspect', '--type', 'container', name,
  ]);
}

async function inspectFixedContainer(name, exec = execFileAsync) {
  const args = boundedArgs(name);
  // Never return raw stderr or stdout in any exception or result.
  let output;
  try {
    output = await exec(BINARY, args, {
      shell:false, timeout:25000, maxBuffer:262144,
      windowsHide:true, encoding:'utf8',
      env:{PATH:'/usr/bin:/bin', HOME:'/root', LANG:'C.UTF-8'}
    });
  } catch {
    throw Error('imotion_compose_remote_inspection_failed');
  }
  if (!output || typeof output.stdout !== 'string') throw Error('imotion_compose_remote_output_invalid');
  let raw;
  try { raw = JSON.parse(output.stdout); }
  catch { throw Error('imotion_compose_remote_json_invalid'); }
  if (!Array.isArray(raw) || raw.length !== 1) throw Error('imotion_compose_remote_identity_invalid');
  return raw;
}

async function discoverOnFixedHost() {
  // This must only be called from an explicitly registered, approved read-only
  // Agent action. Source presence in Git never authorizes execution.
  return discover(name => inspectFixedContainer(name));
}

module.exports = Object.freeze({
  BINARY, HOST, CONFIG, boundedArgs, inspectFixedContainer, discoverOnFixedHost,
});
