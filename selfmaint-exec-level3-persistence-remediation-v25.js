#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='selfmaint_exec_level3_persistence_remediation_v25';
const TARGET='/opt/prhm-agent-selfmaint-exec/server.js';
const SERVICE='prhm-agent-selfmaint-exec.service';
const SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';
const EXPECTED_SHA256='d8db336881f80589b2ca30e953f8a7a3992d205dd79057ffc2fb0acd11d74c86';
const BACKUP_ROOT='/var/backups/prhm-selfmaint-exec-level3-persistence-v25';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/selfmaint-exec-level3-persistence-v25/latest.json';
const ARBITRARY_INPUT=false;

const REQUEST_OLD=`      const record = {
        request_id: requestId,
        request_hash: out?.request?.request_hash || out?.request?.arguments_sha256 || null,
        expires_at: out?.request?.expires_at || null,
        created_at: new Date().toISOString(),
        spec
      };`;
const REQUEST_NEW=`      const record = {
        request_id: requestId,
        request_hash: out?.request?.request_hash || out?.request?.arguments_sha256 || null,
        expires_at: out?.request?.expires_at || null,
        created_at: new Date().toISOString(),
        level: Number(out?.request?.level || 4),
        risk: String(out?.request?.risk || 'critical'),
        spec
      };
      if (![3,4].includes(record.level)) throw new Error('selfmaint_request_level_invalid');`;
const EXEC_OLD=`      if (body.second_confirmation !== CONFIRMATION) throw new Error('Level-4 confirmation required');
      if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length < 3 || body.note.length > 1000)) throw new Error('invalid_note');
      loadRequest(requestId);`;
const EXEC_NEW=`      const record = loadRequest(requestId);
      const requiredConfirmation = Number(record.level) === 3 ? 'CONFIRM_LEVEL_3_PRODUCTION' : CONFIRMATION;
      if (body.second_confirmation !== requiredConfirmation) throw new Error(Number(record.level) === 3 ? 'Level-3 confirmation required' : 'Level-4 confirmation required');
      if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length < 3 || body.note.length > 1000)) throw new Error('invalid_note');`;
const STATUS_OLD=`      if (!fs.existsSync(jobFile(requestId))) return json(res, 404, { ok: false, error: 'status_not_found' });
      return json(res, 200, { ok: true, job: sanitize(readJson(jobFile(requestId))) });`;
const STATUS_NEW=`      if (fs.existsSync(jobFile(requestId))) return json(res, 200, { ok: true, job: sanitize(readJson(jobFile(requestId))) });
      if (!fs.existsSync(requestFile(requestId))) return json(res, 404, { ok: false, error: 'status_not_found' });
      const record = loadRequest(requestId);
      return json(res, 200, { ok: true, status:'pending', request: sanitize({request_id:record.request_id,request_hash:record.request_hash,level:Number(record.level||4),risk:String(record.risk||'critical'),expires_at:record.expires_at||null,created_at:record.created_at||null,status:'pending'}) });`;

const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const count=(s,n)=>s.split(n).length-1;
function fail(m){throw new Error(m)}
function transformSource(source){
  if(typeof source!=='string')fail('source_invalid');
  if(count(source,REQUEST_OLD)!==1)fail('request_anchor_invalid');
  if(count(source,EXEC_OLD)!==1)fail('execute_anchor_invalid');
  if(count(source,STATUS_OLD)!==1)fail('status_anchor_invalid');
  const out=source.replace(REQUEST_OLD,REQUEST_NEW).replace(EXEC_OLD,EXEC_NEW).replace(STATUS_OLD,STATUS_NEW);
  if(count(out,REQUEST_NEW)!==1||count(out,EXEC_NEW)!==1||count(out,STATUS_NEW)!==1)fail('candidate_contract_missing');
  if(count(out,REQUEST_OLD)||count(out,EXEC_OLD)||count(out,STATUS_OLD))fail('old_contract_remaining');
  return out;
}
function syntaxCheck(bytes){
  const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:null,timeout:15000,maxBuffer:262144,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}});
  if(r.error||r.status!==0)fail('candidate_syntax_invalid');
}
const HEALTH_ATTEMPTS=40;
const HEALTH_RETRY_MS=250;

function sleepMs(ms){
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    ms
  );
}

function healthCheck(){
  let last='health_unavailable';

  for(
    let attempt=1;
    attempt<=HEALTH_ATTEMPTS;
    attempt++
  ){
    const r=cp.spawnSync(
      '/usr/bin/curl',
      [
        '-fsS',
        '--unix-socket',
        SOCKET,
        'http://localhost/health'
      ],
      {
        encoding:'utf8',
        timeout:15000,
        maxBuffer:262144,
        env:{
          PATH:
            '/usr/local/sbin:/usr/local/bin:' +
            '/usr/sbin:/usr/bin:/sbin:/bin',
          LC_ALL:'C',
          HOME:'/nonexistent'
        }
      }
    );

    if(
      !r.error &&
      r.status===0
    ){
      let j=null;

      try{
        j=JSON.parse(
          String(r.stdout||'')
        );
      }catch{}

      if(
        j?.ok===true &&
        j?.service==='prhm-agent-selfmaint-exec'
      ){
        return {
          ok:true,
          service:j.service,
          version:j.version||null,
          attempt
        };
      }

      last='health_not_ok';
    }else{
      last=String(
        r.stderr ||
        r.error?.message ||
        'health_unavailable'
      ).slice(0,240);
    }

    if(attempt<HEALTH_ATTEMPTS){
      sleepMs(HEALTH_RETRY_MS);
    }
  }

  fail(
    'health_not_ready_after_retry:' +
    last
  );
}

function serviceActive(){
  const s=cp.execFileSync('/usr/bin/systemctl',['is-active',SERVICE],{encoding:'utf8',timeout:10000}).trim();
  if(s!=='active')fail('service_not_active');
}
function atomicWrite(file,bytes,st){
  const dir=path.dirname(file),tmp=path.join(dir,'.'+path.basename(file)+'.v24-'+process.pid+'-'+Date.now()+'.tmp');
  let fd;
  try{fd=fs.openSync(tmp,'wx',st.mode&0o777);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chmodSync(tmp,st.mode&0o777);fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file);const dfd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(dfd)}finally{fs.closeSync(dfd)}}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{fs.unlinkSync(tmp)}catch{}throw e}
}
function buildCandidate(){
  const st=fs.lstatSync(TARGET);if(st.isSymbolicLink()||!st.isFile())fail('target_not_regular');if(fs.realpathSync(TARGET)!==TARGET)fail('target_realpath_mismatch');
  const before=fs.readFileSync(TARGET),oldSha=digest(before);if(oldSha!==EXPECTED_SHA256)fail('preimage_sha_mismatch:'+oldSha);
  const candidate=Buffer.from(transformSource(before.toString('utf8')),'utf8');syntaxCheck(candidate);
  return {st,before,oldSha,candidate,newSha:digest(candidate)};
}
function execute(){
  if(process.argv.slice(2).length!==0)fail('unexpected_arguments');
  const c=buildCandidate();
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14),dir=path.join(BACKUP_ROOT,stamp+'-'+process.pid);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const backup=path.join(dir,'server.js.bak');fs.writeFileSync(backup,c.before,{mode:0o600,flag:'wx'});
  let wrote=false,rollback=false;
  try{
    atomicWrite(TARGET,c.candidate,c.st);wrote=true;
    if(digest(fs.readFileSync(TARGET))!==c.newSha)fail('postwrite_sha_mismatch');
    cp.execFileSync('/usr/bin/systemctl',['restart',SERVICE],{encoding:'utf8',timeout:60000});
    serviceActive();const health=healthCheck();
    const out={ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,target:TARGET,service:SERVICE,old_sha256:c.oldSha,new_sha256:c.newSha,service_active:true,health_ok:true,health,arbitrary_path:false,arbitrary_command:false,external_network:false,database_mutation:false,production_application_tree_mutation:false,rollback_performed:false};
    fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});fs.writeFileSync(RESULT,JSON.stringify(out)+'\n',{mode:0o600});return out;
  }catch(e){
    if(wrote){try{atomicWrite(TARGET,c.before,c.st);cp.execFileSync('/usr/bin/systemctl',['restart',SERVICE],{encoding:'utf8',timeout:60000});serviceActive();healthCheck();rollback=true}catch(rb){fail('apply_failed_rollback_failed:'+String(e?.message||e)+':'+String(rb?.message||rb))}}
    const err=new Error('apply_failed'+(rollback?'_rolled_back':'')+':'+String(e?.message||e));err.rollback_performed=rollback;throw err;
  }
}
module.exports={ACTION,TARGET,SERVICE,EXPECTED_SHA256,ARBITRARY_INPUT,REQUEST_OLD,REQUEST_NEW,EXEC_OLD,EXEC_NEW,STATUS_OLD,STATUS_NEW,transformSource,buildCandidate,execute};
if(require.main===module){try{process.stdout.write(JSON.stringify(execute())+'\n')}catch(e){process.stderr.write(String(e?.stack||e)+'\n');process.exitCode=1}}
