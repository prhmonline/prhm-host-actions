'use strict';
/**
 * Agent 3 shared five-field registrar bootstrap — bounded LIVE SHAPE INSPECTOR.
 *
 * NO mutation, registration, approval request, service restart or code execute.
 * Only the four exact SHA-pinned owner paths from the prior green live
 * preflight are read via O_NOFOLLOW, and output contains bounded, redacted
 * source anchor positions/hashes only, never source excerpts or credentials.
 *
 * This is diagnostic evidence, NOT an installable bootstrap or permission.
 */
const crypto=require('node:crypto');
const check=require('./four-owner-live-patch-preflight.cjs');
const ownerPins=require('./production-registration-contract.json');
const KEYS=Object.freeze(['base','executor','policy','mcp']);
const MAX_SOURCE_LINE=0; // legacy exported constant; source excerpts prohibited
const MAX_WINDOW_HITS=3;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

const ANCHORS=Object.freeze({
 base:Object.freeze([
  ['canonical_json',/canonicalJson\s*\(/],
  ['v2_approval_request',/host.action.*v2|host_action_v2|host-actions\/v2|\/v1\/host-actions\/request/i],
  ['signed_approval_boundary',/authorize.consume|consume.*approval|approval.*consume/i]
 ]),
 executor:Object.freeze([
  ['v2_spec_registry',/HOST_ACTION_V2_SPECS/],
  ['v2_request_handler',/hostActionV2Spec\s*\(|hostActionV2RequestFile|\/v1\/host-actions\/v2\/request/i],
  ['v2_apply_dispatch',/applyHostActionV2\s*\(|applyHostActionV2InstallerV1\s*\(/],
  ['request_signature_binding',/arguments_sha256|request_hash|canonicalJson\s*\(/]
 ]),
 policy:Object.freeze([
  ['legacy_installer_operation',/host_action\.host_action_v2_installer_v1/],
  ['typed_scopes',/"typed_scopes"/]
 ]),
 mcp:Object.freeze([
  ['request_tool',/host_action_v2_request/],
  ['apply_tool',/host_action_v2_apply/],
  ['request_schema',/inputSchema|schema|z\.object|z\.enum/]
 ])
});
function redact(line){
 if(typeof line!=='string')throw Error('inspector_invalid_line');
 // Never output secret literals, headers, environment assignments, or claims.
 if(/token|secret|password|credential|authorization|bearer|private.?key|api.?key|process\.env|cookie|session/i.test(line))
   return '[REDACTED_SENSITIVE_SOURCE_LINE]';
 return line.trim().slice(0,MAX_SOURCE_LINE);
}
function scan(key,buffer){
 if(!KEYS.includes(key)||!Buffer.isBuffer(buffer)||
   !buffer.length||buffer.length>20*1024*1024)
  throw Error('inspector_untrusted_owner');
 const lines=buffer.toString('utf8').split(/\r?\n/);
 const anchors={};
 for(const [label,re] of ANCHORS[key]){
  const found=[];
  for(let i=0;i<lines.length;i++){
   if(re.test(lines[i])){
    if(found.length<MAX_WINDOW_HITS){
     found.push(Object.freeze({
      line:i+1,
      source_sha256:sha(Buffer.from(lines[i]))
      // Never return source excerpts, even those matching an anchor:
      // approval request lines may contain unknown secret-like literals.
     }));
    }
   }
  }
  anchors[label]=Object.freeze({count:lines.reduce((n,l)=>n+(re.test(l)?1:0),0),
    samples:Object.freeze(found)});
 }
 return Object.freeze({
  sha256:sha(buffer),line_count:lines.length,
  anchors:Object.freeze(anchors)
 });
}
function run(){
 if(process.getuid?.()!==0)throw Error('inspector_root_readonly_required');
 const owners={};
 for(const key of KEYS){
  const bytes=check.safeReadPinned(key);
  if(sha(bytes)!==ownerPins.preimage_sha256[key])
   throw Error('inspector_live_preimage_drift:'+key);
  owners[key]=scan(key,bytes);
 }
 const m=owners.executor.anchors;
 if(!m.v2_spec_registry.count||!m.v2_request_handler.count||
    !m.v2_apply_dispatch.count)
  throw Error('inspector_missing_executor_existing_contract');
 if(!owners.mcp.anchors.request_tool.count||!owners.mcp.anchors.apply_tool.count)
  throw Error('inspector_missing_mcp_tool_contract');
 return Object.freeze({
  schema:'prhm.agent3.five-field-bootstrap-live-shape.v1',
  mode:'READ_ONLY_SOURCE_SHAPE',
  host:'prhm-production',
  operator_report_required:true,
  source_bytes_exposed:false,
  approval_issued:false,
  registration_mutation:false,
  production_mutation:false,
  all_four_owner_pins_matched:true,
  owners:Object.freeze(owners),
  next_required:'REVIEW_EXACT_FIVE_FIELD_REQUEST_AND_DISPATCH_WIRING_WITH_SIGNED_LEVEL4'
 });
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--inspect'){
  process.stderr.write('read-only --inspect only; no install or approval available\n');
  process.exitCode=64;
 }else {
  try{process.stdout.write(JSON.stringify(run())+'\n');}
  catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=78;}
 }
}
module.exports=Object.freeze({KEYS,ANCHORS,MAX_SOURCE_LINE,MAX_WINDOW_HITS,redact,scan,run});
