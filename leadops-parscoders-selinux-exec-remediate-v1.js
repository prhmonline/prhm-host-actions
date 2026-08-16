#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='leadops_parscoders_selinux_exec_remediate_v1';
const RUNTIME='/home/drtarjomeh/leadops/runtime-v3';
const COLLECTOR=RUNTIME+'/collector';
const SCORER=RUNTIME+'/scorer';
const RULES=RUNTIME+'/rules-v3-parscoders.sql';
const ENV_FILE=RUNTIME+'/.env';
const DATA_DIR=RUNTIME+'/data';
const TIMER='leadops-parscoders-collector.timer';
const COLLECTOR_SERVICE='leadops-parscoders-collector.service';
const SCORER_SERVICE='leadops-parscoders-score.service';
const ROLE='leadops_parscoders';
const COLLECTOR_SHA='3d070b611850904e1be77ee037960f3a871baa9bd430eaab1adccaf8fe3a8760';
const SCORER_SHA='7526b70a11447858a8af2a8c2a4c324570c7635bd4d7554377026e527f34ada0';
const INSTALLED_RESTORE_HELPER='/opt/prhm-agent-selfmaint-exec/actions/leadops-parscoders-runtime-v3-restore-v1.js';
const INSTALLED_RESTORE_HELPER_SHA='15e8274230ff33a0a1572430a5928bdd6a54210f687569d8e1009db947432d14';
const UPDATED_RESTORE_HELPER_SHA='1aebce0105112f69a06509225a9706dd20395a4d7b29ac5dda0b4849c8a9ccd7';
const ADMIN_PASS_FILE='/etc/prhm-p0-db-helper/postgres_superuser_password';
const GETENFORCE='/usr/sbin/getenforce';
const SEMANAGE='/usr/sbin/semanage';
const RESTORECON='/usr/sbin/restorecon';
const LS='/usr/bin/ls';
const RESULT_DIR='/var/lib/prhm-agent-selfmaint-exec/leadops-parscoders-selinux-exec-remediate-v1';
const RESULT=RESULT_DIR+'/latest.json';

function fail(m){throw new Error(m)}
function shaBuf(b){return crypto.createHash('sha256').update(b).digest('hex')}
function shaFile(f){return shaBuf(fs.readFileSync(f))}
function run(file,args,opt={}){const r=cp.spawnSync(file,args,{encoding:'utf8',maxBuffer:8*1024*1024,...opt});if(r.error)fail('exec_error:'+file+':'+r.error.message);if(r.status!==0)fail('exec_failed:'+file+':'+r.status+':'+String(r.stderr||'').slice(-1600));return r}
function runLoose(file,args,opt={}){const r=cp.spawnSync(file,args,{encoding:'utf8',maxBuffer:8*1024*1024,...opt});if(r.error)fail('exec_error:'+file+':'+r.error.message);return r}
function atomic(file,data,mode){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,data,{mode});fs.chmodSync(tmp,mode);fs.renameSync(tmp,file)}
function writeJson(file,obj){atomic(file,JSON.stringify(obj,null,2)+'\n',0o600)}
function readAdminPass(){const x=fs.readFileSync(ADMIN_PASS_FILE,'utf8').trim();if(!x)fail('admin_password_empty');return x}
function psqlAdmin(sql,readOnly=true){const env={...process.env,PGPASSWORD:readAdminPass()};if(readOnly)env.PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=2000';try{return String(run('/usr/bin/psql',['-X','-At','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55434','-U','leadops_admin','-d','leadops'],{input:sql,env,timeout:60000}).stdout||'').trim()}finally{delete env.PGPASSWORD}}
function jsonQuery(sql){const raw=psqlAdmin(sql,true);if(!raw)fail('json_query_empty');const line=raw.split(/\r?\n/).find(x=>x.trim().startsWith('{'));if(!line)fail('json_query_row_missing');return JSON.parse(line)}
function systemctlValue(unit,prop){return String(run('/usr/bin/systemctl',['show',unit,'-p',prop,'--value']).stdout||'').trim()}
function unitFileState(unit){const r=runLoose('/usr/bin/systemctl',['is-enabled',unit]);return String(r.stdout||'').trim()||String(r.stderr||'').trim()}
function activeState(unit){const r=runLoose('/usr/bin/systemctl',['is-active',unit]);return String(r.stdout||'').trim()||String(r.stderr||'').trim()}

function selinuxMode(){
  const mode=String(run(GETENFORCE,[]).stdout||'').trim();
  if(mode!=='Enforcing')fail('selinux_not_enforcing:'+mode);
  for(const f of [SEMANAGE,RESTORECON,LS])if(!fs.existsSync(f))fail('selinux_tool_missing:'+f);
  return mode;
}
function selinuxContext(file){
  const out=String(run(LS,['-Zd',file]).stdout||'').trim();
  const m=out.match(/\b[^:\s]+:object_r:[^:\s]+:[^\s]+\b/);
  if(!m)fail('selinux_context_parse_failed:'+file);
  return m[0];
}
function contextType(context){const m=String(context).match(/^[^:]+:object_r:([^:]+):/);if(!m)fail('selinux_type_parse_failed:'+context);return m[1]}
function selinuxType(file){return contextType(selinuxContext(file))}
function localFcontextRows(){
  const r=runLoose(SEMANAGE,['fcontext','-C','-l']);
  if(r.status!==0)fail('semanage_fcontext_list_failed');
  return String(r.stdout||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
}
function inspectExactFcontext(file,rows=localFcontextRows()){
  const exact=rows.filter(line=>line.startsWith(file+' '));
  if(exact.length>1)fail('fcontext_ambiguous:'+file);
  if(exact.length===0)return {exists:false,type:null,row:null};
  const m=exact[0].match(/\b[^:\s]+:object_r:([^:\s]+):[^\s]+\b/);
  if(!m)fail('fcontext_context_parse_failed:'+file);
  return {exists:true,type:m[1],row:exact[0]};
}
function assertNoBroadRuntimeFcontext(rows){
  const allowed=new Set([COLLECTOR,SCORER]);
  for(const line of rows){
    const spec=line.split(/\s+/)[0]||'';
    if(spec.includes(RUNTIME)&&!allowed.has(spec))fail('broad_runtime_fcontext_rule:'+spec);
  }
}
function ensureExactExecFcontext(file){
  const before_context=selinuxContext(file),before_type=contextType(before_context),existing=inspectExactFcontext(file);
  if(existing.exists&&existing.type!=='bin_t')fail('fcontext_conflict:'+file+':'+existing.type);
  let created=false;
  if(!existing.exists){run(SEMANAGE,['fcontext','-a','-t','bin_t',file]);created=true;}
  try{
    run(RESTORECON,['-v',file]);
    const after_context=selinuxContext(file),after_type=contextType(after_context);
    if(after_type!=='bin_t')fail('selinux_type_not_bin_t:'+file+':'+after_type);
    return {path:file,created,before_context,before_type,after_context,after_type,rule_preexisted:existing.exists};
  }catch(e){
    if(created){try{run(SEMANAGE,['fcontext','-d',file]);run(RESTORECON,['-v',file]);}catch(rb){process.stderr.write('fcontext_self_rollback_failed:'+String(rb&&rb.message||rb)+'\n')}}
    throw e;
  }
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
function assertSendSafety(s){
  const f=s.flags||{};
  if(f.P0_SHADOW_MODE!==true)fail('shadow_mode_not_true');
  for(const k of ['P0_DECISION_ENABLED','PROPOSAL_AUTO_SEND_ENABLED','AUTO_PROPOSAL_ENABLED','BID_AUTO_SEND_ENABLED'])if(f[k]!==false)fail('send_flag_not_false:'+k+':'+String(f[k]));
}
function sameSafety(a,b){for(const k of ['outbox_published','bids_submitted','telegram','parscoders_opportunities','parscoders_evaluations','parscoders_outbox'])if(String(a[k])!==String(b[k]))fail('validation_mutated:'+k+':'+a[k]+':'+b[k]);if(JSON.stringify(a.flags)!==JSON.stringify(b.flags))fail('flags_changed_during_validation')}
function dbPrivileges(){return jsonQuery(`SELECT json_build_object(
'role_exists',EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${ROLE}'),
'nosuperuser',COALESCE((SELECT NOT rolsuper FROM pg_roles WHERE rolname='${ROLE}'),false),
'nocreatedb',COALESCE((SELECT NOT rolcreatedb FROM pg_roles WHERE rolname='${ROLE}'),false),
'nocreaterole',COALESCE((SELECT NOT rolcreaterole FROM pg_roles WHERE rolname='${ROLE}'),false),
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
);`)}
function assertDbPrivileges(p){for(const k of ['role_exists','nosuperuser','nocreatedb','nocreaterole','connect','temp','sources_select','opportunities_select','opportunities_insert','opportunities_update','evaluations_select','evaluations_insert','outbox_insert','outbox_idempotency_select'])if(p[k]!==true)fail('db_required_invariant_failed:'+k);for(const k of ['outbox_select_all','outbox_delete','opportunities_delete'])if(p[k]!==false)fail('db_forbidden_privilege_present:'+k)}
function assertNoDockerGroup(){const groups=String(run('/usr/bin/id',['-nG','drtarjomeh']).stdout||'').trim().split(/\s+/).filter(Boolean);if(groups.includes('docker'))fail('drtarjomeh_in_docker_group');return groups}

function captureTimerState(){return {enabled:unitFileState(TIMER),active:activeState(TIMER)}}
function pauseTimer(timer_before){if(timer_before.active==='active')run('/usr/bin/systemctl',['stop',TIMER]);if(activeState(TIMER)!=='inactive')fail('timer_pause_failed');if(unitFileState(TIMER)!==timer_before.enabled)fail('timer_enabled_state_changed_during_pause');const collector_state=activeState(COLLECTOR_SERVICE);if(!['inactive','failed'].includes(collector_state))fail('collector_not_quiescent:'+collector_state)}
function restoreTimerState(timer_before){if(timer_before.active==='active'&&activeState(TIMER)!=='active')run('/usr/bin/systemctl',['start',TIMER]);if(timer_before.active!=='active'&&activeState(TIMER)==='active')run('/usr/bin/systemctl',['stop',TIMER]);if(unitFileState(TIMER)!==timer_before.enabled)fail('timer_enabled_state_changed');if(activeState(TIMER)!==timer_before.active)fail('timer_active_state_not_restored')}

function baseline(){
  if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');
  for(const p of [COLLECTOR,SCORER,RULES,ENV_FILE,DATA_DIR,INSTALLED_RESTORE_HELPER])if(!fs.existsSync(p))fail('required_path_missing:'+p);
  if(shaFile(COLLECTOR)!==COLLECTOR_SHA)fail('collector_sha_mismatch');
  if(shaFile(SCORER)!==SCORER_SHA)fail('scorer_sha_mismatch');
  const restore_helper_sha=shaFile(INSTALLED_RESTORE_HELPER);if(![INSTALLED_RESTORE_HELPER_SHA,UPDATED_RESTORE_HELPER_SHA].includes(restore_helper_sha))fail('installed_restore_helper_sha_mismatch:'+restore_helper_sha);
  const selinux_mode=selinuxMode();
  const cu=systemctlValue(COLLECTOR_SERVICE,'User'),cg=systemctlValue(COLLECTOR_SERVICE,'Group'),ce=systemctlValue(COLLECTOR_SERVICE,'ExecStart');
  const su=systemctlValue(SCORER_SERVICE,'User'),sg=systemctlValue(SCORER_SERVICE,'Group'),se=systemctlValue(SCORER_SERVICE,'ExecStart');
  if(cu!=='drtarjomeh'||cg!=='drtarjomeh'||!ce.includes(COLLECTOR))fail('collector_effective_state_invalid');
  if(su!=='drtarjomeh'||sg!=='drtarjomeh'||!se.includes(SCORER))fail('scorer_effective_state_invalid');
  const timer_before=captureTimerState();if(timer_before.enabled!=='enabled'||timer_before.active!=='active')fail('timer_not_enabled_active');
  const rows=localFcontextRows();assertNoBroadRuntimeFcontext(rows);
  const collector_rule=inspectExactFcontext(COLLECTOR,rows),scorer_rule=inspectExactFcontext(SCORER,rows);
  if(collector_rule.exists&&collector_rule.type!=='bin_t')fail('collector_fcontext_conflict:'+collector_rule.type);
  if(scorer_rule.exists&&scorer_rule.type!=='bin_t')fail('scorer_fcontext_conflict:'+scorer_rule.type);
  const collector_context=selinuxContext(COLLECTOR),scorer_context=selinuxContext(SCORER),collector_type=contextType(collector_context),scorer_type=contextType(scorer_context);
  const bothBefore=collector_type==='user_home_t'&&scorer_type==='user_home_t';
  const bothAfter=collector_type==='bin_t'&&scorer_type==='bin_t'&&collector_rule.exists&&scorer_rule.exists;
  if(!bothBefore&&!bothAfter)fail('mixed_or_unexpected_selinux_state:'+collector_type+':'+scorer_type);
  if(bothBefore&&(collector_rule.exists||scorer_rule.exists))fail('pre_remediation_rule_state_inconsistent');
  const safety=safetyState();assertSendSafety(safety);
  const privileges=dbPrivileges();assertDbPrivileges(privileges);
  const groups=assertNoDockerGroup();
  return {selinux_mode,restore_helper_sha,timer_before,collector:{context:collector_context,type:collector_type,rule:collector_rule},scorer:{context:scorer_context,type:scorer_type,rule:scorer_rule},effective:{collector:{user:cu,group:cg,exec:ce},scorer:{user:su,group:sg,exec:se}},safety,privileges,groups,already_remediated:bothAfter};
}
function preflight(){const b=baseline();return {ok:true,schema_version:'prhm.leadops-parscoders-selinux-exec-remediate.preflight.v1',action:ACTION,preflight_only:true,production_mutation:false,database_mutation:false,committed_database_mutation:false,business_mutation:false,external_send:false,p0_live:false,p0_decision:false,proposal_send:false,bid_send:false,auto_send:false,selinux_mode:b.selinux_mode,fcontext_scope:'exact_paths_only',collector_type_before:b.collector.type,scorer_type_before:b.scorer.type,timer_before:b.timer_before,already_remediated:b.already_remediated,restore_helper_sha:b.restore_helper_sha,systemd_validation:false,validation_mode:'rollback_only'}}

function systemdValidationRun(){
  const before=safetyState();assertSendSafety(before);const unit='prhm-parscoders-selinux-exec-validate-'+Date.now(),started=new Date().toISOString();
  const r=run('/usr/bin/systemd-run',['--wait','--collect','--unit='+unit,'--property=Type=oneshot','--property=User=drtarjomeh','--property=Group=drtarjomeh','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectHome=read-only','--property=ProtectSystem=full','--property=ReadWritePaths='+DATA_DIR,'--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--setenv=PARSCODERS_VALIDATE_ONLY=1','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',COLLECTOR],{timeout:240000});
  const after=safetyState();assertSendSafety(after);sameSafety(before,after);
  const j=runLoose('/usr/bin/journalctl',['-k','--since',started,'--no-pager','-o','cat']);
  const avc=String(j.stdout||'').split(/\r?\n/).filter(x=>/avc:\s+denied/i.test(x)&&(/collector|scorer/.test(x)));
  if(avc.length)fail('selinux_avc_during_validation:'+avc.length);
  return {before,after,unit,exit_status:r.status,avc_denials:0};
}
function rollback(changes,timer_before){
  const errors=[];
  for(const c of [...changes].reverse()){
    try{if(c.created)run(SEMANAGE,['fcontext','-d',c.path]);run(RESTORECON,['-v',c.path]);}catch(e){errors.push(String(e.message||e));}
  }
  try{restoreTimerState(timer_before);}catch(e){errors.push(String(e.message||e));}
  return {ok:errors.length===0,errors};
}

function main(){
  const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--preflight-only'))fail('unexpected_arguments');
  if(args[0]==='--preflight-only'){process.stdout.write(JSON.stringify(preflight())+'\n');return;}
  const b=baseline(),stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14),backup='/var/backups/prhm-leadops-parscoders-selinux-exec-remediate-'+stamp;
  fs.mkdirSync(backup,{recursive:true,mode:0o700});writeJson(backup+'/baseline.json',{action:ACTION,collector_sha256:shaFile(COLLECTOR),scorer_sha256:shaFile(SCORER),installed_restore_helper_sha256:shaFile(INSTALLED_RESTORE_HELPER),selinux_mode:b.selinux_mode,collector_context:b.collector.context,scorer_context:b.scorer.context,collector_rule:b.collector.rule,scorer_rule:b.scorer.rule,timer_before:b.timer_before,safety:b.safety,privileges:b.privileges});
  const changes=[];let committed=false;
  try{
    pauseTimer(b.timer_before);
    changes.push(ensureExactExecFcontext(COLLECTOR));changes.push(ensureExactExecFcontext(SCORER));
    if(selinuxType(COLLECTOR)!=='bin_t'||selinuxType(SCORER)!=='bin_t')fail('post_relabel_type_invalid');
    const validation=systemdValidationRun();
    restoreTimerState(b.timer_before);
    const afterSafety=safetyState();assertSendSafety(afterSafety);sameSafety(b.safety,afterSafety);const afterPrivileges=dbPrivileges();assertDbPrivileges(afterPrivileges);if(JSON.stringify(afterPrivileges)!==JSON.stringify(b.privileges))fail('db_privileges_changed');
    const result={ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,selinux_mode:'Enforcing',fcontext_scope:'exact_paths_only',collector_type_before:b.collector.type,collector_type_after:selinuxType(COLLECTOR),scorer_type_before:b.scorer.type,scorer_type_after:selinuxType(SCORER),systemd_validation:true,validation_mode:'rollback_only',validation_exit_status:validation.exit_status,validation_avc_denials:validation.avc_denials,timer_state_restored:true,timer_before:b.timer_before,timer_after:captureTimerState(),already_remediated:b.already_remediated,committed_database_mutation:false,database_mutation:false,business_mutation:false,external_send:false,p0_live:false,p0_decision:false,proposal_send:false,bid_send:false,auto_send:false,backup_dir:backup,changes:changes.map(c=>({path:c.path,created:c.created,before_type:c.before_type,after_type:c.after_type,rule_preexisted:c.rule_preexisted}))};
    if(result.collector_type_after!=='bin_t'||result.scorer_type_after!=='bin_t'||result.timer_after.enabled!==b.timer_before.enabled||result.timer_after.active!==b.timer_before.active)fail('result_postcondition_invalid');
    writeJson(RESULT,result);committed=true;process.stdout.write(JSON.stringify(result)+'\n');
  }finally{
    if(!committed){const rb=rollback(changes,b.timer_before);try{writeJson(backup+'/rollback.json',rb)}catch{}if(!rb.ok)process.stderr.write('rollback_failed:'+rb.errors.join('|')+'\n');}
  }
}
try{main()}catch(e){process.stderr.write(String(e&&e.stack||e)+'\n');process.exit(1)}
