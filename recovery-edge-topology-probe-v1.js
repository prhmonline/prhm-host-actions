'use strict';
const fs=require('node:fs');
const {spawnSync:defaultSpawnSync}=require('node:child_process');

const ACTION='recovery_edge_topology_probe_v1';
const OPERATION='host_action.recovery_edge_topology_probe_v1';
const READ_ONLY=true;
const RISK='low';
const REQUEST_FIELDS=Object.freeze([]);
const SERVICE='prhm-recovery-edge.service';
const NODE1_HOSTS=Object.freeze(['10.71.0.1','185.191.76.138']);
const KEY_CANDIDATES=Object.freeze([
  '/root/.ssh/prhm_controlplane_ed25519',
  '/root/.ssh/id_ed25519',
  '/root/.ssh/id_rsa'
]);
const SHA_RE=/^[a-f0-9]{64}$/;

function remoteScript(){return String.raw`set -euo pipefail
export LC_ALL=C
UNIT='prhm-recovery-edge.service'
systemctl show "$UNIT" --no-pager --property=Id,LoadState,ActiveState,SubState,FragmentPath,ExecStart
FRAGMENT="$(systemctl show "$UNIT" --no-pager --property=FragmentPath --value)"
[ -n "$FRAGMENT" ]
[ -f "$FRAGMENT" ]
printf 'UNIT_SHA256='
sha256sum "$FRAGMENT" | awk '{print $1}'
EXEC="$(systemctl show "$UNIT" --no-pager --property=ExecStart --value)"
printf '%s\n' "$EXEC" | grep -oE '/[^ ;{}"]+\.(js|mjs|cjs|conf|json|yaml|yml)' | sort -u | while IFS= read -r p; do
  [ -f "$p" ] || continue
  printf 'CANDIDATE_PATH=%s\n' "$p"
  printf 'CANDIDATE_SHA256='
  sha256sum "$p" | awk '{print $1}'
done
ss -lntp 2>/dev/null | grep -E '127\.0\.0\.1:(9080|9444)([[:space:]]|$)' | while IFS= read -r line; do
  printf 'LISTENER=%s\n' "$line"
done || true
`;}

function existingKeys(fsOps=fs){
  const out=[];
  for(const key of KEY_CANDIDATES){
    try{if(fsOps.statSync(key).isFile())out.push(key)}catch{}
  }
  return out;
}

function buildSshAttempts(fsOps=fs){
  const keys=existingKeys(fsOps);
  const selected=keys.length?keys:[null];
  const input=remoteScript();
  const out=[];
  for(const host of NODE1_HOSTS){
    for(const key of selected){
      const args=['-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=no','-o','UserKnownHostsFile=/dev/null'];
      if(key)args.push('-i',key,'-o','IdentitiesOnly=yes');
      const target=`root@${host}`;
      args.push(target,'bash','-s');
      out.push({file:'/usr/bin/ssh',args,input,target,host,key});
    }
  }
  return out;
}

function redact(value){
  return String(value||'')
    .replace(/((?:token|secret|password|passwd|authorization|api[_-]?key)\s*[=:]\s*)[^\s;]+/ig,'$1[REDACTED]')
    .replace(/(--(?:token|password|secret|api-key)\s+)[^\s;]+/ig,'$1[REDACTED]')
    .slice(0,4096);
}

function safePath(value){
  const v=String(value||'').trim();
  if(!v.startsWith('/')||v.length>512||/[\r\n\0]/.test(v))throw new Error('invalid_topology_path');
  return v;
}

function parseEvidence(stdout){
  const text=String(stdout||'');
  if(Buffer.byteLength(text,'utf8')>131072)throw new Error('topology_output_too_large');
  const service={id:null,load_state:null,active_state:null,sub_state:null,fragment_path:null,exec_start:null,unit_sha256:null};
  const candidates=[];const listeners=[];let pendingPath=null;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();if(!line)continue;
    if(line.startsWith('Id=')){service.id=line.slice(3,259);continue}
    if(line.startsWith('LoadState=')){service.load_state=line.slice(10,74);continue}
    if(line.startsWith('ActiveState=')){service.active_state=line.slice(12,76);continue}
    if(line.startsWith('SubState=')){service.sub_state=line.slice(9,73);continue}
    if(line.startsWith('FragmentPath=')){service.fragment_path=safePath(line.slice(13));continue}
    if(line.startsWith('ExecStart=')){service.exec_start=redact(line.slice(10));continue}
    if(line.startsWith('UNIT_SHA256=')){
      const sha=line.slice(12).trim().toLowerCase();if(!SHA_RE.test(sha))throw new Error('invalid_unit_sha256');service.unit_sha256=sha;continue;
    }
    if(line.startsWith('CANDIDATE_PATH=')){pendingPath=safePath(line.slice(15));continue}
    if(line.startsWith('CANDIDATE_SHA256=')){
      const sha=line.slice(17).trim().toLowerCase();if(!pendingPath||!SHA_RE.test(sha))throw new Error('invalid_candidate_sha256');
      if(candidates.length>=16)throw new Error('too_many_candidates');
      candidates.push({path:pendingPath,sha256:sha});pendingPath=null;continue;
    }
    if(line.startsWith('LISTENER=')){
      if(listeners.length>=16)throw new Error('too_many_listeners');
      const v=redact(line.slice(9));
      if(/127\.0\.0\.1:(?:9080|9444)\b/.test(v))listeners.push(v);
    }
  }
  if(service.id!==SERVICE)throw new Error('service_identity_mismatch');
  if(!service.fragment_path||!service.unit_sha256)throw new Error('service_topology_incomplete');
  if(pendingPath)throw new Error('candidate_sha_missing');
  return {service,candidates,listeners};
}

function runProbe({spawnSync=defaultSpawnSync,fsOps=fs}={}){
  const attempts=[];
  for(const attempt of buildSshAttempts(fsOps)){
    const result=spawnSync(attempt.file,attempt.args,{input:attempt.input,encoding:'utf8',timeout:20000,maxBuffer:180000});
    const exitCode=Number.isInteger(result?.status)?result.status:null;
    attempts.push({host:attempt.host,key:attempt.key?attempt.key.split('/').pop():null,exit_code:exitCode,error:result?.error?.message?String(result.error.message).slice(0,300):null,stderr:String(result?.stderr||'').slice(0,500)});
    if(exitCode===0){
      try{return {ok:true,action:ACTION,operation:OPERATION,read_only:true,risk:RISK,node1_host:attempt.host,evidence:parseEvidence(result.stdout),attempts}}
      catch(error){return {ok:false,action:ACTION,operation:OPERATION,read_only:true,risk:RISK,error:String(error?.message||'topology_parse_failed').slice(0,160),attempts}}
    }
  }
  return {ok:false,action:ACTION,operation:OPERATION,read_only:true,risk:RISK,error:'node1_unreachable',attempts};
}

module.exports=Object.freeze({ACTION,OPERATION,READ_ONLY,RISK,REQUEST_FIELDS,SERVICE,NODE1_HOSTS,KEY_CANDIDATES,remoteScript,buildSshAttempts,parseEvidence,runProbe});
