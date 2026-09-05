const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mod=require('./bootstrap-prhm-root-of-trust-typed-bootstrap-helper-refresh-v6.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const PRE=Buffer.from('fixture-preimage');
// Fake hash identity is controlled independently because production preimage bytes are not embedded in seed.
function make(opts={}){
 let current=opts.already?mod.candidateBytes():Buffer.from(PRE); let fakeHash=opts.already?mod.CANDIDATE_SHA:mod.PREIMAGE_SHA;
 const calls=[];
 const stat={isFile:()=>!opts.notFile,isSymbolicLink:()=>!!opts.symlink,mode:opts.mode??0o100750,uid:opts.uid??0,gid:opts.gid??0};
 return {calls,
  getuid:()=>opts.uidProcess??0,stat:()=>stat,hash:()=>fakeHash,read:()=>Buffer.from(current),digest:b=>Buffer.compare(Buffer.from(b),PRE)===0?mod.PREIMAGE_SHA:sha(b),
  syntax:b=>{calls.push('syntax');if(opts.syntaxFail)throw Error('syntax')},
  health:()=>{calls.push('health');if(opts.healthFail)throw Error('health');return {ok:true,host_actions_v2:[mod.ACTION]}},
  backup:b=>{calls.push('backup');if(opts.backupFail)throw Error('backup');return 'b1'},
  atomicReplace:b=>{calls.push('replace');current=Buffer.from(b);fakeHash=opts.postHashFail?'0'.repeat(64):mod.CANDIDATE_SHA;if(opts.replaceThrow)throw Error('replace')},
  atomicRestore:b=>{calls.push('restore');if(opts.rollbackFail)throw Error('rollback');current=Buffer.from(b);fakeHash=mod.PREIMAGE_SHA}
 };
}
test('fixed identity and zero-input target contract',()=>{assert.equal(mod.TARGET,'/opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js');assert.equal(mod.PREIMAGE_SHA,'c29846353a4f6e1bdff04cdc213e4db062238e418da6db5a276fb56188939618');assert.equal(mod.CANDIDATE_SHA,'80ce1b2d3a53d45a750035a2ff5c8c67f1e31695e08fd41c8f980d7c7109725a');assert.equal(sha(mod.candidateBytes()),mod.CANDIDATE_SHA)});
test('preflight accepts exact preimage without mutation',()=>{const a=make();const p=mod.preflight(a);assert.equal(p.already_applied,false);assert.equal(p.production_mutation,false);assert.deepEqual(a.calls,['syntax','health'])});
test('already applied is idempotent',()=>{const a=make({already:true});const o=mod.applyWithAdapter(a);assert.equal(o.status,'ALREADY_APPLIED');assert.equal(o.mutation,false);assert.equal(a.calls.includes('replace'),false)});
test('rejects wrong preimage before writes',()=>{const a=make();a.hash=()=> '1'.repeat(64);assert.throws(()=>mod.preflight(a),/target_sha_mismatch/);assert.equal(a.calls.length,0)});
test('rejects symlink and wrong metadata',()=>{assert.throws(()=>mod.preflight(make({symlink:true})),/target_symlink/);assert.throws(()=>mod.preflight(make({mode:0o100755})),/target_mode_mismatch/);assert.throws(()=>mod.preflight(make({uid:1000})),/target_owner_mismatch/)});
test('rejects non-root',()=>{assert.throws(()=>mod.preflight(make({uidProcess:1000})),/root_required/)});
test('successful apply backs up then replaces and verifies',()=>{const a=make();const o=mod.applyWithAdapter(a);assert.equal(o.status,'APPLIED');assert.equal(o.after_sha256,mod.CANDIDATE_SHA);assert.equal(o.rollback_performed,false);assert.ok(a.calls.indexOf('backup')<a.calls.indexOf('replace'));assert.deepEqual(a.calls.slice(-2),['syntax','health'])});
test('post-write hash failure rolls back exact preimage identity',()=>{const a=make({postHashFail:true});const o=mod.applyWithAdapter(a);assert.equal(o.status,'FAILED_ROLLED_BACK');assert.equal(o.rollback_performed,true);assert.ok(a.calls.includes('restore'))});
test('post-write health failure rolls back',()=>{let calls=0;const a=make();a.health=()=>{a.calls.push('health');calls++;if(calls===2)throw Error('posthealth');return {ok:true,host_actions_v2:[mod.ACTION]}};const o=mod.applyWithAdapter(a);assert.equal(o.status,'FAILED_ROLLED_BACK');assert.ok(a.calls.includes('restore'));assert.equal(calls,3)});
test('rollback failure is explicit critical failure',()=>{const a=make({postHashFail:true,rollbackFail:true});assert.throws(()=>mod.applyWithAdapter(a),/apply_failed_rollback_failed/)});
test('source excludes generic execution and unrelated product paths',()=>{const fs=require('node:fs');const s=fs.readFileSync(require.resolve('./bootstrap-prhm-root-of-trust-typed-bootstrap-helper-refresh-v6.js'),'utf8');for(const bad of ['/home/drtarjomeh','/home/imotion','mysql','node:pg','child_process.exec(','SSH_ORIGINAL_COMMAND','authorized_keys'])assert.equal(s.includes(bad),false,bad)});
