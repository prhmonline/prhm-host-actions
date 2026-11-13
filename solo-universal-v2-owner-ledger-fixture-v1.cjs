'use strict';
/*
 * Crash/replay fixture for owner-governed Universal v2 observation adoption.
 * This is the SOURCE REVIEW harness, NOT the production root installer.
 * All filesystem writes are hard-confined to a private tmp fixture.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const binding=require('./solo-universal-v2-host-action-binding-candidate-v1.cjs');
const {UUID}=Object.freeze({UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i});
const MARK='SOLO_UNIVERSAL_V2_LEDGER_FIXTURE_ONLY\n';
const err=(s)=>{throw Error('solo_v2_fixture_ledger_'+s)};
const expectedDir=(root)=>path.resolve(os.tmpdir(),path.basename(root));
function regular(p){
  const s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink())err('unsafe_file');
  return s;
}
function directory(p){
  const s=fs.lstatSync(p);
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0)err('unsafe_directory');
  return s;
}
function dirsync(p){
  const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function rootFixture(root){
  if(typeof root!=='string'||path.dirname(root)!==path.resolve(os.tmpdir())||
      !/^solo-universal-v2-ledger-fixture-[a-f0-9]{16}$/.test(path.basename(root))||
      expectedDir(root)!==root)
    err('outside_private_fixture');
  directory(root);
  const marker=path.join(root,'.fixture');
  regular(marker);
  if(fs.readFileSync(marker,'utf8')!==MARK)err('fixture_marker_missing');
  for(const sub of ['ledger','journal'])directory(path.join(root,sub));
  return root;
}
function init(root){
  if(typeof root!=='string'||path.dirname(root)!==path.resolve(os.tmpdir())||
      !/^solo-universal-v2-ledger-fixture-[a-f0-9]{16}$/.test(path.basename(root))||
      fs.existsSync(root))err('outside_new_fixture');
  fs.mkdirSync(root,{mode:0o700});
  try{
    fs.writeFileSync(path.join(root,'.fixture'),MARK,{flag:'wx',mode:0o600});
    for(const sub of ['ledger','journal'])
      fs.mkdirSync(path.join(root,sub),{mode:0o700});
    return rootFixture(root);
  }catch(e){fs.rmSync(root,{recursive:true,force:true});throw e}
}
function record(pathname,object){
  const fd=fs.openSync(pathname,'wx',0o600);
  try{
    fs.writeFileSync(fd,JSON.stringify(object)+'\n',{encoding:'utf8'});
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd)}
  dirsync(path.dirname(pathname));
}
function validateVerifiedGrant(receipt){
  if(!receipt||typeof receipt!=='object'||receipt.signature_verified!==true||
      receipt.operation!==binding.OPERATION||receipt.source_only!==true||
      receipt.consumed!==false||receipt.production_authorized!==false||
      receipt.independent_root_executor_required!==true||
      !UUID.test(receipt.request_id||'')||!UUID.test(receipt.jti||'')||
      !Number.isSafeInteger(receipt.exp)||receipt.exp<1)
    err('unverified_owner_grant');
  return receipt;
}
function consumeFixture(root,receipt,nowSeconds){
  root=rootFixture(root);
  validateVerifiedGrant(receipt);
  if(!Number.isSafeInteger(nowSeconds)||nowSeconds>=receipt.exp)
    err('expired_receipt');
  const ledger=path.join(root,'ledger');
  const journal=path.join(root,'journal');
  const txn=path.join(journal,receipt.request_id+'.json');
  const marker=path.join(ledger,receipt.jti+'.json');
  if(fs.existsSync(txn)||fs.existsSync(marker))err('replay_or_transaction_exists');
  record(txn,{schema:'solo.v2.offline.journal.v1',operation:binding.OPERATION,
    request_id:receipt.request_id,jti:receipt.jti,status:'PREPARED',
    production_modified:false});
  // Durable receipt consumption precedes every simulated state transition.
  record(marker,{schema:'solo.v2.offline.ledger.v1',operation:binding.OPERATION,
    request_id:receipt.request_id,jti:receipt.jti,
    consumed:true,production_modified:false});
  return Object.freeze({status:'FIXTURE_RECEIPT_CONSUMED',
    root_path:root,request_id:receipt.request_id,jti:receipt.jti,
    production_modified:false});
}
function reconcileFixture(root,requestId){
  root=rootFixture(root);
  if(!UUID.test(requestId||''))err('request_id_invalid');
  const journal=path.join(root,'journal',requestId+'.json');
  const recordValue=JSON.parse(fs.readFileSync(journal,'utf8'));
  if(recordValue.schema!=='solo.v2.offline.journal.v1'||
     recordValue.operation!==binding.OPERATION||
     recordValue.request_id!==requestId||recordValue.status!=='PREPARED'||
     recordValue.production_modified!==false||!UUID.test(recordValue.jti))
    err('journal_invalid');
  const marker=path.join(root,'ledger',recordValue.jti+'.json');
  regular(marker);
  const ledger=JSON.parse(fs.readFileSync(marker,'utf8'));
  if(ledger.schema!=='solo.v2.offline.ledger.v1'||
     ledger.operation!==binding.OPERATION||
     ledger.request_id!==requestId||ledger.jti!==recordValue.jti||
     ledger.consumed!==true||ledger.production_modified!==false)
    err('ledger_journal_mismatch');
  const recovered=path.join(root,'journal',requestId+'.recovered.json');
  record(recovered,{schema:'solo.v2.offline.recovery.v1',
    request_id:requestId,status:'ROLLED_BACK',production_modified:false});
  return Object.freeze({status:'ROLLED_BACK',receipt_still_consumed:true,
    production_modified:false,root_only_required_for_real_apply:true});
}
module.exports=Object.freeze({MARK,init,rootFixture,validateVerifiedGrant,
  consumeFixture,reconcileFixture});
if(require.main===module){
  process.stderr.write('SOURCE_ONLY_NO_PRODUCTION_ROOT_DRIVER\n');
  process.exitCode=64;
}
