'use strict';
/**
 * Agent 3 backup policy / job planner.
 * Deliberately does NOT execute shell commands or touch production files.
 * The privileged backup executor must independently enforce this plan.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const KEY = /^[A-Za-z0-9_-]{12,128}$/;
const SHA = /^[a-f0-9]{64}$/;
function reject(message) { throw new Error('backup_policy_denied: ' + message); }
function validId(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) reject(name);
  return value;
}
function isWithin(root, target) {
  return target === root || target.startsWith(root + path.sep);
}
function canonicalDirectory(value, name) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) reject(name);
  const st = fs.lstatSync(value);
  if (!st.isDirectory() || st.isSymbolicLink()) reject(name);
  return fs.realpathSync(value);
}
function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) reject('registry');
  const projects = registry.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) reject('projects');
  const output = new Map();
  for (const [projectId, project] of Object.entries(projects)) {
    validId(projectId, 'project_id');
    if (!project || typeof project !== 'object') reject('project');
    const root = canonicalDirectory(project.root, 'source_root');
    const destination = canonicalDirectory(project.destination, 'destination');
    if (isWithin(root, destination) || isWithin(destination, root)) reject('overlapping_roots');
    const profiles = new Map();
    for (const [profileId, profile] of Object.entries(project.profiles || {})) {
      validId(profileId, 'profile_id');
      if (!profile || profile.type !== 'files' || !Array.isArray(profile.files) || profile.files.length === 0) reject('profile');
      const files = [];
      const seen = new Set();
      for (const relative of profile.files) {
        if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.posix.isAbsolute(relative)) reject('file_path');
        const parts = relative.split('/');
        if (parts.some(p => !p || p === '.' || p === '..')) reject('traversal');
        const full = path.resolve(root, relative);
        if (!isWithin(root, full)) reject('escape');
        // lstat each component: reject symlinks even if they resolve inside the root.
        let cursor = root;
        for (const part of parts) {
          cursor = path.join(cursor, part);
          const stat = fs.lstatSync(cursor);
          if (stat.isSymbolicLink()) reject('symlink');
        }
        if (!fs.lstatSync(full).isFile() || !isWithin(root, fs.realpathSync(full))) reject('non_regular_file');
        if (seen.has(relative)) reject('duplicate_file');
        seen.add(relative);
        files.push(relative);
      }
      profiles.set(profileId, Object.freeze({type: 'files', files: Object.freeze(files)}));
    }
    output.set(projectId, Object.freeze({root, destination, profiles}));
  }
  return output;
}
function createPlanner(registry) {
  const projects = validateRegistry(registry);
  const usedKeys = new Map();
  function planCreate(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) reject('request');
    const {project_id, profile_id, idempotency_key} = request;
    validId(project_id, 'project_id');
    validId(profile_id, 'profile_id');
    if (typeof idempotency_key !== 'string' || !KEY.test(idempotency_key)) reject('idempotency_key');
    if (Object.keys(request).some(k => !['project_id','profile_id','idempotency_key'].includes(k))) reject('extra_parameters');
    const project = projects.get(project_id);
    const profile = project?.profiles.get(profile_id);
    if (!profile) reject('unregistered_profile');
    const binding = project_id + ':' + profile_id;
    const previous = usedKeys.get(idempotency_key);
    if (previous && previous !== binding) reject('idempotency_conflict');
    usedKeys.set(idempotency_key, binding);
    return Object.freeze({
      job_id: crypto.createHash('sha256').update(idempotency_key + ':' + binding).digest('hex'),
      project_id, profile_id, type: 'files',
      source_root: project.root, destination_root: project.destination,
      files: [...profile.files], expected_file_count: profile.files.length,
      status: 'planned_not_executed'
    });
  }
  return Object.freeze({planCreate});
}
function verifyEvidence(evidence, plan) {
  if (!evidence || evidence.job_id !== plan.job_id || evidence.file_count !== plan.expected_file_count ||
      !SHA.test(evidence.archive_sha256 || '') || !SHA.test(evidence.manifest_sha256 || '') ||
      evidence.archive_readback_ok !== true || evidence.manifest_verified !== true ||
      evidence.atomic_commit_ok !== true) reject('unverified_backup');
  return Object.freeze({job_id: plan.job_id, verified: true});
}
module.exports = {createPlanner, verifyEvidence};
