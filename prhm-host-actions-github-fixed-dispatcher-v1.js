'use strict';

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

module.exports={CONTRACT,validateInvocation,createDispatcher};

if(require.main===module){
  validateInvocation();
  throw new Error('unsealed_runtime_not_executable');
}
