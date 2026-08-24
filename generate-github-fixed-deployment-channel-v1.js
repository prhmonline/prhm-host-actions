'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const DISPATCHER_PATH=path.join(__dirname,'prhm-host-actions-github-fixed-dispatcher-v1.js');
const ACCOUNT='prhm-host-actions-deploy';
const INSTALLED_DISPATCHER='/usr/local/libexec/prhm-host-actions-github-fixed-dispatcher-v1.js';
const PRHM_NODE='/usr/local/bin/prhm-node';
const HOME='/var/lib/prhm-host-actions-deploy';
const SSH_DIR=HOME+'/.ssh';
const AUTHORIZED_KEYS=SSH_DIR+'/authorized_keys';

function sha(value){
  const data=Buffer.isBuffer(value)?value:Buffer.from(String(value),'utf8');
  return crypto.createHash('sha256').update(data).digest('hex');
}

function validateEd25519Line(line,label){
  if(typeof line!=='string' || line.length===0) throw new Error(`${label}_empty`);
  if(line!==line.trim() || /[\r\n]/.test(line)) throw new Error(`${label}_multiline_or_whitespace`);
  const parts=line.split(/ +/);
  if(parts.length<2 || parts[0]!=='ssh-ed25519') throw new Error(`${label}_not_ed25519`);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(parts[1])) throw new Error(`${label}_invalid_base64`);
  let blob;
  try{blob=Buffer.from(parts[1],'base64');}catch{throw new Error(`${label}_invalid_base64`);}
  if(blob.length!==51) throw new Error(`${label}_invalid_blob_length`);
  if(blob.readUInt32BE(0)!==11 || blob.subarray(4,15).toString('ascii')!=='ssh-ed25519') throw new Error(`${label}_invalid_blob_type`);
  if(blob.readUInt32BE(15)!==32 || blob.length!==51) throw new Error(`${label}_invalid_key_length`);
  return line;
}

function validateSealInput({deployPublicKey,sshHost,sshPort,hostPublicKey}={}){
  validateEd25519Line(deployPublicKey,'deploy_public_key');
  validateEd25519Line(hostPublicKey,'host_public_key');
  if(typeof sshHost!=='string' || !/^[A-Za-z0-9.-]+$/.test(sshHost)) throw new Error('invalid_ssh_host');
  if(!Number.isInteger(sshPort) || sshPort<1 || sshPort>65535) throw new Error('invalid_ssh_port');
  return Object.freeze({deployPublicKey,sshHost,sshPort,hostPublicKey});
}

function authorizedKeysLine(deployPublicKey){
  const prefix='no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,command="/usr/local/bin/prhm-node /usr/local/libexec/prhm-host-actions-github-fixed-dispatcher-v1.js" ';
  return prefix+deployPublicKey;
}

function makeBootstrapSource(dispatcherSource,authorizedLine){
  const dispatcherB64=Buffer.from(dispatcherSource,'utf8').toString('base64');
  const dispatcherSha=sha(dispatcherSource);
  const authB64=Buffer.from(authorizedLine+'\n','utf8').toString('base64');
  const authSha=sha(authorizedLine+'\n');
  return `#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACCOUNT=${JSON.stringify(ACCOUNT)};
const HOME=${JSON.stringify(HOME)};
const SSH_DIR=${JSON.stringify(SSH_DIR)};
const AUTHORIZED_KEYS=${JSON.stringify(AUTHORIZED_KEYS)};
const DISPATCHER=${JSON.stringify(INSTALLED_DISPATCHER)};
const DISPATCHER_BYTES=Buffer.from(${JSON.stringify(dispatcherB64)},'base64');
const DISPATCHER_SHA=${JSON.stringify(dispatcherSha)};
const AUTH_BYTES=Buffer.from(${JSON.stringify(authB64)},'base64');
const AUTH_SHA=${JSON.stringify(authSha)};
const BACKUP_ROOT='/var/backups/prhm-host-actions-github-fixed-deployment-v1';
function sha(data){return crypto.createHash('sha256').update(data).digest('hex');}
function fixed(cmd,args){const r=cp.spawnSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});if(r.status!==0)throw new Error('fixed_command_failed:'+path.basename(cmd)+':'+String(r.stderr||'').trim());return String(r.stdout||'').trim();}
function existsUser(){const r=cp.spawnSync('/usr/bin/id',['-u',ACCOUNT],{encoding:'utf8',stdio:['ignore','pipe','pipe']});return r.status===0;}
function statNoLink(p){try{const st=fs.lstatSync(p);if(st.isSymbolicLink())throw new Error('symlink_refused:'+p);return st;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function ensureParent(p,mode){if(!fs.existsSync(p))fs.mkdirSync(p,{recursive:true,mode});}
function writeAtomic(p,bytes,mode,uid,gid){const dir=path.dirname(p);const tmp=path.join(dir,'.'+path.basename(p)+'.tmp-'+process.pid);const fd=fs.openSync(tmp,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(uid!==undefined&&gid!==undefined)fs.chownSync(tmp,uid,gid);fs.chmodSync(tmp,mode);fs.renameSync(tmp,p);const dfd=fs.openSync(dir,'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}}
function snapshot(p){const st=statNoLink(p);return st?{exists:true,bytes:fs.readFileSync(p),mode:st.mode&0o777,uid:st.uid,gid:st.gid}:{exists:false};}
function restore(p,s){if(!s.exists){try{fs.unlinkSync(p);}catch(e){if(e.code!=='ENOENT')throw e;}return;}writeAtomic(p,s.bytes,s.mode,s.uid,s.gid);}
function preflight(){if(process.getuid&&process.getuid()!==0)throw new Error('root_required');if(sha(DISPATCHER_BYTES)!==DISPATCHER_SHA)throw new Error('embedded_dispatcher_sha_mismatch');if(sha(AUTH_BYTES)!==AUTH_SHA)throw new Error('embedded_authorized_keys_sha_mismatch');const ds=statNoLink(DISPATCHER);if(ds&&sha(fs.readFileSync(DISPATCHER))!==DISPATCHER_SHA)throw new Error('dispatcher_unknown_preimage');const as=statNoLink(AUTHORIZED_KEYS);if(as&&sha(fs.readFileSync(AUTHORIZED_KEYS))!==AUTH_SHA)throw new Error('authorized_keys_unknown_preimage');return {ok:true,account_exists:existsUser(),dispatcher_present:!!ds,authorized_keys_present:!!as};}
function apply(){const pf=preflight();if(pf.account_exists&&pf.dispatcher_present&&pf.authorized_keys_present)return {ok:true,already_applied:true,mutation:false};const createdUser=!pf.account_exists;const beforeDispatcher=snapshot(DISPATCHER);const beforeAuth=snapshot(AUTHORIZED_KEYS);let uid,gid;try{if(createdUser){fixed('/usr/sbin/useradd',['--system','--create-home','--home-dir',HOME,'--shell','/bin/sh',ACCOUNT]);fixed('/usr/sbin/usermod',['-L',ACCOUNT]);}uid=Number(fixed('/usr/bin/id',['-u',ACCOUNT]));gid=Number(fixed('/usr/bin/id',['-g',ACCOUNT]));ensureParent('/usr/local/libexec',0o755);ensureParent(SSH_DIR,0o700);fs.chownSync(HOME,uid,gid);fs.chmodSync(HOME,0o700);fs.chownSync(SSH_DIR,uid,gid);fs.chmodSync(SSH_DIR,0o700);ensureParent(BACKUP_ROOT,0o700);writeAtomic(DISPATCHER,DISPATCHER_BYTES,0o700,0,0);writeAtomic(AUTHORIZED_KEYS,AUTH_BYTES,0o600,uid,gid);if(sha(fs.readFileSync(DISPATCHER))!==DISPATCHER_SHA)throw new Error('dispatcher_install_verify_failed');if(sha(fs.readFileSync(AUTHORIZED_KEYS))!==AUTH_SHA)throw new Error('authorized_keys_install_verify_failed');return {ok:true,already_applied:false,mutation:true,dispatcher_sha256:DISPATCHER_SHA,authorized_keys_sha256:AUTH_SHA};}catch(error){const rollbackErrors=[];for(const [p,s] of [[AUTHORIZED_KEYS,beforeAuth],[DISPATCHER,beforeDispatcher]]){try{restore(p,s);}catch(e){rollbackErrors.push(e.message);}}if(createdUser){try{fixed('/usr/sbin/userdel',['--remove',ACCOUNT]);}catch(e){rollbackErrors.push(e.message);}}if(rollbackErrors.length)throw new Error('trust_anchor_failed_and_rollback_failed:'+error.message+':'+rollbackErrors.join('|'));throw new Error('trust_anchor_failed_rolled_back:'+error.message);}}
function main(){const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--preflight-only'))throw new Error('unexpected_arguments');const result=args[0]==='--preflight-only'?preflight():apply();process.stdout.write(JSON.stringify(result)+'\\n');}
module.exports={preflight,apply};
if(require.main===module)main();
`;
}

function generate(raw){
  const input=validateSealInput(raw);
  const dispatcherSource=fs.readFileSync(DISPATCHER_PATH,'utf8');
  const line=authorizedKeysLine(input.deployPublicKey);
  const bootstrapSource=makeBootstrapSource(dispatcherSource,line);
  const result={
    authorizedKeysLine:line,
    workflowYaml:'',
    bootstrapSource,
    manifest:{
      schema_version:'prhm.github-fixed-deployment-seal.v1',
      action:'root_scripts_fixed_stage_promotion_v1',
      ssh_host:input.sshHost,
      ssh_port:input.sshPort,
      host_public_key:input.hostPublicKey,
      dispatcher_sha256:sha(dispatcherSource),
      authorized_keys_line_sha256:sha(line+'\n'),
      bootstrap_sha256:sha(bootstrapSource),
      workflow_sha256:null
    }
  };
  return Object.freeze(result);
}

module.exports={validateSealInput,generate,sha};
