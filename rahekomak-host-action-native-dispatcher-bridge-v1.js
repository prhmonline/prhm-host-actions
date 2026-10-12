'use strict';
// RahKomak #143: fixed-scope bridge for an ALREADY trusted native Level-4 dispatcher.
// This module grants no authority and has no CLI installer or raw shell interface.
// A native host-action handler must separately register and authenticate the action.
const tx=require('./rahekomak-host-action-typed-registration-bootstrap-v2.js');
const reg=require('./rahekomak-host-action-registration-v2.js');
const crypto=require('node:crypto');
const ACTION=tx.ACTION,OPERATION=tx.OPERATION,SOURCE_COMMIT=tx.SOURCE_COMMIT;
const TARGETS=Object.freeze(tx.paths());
const OWNERS=Object.freeze(Object.values(reg.PATHS));
const SOURCES=Object.freeze([...tx.NAMES]);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
function fail(s){throw Error(s)}
function exactTarget(path){if(!TARGETS.includes(path))fail('unapproved_target');return path}
function exactSource(name,commit){
 if(commit!==SOURCE_COMMIT||!SOURCES.includes(name))fail('unapproved_source');
 return name;
}
function createNativeBridge(native){
 // The native authority MUST be supplied from its authenticated, signed and
 // consumed Level-4 execution context. A JS object is not an approval token.
 const methods=['acquireExclusive','consumeSignedLevel4','hasReceipt','statExact',
  'readBytes','readSourceBlob','backupExact','replaceAtomic','removeExact',
  'reloadAndHealth','persistReceipt'];
 for(const method of methods)if(typeof native?.[method]!=='function')fail('native_method_missing:'+method);
 return Object.freeze({
  acquireExclusive:async action=>{
   if(action!==ACTION)fail('action_mismatch');
   return native.acquireExclusive(ACTION);
  },
  consumeSignedLevel4:async request=>{
   if(request.action!==ACTION||request.operation!==OPERATION||
      request.source_commit!==SOURCE_COMMIT||request.level!==4||
      request.risk!=='critical'||request.one_time!==true)
     fail('approval_binding_mismatch');
   // NO locally synthesized signature, confirmation, or approval receipt.
   return native.consumeSignedLevel4(Object.freeze({...request}));
  },
  hasReceipt:async action=>native.hasReceipt(ACTION),
  statExact:path=>native.statExact(exactTarget(path)),
  readBytes:path=>native.readBytes(exactTarget(path)),
  readSourceArtifact:(name,commit)=>{
   exactSource(name,commit);
   const b=native.readSourceBlob(Object.freeze({repository:'prhmonline/prhm-host-actions',
      commit:SOURCE_COMMIT,path:name}));
   if(!Buffer.isBuffer(b)||blob(b)!==reg.ARTIFACTS[name])
     fail('reviewed_source_blob_mismatch');
   return b;
  },
  backupExact:async(path,bytes,digest,requestId)=>{
   exactTarget(path);
   if(!OWNERS.includes(path)||!Buffer.isBuffer(bytes)||sha(bytes)!==digest)
    fail('invalid_owner_backup');
   return native.backupExact(path,bytes,digest,requestId);
  },
  replaceAtomic:async(path,bytes,metadata)=>{
   exactTarget(path);
   if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>4*1024*1024||
      !Number.isInteger(metadata?.mode)||!Number.isInteger(metadata?.uid)||
      !Number.isInteger(metadata?.gid)||(metadata.mode&0o002)!==0)
      fail('invalid_replacement');
   return native.replaceAtomic(path,bytes,metadata);
  },
  removeExact:async path=>{
   if(!TARGETS.includes(path)||OWNERS.includes(path))fail('unapproved_removal');
   return native.removeExact(path);
  },
  reloadAndHealth:async(mode,bounds)=>{
   if(!['candidate','baseline'].includes(mode)||bounds?.residentProtectHome!=='yes')
    fail('unapproved_health_scope');
   return native.reloadAndHealth(mode,Object.freeze({...bounds}));
  },
  persistReceipt:async record=>{
   if(!['prepared','registration_installed','rolled_back'].includes(record?.status)||
      record.action!==ACTION||record.source_commit&&record.source_commit!==SOURCE_COMMIT)
      fail('invalid_receipt');
   return native.persistReceipt(record);
  }
 });
}
function manifest(){
 return Object.freeze({action:ACTION,operation:OPERATION,source_commit:SOURCE_COMMIT,
  immutable_paths:TARGETS,owner_preimages:reg.PREIMAGE,
  reviewed_blobs:reg.ARTIFACTS,installed:false,level:4,
  approval_source:'external_trusted_native_dispatcher_only',
  deployment_authorized:false});
}
async function runFromNativeDispatcher(native){
 const bridge=createNativeBridge(native);
 const plan=tx.prepare(bridge);
 return tx.applyFromTrustedDispatcher(bridge,plan);
}
module.exports=Object.freeze({ACTION,OPERATION,SOURCE_COMMIT,TARGETS,OWNERS,
 createNativeBridge,manifest,runFromNativeDispatcher});
if(require.main===module){
 process.stderr.write('Not a CLI. Independent signed Level-4 native handler required.\n');
 process.exitCode=64;
}
