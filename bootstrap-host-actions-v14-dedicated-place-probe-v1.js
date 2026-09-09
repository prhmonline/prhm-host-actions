'use strict';

const fs=require('fs');
const crypto=require('crypto');

const ACTION='honartik_iticket_v14_dedicated_place_probe_v1';

const SOURCE=
  __dirname+
  '/artifacts/honartik-iticket-v14-dedicated-place-probe-v1/opsExecutorRoutes.js';

const TARGET='/home/agent/ssh-agent-api/opsExecutorRoutes.js';

const OLD_SHA=
  'df5c2ad6991eda64224db059388703db18fe2045aea7798d48e13efd4de62bbb';

const NEW_SHA=
  '49e38d08562597d07b88db2c6e6dbc91fd167a3a5249129c7df7e05ae9f49034';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

function inspect(){
  const src=fs.readFileSync(SOURCE);
  const target=fs.readFileSync(TARGET);

  const sourceSha=sha(src);
  const targetSha=sha(target);

  if(sourceSha!==NEW_SHA)
    throw new Error('source_sha_mismatch');

  if(targetSha!==OLD_SHA && targetSha!==NEW_SHA)
    throw new Error('target_sha_drift');

  return {
    ok:true,
    action:ACTION,
    target:TARGET,
    old_sha256:OLD_SHA,
    new_sha256:NEW_SHA,
    current_sha256:targetSha,
    already_applied:targetSha===NEW_SHA,
    production_mutation:false,
    database_mutation:false,
    arbitrary_path:false,
    arbitrary_command:false
  };
}

module.exports={
  ACTION,
  SOURCE,
  TARGET,
  OLD_SHA,
  NEW_SHA,
  inspect
};

if(require.main===module){
  process.stdout.write(JSON.stringify(inspect())+'\n');
}
