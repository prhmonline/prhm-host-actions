#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='leadops_parscoders_runtime_v3_restore_v1';
const RUNTIME='/home/drtarjomeh/leadops/runtime-v3';
const SOURCE_COLLECTOR=RUNTIME+'/leadops-parscoders-collector';
const SOURCE_SCORER=RUNTIME+'/leadops-parscoders-score';
const COLLECTOR=RUNTIME+'/collector';
const SCORER=RUNTIME+'/scorer';
const RULES=RUNTIME+'/rules-v3-parscoders.sql';
const ENV_FILE=RUNTIME+'/.env';
const DATA_DIR=RUNTIME+'/data';
const ROLE='leadops_parscoders';
const ADMIN_PASS_FILE='/etc/prhm-p0-db-helper/postgres_superuser_password';
const COLLECTOR_SHA='fb8af82a47bf219f30b5d460220491457d105c12cd997886ec4e3bd71abf5b79';
const SCORER_SHA='61459e3934107d25a88cc4c375c880bb4faa6f59df755f62c46d62b51244cb61';
const COLLECTOR_SERVICE='leadops-parscoders-collector.service';
const SCORER_SERVICE='leadops-parscoders-score.service';
const TIMER='leadops-parscoders-collector.timer';
const COLLECTOR_DROPIN='/etc/systemd/system/leadops-parscoders-collector.service.d/40-runtime-v3-canonical.conf';
const SCORER_DROPIN='/etc/systemd/system/leadops-parscoders-score.service.d/40-runtime-v3-canonical.conf';
const TIMER_DROPIN='/etc/systemd/system/leadops-parscoders-collector.timer.d/40-runtime-v3-canonical.conf';
const RESULT_DIR='/var/lib/prhm-agent-selfmaint-exec/leadops-parscoders-runtime-v3-restore-v1';
const RESULT=RESULT_DIR+'/latest.json';

const ROLE_SQL=`CREATE ROLE leadops_parscoders LOGIN PASSWORD '__PASSWORD__' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT, TEMP ON DATABASE leadops TO leadops_parscoders;
GRANT USAGE ON SCHEMA marketplace, automation TO leadops_parscoders;
GRANT SELECT ON marketplace.sources TO leadops_parscoders;
GRANT SELECT, INSERT, UPDATE ON marketplace.opportunities TO leadops_parscoders;
GRANT SELECT, INSERT ON marketplace.opportunity_evaluations TO leadops_parscoders;
GRANT INSERT ON automation.outbox_events TO leadops_parscoders;
GRANT SELECT (idempotency_key) ON automation.outbox_events TO leadops_parscoders;`;

function fail(m){throw new Error(m)}
function shaBuf(b){return crypto.createHash('sha256').update(b).digest('hex')}
function shaFile(f){return shaBuf(fs.readFileSync(f))}
function run(file,args,opt={}){const r=cp.spawnSync(file,args,{encoding:'utf8',maxBuffer:8*1024*1024,...opt});if(r.error)fail('exec_error:'+file+':'+r.error.message);if(r.status!==0)fail('exec_failed:'+file+':'+r.status+':'+String(r.stderr||'').slice(-1600));return r}
function runLoose(file,args,opt={}){const r=cp.spawnSync(file,args,{encoding:'utf8',maxBuffer:8*1024*1024,...opt});if(r.error)fail('exec_error:'+file+':'+r.error.message);return r}
function replaceOnce(s,a,b,label){const i=s.indexOf(a);if(i<0)fail('anchor_missing:'+label);if(s.indexOf(a,i+1)>=0)fail('anchor_not_unique:'+label);return s.slice(0,i)+b+s.slice(i+a.length)}
function readAdminPass(){const x=fs.readFileSync(ADMIN_PASS_FILE,'utf8').trim();if(!x)fail('admin_password_empty');return x}
function psqlAdmin(sql,readOnly=false){const env={...process.env,PGPASSWORD:readAdminPass()};if(readOnly)env.PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=2000';try{return String(run('/usr/bin/psql',['-X','-At','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55434','-U','leadops_admin','-d','leadops'],{input:sql,env,timeout:60000}).stdout||'').trim()}finally{delete env.PGPASSWORD}}
function psqlRole(sql,password){const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'55434',PGDATABASE:'leadops',PGUSER:ROLE,PGPASSWORD:password,PGOPTIONS:'-c statement_timeout=30000 -c lock_timeout=2000'};try{return String(run('/usr/bin/psql',['-X','-At','-v','ON_ERROR_STOP=1'],{input:sql,env,timeout:60000}).stdout||'').trim()}finally{delete env.PGPASSWORD}}
function jsonQuery(sql){const raw=psqlAdmin(sql,true);if(!raw)fail('json_query_empty');return JSON.parse(raw.split(/\r?\n/).find(x=>x.trim().startsWith('{')))}
function systemctlValue(unit,prop){return String(run('/usr/bin/systemctl',['show',unit,'-p',prop,'--value']).stdout||'').trim()}
function unitFileState(unit){const r=runLoose('/usr/bin/systemctl',['is-enabled',unit]);return String(r.stdout||'').trim()||String(r.stderr||'').trim()}
function activeState(unit){const r=runLoose('/usr/bin/systemctl',['is-active',unit]);return String(r.stdout||'').trim()||String(r.stderr||'').trim()}
function statMeta(p){const s=fs.statSync(p);return {mode:s.mode&0o7777,uid:s.uid,gid:s.gid}}
function roleExists(){return psqlAdmin(`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${ROLE}');`,true)==='t'}
function userIds(){const uid=Number(String(run('/usr/bin/id',['-u','drtarjomeh']).stdout).trim()),gid=Number(String(run('/usr/bin/id',['-g','drtarjomeh']).stdout).trim());if(!Number.isInteger(uid)||!Number.isInteger(gid))fail('drtarjomeh_identity_invalid');return {uid,gid}}
function syntaxBash(content,label){const f='/tmp/prhm-'+ACTION+'-'+label+'-'+process.pid+'.sh';try{fs.writeFileSync(f,content,{mode:0o700});run('/usr/bin/bash',['-n',f])}finally{try{fs.unlinkSync(f)}catch{}}}
function atomic(file,data,mode,uid,gid){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o755});const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,data,{mode});fs.chmodSync(tmp,mode);if(uid!==undefined)fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file)}
function writeJson(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});atomic(file,JSON.stringify(obj,null,2)+'\n',0o600,0,0)}

function deriveCandidates(){
  if(shaFile(SOURCE_COLLECTOR)!==COLLECTOR_SHA)fail('collector_source_sha_mismatch');
  if(shaFile(SOURCE_SCORER)!==SCORER_SHA)fail('scorer_source_sha_mismatch');
  const sourceCollector=fs.readFileSync(SOURCE_COLLECTOR,'utf8');
  const sourceScorer=fs.readFileSync(SOURCE_SCORER,'utf8');
  let collector=replaceOnce(sourceCollector,"umask 077\n","umask 077\nRUNTIME='/home/drtarjomeh/leadops/runtime-v3'\nset -a\nsource \"$RUNTIME/.env\"\nset +a\n",'collector_env');
  const oldBlock=`docker exec -i drtarjomeh-leadops-staging-postgres-1 \\\n  psql -X -U leadops_admin -d leadops -v ON_ERROR_STOP=1 < \"$SQL\"\n\n/home/drtarjomeh/leadops/runtime-v3/leadops-parscoders-score\n`;
  const newBlock=`if [[ \"\${PARSCODERS_VALIDATE_ONLY:-0}\" == \"1\" ]]; then\n  sed 's/^COMMIT;$/ROLLBACK;/' \"$SQL\" > \"$TMP/upsert-rollback.sql\"\n  /usr/bin/psql -X -v ON_ERROR_STOP=1 < \"$TMP/upsert-rollback.sql\"\n  PARSCODERS_VALIDATE_ONLY=1 \"$RUNTIME/scorer\"\nelse\n  /usr/bin/psql -X -v ON_ERROR_STOP=1 < \"$SQL\"\n  \"$RUNTIME/scorer\"\nfi\n`;
  collector=replaceOnce(collector,oldBlock,newBlock,'collector_db_exec');
  if(/docker exec|leadops_admin/.test(collector))fail('collector_still_privileged');
  const start=`docker exec -i drtarjomeh-leadops-staging-postgres-1 \\\n  psql -X -U leadops_admin -d leadops -v ON_ERROR_STOP=1 <<'SQL'\n`;
  const si=sourceScorer.indexOf(start);if(si<0)fail('scorer_sql_start_missing');
  const bodyStart=si+start.length;const ei=sourceScorer.lastIndexOf('\nSQL\n');if(ei<bodyStart)fail('scorer_sql_end_missing');
  const rules=sourceScorer.slice(bodyStart,ei).trimEnd()+'\n';
  if(!rules.startsWith('BEGIN;\n')||!rules.includes("evaluation_version='rules-v3-parscoders'")||!rules.trimEnd().endsWith('COMMIT;'))fail('rules_contract_invalid');
  const scorer=`#!/usr/bin/env bash\nset -Eeuo pipefail\numask 077\nRUNTIME='/home/drtarjomeh/leadops/runtime-v3'\nset -a\nsource \"$RUNTIME/.env\"\nset +a\nif [[ \"\${PARSCODERS_VALIDATE_ONLY:-0}\" == \"1\" ]]; then\n  TMP=\"$(mktemp)\"\n  trap 'rm -f \"$TMP\"' EXIT\n  sed 's/^COMMIT;$/ROLLBACK;/' \"$RUNTIME/rules-v3-parscoders.sql\" > \"$TMP\"\n  /usr/bin/psql -X -v ON_ERROR_STOP=1 < \"$TMP\"\nelse\n  exec /usr/bin/psql -X -v ON_ERROR_STOP=1 -f \"$RUNTIME/rules-v3-parscoders.sql\"\nfi\n`;
  if(/docker exec|leadops_admin/.test(scorer))fail('scorer_still_privileged');
  syntaxBash(collector,'collector');syntaxBash(scorer,'scorer');
  return {collector,scorer,rules,hashes:{collector:shaBuf(Buffer.from(collector)),scorer:shaBuf(Buffer.from(scorer)),rules:shaBuf(Buffer.from(rules))}};
}

function safetyState(){return jsonQuery(`SELECT json_build_object(
'outbox_published',(SELECT count(*) FROM automation.outbox_events WHERE status='published'),
'bids_submitted',(SELECT count(*) FROM marketplace.bids WHERE status='SUBMITTED'),
'telegram',(SELECT count(*) FROM automation.telegram_messages),
'parscoders_opportunities',(SELECT count(*) FROM marketplace.opportunities o JOIN marketplace.sources s ON s.id=o.source_id WHERE s.code='parscoders'),
'parscoders_evaluations',(SELECT count(*) FROM marketplace.opportunity_evaluations e JOIN marketplace.opportunities o ON o.id=e.opportunity_id JOIN marketplace.sources s ON s.id=o.source_id WHERE s.code='parscoders' AND e.evaluation_version='rules-v3-parscoders'),
'parscoders_outbox',(SELECT count(*) FROM automation.outbox_events WHERE idempotency_key LIKE 'parscoders:%'),
'flags',(SELECT COALESCE(json_object_agg(flag,enabled),'{}'::json) FROM automation.p0_feature_flags WHERE flag IN ('P0_SHADOW_MODE','P0_DECISION_ENABLED','PROPOSAL_AUTO_SEND_ENABLED','AUTO_PROPOSAL_ENABLED','BID_AUTO_SEND_ENABLED'))
);`)}
function assertSendSafety(s){const f=s.flags||{};for(const k of ['P0_DECISION_ENABLED','PROPOSAL_AUTO_SEND_ENABLED','AUTO_PROPOSAL_ENABLED','BID_AUTO_SEND_ENABLED'])if(f[k]===true)fail('send_flag_enabled:'+k)}
function sameSafety(a,b){for(const k of ['outbox_published','bids_submitted','telegram','parscoders_opportunities','parscoders_evaluations','parscoders_outbox'])if(String(a[k])!==String(b[k]))fail('validation_mutated:'+k+':'+a[k]+':'+b[k]);if(JSON.stringify(a.flags)!==JSON.stringify(b.flags))fail('flags_changed_during_validation')}

function baseline(){
  if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');
  if(!fs.existsSync(RUNTIME)||!fs.existsSync(SOURCE_COLLECTOR)||!fs.existsSync(SOURCE_SCORER))fail('runtime_v3_sources_missing');
  if(shaFile(SOURCE_COLLECTOR)!==COLLECTOR_SHA||shaFile(SOURCE_SCORER)!==SCORER_SHA)fail('runtime_v3_source_sha_mismatch');
  for(const p of [COLLECTOR,SCORER,RULES,ENV_FILE,DATA_DIR,COLLECTOR_DROPIN,SCORER_DROPIN,TIMER_DROPIN])if(fs.existsSync(p))fail('target_already_exists:'+p);
  if(roleExists())fail('role_already_exists');
  if(unitFileState(TIMER)!=='disabled'||activeState(TIMER)!=='inactive')fail('timer_baseline_not_disabled_inactive');
  const cu=systemctlValue(COLLECTOR_SERVICE,'User'),cg=systemctlValue(COLLECTOR_SERVICE,'Group'),ce=systemctlValue(COLLECTOR_SERVICE,'ExecStart');
  const su=systemctlValue(SCORER_SERVICE,'User'),sg=systemctlValue(SCORER_SERVICE,'Group'),se=systemctlValue(SCORER_SERVICE,'ExecStart');
  if(cu!=='root'||cg!=='root'||!ce.includes('/usr/local/sbin/leadops-parscoders-collector'))fail('collector_baseline_unexpected');
  if(su!=='root'||sg!=='root'||!se.includes('/root/leadops-parscoders-score.sh'))fail('scorer_baseline_unexpected');
  if(activeState('tor.service')!=='active')fail('tor_not_active');
  const ids=userIds(),runtime_meta=statMeta(RUNTIME),safety=safetyState();assertSendSafety(safety);
  return {ids,runtime_meta,safety,collector_unit:{user:cu,group:cg,exec:ce},scorer_unit:{user:su,group:sg,exec:se},timer:{enabled:'disabled',active:'inactive'}};
}

function preflight(){const b=baseline(),c=deriveCandidates();return {ok:true,schema_version:'prhm.leadops-parscoders-runtime-v3-restore.preflight.v1',action:ACTION,preflight_only:true,production_mutation:false,database_mutation:false,business_mutation:false,p0_live:false,p0_decision:false,proposal_send:false,bid_send:false,auto_send:false,external_send:false,source_hashes:{collector:COLLECTOR_SHA,scorer:SCORER_SHA},candidate_hashes:c.hashes,role:ROLE,role_exists:false,timer_before:b.timer,validation_mode:'rollback_only'}}

function createRole(password){const sql=ROLE_SQL.replace('__PASSWORD__',password);psqlAdmin(sql,false);if(!roleExists())fail('role_create_failed');const check=jsonQuery(`SELECT json_build_object(
'connect',has_database_privilege('${ROLE}','leadops','CONNECT'),
'temp',has_database_privilege('${ROLE}','leadops','TEMP'),
'sources_select',has_table_privilege('${ROLE}','marketplace.sources','SELECT'),
'opportunities_select',has_table_privilege('${ROLE}','marketplace.opportunities','SELECT'),
'opportunities_insert',has_table_privilege('${ROLE}','marketplace.opportunities','INSERT'),
'opportunities_update',has_table_privilege('${ROLE}','marketplace.opportunities','UPDATE'),
'evaluations_select',has_table_privilege('${ROLE}','marketplace.opportunity_evaluations','SELECT'),
'evaluations_insert',has_table_privilege('${ROLE}','marketplace.opportunity_evaluations','INSERT'),
'outbox_insert',has_table_privilege('${ROLE}','automation.outbox_events','INSERT'),
'outbox_idempotency_select',has_column_privilege('${ROLE}','automation.outbox_events','idempotency_key','SELECT'),
'outbox_select_all',has_table_privilege('${ROLE}','automation.outbox_events','SELECT'),
'outbox_delete',has_table_privilege('${ROLE}','automation.outbox_events','DELETE'),
'opportunities_delete',has_table_privilege('${ROLE}','marketplace.opportunities','DELETE')
);`);for(const k of ['connect','temp','sources_select','opportunities_select','opportunities_insert','opportunities_update','evaluations_select','evaluations_insert','outbox_insert','outbox_idempotency_select'])if(check[k]!==true)fail('required_privilege_missing:'+k);for(const k of ['outbox_select_all','outbox_delete','opportunities_delete'])if(check[k]!==false)fail('forbidden_privilege_present:'+k);return check}
function dropRole(){if(!roleExists())return;psqlAdmin(`DROP OWNED BY ${ROLE}; DROP ROLE ${ROLE};`,false);if(roleExists())fail('role_drop_failed')}
function envContent(password){return `PGHOST=127.0.0.1\nPGPORT=55434\nPGDATABASE=leadops\nPGUSER=leadops_parscoders\nPGPASSWORD=${password}\n`}
function installRuntime(c,password,b){const {uid,gid}=b.ids;fs.chownSync(RUNTIME,0,gid);fs.chmodSync(RUNTIME,0o750);atomic(COLLECTOR,c.collector,0o750,0,gid);atomic(SCORER,c.scorer,0o750,0,gid);atomic(RULES,c.rules,0o640,0,gid);atomic(ENV_FILE,envContent(password),0o640,0,gid);fs.mkdirSync(DATA_DIR,{mode:0o750});fs.chownSync(DATA_DIR,uid,gid);fs.chmodSync(DATA_DIR,0o750)}
function installDropins(){const collector=`[Service]\nUser=drtarjomeh\nGroup=drtarjomeh\nExecStart=\nExecStart=/home/drtarjomeh/leadops/runtime-v3/collector\n`;const scorer=`[Service]\nUser=drtarjomeh\nGroup=drtarjomeh\nExecStart=\nExecStart=/home/drtarjomeh/leadops/runtime-v3/scorer\n`;const timer=`[Timer]\nOnBootSec=\nOnUnitActiveSec=\nOnActiveSec=10min\nOnUnitActiveSec=60min\nRandomizedDelaySec=5min\nPersistent=true\nUnit=leadops-parscoders-collector.service\n`;atomic(COLLECTOR_DROPIN,collector,0o644,0,0);atomic(SCORER_DROPIN,scorer,0o644,0,0);atomic(TIMER_DROPIN,timer,0o644,0,0);run('/usr/bin/systemctl',['daemon-reload'])}
function verifyEffective(){const cu=systemctlValue(COLLECTOR_SERVICE,'User'),cg=systemctlValue(COLLECTOR_SERVICE,'Group'),ce=systemctlValue(COLLECTOR_SERVICE,'ExecStart'),su=systemctlValue(SCORER_SERVICE,'User'),sg=systemctlValue(SCORER_SERVICE,'Group'),se=systemctlValue(SCORER_SERVICE,'ExecStart');if(cu!=='drtarjomeh'||cg!=='drtarjomeh'||!ce.includes(COLLECTOR))fail('collector_effective_invalid');if(su!=='drtarjomeh'||sg!=='drtarjomeh'||!se.includes(SCORER))fail('scorer_effective_invalid');return {collector:{user:cu,group:cg,exec:ce},scorer:{user:su,group:sg,exec:se}}}
function validateRoleConnection(password){const x=psqlRole(`BEGIN; CREATE TEMP TABLE prhm_parscoders_v3_validate(x integer); INSERT INTO prhm_parscoders_v3_validate VALUES (1); SELECT current_user || ':' || count(*) FROM prhm_parscoders_v3_validate; ROLLBACK;`,password);if(!x.includes('leadops_parscoders:1'))fail('role_direct_psql_validation_failed')}
function validationRun(){const before=safetyState();assertSendSafety(before);const env={...process.env,PARSCODERS_VALIDATE_ONLY:'1'};run('/usr/sbin/runuser',['-u','drtarjomeh','--',COLLECTOR],{env,timeout:240000});const after=safetyState();assertSendSafety(after);sameSafety(before,after);return {before,after}}
function activateTimer(){run('/usr/bin/systemctl',['enable',TIMER]);run('/usr/bin/systemctl',['start',TIMER]);const enabled=unitFileState(TIMER),active=activeState(TIMER),next=systemctlValue(TIMER,'NextElapseUSecRealtime');if(enabled!=='enabled'||active!=='active')fail('timer_activation_failed');return {enabled,active,next,first_run_delay:'10min+randomized<=5min',interval:'60min'}}
function cleanupNewTargets(){for(const p of [COLLECTOR_DROPIN,SCORER_DROPIN,TIMER_DROPIN,COLLECTOR,SCORER,RULES,ENV_FILE]){try{fs.unlinkSync(p)}catch(e){if(e.code!=='ENOENT')throw e}}try{fs.rmdirSync(DATA_DIR)}catch(e){if(!['ENOENT','ENOTEMPTY'].includes(e.code))throw e}}
function rollback(b){let ok=true,errors=[];try{runLoose('/usr/bin/systemctl',['disable','--now',TIMER])}catch(e){ok=false;errors.push(String(e.message||e))}try{cleanupNewTargets();fs.chownSync(RUNTIME,b.runtime_meta.uid,b.runtime_meta.gid);fs.chmodSync(RUNTIME,b.runtime_meta.mode);run('/usr/bin/systemctl',['daemon-reload'])}catch(e){ok=false;errors.push(String(e.message||e))}try{dropRole()}catch(e){ok=false;errors.push(String(e.message||e))}return {ok,errors}}

function main(){const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--preflight-only'))fail('unexpected_arguments');if(args[0]==='--preflight-only'){process.stdout.write(JSON.stringify(preflight())+'\n');return}
  const b=baseline(),c=deriveCandidates();const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14),backup='/var/backups/prhm-leadops-parscoders-runtime-v3-restore-'+stamp;fs.mkdirSync(backup,{recursive:true,mode:0o700});writeJson(backup+'/baseline.json',{...b,source_hashes:{collector:COLLECTOR_SHA,scorer:SCORER_SHA},candidate_hashes:c.hashes});
  let committed=false,roleCreated=false;const password=crypto.randomBytes(32).toString('base64url');const password_sha256=shaBuf(Buffer.from(password));try{
    const privileges=createRole(password);roleCreated=true;installRuntime(c,password,b);validateRoleConnection(password);installDropins();const effective=verifyEffective();const validation=validationRun();const timer=activateTimer();
    const result={ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,installed:true,runtime_v3_restored:true,validation_run:true,validation_mode:'rollback_only',database_mutation:true,business_mutation:false,external_send:false,p0_live:false,p0_decision:false,proposal_send:false,bid_send:false,auto_send:false,role:ROLE,role_password_sha256:password_sha256,privileges,source_hashes:{collector:COLLECTOR_SHA,scorer:SCORER_SHA},candidate_hashes:c.hashes,effective,timer,backup_dir:backup,legacy_paths_authoritative:false,rollback_verified:false};writeJson(RESULT,result);committed=true;process.stdout.write(JSON.stringify(result)+'\n');
  }finally{if(!committed){const rb=rollback(b);try{writeJson(backup+'/rollback.json',{ok:rb.ok,errors:rb.errors,role_created:roleCreated})}catch{}if(!rb.ok)process.stderr.write('rollback_failed:'+rb.errors.join('|')+'\n')}}
}
try{main()}catch(e){process.stderr.write(String(e&&e.stack||e)+'\n');process.exit(1)}
