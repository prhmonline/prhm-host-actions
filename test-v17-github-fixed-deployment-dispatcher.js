const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const dispatcherPath=path.join(__dirname,'prhm-host-actions-github-fixed-dispatcher-v1.js');

test('fixed dispatcher exposes only the approved promotion contract',()=>{
  assert.equal(fs.existsSync(dispatcherPath),true,'dispatcher must exist');
  const d=require(dispatcherPath);
  assert.deepEqual(d.CONTRACT,{
    schema_version:'prhm.github-fixed-deployment.v1',
    action:'root_scripts_fixed_stage_promotion_v1',
    source:'agent_api/root-stage-fixed-v1.candidate.txt',
    source_sha256:'22181213d9c6a1b5982778530a9b674782f6de023e6ed75f915366f995eb5bd8',
    target:'/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js',
    target_preimage_sha256:'50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee'
  });
  assert.throws(()=>d.validateInvocation(['node','dispatcher','anything'],{}),/unexpected_arguments/);
  assert.throws(()=>d.validateInvocation(['node','dispatcher'],{SSH_ORIGINAL_COMMAND:'id'}),/unexpected_original_command/);
  assert.doesNotThrow(()=>d.validateInvocation(['node','dispatcher'],{}));
});
