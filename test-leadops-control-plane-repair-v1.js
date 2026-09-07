#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const ROOT=__dirname;
const language=fs.readFileSync(path.join(ROOT,'bootstrap-host-actions-v3-leadops-language-gate.js'),'utf8');
const economics=fs.readFileSync(path.join(ROOT,'bootstrap-host-actions-v5-leadops-economics-foundation.js'),'utf8');

function indexOrFail(text,needle,label){
  const i=text.indexOf(needle);
  assert.notEqual(i,-1,`${label}: missing ${needle}`);
  return i;
}

test('language gate freezes producer from stop through migration and postcheck',()=>{
  const stop=indexOrFail(language,"systemctl(['stop','leadops-parscoders-v3.timer']",'timer stop');
  const migration=indexOrFail(language,'const migration=parseLastJson(psql(migrationSql()))','migration');
  const postcheck=indexOrFail(language,"const finalCheck=parseLastJson(psql(detectionSql(),{readOnly:true}))",'postcheck');
  assert.ok(stop<migration && migration<postcheck,'expected stop < migration < postcheck');
  const criticalWindow=language.slice(stop,postcheck);
  assert.doesNotMatch(criticalWindow,/waitActive\('leadops-parscoders-v3\.timer'\)/,'producer timer must not be reactivated before migration/postcheck complete');
});

test('language gate captures and restores prior timer state on success and rollback',()=>{
  assert.match(language,/timerWasActive/,'must capture prior timer state');
  assert.match(language,/restoreParscodersTimer/,'must centralize prior-state restoration');
  const migration=indexOrFail(language,'const migration=parseLastJson(psql(migrationSql()))','migration');
  const restore=language.indexOf('restoreParscodersTimer',migration);
  assert.ok(restore>migration,'success restoration must happen after migration');
  const catchPos=indexOrFail(language,'}catch(error){','catch');
  assert.ok(language.indexOf('restoreParscodersTimer',catchPos)>catchPos,'rollback path must restore prior timer state');
});

test('language gate preserves target-limit assertion instead of deleting it',()=>{
  assert.match(language,/count\(\*\)<=\$\{MAX_TARGETS\} THEN 1 ELSE 1\/0/);
  assert.match(language,/leadops_language_targets_exceed_limit/);
});

test('economics transient action owns its volatile runtime directory before ReadWritePaths uses it',()=>{
  const runtime=indexOrFail(economics,'--property=RuntimeDirectory=prhm-p0-shadow-worker','RuntimeDirectory');
  const rw=indexOrFail(economics,'--property=ReadWritePaths=/opt/prhm-p0-shadow-worker /opt/prhm-p0-fixed-executor/migrations /var/lib/prhm-agent-selfmaint-exec /run/prhm-p0-shadow-worker','ReadWritePaths');
  assert.ok(runtime<rw,'RuntimeDirectory property must be declared before ReadWritePaths uses /run/prhm-p0-shadow-worker');
});

test('economics sandbox remains constrained after namespace repair',()=>{
  assert.match(economics,/--property=NoNewPrivileges=true/);
  assert.match(economics,/--property=PrivateTmp=true/);
  assert.match(economics,/--property=ProtectSystem=full/);
  assert.match(economics,/--property=ProtectHome=read-only/);
  assert.match(economics,/--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6/);
});
