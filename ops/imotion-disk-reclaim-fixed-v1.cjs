'use strict';

/**
 * iMotion disk reclaim v1 — SOURCE CANDIDATE for the EXISTING PRHM Host Actions v2.
 * No CLI, SSH/root shell, HTTP route, installer, deployment, registration or token issuer.
 * The existing trusted Host Action runner must supply the five named capabilities.
 * Approval Center must independently bind action+plan SHA to fresh, one-use Level-4 consent.
 */
const crypto = require('node:crypto');
const ACTION = 'imotion_disk_reclaim_v1';
const PROJECT = 'imotion_admin_prod';
const HOST = 'imotion-prod-vm';
const LEVEL = 4;
const MAX_ITEMS = 20;
const PROBE_TIMEOUT_MS = 15000;
const APPROVAL_TTL_SECONDS = 180;
const KINDS = Object.freeze(['docker_build_cache', 'rotated_log']);

function deny(code) { throw new Error('imotion_disk_reclaim_' + code); }
function exact(o, keys) {
  return !!o && typeof o === 'object' && !Array.isArray(o) &&
    Object.keys(o).sort().join(':') === keys.slice().sort().join(':');
}
function canonical(o) {
  if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']';
  if (o && typeof o === 'object')
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  return JSON.stringify(o);
}
function sha(o) { return crypto.createHash('sha256').update(canonical(o)).digest('hex'); }
function number(n) { return Number.isSafeInteger(n) && n >= 0; }
function sha256(s) { return typeof s === 'string' && /^[a-f0-9]{64}$/.test(s); }
function trusted(c) {
  for (const name of ['probeDisk', 'probeDocker', 'probeBackups', 'probeLogs', 'probeHealth',
    'getApprovalReceipt', 'consumeApproval', 'reclaimBuildCache', 'removeRotatedLog']) {
    if (!c || typeof c[name] !== 'function') deny('trusted_capability_missing_' + name);
  }
  return c;
}
function validateDisk(d) {
  if (!exact(d, ['total_bytes', 'used_bytes', 'free_bytes']) ||
    !number(d.total_bytes) || !number(d.used_bytes) || !number(d.free_bytes) ||
    d.used_bytes > d.total_bytes || d.free_bytes > d.total_bytes) deny('disk_probe_invalid');
  return Object.freeze({...d});
}
function candidate(c) {
  if (!exact(c, ['id', 'kind', 'bytes', 'age_days', 'reclaimable', 'in_use', 'symlink', 'sha256']) ||
      !KINDS.includes(c.kind) || !number(c.bytes) || !number(c.age_days) ||
      typeof c.reclaimable !== 'boolean' || typeof c.in_use !== 'boolean' ||
      c.symlink !== false || !sha256(c.sha256) || typeof c.id !== 'string' ||
      c.id.length > 240) deny('candidate_schema');
  if (c.kind === 'docker_build_cache') {
    if (!/^[a-f0-9]{12,64}$/.test(c.id)) deny('docker_cache_id');
  } else {
    // Only archived, compressed rotated logs. No current logs, audit, journal or backups.
    if (!/^\/var\/log\/[A-Za-z0-9_./-]+\.log\.[0-9]+\.gz$/.test(c.id) ||
        c.id.includes('/../') || /\/(?:audit|journal)\//.test(c.id)) deny('rotated_log_path');
  }
  return Object.freeze({...c});
}
function validateBucket(b, kind) {
  if (!exact(b,['complete','bytes','candidates']) || b.complete !== true ||
      !number(b.bytes) || !Array.isArray(b.candidates) ||
      b.candidates.length > 200 || b.candidates.some(x=>x?.kind!==kind))
    deny(kind + '_probe_invalid');
  return Object.freeze({complete:true,bytes:b.bytes,candidates:Object.freeze(b.candidates.map(candidate))});
}
function validateBackup(b) {
  if (!exact(b, ['complete','bytes','latest_local_success','latest_offsite_success']) ||
      b.complete !== true || !number(b.bytes) ||
      typeof b.latest_local_success !== 'boolean' ||
      typeof b.latest_offsite_success !== 'boolean') deny('backup_probe_invalid');
  return Object.freeze({...b});
}
async function collect(capabilities) {
  const c=trusted(capabilities);
  // Each fixed read runs with its own timeout in the trusted existing host adapter.
  // DO NOT implement with one sequential recursive du / or expose caller-supplied commands.
  const results=await Promise.allSettled([
    c.probeDisk(PROBE_TIMEOUT_MS),
    c.probeDocker(PROBE_TIMEOUT_MS),
    c.probeBackups(PROBE_TIMEOUT_MS),
    c.probeLogs(PROBE_TIMEOUT_MS),
    c.probeHealth(PROBE_TIMEOUT_MS)
  ]);
  if(results.some(x=>x.status!=='fulfilled')) return Object.freeze({
    action:ACTION,project:PROJECT,host:HOST,complete:false,
    error:'bounded_probe_incomplete',cleanup_enabled:false
  });
  const [disk,docker,backups,logs,health]=results.map(x=>x.value);
  if (!exact(health,['healthy']) || health.healthy !== true) deny('service_health');
  const out={
    action:ACTION,project:PROJECT,host:HOST,complete:true,
    disk:validateDisk(disk),
    docker:validateBucket(docker,'docker_build_cache'),
    backups:validateBackup(backups),
    logs:validateBucket(logs,'rotated_log')
  };
  const ids=[...out.docker.candidates,...out.logs.candidates].map(x=>x.id);
  if(new Set(ids).size!==ids.length) deny('duplicate_candidate');
  return Object.freeze({...out,inventory_sha256:sha(out),cleanup_enabled:false});
}
function reviewPlan(inventory, ids) {
  if (!inventory || inventory.complete!==true || inventory.action!==ACTION ||
      inventory.project!==PROJECT || inventory.host!==HOST ||
      !sha256(inventory.inventory_sha256)) deny('inventory_incomplete');
  const {inventory_sha256,...base}=inventory;
  delete base.cleanup_enabled;
  if(sha(base)!==inventory_sha256) deny('inventory_hash_drift');
  if(!Array.isArray(ids) || !ids.length || ids.length>MAX_ITEMS ||
     ids.some(id=>typeof id!=='string') || new Set(ids).size!==ids.length)
     deny('selection_invalid');
  const lookup=new Map([...inventory.docker.candidates,...inventory.logs.candidates].map(c=>[c.id,c]));
  const selected=ids.map(id=>{
    const c=lookup.get(id);
    if(!c || c.in_use || !c.reclaimable || c.symlink || c.bytes===0) deny('candidate_not_safe');
    if(c.kind==='docker_build_cache' && c.age_days<7) deny('cache_too_new');
    if(c.kind==='rotated_log' && (c.age_days<30 || !inventory.backups.latest_offsite_success))
      deny('log_retention_or_offsite_block');
    return c;
  });
  const plan={
    action:ACTION,project:PROJECT,host:HOST,
    inventory_sha256,items:selected,
    bytes_max:selected.reduce((n,c)=>n+c.bytes,0),
    approval_level:LEVEL,approval_ttl_seconds:APPROVAL_TTL_SECONDS
  };
  if(!number(plan.bytes_max)) deny('bytes_overflow');
  return Object.freeze({...plan,plan_sha256:sha(plan),approved:false,executed:false});
}
async function executeApproved(plan, capabilities) {
  const c=trusted(capabilities);
  if(!plan || !sha256(plan.plan_sha256) || plan.approval_level!==LEVEL ||
     plan.action!==ACTION || plan.project!==PROJECT || plan.host!==HOST ||
     plan.approval_ttl_seconds!==APPROVAL_TTL_SECONDS ||
     !Array.isArray(plan.items) || !plan.items.length || plan.items.length>MAX_ITEMS)
     deny('plan_invalid');
  const {plan_sha256,approved,executed,...body}=plan;
  if(approved!==false || executed!==false || sha(body)!==plan_sha256)
    deny('plan_hash_drift');
  // Fresh host scan; any drift fails CLOSED before authorization is consumed.
  const current=await collect(c);
  if(current.complete!==true || current.inventory_sha256!==plan.inventory_sha256)
    deny('preimage_changed');
  const canonicalPlan=reviewPlan(current,plan.items.map(x=>x.id));
  if(canonicalPlan.plan_sha256!==plan.plan_sha256) deny('candidate_changed');
  // Existing trusted Approval Center alone can provide/consume this receipt.
  // Never accept bearer/JWS, authority, clock, request_id or a shell command from the caller.
  const receipt=await c.getApprovalReceipt({action:ACTION,project:PROJECT,host:HOST,
    plan_sha256:plan.plan_sha256,level:LEVEL,ttl_seconds:APPROVAL_TTL_SECONDS});
  if(!receipt || receipt.authorized!==true || receipt.level!==LEVEL ||
    receipt.action!==ACTION || receipt.plan_sha256!==plan.plan_sha256 ||
    receipt.one_time_use!==true) deny('level4_not_authorized');
  const consumed=await c.consumeApproval(receipt);
  if(!consumed || consumed.ok!==true) deny('approval_not_consumed');
  const actions=[];
  for(const item of canonicalPlan.items){
    // Root-owned handlers must independently revalidate exact ID/SHA/type/size/age
    // and refuse symlinks, active container layers, volumes, current logs and backups.
    const outcome=item.kind==='docker_build_cache'
      ? await c.reclaimBuildCache(item)
      : await c.removeRotatedLog(item);
    actions.push({kind:item.kind,id:item.id,ok:outcome?.ok===true,bytes:outcome?.bytes||0});
    if(outcome?.ok!==true) break; // Never continue after partial failure.
  }
  const after=await c.probeDisk(PROBE_TIMEOUT_MS);
  const healthy=await c.probeHealth(PROBE_TIMEOUT_MS);
  return Object.freeze({
    action:ACTION,plan_sha256:plan.plan_sha256,
    status:actions.length===canonicalPlan.items.length && actions.every(x=>x.ok) &&
      healthy?.healthy===true ? 'completed' : 'partial_review_required',
    before_bytes:current.disk.free_bytes,after_bytes:validateDisk(after).free_bytes,
    items:actions,service_healthy:healthy?.healthy===true,
    // Cleanup is not a backup deletion or a claim of atomic rollback.
    backup_files_deleted:false,volumes_deleted:false,containers_stopped:false
  });
}
module.exports=Object.freeze({ACTION,PROJECT,HOST,PROBE_TIMEOUT_MS,collect,reviewPlan,executeApproved});
