'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const BASE_SHA='1c261c486df729b959a63a9dc0c14f5bb730daca9d88f1ec685cc3b3dd106c16';
const OLD_HELPER_SHA='fef813dac1680653531c23bf9c9b1070a97d517bc90461844deaff97e69f4b80';
const NEW_HELPER_SHA='cf4326f4931e7965a576a54501f2e64d38ac3db6d7717f90d88d848dcb1dd0c7';
const SELFMAINT_BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function readExactBackup(full){
  let st;try{st=fs.lstatSync(full)}catch{return null}
  if(!st.isFile()||st.isSymbolicLink())return null;
  const bytes=fs.readFileSync(full);
  return sha(bytes)===BASE_SHA?bytes:null;
}
function loadBase(){
  const local=fs.readdirSync(__dirname).filter(n=>n.startsWith('fileBasicRoutes.js.agent-backup.')).sort().reverse();
  for(const name of local){
    const bytes=readExactBackup(path.join(__dirname,name));
    if(bytes)return bytes;
  }
  const official=fs.readdirSync(SELFMAINT_BACKUP_ROOT)
    .filter(n=>n.startsWith('agent_api-fileBasicRoutes.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse();
  for(const name of official){
    const bytes=readExactBackup(path.join(SELFMAINT_BACKUP_ROOT,name));
    if(bytes)return bytes;
  }
  fail('iticket_mapping_diag_base_backup_missing');
}
const bytes=loadBase();
let source=bytes.toString('utf8');
if(source.split(OLD_HELPER_SHA).length-1!==1||source.includes(NEW_HELPER_SHA))fail('iticket_mapping_diag_pin_anchor_mismatch');
source=source.replace(OLD_HELPER_SHA,NEW_HELPER_SHA);
if(source.includes(OLD_HELPER_SHA)||source.split(NEW_HELPER_SHA).length-1!==1)fail('iticket_mapping_diag_pin_postcondition');
const m=new Module(__filename,module);
m.filename=__filename;
m.paths=module.paths;
m._compile(source,__filename);
module.exports=m.exports;
// honartik-iticket-mapping-diagnostic-pin-reload-v2
