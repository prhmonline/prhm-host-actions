'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const LIVE_SOURCE='/home/agent/ssh-agent-api/root-stage-fixed-v1.candidate.txt';
const LIVE_TARGET='/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js';
const BACKUP_ROOT='/var/backups/prhm-host-actions-github-fixed-deployment-v1';
const EXEC_SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';
const PRHM_NODE='/usr/local/bin/prhm-node';
const CURL='/usr/bin/curl';

const CONTRACT=Object.freeze({
  schema_version:'prhm.github-fixed-deployment.v1',
  action:'root_scripts_fixed_stage_promotion_v1',
  source:'agent_api/root-stage-fixed-v1.candidate.txt',
  source_sha256:'22181213d9c6a1b5982778530a9b674782f6de023e6ed75f915366f995eb5bd8',
  target:'/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js',
  target_preimage_sha256:'50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee'
});

function validateInvocation(argv=process.argv,env=process.env){
  if(!Array.isArray(argv) || argv.length!==2) throw new Error('unexpected_arguments');
  if(String(env.SSH_ORIGINAL_COMMAND||'').trim()!=='') throw new Error('unexpected_original_command');
  return true;
}

function assertRegularNotSymlink(st,label){
  if(!st || typeof st.isFile!=='function' || !st.isFile()) throw new Error(`${label}_not_regular_file`);
  if(typeof st.isSymbolicLink==='function' && st.isSymbolicLink()) throw new Error(`${label}_symlink`);
}

function assertExecutorHealth(health,label='executor_unhealthy'){
  if(!health || health.ok!==true) throw new Error(label);
  const actions=Array.isArray(health.host_actions_v2)?health.host_actions_v2:[];
  if(!actions.includes('root_scripts_fixed_stage_v1')) throw new Error(`${label}_action_missing`);
}

function createDispatcher(ops){
  const required=['stat','sha256File','nodeCheck','executorHealth','readFile','writeExclusive','fsyncFile','rename','fsyncDir','now'];
  for(const name of required) if(!ops || typeof ops[name]!=='function') throw new Error(`missing_op_${name}`);

  function preflight(){
    const sourceStat=ops.stat('source');
    assertRegularNotSymlink(sourceStat,'source');
    const sourceSha=ops.sha256File('source');
    if(sourceSha!==CONTRACT.source_sha256) throw new Error('source_sha_mismatch');

    const targetStat=ops.stat('target');
    assertRegularNotSymlink(targetStat,'target');
    const targetSha=ops.sha256File('target');
    if(targetSha===CONTRACT.source_sha256){
      return {ok:true,already_applied:true,before_sha256:targetSha};
    }
    if(targetSha!==CONTRACT.target_preimage_sha256) throw new Error('target_sha_mismatch');

    try{ops.nodeCheck('source');}catch(error){throw new Error(`candidate_syntax_failure:${error.message}`);}
    assertExecutorHealth(ops.executorHealth(),'executor_unhealthy');
    return {ok:true,already_applied:false,before_sha256:targetSha};
  }

  function rollback(preimage){
    ops.writeExclusive('rollback_temp',preimage,{mode:0o700});
    ops.fsyncFile('rollback_temp');
    ops.rename('rollback_temp','rollback_target');
    ops.fsyncDir('target_dir');
    const restored=ops.sha256File('target');
    if(restored!==CONTRACT.target_preimage_sha256) throw new Error(`rollback_verification_failed:${restored}`);
    assertExecutorHealth(ops.executorHealth(),'rollback_executor_unhealthy');
    return restored;
  }

  function apply(){
    const pf=preflight();
    if(pf.already_applied){
      return {ok:true,action:CONTRACT.action,already_applied:true,mutation:false,before_sha256:pf.before_sha256,after_sha256:pf.before_sha256,rollback_performed:false};
    }

    const preimage=ops.readFile('target');
    const candidate=ops.readFile('source');
    const stamp=String(ops.now());
    ops.writeExclusive('backup',preimage,{stamp,mode:0o600});
    let mutated=false;
    try{
      ops.writeExclusive('temp',candidate,{stamp,mode:0o700});
      ops.fsyncFile('temp');
      ops.rename('temp','target');
      mutated=true;
      ops.fsyncDir('target_dir');
      const installed=ops.sha256File('target');
      if(installed!==CONTRACT.source_sha256) throw new Error(`installed_sha_mismatch:${installed}`);
      try{ops.nodeCheck('target');}catch(error){throw new Error(`installed_syntax_failure:${error.message}`);}
      assertExecutorHealth(ops.executorHealth(),'post_write_health_failure');
      return {
        ok:true,
        action:CONTRACT.action,
        already_applied:false,
        mutation:true,
        before_sha256:pf.before_sha256,
        after_sha256:installed,
        backup_id:stamp,
        rollback_performed:false,
        verification:'PASS'
      };
    }catch(error){
      if(!mutated) throw error;
      try{
        const restored=rollback(preimage);
        return {
          ok:false,
          action:CONTRACT.action,
          status:'FAILED_ROLLED_BACK',
          error:error.message,
          before_sha256:pf.before_sha256,
          after_sha256:restored,
          rollback_performed:true,
          verification:'ROLLBACK_PASS'
        };
      }catch(rollbackError){
        throw new Error(`promotion_failed_and_rollback_failed:${error.message}:${rollbackError.message}`);
      }
    }
  }

  return {preflight,apply};
}


function createFixedRuntimeOps(...args){
  if(args.length!==0) throw new Error('unexpected_arguments');
  const state={backup:null,temp:null,rollback_temp:null};
  function livePath(which){
    if(which==='source') return LIVE_SOURCE;
    if(which==='target'||which==='installed') return LIVE_TARGET;
    if(state[which]) return state[which];
    throw new Error(`unknown_fixed_path:${which}`);
  }
  function hashFile(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
  function runFixed(exe,argv,label){
    const r=cp.spawnSync(exe,argv,{encoding:'utf8',stdio:['ignore','pipe','pipe'],shell:false});
    if(r.status!==0) throw new Error(`${label}:${String(r.stderr||'').trim()}`);
    return String(r.stdout||'');
  }
  function uniqueStamp(){return new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14)+'Z';}
  return {
    stat(which){return fs.lstatSync(livePath(which));},
    sha256File(which){return hashFile(livePath(which));},
    nodeCheck(which){runFixed(PRHM_NODE,['--check',livePath(which)],'node_check_failed');return true;},
    executorHealth(){
      const out=runFixed(CURL,['--silent','--show-error','--fail','--unix-socket',EXEC_SOCKET,'http://localhost/health'],'executor_health_failed');
      let parsed;try{parsed=JSON.parse(out);}catch{throw new Error('executor_health_invalid_json');}
      return parsed;
    },
    readFile(which){return fs.readFileSync(livePath(which));},
    writeExclusive(which,bytes,meta={}){
      let p;
      if(which==='backup'){
        fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});
        p=path.join(BACKUP_ROOT,`root-scripts-fixed-stage-v1.${String(meta.stamp||uniqueStamp())}.bak`);
      }else if(which==='temp'){
        p=LIVE_TARGET+`.candidate-${String(meta.stamp||uniqueStamp())}-${process.pid}`;
      }else if(which==='rollback_temp'){
        p=LIVE_TARGET+`.rollback-${uniqueStamp()}-${process.pid}`;
      }else throw new Error(`unknown_write_slot:${which}`);
      const fd=fs.openSync(p,'wx',meta.mode||0o600);
      try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.chmodSync(p,meta.mode||0o600);
      state[which]=p;
      return p;
    },
    fsyncFile(which){const fd=fs.openSync(livePath(which),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}},
    rename(from,to){
      const src=livePath(from);
      if(to!=='target'&&to!=='rollback_target') throw new Error(`unknown_rename_target:${to}`);
      fs.renameSync(src,LIVE_TARGET);
      state[from]=null;
    },
    fsyncDir(){const fd=fs.openSync(path.dirname(LIVE_TARGET),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}},
    now(){return uniqueStamp();}
  };
}

module.exports={CONTRACT,validateInvocation,createDispatcher,createFixedRuntimeOps};

if(require.main===module){
  try{
    validateInvocation();
    const result=createDispatcher(createFixedRuntimeOps()).apply();
    process.stdout.write(JSON.stringify(result)+'\n');
    if(result.ok!==true) process.exitCode=1;
  }catch(error){
    process.stdout.write(JSON.stringify({ok:false,action:CONTRACT.action,error:error.message})+'\n');
    process.exitCode=1;
  }
}
