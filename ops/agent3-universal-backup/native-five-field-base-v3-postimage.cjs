'use strict';
/**
 * SHA-pinned candidate for TWO independent five-field Base v3 routes.
 * Review-only code generation; no file writes, approval traffic or installs.
 * The existing /v1 and /v2 action-only routes remain byte-for-byte intact.
 *
 * The root Executor must separately:
 * 1. persist the issued request in its root-owned O_EXCL five-field store,
 * 2. re-read that record and validate exact seven apply fields,
 * 3. call Base decision-consume ONLY after its trusted precheck,
 * 4. independently verify the returned signed Ed25519 JWS and consumed ledger,
 * 5. run the fixed rollback-ready installer with exclusive execution claim.
 */
const crypto=require('node:crypto');
const vm=require('node:vm');
const pins=require('./production-registration-contract.json');
const registration=require('./registration-contract.cjs');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const REQUEST='/v3/agent3-registry/request';
const CONFIRM='/v3/agent3-registry/confirm-consume';
const BASE_ANCHOR="    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {";
const ACTION=gateway.ACTION;
const OPERATION=gateway.OPERATION;
const SOURCE=registration.SOURCE_COMMIT;
const ROLLBACK='host-action-v2:prhm-action-registry-install-v1:verified-four-owner-restore';
function deny(reason){throw Error('agent3_base_v3_candidate_denied:'+reason);}
function v3Snippet(){
 // Hardcoded strings are emitted as properly quoted JS literals, NOT text
 // interpolated from caller arguments.
 const q=JSON.stringify;
 const schema="['action','project','source_commit','manifest_commit','manifest_sha256']";
 const lines=[
  "    // Agent3 v3: independently typed five-field registrar. Legacy v2 remains untouched.",
  "    if (req.method === 'POST' && req.url === "+q(REQUEST)+") {",
  "      const input=await readBody(req);",
  "      if (!input || typeof input!=='object' || Array.isArray(input) ||",
  "          Object.keys(input).sort().join('|')!=="+schema+".sort().join('|') ||",
  "          input.action!=="+q(ACTION)+" || input.project!=='agent3' ||",
  "          input.source_commit!=="+q(SOURCE)+" ||",
  "          !/^[a-f0-9]{40}$/.test(input.manifest_commit) ||",
  "          !/^[a-f0-9]{64}$/.test(input.manifest_sha256))",
  "        throw Object.assign(new Error('agent3_registry_exact_five_fields_required'),{status:400});",
  "      const args={action:"+q(ACTION)+",project:'agent3',",
  "        source_commit:"+q(SOURCE)+",",
  "        manifest_commit:input.manifest_commit,manifest_sha256:input.manifest_sha256};",
  "      const digest=argumentsSha256(args);",
  "      const env=readEnvFile(APPROVAL_CLIENT_ENV);",
  "      if (!env.APPROVAL_REQUEST_TOKEN) throw new Error('approval_request_token_missing');",
  "      const result=approvalHttp('POST','/v1/requests',env.APPROVAL_REQUEST_TOKEN,{",
  "        principal_id:'mohammad',role:'mcp-operator',tool:'host_action_v2_apply',",
  "        project:'control_plane',environment:'production',",
  "        action:"+q(ACTION)+",risk:'critical',operation:"+q(OPERATION)+",",
  "        arguments:args,arguments_sha256:digest,ttl_seconds:180,",
  "        rollback_reference:"+q(ROLLBACK),
  "      });",
  "      const issued=result.request||{};",
  "      const expiry=Date.parse(issued.expires_at);",
  "      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(issued.request_id||'') ||",
  "         issued.action!=="+q(ACTION)+" || issued.arguments_sha256!==digest ||",
  "         Number(issued.level)!==4 || issued.risk!=='critical' ||",
  "         !Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+180000)",
  "        throw Object.assign(new Error('agent3_registry_issuer_binding_mismatch'),{status:409});",
  "      return send(res,201,{ok:true,request:{request_id:issued.request_id,",
  "        expires_at:issued.expires_at,action:"+q(ACTION)+",arguments_sha256:digest,",
  "        level:4,risk:'critical'},arguments_sha256:digest});",
  "    }",
  "    if (req.method === 'POST' && req.url === "+q(CONFIRM)+") {",
  "      const input=await readBody(req);",
  "      if (!input || typeof input!=='object'||Array.isArray(input)||",
  "          Object.keys(input).sort().join('|')!==",
  "          ['request_id','second_confirmation',..."+schema+"].sort().join('|') ||",
  "          input.action!=="+q(ACTION)+" || input.project!=='agent3' ||",
  "          input.source_commit!=="+q(SOURCE)+" ||",
  "          !/^[a-f0-9]{40}$/.test(input.manifest_commit) ||",
  "          !/^[a-f0-9]{64}$/.test(input.manifest_sha256) ||",
  "          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.request_id||'') ||",
  "          input.second_confirmation!=='CONFIRM_LEVEL_4_CRITICAL')",
  "        throw Object.assign(new Error('agent3_registry_confirmation_binding_required'),{status:400});",
  "      const args={action:"+q(ACTION)+",project:'agent3',",
  "        source_commit:"+q(SOURCE)+",",
  "        manifest_commit:input.manifest_commit,manifest_sha256:input.manifest_sha256};",
  "      const digest=argumentsSha256(args);",
  "      const env=readEnvFile(APPROVAL_CLIENT_ENV);",
  "      if(!env.APPROVAL_DECISION_TOKEN)throw new Error('approval_decision_token_missing');",
  "      const decision=approvalHttp('POST','/v1/requests/'+input.request_id+'/decision',",
  "        env.APPROVAL_DECISION_TOKEN,{decision:'accept',",
  "          rollback_reference:"+q(ROLLBACK)+",",
  "          second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',",
  "          note:'Fixed five-field Agent3 registrar enrollment'});",
  "      const approval=decision.approval||{};",
  "      const token=String(decision.approval_token||decision.token||approval.token||'');",
  "      if(approval.execution_authorized!==true||approval.request_id!==input.request_id||",
  "         approval.action!=="+q(ACTION)+"||approval.arguments_sha256!==digest||",
  "         approval.request_hash!==digest||Number(approval.level)!==4||",
  "         approval.risk!=='critical'||approval.one_time_use!==true||",
  "         !/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(token)||",
  "         token.length<120||token.length>16384)",
  "        throw Object.assign(new Error('agent3_registry_decision_binding_mismatch'),{status:409});",
  "      const binding={approval_token:token,principal_id:'mohammad',",
  "        role:'mcp-operator',tool:'host_action_v2_apply',",
  "        project:'control_plane',environment:'production',",
  "        action:"+q(ACTION)+",risk:'critical',operation:"+q(OPERATION)+",",
  "        arguments_sha256:digest};",
  "      const validated=await approvalBridge('/v1/validate',binding);",
  "      if(validated.valid!==true)throw Object.assign(new Error('agent3_registry_approval_invalid'),{status:409});",
  "      const consumed=await approvalBridge('/v1/consume',{...binding,",
  "        consumer:'prhm-agent-selfmaint-exec-host-actions-v2'});",
  "      if(consumed.consumed!==true)throw Object.assign(new Error('agent3_registry_approval_not_consumed'),{status:409});",
  "      // Token only over pre-existing root-owned AF_UNIX transport to Executor.",
  "      // This response DOES NOT authenticate the Ed25519 signature or ledger.",
  "      return send(res,200,{ok:true,request_id:input.request_id,",
  "        arguments_sha256:digest,approval_token:token,",
  "        consumed_by_approval_center:true,root_jws_verified:false});",
  "    }",
  ""
 ];
 return lines.join('\n');
}
function inject(source){
 if(typeof source!=='string'||!source.includes(BASE_ANCHOR)||
    source.split(BASE_ANCHOR).length!==2)deny('base_v2_anchor_missing_or_duplicate');
 if(source.includes(REQUEST)||source.includes(CONFIRM))deny('v3_route_already_present');
 const next=source.replace(BASE_ANCHOR,v3Snippet()+'\n'+BASE_ANCHOR);
 // Old action-only request, confirm and authorize consume handlers survive.
 for(const legacy of ['/v2/host-actions/request','/v2/host-actions/confirm',
   '/v2/host-actions/authorize-consume']){
  if(!next.includes(legacy))deny('legacy_route_removed');
 }
 try{new vm.Script(next,{filename:'sha-pinned-Agent3-Base-v3-candidate.js'});}
 catch{deny('candidate_syntax_invalid');}
 return next;
}
function propose(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>20*1024*1024||
    sha(bytes)!==pins.preimage_sha256.base)deny('base_preimage_not_pinned');
 const source=bytes.toString('utf8');
 if(!Buffer.from(source,'utf8').equals(bytes))deny('noncanonical_utf8');
 const candidate=Buffer.from(inject(source));
 return Object.freeze({
  schema:'prhm.agent3.base-v3-five-field-source-candidate.v1',
  original_sha256:pins.preimage_sha256.base,postimage_sha256:sha(candidate),
  bytes:candidate,distinct_legacy_routes_preserved:true,
  source_only:true,executor_v3_route_installed:false,
  root_rollback_verified:false,signed_level4_consumed:false,
  production_mutation:false,ready_to_install:false
 });
}
if(require.main===module){
 process.stderr.write('SHA-pinned Base v3 proposal only; no stage, apply, approval or production changes\n');
 process.exitCode=78;
}
module.exports=Object.freeze({REQUEST,CONFIRM,BASE_ANCHOR,v3Snippet,inject,propose});
