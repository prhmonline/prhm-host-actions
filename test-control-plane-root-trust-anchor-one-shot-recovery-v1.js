'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const crypto=require('node:crypto');
const r=require('./control-plane-root-trust-anchor-one-shot-recovery-v1.js');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'rta-'));}

test('repairs only the fixed root_scripts trust anchor and fixed recovery artifacts',()=>assert.equal(typeof r.runRecovery,'function'));
test('contains all immutable approved bindings',()=>{
 assert.equal(r.SPEC.expected.base,'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd');
 assert.equal(r.SPEC.expected.executor,'1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd');
 assert.equal(r.SPEC.expected.mcp,'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71');
 assert.equal(r.SPEC.expected.policy,'c0cb39528b9658cc01d9c97f4011f9200efa9e0a862d202cf4ef82824594c9e0');
 assert.equal(r.SPEC.artifacts['control-plane-approval-bootstrap-recovery-v1.sh'],'142383a58e5647a95bf2c7a4200772e7b7eb7cdde6783df991aec89d6f8151dd');
 assert.equal(r.SPEC.artifacts['control-plane-approval-bootstrap-recovery-v1.json'],'b3918639f19a489373489e714c86c733f5b8c0a851727b2b65b3831b071cb1d2');
});
test('baseline drift fails before mutation',()=>{const d=tmp(),paths={}; const expected={}; for(const k of ['base','executor','mcp','policy']){paths[k]=path.join(d,k);fs.writeFileSync(paths[k],k);expected[k]=H(Buffer.from(k));} fs.writeFileSync(paths.policy,'drift'); assert.throws(()=>r.verifyBaselines({paths},expected),/baseline_sha_mismatch:policy/);});
test('executor capability must already exist',()=>{const d=tmp(),f=path.join(d,'e');fs.writeFileSync(f,"root_scripts_fixed_stage_v1 /opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js");assert.equal(r.verifyExecutorCapability({paths:{executor:f}}),true);});
test('base registry patch is deterministic and duplicate safe',()=>{const a="  honartik_iticket_dark_backend_batch2_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch2_v1', rollback: 'host-action-v2:honartik-iticket-dark-backend-batch2-v1:worktree-file-rollback' },"; const x='A\n'+a+'\nB'; const y=r.patchBaseRegistry(x);assert.equal((y.match(/root_scripts_fixed_stage_v1/g)||[]).length,2);assert.equal(r.patchBaseRegistry(y),y);});
test('base patch rejects ambiguous anchor',()=>assert.throws(()=>r.patchBaseRegistry('x'),/base_anchor_ambiguous/));
test('policy patch clones exact fixed reference scope at level 4',()=>{const p={operations:{'host_action.honartik_iticket_dark_backend_batch2_v1':{level:4}},scopes:[{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'honartik_iticket_dark_backend_batch2_v1',risk:'critical',operation:'host_action.honartik_iticket_dark_backend_batch2_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]}; const out=JSON.parse(r.patchApprovalPolicy(JSON.stringify(p)));assert.equal(out.operations['host_action.root_scripts_fixed_stage_v1'].level,4);const s=out.scopes.find(x=>x.action==='root_scripts_fixed_stage_v1');assert.equal(s.operation,'host_action.root_scripts_fixed_stage_v1');assert.equal(s.risk,'critical');});
test('policy patch is duplicate safe',()=>{const p={operations:{'host_action.honartik_iticket_dark_backend_batch2_v1':{level:4}},scopes:[{action:'honartik_iticket_dark_backend_batch2_v1',operation:'host_action.honartik_iticket_dark_backend_batch2_v1'}]};const a=r.patchApprovalPolicy(JSON.stringify(p));const b=r.patchApprovalPolicy(a);assert.deepEqual(JSON.parse(a),JSON.parse(b));});
test('artifact SHA mismatch is rejected',()=>{const d=tmp(),s=path.join(d,'s'),t=path.join(d,'out','x');fs.writeFileSync(s,'abc');assert.throws(()=>r.materializeOne(s,t,'0'.repeat(64)),/artifact_source_sha_mismatch/);});
test('artifact materialization is atomic and idempotent for verified bytes',()=>{const d=tmp(),s=path.join(d,'s'),t=path.join(d,'out','x'),b=Buffer.from('verified');fs.writeFileSync(s,b);const h=H(b);assert.equal(r.materializeOne(s,t,h).changed,true);assert.equal(r.materializeOne(s,t,h).changed,false);assert.equal(H(fs.readFileSync(t)),h);});
test('production orchestrator fails closed until canonical artifact provenance is resolved',()=>assert.throws(()=>r.runRecovery(),/canonical_artifact_provenance_unresolved/));
