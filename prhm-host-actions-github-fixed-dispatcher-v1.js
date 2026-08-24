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

module.exports={CONTRACT,validateInvocation};

if(require.main===module){
  validateInvocation();
}
