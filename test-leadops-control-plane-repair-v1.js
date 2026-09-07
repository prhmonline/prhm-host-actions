#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const repair=require('./bootstrap-host-actions-v20-leadops-control-plane-repair-v1.js');

const historicalLanguage=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v3-leadops-language-gate.js'),'utf8');

const languageFixture=`function waitActive(unit,attempts=40){return true;}\nfunction atomicReplace(file,text){const st=fs.statSync(file);const tmp=file+'.language-gate-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,text,{mode:st.mode&0o777});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file);}\nfunction main(){\n  let backup=null,patched=false,agentRestarted=false;\n  try{\n    const svc=systemctl(['is-active','leadops-parscoders-v3.service'],{allowFailure:true,timeout:10000});if(String(svc.stdout||'').trim()==='active')throw Error('parscoders_v3_service_active_retry_later');\n    const pf=preflight();\n    systemctl(['stop','leadops-parscoders-v3.timer'],{allowFailure:true,timeout:15000});\n    if(!waitActive('prhm-agent-api.service'))throw Error('agent_api_not_active_after_scorer_v4');\n    if(!waitActive('leadops-parscoders-v3.timer'))throw Error('parscoders_timer_not_active_after_scorer_v4');\n    const migration=parseLastJson(psql(migrationSql()));\n    const finalCheck=parseLastJson(psql(detectionSql(),{readOnly:true}));\n    if(Number(finalCheck.missing)!==0)throw Error('language_gate_postcheck_missing:'+finalCheck.missing);\n    const result={schema_version:'prhm.host-action-result.v1',ok:true,action:ACTION,finished_at:new Date().toISOString(),scorer_before_sha256:EXPECTED_V3_SHA,scorer_after_sha256:shaFile(SCORER),scoring_model:'rules-v4-parscoders',language_codes:'ISO-639-1 lowercase',migration,remaining_waiting_missing_language:0,timer:'leadops-parscoders-v3.timer',timer_active:true,p0_live:false,proposal_send:false,bid_send:false,backup_path:backup,rollback_performed:false,preflight:pf.targets};\n  }catch(error){\n    const rollbackErrors=[];\n    try{systemctl(['restart','prhm-agent-api.service'],{timeout:30000});if(!waitActive('prhm-agent-api.service'))throw Error('agent_api_not_active')}catch(e){rollbackErrors.push('agent_api:'+e.message)}\n    if(rollbackErrors.length)throw Error('leadops_language_gate_failed_and_rollback_failed:'+error.message+':'+rollbackErrors.join('|'));\n  }\n}\nSELECT CASE WHEN count(*)<=\${MAX_TARGETS} THEN 1 ELSE 1/0 END`;

const executorFixture=`function applyLeadOpsEconomicsInputsFoundationV1(){\n  const args=[\n    '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',\n    '--property=ReadWritePaths=/opt/prhm-p0-shadow-worker /opt/prhm-p0-fixed-executor/migrations /var/lib/prhm-agent-selfmaint-exec /run/prhm-p0-shadow-worker',\n  ];\n}`;

test('language repair freezes producer through migration/postcheck and restores previous state',()=>{
  const out=repair.patchLanguageHelper(languageFixture);
  const stop=out.indexOf("systemctl(['stop','leadops-parscoders-v3.timer']");
  const migration=out.indexOf('const migration=parseLastJson(psql(migrationSql()))');
  const post=out.indexOf("const finalCheck=parseLastJson(psql(detectionSql(),{readOnly:true}))");
  assert.ok(stop>=0&&stop<migration&&migration<post);
  assert.doesNotMatch(out.slice(stop,post),/waitActive\('leadops-parscoders-v3\.timer'\)/);
  assert.match(out,/timerWasActive/);
  assert.match(out,/restoreParscodersTimer\(timerWasActive\)/);
  assert.ok(out.indexOf('restoreParscodersTimer(timerWasActive)',post)>post);
  const catchPos=out.indexOf('}catch(error){');
  assert.ok(out.indexOf('restoreParscodersTimer(timerWasActive)',catchPos)>catchPos);
});

test('language target-limit assertion is preserved',()=>{
  assert.match(historicalLanguage,/count\(\*\)<=\$\{MAX_TARGETS\} THEN 1 ELSE 1\/0/);
  const out=repair.patchLanguageHelper(languageFixture);
  assert.match(out,/count\(\*\)<=\$\{MAX_TARGETS\} THEN 1 ELSE 1\/0/);
});

test('economics repair owns volatile runtime directory before ReadWritePaths',()=>{
  const out=repair.patchExecutor(executorFixture);
  const runtime=out.indexOf('--property=RuntimeDirectory=prhm-p0-shadow-worker');
  const mode=out.indexOf('--property=RuntimeDirectoryMode=0750');
  const rw=out.indexOf('--property=ReadWritePaths=/opt/prhm-p0-shadow-worker');
  assert.ok(runtime>=0&&runtime<mode&&mode<rw);
});

test('permanent worker service drop-in owns the same runtime directory',()=>{
  assert.equal(repair.DROPIN,'[Service]\nRuntimeDirectory=prhm-p0-shadow-worker\nRuntimeDirectoryMode=0750\n');
});

test('repair is bound to exact live SHA baselines and fixed paths',()=>{
  assert.equal(repair.EXPECTED.language,'94885041de12b4276bb4c8af1eb8cc6f4d41bdbeb5db9f2aa02341126f1cca71');
  assert.equal(repair.EXPECTED.executor,'1faccf7f9616cab326000f05845e7d09ccc0c81228c1175a39dcbdea87186be2');
  assert.equal(repair.PATHS.language,'/opt/prhm-agent-selfmaint-exec/actions/leadops-language-gate-v1.js');
  assert.equal(repair.PATHS.executor,'/opt/prhm-agent-selfmaint-exec/server.js');
  assert.equal(repair.PATHS.dropin,'/etc/systemd/system/prhm-p0-shadow-worker.service.d/runtime-directory.conf');
});
