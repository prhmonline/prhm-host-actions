'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const tx=require('./deploy-control-l4-post-registration-cutover-v2.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const base=process.env.PRHM_L4_RUNTIME_TEST_FIXTURES;
const required=['policy-candidate.json','dispatcher.mjs','core.mjs','gated.sudoers'];
function fixtures(){
 if(!base)throw Error('isolated_real_blob_fixtures_required');
 const assets={policy:fs.readFileSync(path.join(base,'policy-candidate.json')),
 dispatcher:fs.readFileSync(path.join(base,'dispatcher.mjs')),
 core:fs.readFileSync(path.join(base,'core.mjs')),
 sudoers:fs.readFileSync(path.join(base,'gated.sudoers'))};
 const stage=Buffer.from('# Honartik staging canonical rebuild privilege boundary.\n# deploy-runner may execute ONLY the fixed no-argument dry-run wrapper.\ndeploy-runner ALL=(root) NOPASSWD: /usr/local/libexec/prhm-agent/honartik-staging-canonical-dry-run ""\n');
 const old=new Map([
  [tx.ASSETS[0].path,Buffer.from(assets.policy)],
  [tx.LEGACY[0].path,Buffer.from('deploy-runner ALL=(prhm) NOPASSWD: /home/prhm/deploy/aranob-production.sh *\n')],
  [tx.LEGACY[1].path,Buffer.from('deploy-runner ALL=(root) NOPASSWD: /usr/local/libexec/deploy-control/honartik-front-production *\ndeploy-runner ALL=(honartik) NOPASSWD: /usr/local/libexec/deploy-control/honartik-back-production *\n')],
  [tx.STAGING.path,stage]
 ]);
 return {assets,old};
}
function harness({inject='',receiptPatch=null,wrongLive=false,unfreezeFail=false}={}){
 const {assets,old}=fixtures();
 let files=new Map([...old].map(([k,b])=>[k,Buffer.from(b)]));
 let snapshot=null,policyNew=true,frozen=false,consumed=0,writeCount=0,rollbacks=0,discoveryCalls=0,policyShaReads=0;
 const events=[],calls=[];
 const before=()=>{
  const state=policyNew?{version:'2026-10-15.1-deploy-control-l4-installer-enrollment-v1',
   hash:'732c21b15a54b47dced724e1f5be1c70aa1bd6c41cc5f94c5d2f600e45c36acb'}:
   {version:'2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1',
    hash:'c141ce7d56bf1de9c11a6e98b0abd6d20da9a349a6cbe1735c5bb659e3a70fea'};
  return {ok:true,service:'prhm-company-approval',mode:'mcp-operator',
   one_time_use:true,algorithm:'Ed25519',policy_version:state.version,
   policy_hash:state.hash};
 };
 const failPoint=(name)=>{if(inject===name)throw Error('simulated_'+name)};
 const host={
  assertTrustedRootExecutor:async()=>{failPoint('root');return true},
  attestExactGitCommitAndBlobs:async input=>{
   calls.push('git'); assert.equal(input.commit,'1e16bbb633a2d7b62d1322fe4c93bf9df346a748');return true},
  freezeAllDeployEntrypoints:async()=>{calls.push('freeze');frozen=true;return true},
  readTrustedFile:async p=>files.get(p),
  attestRootFileSha256:async p=>{
    assert.equal(p,tx.ASSETS[0].path);
    policyShaReads++;
    if(inject==='wrong-live-hash')return '0'.repeat(64);
    if(inject==='legacy-policy-before-registration')
      return '148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174';
    if(inject==='registered-policy-drift-postwrite'&&policyShaReads>1)
      return 'f'.repeat(64);
    return tx.ASSETS[0].sha256;
  },
  assertAbsent:async p=>!files.has(p),
  inspectEffectiveSudoGrants:async ({phase})=>{
   if(phase==='before')return files.has(tx.LEGACY[0].path)&&files.has(tx.LEGACY[1].path);
   return !files.has(tx.LEGACY[0].path)&&!files.has(tx.LEGACY[1].path)&&
     files.has('/etc/sudoers.d/prhm-deploy-control-gated')},
  verifyBackupArchive:async p=>{assert.equal(p.sha256,tx.BACKUP.sha256);return true},
  createDurableRecoveryJournal:async ()=>{
   calls.push('journal');
   snapshot=new Map([...files].map(([k,v])=>[k,Buffer.from(v)]));
   return {id:'fixture-durable-backup'};
  },
  verifyRecoveryIsReady:async()=>true,
  readPrivateExecutorToken:async()=>('isolated-only-fake-nonsecret-executor-token-'+('q'.repeat(40))),
  consumeSignedExactLevel4Authorization:async input=>{
   calls.push('consume');consumed++;failPoint('consume');
   return {...input,signed:true,consumed_once:true,source_git_pinned:true,
    request_id:'d473c3c7-77c1-4e51-82dc-a08300ac3612',...(receiptPatch||{})};
  },
  atomicWriteRootFile:async(p,b,mode)=>{
   calls.push('write:'+p);writeCount++;failPoint('write-'+writeCount);
   assert.ok([0o600,0o644,0o755,0o440].includes(mode));
   assert.ok([...tx.ASSETS.slice(1).map(x=>x.path),'/etc/prhm-deploy-control/approval-gate.json'].includes(p));
   assert.notEqual(p,tx.ASSETS[0].path,'policy_mutation_forbidden_in_phase_2');
   files.set(p,Buffer.from(b));return true;
  },
  removeExactLegacySudoers:async(p,expected)=>{
   calls.push('remove:'+p);failPoint('remove');
   assert.equal(sha(files.get(p)),expected);files.delete(p);return true;
  },
  validateFullSudoers:async()=>{failPoint('visudo');return true},
  reloadApprovalCenter:async()=>{throw Error('PHASE_2_ISSUER_RELOAD_FORBIDDEN')},
  getApprovalCenterHealth:async()=>wrongLive?{...before(),policy_hash:'a'.repeat(64)}:before(),
  getFixedToolDiscovery:async()=>{discoveryCalls++;if(inject==='unregistered-preflight')return false;if(inject==='registration'&&discoveryCalls>1)throw Error('simulated_registration');return true},
  verifyInstalledPostimages:async({assets,legacy_absent,staging})=>{
   failPoint('postimage');for(const a of assets)if(!files.has(a.path)||sha(files.get(a.path))!==a.sha256)return false;
   for(const a of legacy_absent)if(files.has(a))return false;
   return sha(files.get(staging.path))===staging.sha256;
  },
  restoreJournalAndReload:async()=>{
   calls.push('rollback');rollbacks++;if(inject==='broken-rollback')return false;
   files=new Map([...snapshot].map(([k,v])=>[k,Buffer.from(v)]));policyNew=true;
   return true;
  },
  durableAudit:async x=>{events.push(x.event);failPoint('audit-'+x.event)},
  unfreezeAllDeployEntrypoints:async()=>{calls.push('unfreeze');frozen=false;return !unfreezeFail}
 };
 return {host,assets,old,calls,events,gets:()=>({files,consumed,writeCount,rollbacks,frozen})};
}
function sameState(actual,old){
 assert.deepEqual([...actual.files].map(([k,v])=>[k,sha(v)]).sort(),
   [...old].map(([k,v])=>[k,sha(v)]).sort());
}
test('literal allowlisted production plan matches exact GitHub blob SHA256s',()=>{
 const {assets}=fixtures();assert.equal(tx.verifySource(assets),true);
 assert.equal(tx.ASSETS.length,4);
 assert.equal(tx.OPERATION,'host_action.deploy_control_cutover_install_v1');
 assert.deepEqual(tx.LEGACY.map(x=>x.path),[
 '/etc/sudoers.d/aranob-deploy-runner','/etc/sudoers.d/deploy-control-honartik']);
 assert.equal(typeof tx.cli,'undefined');
});
test('post-registration executor installs drivers, revokes legacy grants, NEVER edits or reloads issuer policy',async()=>{
 const h=harness();const result=await tx.applyFixedCutover({host:h.host,assets:h.assets});
 assert.equal(result.ok,true);assert.equal(h.gets().consumed,1);
 assert.equal(h.gets().rollbacks,0);assert.equal(h.gets().frozen,false);
 assert.ok(h.events.includes('installed'));
 assert.equal(sha(h.gets().files.get(tx.ASSETS[0].path)),tx.ASSETS[0].sha256);
 assert.ok(!h.calls.some(c=>c==='write:'+tx.ASSETS[0].path||c==='reload'));
 assert.equal(h.gets().files.has(tx.STAGING.path),true);
 for(const old of tx.LEGACY)assert.equal(h.gets().files.has(old.path),false);
 assert.ok(h.calls.indexOf('journal')<h.calls.indexOf('consume'));
 assert.ok(h.calls.indexOf('consume')<h.calls.indexOf('write:'+tx.ASSETS[1].path));
});
test('unexpected asset SHA, missing capability and wrong issuer fail before any consume or disk mutation',async()=>{
 const h=harness();h.assets.dispatcher=Buffer.from('malicious changed');
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:h.assets}),/DENIED_OR_ROLLED_BACK/);
 assert.equal(h.gets().consumed,0);assert.equal(h.gets().writeCount,0);
 const g=harness();delete g.host.assertTrustedRootExecutor;
 await assert.rejects(tx.applyFixedCutover({host:g.host,assets:g.assets}),/missing_trusted_executor_capabilities/);
 const b=harness({inject:'wrong-live-hash'});
 await assert.rejects(tx.applyFixedCutover({host:b.host,assets:b.assets}),/DENIED_OR_ROLLED_BACK/);
 assert.equal(b.gets().consumed,0);assert.equal(b.gets().writeCount,0);
});
test('missing independently registered Level-4 action denies BEFORE freezing, backup or permit consumption',async()=>{
 const h=harness({inject:'unregistered-preflight'});
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:h.assets}),
   /DENIED_OR_ROLLED_BACK/);
 assert.equal(h.gets().consumed,0);
 assert.equal(h.gets().writeCount,0);
 assert.equal(h.gets().rollbacks,0);
 assert.equal(h.gets().frozen,false);
 assert.equal(h.calls.includes('freeze'),false);
 assert.equal(h.calls.includes('journal'),false);
 sameState(h.gets(),h.old);
});

test('unverified receipt cannot install any Root file and restores journal',async()=>{
 const h=harness({receiptPatch:{signed:false}});
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:h.assets}),/DENIED_OR_ROLLED_BACK/);
 assert.equal(h.gets().writeCount,0);assert.equal(h.gets().rollbacks,1);
 sameState(h.gets(),h.old);
});
test('injected disk/write/revoke/visudo/policy-drift/registration/postimage faults restore byte-for-byte',async()=>{
 for(const name of ['write-1','write-2','write-3','write-4','remove',
 'visudo','registered-policy-drift-postwrite','registration','postimage','audit-installed']){
  const h=harness({inject:name});
  await assert.rejects(tx.applyFixedCutover({host:h.host,assets:h.assets}),/DENIED_OR_ROLLED_BACK/,name);
  assert.equal(h.gets().rollbacks,1,name);
  sameState(h.gets(),h.old);
  assert.equal(h.gets().frozen,false,name);
  assert.ok(h.events.includes('rollback_verified'),name);
 }
});
test('failed rollback is critical hard failure, never reported as safe',async()=>{
 const h=harness({inject:'broken-rollback'});
 const original=h.host.validateFullSudoers;
 h.host.validateFullSudoers=async()=>{throw Error('failure_after_consume')};
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:h.assets}),/ROLLBACK_UNVERIFIED/);
 assert.equal(h.gets().rollbacks,1);
});
test('no caller-selected project, operation or arbitrary path accepted by fixed API',async()=>{
 const h=harness();
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:{...h.assets,extra:Buffer.from('foo')}}),
   /DENIED_OR_ROLLED_BACK/);
 assert.equal(h.gets().consumed,0);
 assert.equal(h.gets().writeCount,0);
});
if(!base)test('isolated Git blob fixtures must be supplied',{skip:true},()=>{});

test('old pre-registration issuer policy is denied even if target action name appears',async()=>{
 const h=harness({inject:'legacy-policy-before-registration'});
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:h.assets}),
   /DENIED_OR_ROLLED_BACK/);
 assert.equal(h.gets().consumed,0);
 assert.equal(h.gets().writeCount,0);
 assert.equal(h.calls.includes('freeze'),false);
 assert.equal(h.calls.includes('journal'),false);
 sameState(h.gets(),h.old);
});
test('new post-registration issuer policy must be live BEFORE consuming L4 permit',async()=>{
 const h=harness({wrongLive:true});
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:h.assets}),
   /DENIED_OR_ROLLED_BACK/);
 assert.equal(h.gets().consumed,0);
 assert.equal(h.gets().writeCount,0);
 assert.equal(h.calls.includes('freeze'),false);
});
test('phase-2 post-registration candidate policy is never written even on rollback',async()=>{
 const h=harness({inject:'remove'});
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:h.assets}),
   /DENIED_OR_ROLLED_BACK/);
 assert.equal(h.gets().rollbacks,1);
 assert.ok(!h.calls.includes('write:'+tx.ASSETS[0].path));
 assert.ok(!h.calls.includes('reload'));
 assert.equal(sha(h.gets().files.get(tx.ASSETS[0].path)),tx.ASSETS[0].sha256);
 sameState(h.gets(),h.old);
});
