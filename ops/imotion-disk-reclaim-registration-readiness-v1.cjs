'use strict';
/**
 * iMotion disk-reclaim registry READINESS CHECK (source-only).
 *
 * This is NOT a registrar, root installer, approval issuer or executor.
 * The existing trusted Agent 3 root adapter must collect ALL evidence from
 * live, fixed owner paths. Untrusted UI-supplied evidence is not authority.
 *
 * For the source/manifest two-commit release contract, the existing global
 * registrar first needs its own signed native bootstrap and live discovery.
 */
const crypto=require('node:crypto');
const ACTION='imotion_disk_reclaim_v1';
const REGISTRAR='prhm_action_registry_install_v1';
const PROJECT='imotion_admin_prod';
const SCHEMA='prhm.imotion.disk-reclaim.registration-readiness.v1';
const OWNERS=Object.freeze([
  '/opt/prhm-agent-selfmaint/server.js',
  '/opt/prhm-agent-selfmaint-exec/server.js',
  '/opt/prhm-company-control-plane/config/approval-policy.json',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
]);
const SERVICES=Object.freeze([
  'prhm-agent-selfmaint.service',
  'prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp-blue.service',
  'prhm-agent-mcp-green.service'
]);
const HEX40=/^[0-9a-f]{40}$/;
const HEX64=/^[0-9a-f]{64}$/;
const ERR='NO_GO';
function exact(v,keys){
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
}
function canonical(v){
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.keys(v).sort()
  .map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
function hash(v){return crypto.createHash('sha256').update(canonical(v)).digest('hex');}
function check(input){
 const blockers=[];
 if(!exact(input,[
  'schema','project','action','trusted_source',
  'registrar','release','owners','services','rollback',
  'approval','discovery','inventory'
 ]))blockers.push('EVIDENCE_SCHEMA_INVALID');
 if(!blockers.length){
  if(input.schema!==SCHEMA||input.project!==PROJECT||input.action!==ACTION)
   blockers.push('ACTION_SCOPE_INVALID');
  // This boolean does not establish trust. It must be independently bound to
  // root-owned read-only evidence by the privileged adapter before use.
  if(input.trusted_source!=='root_owned_readonly_agent3')
   blockers.push('TRUSTED_SOURCE_UNPROVEN');
  const r=input.registrar;
  if(!exact(r,['action','installed','live_discoverable','typed_five_field_route','root_launcher_attested'])||
     r.action!==REGISTRAR||r.installed!==true||r.live_discoverable!==true||
     r.typed_five_field_route!==true||r.root_launcher_attested!==true)
   blockers.push('SHARED_REGISTRAR_NOT_INSTALLED');
  const rel=input.release;
  if(!exact(rel,['source_commit','manifest_commit','manifest_sha256','git_attested','asset_bytes_verified'])||
      !HEX40.test(rel.source_commit||'')||!HEX40.test(rel.manifest_commit||'')||
      !HEX64.test(rel.manifest_sha256||'')||
      rel.source_commit===rel.manifest_commit||
      rel.git_attested!==true||rel.asset_bytes_verified!==true)
   blockers.push('PINNED_RELEASE_UNVERIFIED');
  const owners=input.owners;
  if(!Array.isArray(owners)||owners.length!==OWNERS.length||
     OWNERS.some((p,i)=>owners[i]?.path!==p||!HEX64.test(owners[i]?.sha256||'')||
     owners[i]?.root_owned!==true||owners[i]?.mode_safe!==true||
     owners[i]?.matches_reviewed_preimage!==true))
   blockers.push('FOUR_OWNER_SHA_OR_MODE_DRIFT');
  const services=input.services;
  if(!Array.isArray(services)||services.length!==SERVICES.length||
      SERVICES.some((name,i)=>services[i]?.name!==name||services[i]?.healthy!==true))
   blockers.push('CONTROL_PLANE_HEALTH_UNPROVEN');
  const rb=input.rollback;
  if(!exact(rb,['restored_bytes_verified','root_lock_safe','crash_recovery_tested'])||
    Object.values(rb).some(v=>v!==true))
   blockers.push('ROLLBACK_NOT_VERIFIED');
  const ap=input.approval;
  if(!exact(ap,['ed25519_verified','one_time_ledger','ttl_seconds','arguments_sha256_bound','policy_scope_registered'])||
      ap.ed25519_verified!==true||ap.one_time_ledger!==true||
      ap.ttl_seconds!==180||ap.arguments_sha256_bound!==true||
      ap.policy_scope_registered!==true)
   blockers.push('TYPED_APPROVAL_UNVERIFIED');
  const d=input.discovery;
  if(!exact(d,['blue_authenticated','green_authenticated','action_visible'])||
      d.blue_authenticated!==true||d.green_authenticated!==true||
      d.action_visible!==true)
   blockers.push('DUAL_MCP_DISCOVERY_UNVERIFIED');
  const inv=input.inventory;
  if(!exact(inv,['complete','bounded','sha256','read_only'])||
      inv.complete!==true||inv.bounded!==true||inv.read_only!==true||
      !HEX64.test(inv.sha256||''))
   blockers.push('BOUNDED_INVENTORY_UNVERIFIED');
 }
 return Object.freeze({
  action:ACTION,project:PROJECT,phase:'registration-readiness',
  status:blockers.length===0?'ATTESTATIONS_COMPLETE':'NO_GO',
  blockers:Object.freeze(blockers),read_only:true,
  // Evidence shape is not authority; only a separately installed root runner
  // with genuine signed approval may register/execute Production actions.
  registration_authorized:false,production_mutation:false,
  activation_authorized:false,
  evidence_sha256:input&&typeof input==='object'?
   hash(input):null
 });
}
module.exports=Object.freeze({ACTION,REGISTRAR,PROJECT,SCHEMA,OWNERS,SERVICES,check});
