'use strict';

const fs=require('node:fs');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const TARGET=
  '/home/agent/ssh-mcp-server/src/plugins/safeFiles.js';

const EXPECTED=
  'ab72784b04bba1190c664c6624cb5897ef4eb818796fa1f6cb43fcb72e110c23';

const SERVICE='prhm-agent-mcp.service';

const OLD=
  "    '--pipe','--wait','--collect','--quiet',";

const NEW=
  "    '--wait','--collect','--quiet',";

function sha(b){
  return crypto.createHash('sha256').update(b).digest('hex');
}

function fail(msg){
  throw new Error(msg);
}

const before=fs.readFileSync(TARGET);

if(sha(before)!==EXPECTED){
  fail('preimage_sha_mismatch');
}

let source=before.toString('utf8');

if(source.split(OLD).length-1!==1){
  fail('pipe_anchor_count_mismatch');
}

const required=[
  "'--property=NoNewPrivileges=yes'",
  "'--property=PrivateTmp=yes'",
  "'--property=PrivateDevices=yes'",
  "'--property=ProtectSystem=strict'",
  "'--property=ProtectHome=read-only'",
  "'--property=RestrictAddressFamilies=AF_UNIX'",
  "'--property=WorkingDirectory='+ZDT_WORKTREE"
];

for(const x of required){
  if(!source.includes(x)){
    fail('sandbox_invariant_missing:'+x);
  }
}

source=source.replace(OLD,NEW);

const candidate=Buffer.from(source,'utf8');
const newSha=sha(candidate);

const backup=
  '/root/safeFiles.js.pre-zdt-v26.'+
  EXPECTED+'.bak';

const tmp=
  TARGET+'.v26.'+process.pid+'.tmp';

fs.copyFileSync(TARGET,backup);
fs.writeFileSync(tmp,candidate,{mode:0o600});

if(sha(fs.readFileSync(tmp))!==newSha){
  fail('temporary_sha_mismatch');
}

let committed=false;

try{
  fs.renameSync(tmp,TARGET);
  committed=true;

  const check=cp.spawnSync(
    '/usr/local/bin/prhm-node',
    ['--check',TARGET],
    {encoding:'utf8'}
  );

  if(check.status!==0){
    fail('node_check_failed:'+String(check.stderr||''));
  }

  const restart=cp.spawnSync(
    '/usr/bin/systemctl',
    ['restart',SERVICE],
    {encoding:'utf8'}
  );

  if(restart.status!==0){
    fail('service_restart_failed');
  }

  let active=false;

  for(let i=0;i<40;i++){
    const r=cp.spawnSync(
      '/usr/bin/systemctl',
      ['is-active','--quiet',SERVICE]
    );

    if(r.status===0){
      active=true;
      break;
    }

    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0,0,250
    );
  }

  if(!active){
    fail('service_not_active');
  }

  if(sha(fs.readFileSync(TARGET))!==newSha){
    fail('post_apply_sha_mismatch');
  }

  console.log(JSON.stringify({
    ok:true,
    action:'agent2_zdt_sandbox_no_pipe_remediation_v26',
    old_sha256:EXPECTED,
    new_sha256:newSha,
    service_active:true,
    sandbox_properties_preserved:true,
    rollback_performed:false
  }));

}catch(error){

  try{
    if(fs.existsSync(tmp))fs.unlinkSync(tmp);

    if(committed){
      fs.copyFileSync(backup,TARGET);

      cp.spawnSync(
        '/usr/bin/systemctl',
        ['restart',SERVICE]
      );
    }
  }catch(rollbackError){
    fail(
      'apply_failed_rollback_failed:'+
      error.message+':'+rollbackError.message
    );
  }

  throw error;
}
