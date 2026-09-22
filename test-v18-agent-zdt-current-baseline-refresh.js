'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const IMPL=path.join(__dirname,'bootstrap-host-actions-v18-agent-zdt-current-baseline-refresh.js');
function load(){delete require.cache[require.resolve(IMPL)];return require(IMPL)}
const sha=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
const REG_BASE=Object.freeze({
 base:'6ae89522f439babd3b6a9679336aea0fb12bb74993d33234095f872d38ad8cc6',
 exec:'409b63bd48b3363eaec2b3921f77ece2767dff93f6143923bdb754fe8f4cf69c',
 policy:'9672e88b8c5033b7107e921d25bd4911216e86a8fe593ee67ac2330e0a75bab2',
 mcp:'703a8f8ee0726fac47d008a69c759e3f52254c980cf551ea3f2660cc46321283',
});
const REG_CAND=Object.freeze({
 base:'de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea',
 exec:'6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9',
 policy:'2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a',
 mcp:'b71b271cf3de3c314cf63491db3873a58336bf25f064271b218a5f602c5bc7eb',
});
const fs=require('node:fs');
const cp=require('node:child_process');
const REG_OWNER_PATHS=Object.freeze({
 base:'/opt/prhm-agent-selfmaint/server.js',
 exec:'/opt/prhm-agent-selfmaint-exec/server.js',
 policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
 mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
});
const STAGED_INSTALLER='/opt/prhm-agent-selfmaint-exec/actions/current-baseline-refresh-registration-installer-v1.js';
function fileSha(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}
function registrationState(){
 const actual=Object.fromEntries(Object.entries(REG_OWNER_PATHS).map(([n,p])=>[n,fileSha(p)]));
 const pre=Object.keys(REG_BASE).every(n=>actual[n]===REG_BASE[n]);
 const post=Object.keys(REG_CAND).every(n=>actual[n]===REG_CAND[n]);
 return {actual,pre,post};
}
function installerForContract(m){
 const state=registrationState();
 if(state.pre)return m.buildRegistrationInstallerSource();
 assert.equal(state.post,true,'registration owners must be exact pre-state or post-state');
 assert.equal(fs.existsSync(STAGED_INSTALLER),true,'post-state staged installer missing');
 const s=fs.readFileSync(STAGED_INSTALLER,'utf8');
 assert.equal(sha(s),m.REGISTRATION_INSTALLER_SOURCE_SHA256);
 return s;
}

test('01 exports fixed promotion action',()=>{const m=load();assert.equal(m.ACTION,'control_plane_typed_bootstrap_current_baseline_refresh_v1');assert.equal(m.PROMOTION_OPERATION,'host_action.control_plane_typed_bootstrap_current_baseline_refresh_v1')});
test('02 validates exact stage evidence',()=>{const m=load();assert.equal(m.validateStageEvidence({transport:{path:m.STAGE_ARTIFACTS.transport.path,sha256:m.STAGE_ARTIFACTS.transport.sha256,exists:true,regular:true,symlink:false},bootstrap:{path:m.STAGE_ARTIFACTS.bootstrap.path,sha256:m.STAGE_ARTIFACTS.bootstrap.sha256,exists:true,regular:true,symlink:false}}),true)});
test('03 stage evidence rejects SHA/path/symlink drift',()=>{const m=load(),g={transport:{path:m.STAGE_ARTIFACTS.transport.path,sha256:m.STAGE_ARTIFACTS.transport.sha256,exists:true,regular:true,symlink:false},bootstrap:{path:m.STAGE_ARTIFACTS.bootstrap.path,sha256:m.STAGE_ARTIFACTS.bootstrap.sha256,exists:true,regular:true,symlink:false}};assert.throws(()=>m.validateStageEvidence({...g,transport:{...g.transport,sha256:'0'.repeat(64)}}));assert.throws(()=>m.validateStageEvidence({...g,bootstrap:{...g.bootstrap,symlink:true}}))});
test('04 refreshes exactly one stale bootstrap baseline',()=>{const m=load(),old='const BASELINE=Object.freeze('+JSON.stringify(m.OLD_BASELINE)+');',cur='const BASELINE=Object.freeze('+JSON.stringify(m.CURRENT_BASELINE)+');',out=m.buildCurrentBaselineCandidate('x\n'+old+'\ny');assert.equal(out.ok,true);assert.equal(out.replacement_count,1);assert.equal(out.content.includes(old),false);assert.equal(out.content.includes(cur),true);assert.equal(out.production_mutation,false)});
test('05 bootstrap baseline refresh fails closed on ambiguity',()=>{const m=load(),old='const BASELINE=Object.freeze('+JSON.stringify(m.OLD_BASELINE)+');';assert.throws(()=>m.buildCurrentBaselineCandidate('none'));assert.throws(()=>m.buildCurrentBaselineCandidate(old+'\n'+old))});
test('06 module exposes no caller-controlled execution surface',()=>{const m=load();for(const k of ['runPromotion','command','exec','spawn','destinationPath','callerContent'])assert.equal(Object.hasOwn(m,k),false)});
test('07 registration baseline is rebound to four live owners',()=>assert.deepEqual(load().REGISTRATION_BASELINE_SHA256,REG_BASE));
test('08 registration candidates are exact SHA-bound outputs',()=>assert.deepEqual(load().REGISTRATION_CANDIDATE_SHA256,REG_CAND));
test('09 registration builder inserts only fixed promotion bindings',()=>{const m=load(),input={base:"const HOST_ACTION_V2_SPECS = Object.freeze({\n  control_plane_typed_bootstrap_transport_v1: { operation: 'host_action.control_plane_typed_bootstrap_transport_v1', rollback: 'host-action-v2:control-plane-typed-bootstrap-transport-v1:journal-restore' },\n});",exec:"const HOST_ACTION_V2_SPECS = Object.freeze({\n  control_plane_typed_bootstrap_transport_v1:{operation:'host_action.control_plane_typed_bootstrap_transport_v1',kind:'control_plane_typed_bootstrap_transport_v1'},\n});\nconst applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){if(action==='control_plane_typed_bootstrap_transport_v1')return applyControlPlaneTypedBootstrapTransportV1();return applyHostActionV2Original(action);};",policy:JSON.stringify({operations:{},typed_scopes:[]},null,2)+'\n',mcp:"const HostActionV2=z.enum([\n'control_plane_typed_bootstrap_transport_v1',\n]);"},out=m.buildRegistrationCandidates(input);assert.equal(out.ok,true);for(const n of ['base','exec','mcp'])assert.match(out.files[n],/control_plane_typed_bootstrap_current_baseline_refresh_v1/);assert.equal(JSON.parse(out.files.policy).operations['host_action.control_plane_typed_bootstrap_current_baseline_refresh_v1'].level,4)});
test('10 duplicate registration is rejected',()=>{const m=load(),a=m.PROMOTION_ACTION;assert.throws(()=>m.buildRegistrationCandidates({base:a,exec:a,mcp:a,policy:JSON.stringify({operations:{},typed_scopes:[]})}))});
test('11 registration owner paths are fixed and complete',()=>assert.deepEqual(load().REGISTRATION_OWNER_PATHS,{base:'/opt/prhm-agent-selfmaint/server.js',exec:'/opt/prhm-agent-selfmaint-exec/server.js',policy:'/opt/prhm-company-control-plane/config/approval-policy.json',mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'}));
test('12 installer is fixed transactional and rollback-safe',()=>{const m=load(),s=installerForContract(m);for(const p of Object.values(m.REGISTRATION_OWNER_PATHS))assert.ok(s.includes(p));for(const h of Object.values(REG_BASE))assert.ok(s.includes(h));assert.match(s,/baseline_drift/);assert.match(s,/candidate_sha_mismatch/);assert.match(s,/backup/i);assert.match(s,/rollback/i);assert.match(s,/--check/);assert.match(s,/prhm-company-approval\.service/);assert.match(s,/prhm-agent-mcp-green\.service/);assert.doesNotMatch(s,/'prhm-agent-mcp\.service'/);assert.doesNotMatch(s,/destinationPath|callerContent/)});
test('13 exported installer SHA equals immutable artifact in pre or post state',()=>{const m=load(),s=installerForContract(m);assert.match(m.REGISTRATION_INSTALLER_SOURCE_SHA256,/^[a-f0-9]{64}$/);assert.equal(m.REGISTRATION_INSTALLER_SOURCE_SHA256,sha(s));assert.match(s,/\.candidate-'\+process\.pid\+'-'\+n\+'\.js'/);let r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:s,encoding:'utf8',timeout:30000,maxBuffer:1000000});assert.equal(r.status,0,String(r.stderr||r.stdout||r.error||''));const state=registrationState();assert.equal(state.pre||state.post,true)});
test('14 stage transport contract remains fixed after registration post-state',()=>{const m=load(),state=registrationState();assert.equal(m.REGISTRATION_INSTALLER_DESTINATION,STAGED_INSTALLER);assert.equal(m.REGISTRATION_INSTALLER_SOURCE_SHA256,'2031d0de149d9f090987fe710df44413cd5ac0a51a7394ff7874c2e9073f077c');if(state.pre){const s=m.buildRegistrationStageTransportSource();assert.match(s,/INSTALLER_B64/);assert.ok(s.includes(m.REGISTRATION_INSTALLER_SOURCE_SHA256));assert.match(s,/source_sha_mismatch/);assert.match(s,/candidate_sha_mismatch/)}else{assert.equal(state.post,true);assert.equal(fileSha(STAGED_INSTALLER),m.REGISTRATION_INSTALLER_SOURCE_SHA256)}});
test('15 stage transport has no caller-controlled dependency',()=>{const m=load(),state=registrationState();if(state.pre){const s=m.buildRegistrationStageTransportSource();assert.doesNotMatch(s,/GENERATOR_SHA/);assert.doesNotMatch(s,/buildRegistrationInstallerSource/);assert.doesNotMatch(s,/bootstrap-host-actions-v18-agent-zdt-current-baseline-refresh\.js/);assert.doesNotMatch(s,/new_content|callerContent|callerPath|destinationPath|req\.body/)}else{assert.equal(state.post,true);const impl=fs.readFileSync(IMPL,'utf8');assert.doesNotMatch(impl,/callerContent|callerPath|destinationPath|req\.body/)}});
test('16 stage transport is atomic in pre-state and exact-idempotent in post-state',()=>{const m=load(),state=registrationState();assert.equal(m.REGISTRATION_STAGE_TRANSPORT_ACTION,'control_plane_current_baseline_refresh_registration_installer_stage_v1');assert.equal(m.REGISTRATION_INSTALLER_DESTINATION,STAGED_INSTALLER);if(state.pre){const s=m.buildRegistrationStageTransportSource();assert.match(s,/--preflight-only/);assert.match(s,/--apply/);assert.match(s,/renameSync/);assert.match(s,/rollback/i);assert.match(s,/production_owner_mutation:false/);assert.match(s,/database_mutation:false/)}else{assert.equal(state.post,true);assert.equal(fileSha(STAGED_INSTALLER),m.REGISTRATION_INSTALLER_SOURCE_SHA256)}});
test('17 mediator binding forward-rebase is fixed Level-4/critical and SHA-bound',()=>{const m=load();assert.equal(m.MEDIATOR_TARGET,'/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js');assert.equal(m.MEDIATOR_BASELINE_SHA256,'e8fc3f5185f01efeca5563490461566f64fc8bda1534bad5a3c39e73a7108abb');const source=["export const FIXED_BINDING=Object.freeze({","  risk:'critical',","});","export const CONFIRM_LITERAL='CONFIRM_LEVEL_4_CRITICAL';","if(Number(request.level)!==4)throw new Error('request_binding_mismatch');","return {request_id:request.request_id,binding_metadata:{action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,project:FIXED_BINDING.project,environment:FIXED_BINDING.environment,risk:FIXED_BINDING.risk,arguments_sha256:ARGUMENTS_SHA256,level:4,expires_at:request.expires_at??null}};","if(String(second_confirmation||'')!==CONFIRM_LITERAL)throw new Error('critical_second_confirmation_required');"].join('\n');const out=m.buildMediatorBindingCandidate(source);assert.equal(out.ok,true);assert.equal(out.replacement_count,5);assert.match(out.content,/risk:'critical'/);assert.match(out.content,/CONFIRM_LEVEL_4_CRITICAL/);assert.match(out.content,/Number\(request\.level\)!==4/);assert.match(out.content,/level:4/);assert.match(out.content,/critical_second_confirmation_required/);assert.doesNotMatch(out.content,/risk:'high'|CONFIRM_LEVEL_3_PRODUCTION|request\.level\)!==3|level:3|level3_confirmation_required/);assert.equal(out.content,source);assert.equal(out.production_mutation,false)});
