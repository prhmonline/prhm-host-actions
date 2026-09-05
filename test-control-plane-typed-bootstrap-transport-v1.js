'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const t=require('./control-plane-typed-bootstrap-transport-v1.js');
const manifest=t.runtimeManifest();
const bytes=t.embeddedPackageBytes();
const noSymlink={lstatSync(p){const e=new Error('no');e.code='ENOENT';throw e}};
test('transport identity and package are immutable',()=>{assert.equal(t.ACTION,'control_plane_typed_bootstrap_transport_v1');assert.equal(t.OPERATION,'host_action.control_plane_typed_bootstrap_transport_v1');assert.equal(t.PACKAGE.package_id,'deployhq_control_adapter_node1_recreate_v1');assert.equal(t.PACKAGE.source_repo,'prhmonline/prhm-host-actions');assert.equal(t.PACKAGE.source_commit,'cb180a622145062b07a314c43c2075d91446aa91');assert.equal(t.PACKAGE.manifest_sha256,'e4f0399e99efa32c70d597a0341ef606cc3c8e48d6a55e9aee0b2aac14ad4089');});
test('runtime request surface is empty',()=>assert.deepEqual(t.REQUEST_FIELDS,[]));
test('valid exact manifest and bytes pass',()=>{assert.equal(t.validateManifest(manifest),true);assert.equal(t.validatePackageBytes(manifest,bytes),true)});
test('destination outside allowlist fails closed',()=>assert.throws(()=>t.validateDestination({destination_path:'/root/x'},noSymlink),/destination_not_allowlisted/));
test('artifact sha mismatch fails closed',()=>{const b={...bytes,[manifest.records[0].source_path]:Buffer.from('tampered')};assert.throws(()=>t.validatePackageBytes(manifest,b),/artifact_sha_mismatch/)});
test('symlink destination fails closed',()=>{const f={lstatSync(p){if(p===manifest.records[0].destination_path)return {isSymbolicLink:()=>true};const e=new Error();e.code='ENOENT';throw e}};assert.throws(()=>t.validateDestination(manifest.records[0],f),/destination_symlink/)});
test('symlink parent fails closed',()=>{const parent='/opt/prhm-deployhq-control';const f={lstatSync(p){if(p===parent)return {isSymbolicLink:()=>true};const e=new Error();e.code='ENOENT';throw e}};assert.throws(()=>t.validateDestination(manifest.records[0],f),/destination_parent_symlink/)});
test('alternate path spelling and relative destination reject',()=>{const m=structuredClone(manifest);m.records[0].destination_path='/opt/prhm-deployhq-control/../prhm-deployhq-control/server.js';assert.throws(()=>t.validateManifest(m),/destination_path_invalid|manifest_record_mismatch/);const m2=structuredClone(manifest);m2.records[0].destination_path='opt/prhm-deployhq-control/server.js';assert.throws(()=>t.validateManifest(m2),/destination_path_invalid|manifest_record_mismatch/)});
test('manifest chaining or extra fields reject',()=>{const m=structuredClone(manifest);m.records[0].next_manifest='x';assert.throws(()=>t.validateManifest(m),/manifest_record_fields_invalid/);const m2=structuredClone(manifest);m2.parent_manifest='x';assert.throws(()=>t.validateManifest(m2),/manifest_top_level_fields_invalid/)});
test('secret-like manifest keys reject',()=>{const m=structuredClone(manifest);m.records[0].api_key_value='x';assert.throws(()=>t.validateManifest(m),/secret_like_manifest_key/)});
test('redactEvidence hides auth and secret-like keys',()=>{const o=t.redactEvidence({token:'abc',msg:'Bearer abc',nested:{password:'p',ok:true}});assert.equal(o.token,'[REDACTED]');assert.equal(o.msg,'[REDACTED]');assert.equal(o.nested.password,'[REDACTED]');assert.equal(o.nested.ok,true)});

test('preflight performs zero writes and returns required evidence',()=>{
 const writes=[];
 const fsApi={lstatSync(p){const e=new Error();e.code='ENOENT';throw e},writeFileSync(){writes.push('write')},renameSync(){writes.push('rename')}};
 const execApi={verifyNode(){return {ok:true}},verifyUnit(){return {ok:true}}};
 const out=t.preflight({fsApi,execApi,manifest,packageBytes:bytes,sourceCommit:t.PACKAGE.source_commit,manifestSha:t.PACKAGE.manifest_sha256,liveBaseline:{expected:{a:'1'},actual:{a:'1'}}});
 assert.equal(writes.length,0);
 assert.equal(out.ok,true);assert.equal(out.preflight_only,true);assert.equal(out.production_mutation,false);
});

test('preflight rejects wrong source commit and manifest sha',()=>{
 const fsApi={lstatSync(){const e=new Error();e.code='ENOENT';throw e}};const execApi={verifyNode(){return {ok:true}},verifyUnit(){return {ok:true}}};
 assert.throws(()=>t.preflight({fsApi,execApi,manifest,packageBytes:bytes,sourceCommit:'0'.repeat(40),manifestSha:t.PACKAGE.manifest_sha256,liveBaseline:{expected:{a:1},actual:{a:1}}}),/source_commit_mismatch/);
 assert.throws(()=>t.preflight({fsApi,execApi,manifest,packageBytes:bytes,sourceCommit:t.PACKAGE.source_commit,manifestSha:'0'.repeat(64),liveBaseline:{expected:{a:1},actual:{a:1}}}),/manifest_sha_mismatch/);
});
test('preflight rejects artifact sha mismatch and syntax failure',()=>{
 const fsApi={lstatSync(){const e=new Error();e.code='ENOENT';throw e}};const okExec={verifyNode(){return {ok:true}},verifyUnit(){return {ok:true}}};
 const bad={...bytes,[manifest.records[1].source_path]:Buffer.from('bad')};
 assert.throws(()=>t.preflight({fsApi,execApi:okExec,manifest,packageBytes:bad,sourceCommit:t.PACKAGE.source_commit,manifestSha:t.PACKAGE.manifest_sha256,liveBaseline:{expected:{a:1},actual:{a:1}}}),/artifact_sha_mismatch/);
 const badExec={verifyNode(){return {ok:false}},verifyUnit(){return {ok:true}}};
 assert.throws(()=>t.preflight({fsApi,execApi:badExec,manifest,packageBytes:bytes,sourceCommit:t.PACKAGE.source_commit,manifestSha:t.PACKAGE.manifest_sha256,liveBaseline:{expected:{a:1},actual:{a:1}}}),/syntax_failed/);
});
test('preflight rejects baseline drift and destination conflict',()=>{
 const none={lstatSync(){const e=new Error();e.code='ENOENT';throw e}};const execApi={verifyNode(){return {ok:true}},verifyUnit(){return {ok:true}}};
 assert.throws(()=>t.preflight({fsApi:none,execApi,manifest,packageBytes:bytes,sourceCommit:t.PACKAGE.source_commit,manifestSha:t.PACKAGE.manifest_sha256,liveBaseline:{expected:{a:1},actual:{a:2}}}),/baseline_drift/);
 const conflict={lstatSync(p){if(p===manifest.records[0].destination_path)return {isSymbolicLink:()=>false,isDirectory:()=>true,isFile:()=>false};const e=new Error();e.code='ENOENT';throw e}};
 assert.throws(()=>t.preflight({fsApi:conflict,execApi,manifest,packageBytes:bytes,sourceCommit:t.PACKAGE.source_commit,manifestSha:t.PACKAGE.manifest_sha256,liveBaseline:{expected:{a:1},actual:{a:1}}}),/destination_conflict/);
});
test('preflight evidence contains no auth or secret values',()=>{
 const fsApi={lstatSync(){const e=new Error();e.code='ENOENT';throw e}};const execApi={verifyNode(){return {ok:true,token:'SHOULD_NOT_LEAK'}},verifyUnit(){return {ok:true,authorization:'Basic abc'}}};
 const out=t.preflight({fsApi,execApi,manifest,packageBytes:bytes,sourceCommit:t.PACKAGE.source_commit,manifestSha:t.PACKAGE.manifest_sha256,liveBaseline:{expected:{a:1},actual:{a:1}}});
 const text=JSON.stringify(out);assert.doesNotMatch(text,/SHOULD_NOT_LEAK|Basic abc/);
});


function makeApplyDeps(opts={}){
 const trace=[];const installed=new Map();const backups=new Map();const stages=new Map();
 const fsApi={lstatSync(){const e=new Error();e.code='ENOENT';throw e}};
 const execApi={verifyNode(){return {ok:true}},verifyUnit(){return {ok:true}}};
 const io={
  inspect(p){const b=installed.get(p);return b?{exists:true,sha256:t.sha256(b),mode:'0750',owner:'root',group:'root',is_symlink:false}:{exists:false,is_symlink:false}},
  backup(p,id){const bp='/backup/'+id+'/'+Buffer.from(p).toString('hex');backups.set(bp,installed.get(p));trace.push({kind:'backup',path:p});return bp},
  readBackup(p){if(opts.rollbackReadFail)throw new Error('rollback read fail');return backups.get(p)},
  restoreBackup(p,bp){if(opts.rollbackRestoreFail)throw new Error('restore fail');installed.set(p,backups.get(bp));trace.push({kind:'restore',path:p})},
  remove(p){installed.delete(p);trace.push({kind:'remove',path:p})},
  persistJournal(j){trace.push({kind:'journal',mutation_started:j.mutation_started})},
  stageCandidate(id,r,b){const p='/stage/'+id+'/'+Buffer.from(r.source_path).toString('hex');stages.set(p,Buffer.from(b));trace.push({kind:'stage',path:p});return p},
  readStage(p){return stages.get(p)},
  installAtomic(sp,dp){installed.set(dp,Buffer.from(stages.get(sp)));trace.push({kind:'write',path:dp});if(opts.tamperPostWrite&&trace.filter(x=>x.kind==='write').length===1)installed.set(dp,Buffer.from('tampered'))},
  readInstalled(p){return installed.get(p)},
  persistResult(r){trace.push({kind:'result',ok:r.ok})}
 };
 const serviceApi={getState(){return {active:false,enabled:false}},daemonReload(){trace.push({kind:'daemon-reload'})},startOrRestart(s){trace.push({kind:'service',service:s})},restoreState(s,state){if(opts.serviceRestoreFail)throw new Error('service restore fail');trace.push({kind:'service-restore',service:s,state})}};
 const healthSequence=Array.isArray(opts.healthSequence)?opts.healthSequence.slice():null;const healthApi={checkAdapter(){if(healthSequence&&healthSequence.length){const v=healthSequence.shift();trace.push({kind:'health',value:v});return v}return opts.health||{ok:true}},sleep(ms){trace.push({kind:'sleep',ms})}};
 return {trace,installed,manifest,packageBytes:bytes,sourceCommit:t.PACKAGE.source_commit,manifestSha:t.PACKAGE.manifest_sha256,liveBaseline:{expected:{a:1},actual:{a:1}},fsApi,execApi,io,serviceApi,healthApi,invocationId:'11111111-1111-4111-8111-111111111111'};
}
test('apply writes only manifest-owned destinations',()=>{const d=makeApplyDeps();const out=t.applyTransaction(d);assert.equal(out.ok,true);const writes=d.trace.filter(x=>x.kind==='write').map(x=>x.path);assert.deepEqual(new Set(writes),new Set(manifest.records.map(r=>r.destination_path)));assert.deepEqual(d.trace.filter(x=>x.kind==='service').map(x=>x.service),['prhm-deployhq-control.service']);});
test('apply journal exists before first destination write',()=>{const d=makeApplyDeps();t.applyTransaction(d);const ji=d.trace.findIndex(x=>x.kind==='journal');const wi=d.trace.findIndex(x=>x.kind==='write');assert.ok(ji>=0&&ji<wi)});
test('post-write sha mismatch rolls back invocation-owned created files',()=>{const d=makeApplyDeps({tamperPostWrite:true});const out=t.applyTransaction(d);assert.equal(out.ok,false);assert.equal(out.rollback_performed,true);for(const r of manifest.records)assert.equal(d.installed.has(r.destination_path),false);});
test('adapter health failure rolls back but credentials-missing remains fail-closed installed',()=>{const d=makeApplyDeps({health:{ok:false,reason:'boom'}});const out=t.applyTransaction(d);assert.equal(out.rollback_performed,true);const d2=makeApplyDeps({health:{ok:false,reason:'deployhq_credentials_missing'}});const out2=t.applyTransaction(d2);assert.equal(out2.ok,true);assert.equal(out2.adapter_ready,false);assert.equal(out2.readiness_reason,'deployhq_credentials_missing');});
test('adapter readiness retries transient health failure before rollback',()=>{const d=makeApplyDeps({healthSequence:[{ok:false,reason:'adapter_unhealthy'},{ok:true}]});const out=t.applyTransaction(d);assert.equal(out.ok,true);assert.equal(out.rollback_performed,false);assert.equal(d.trace.filter(x=>x.kind==='health').length,2);assert.deepEqual(d.trace.filter(x=>x.kind==='sleep').map(x=>x.ms),[2000]);});
test('rollback failure returns critical explicit evidence',()=>{const d=makeApplyDeps({tamperPostWrite:true,rollbackRestoreFail:true});d.installed.set(manifest.records[0].destination_path,Buffer.from('old'));const out=t.applyTransaction(d);assert.equal(out.ok,false);assert.equal(out.critical_failure,true);assert.equal(out.rollback_failed,true);});
test('no unrelated service or MCP runtime restart occurs',()=>{const d=makeApplyDeps();t.applyTransaction(d);const text=JSON.stringify(d.trace);assert.doesNotMatch(text,/prhm-agent-mcp|honartik|imotion/);assert.match(text,/prhm-deployhq-control\.service/);});

test('embedded runtime package bytes match compiled manifest hashes',()=>{const b=t.embeddedPackageBytes();assert.equal(t.validatePackageBytes(t.runtimeManifest(),b),true)});
test('production node verifier is fileless and package has no unit record',()=>{const e=t.productionExecApi({nodeBin:process.execPath});assert.equal(e.verifyNode('x.js',Buffer.from("'use strict';\nconst x=1;\n")).ok,true);assert.equal(t.runtimeManifest().records.some(r=>r.source_path.endsWith('.service')),false)});
test('CLI rejects arbitrary arguments without mutation',()=>assert.throws(()=>t.main(['--command=sh']),/unexpected_arguments/));


test('production installAtomic promotes through destination-local temp to avoid EXDEV', () => {
  const src=require('node:fs').readFileSync(require.resolve('./control-plane-typed-bootstrap-transport-v1.js'),'utf8');
  assert.equal(src.includes("fs.renameSync(sp,dp)"),false);
  assert.equal(src.includes("fs.copyFileSync(sp,tmp,fs.constants.COPYFILE_EXCL)"),true);
  assert.equal(src.includes("const tmp=dp+'.candidate-'"),true);
  assert.equal(src.includes("fs.renameSync(tmp,dp)"),true);
  assert.equal(src.includes("fs.fsyncSync(dfd)"),true);
});
