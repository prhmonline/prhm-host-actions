'use strict';
// Fixed-scope, audit-only inventory. Not a deployment or authorization mechanism.
// This file has no shell, network, write, or service-control operations.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const SOURCE_COMMIT='f22b1d17801239f7539f84e5aa8b91250c87dc58';
const EXPECTED_RELEASE='20261006-224241-0e8686eed30f';
const RELEASES_ROOT='/home/drtarjomeh/domains/drtarjomeh.ir/releases';
const POINTER='/home/drtarjomeh/domains/drtarjomeh.ir/public_html';
const ENV='/etc/drtarjomeh/production.env';
const FILES=Object.freeze([
  'api/config/main-local.php','api/config/web.php','api/web/index.php','backend/web/index.php',
  'common/components/DisabledSmsService.php','common/config/base.php','common/config/base_env.php',
  'common/config/env/dev.php','common/config/env/dev_m.php','common/config/env/devmp.php',
  'common/config/env/drtarjomeh-ir.php','common/config/env/prod.php','common/config/load-environment.php',
  'common/config/params.php','console/config/main.php','core/helpers/sms/webservice/mediana.php',
  'environments/prod/yii','frontend/web/index.php','panel/web/index.php',
  'scripts/probe-runtime-bootstrap.php','scripts/test-environment-loader.php',
  'site_configs/drtarjomeh-ir.php','translator/web/index.php','yii'
]);

function isSafeRelative(p) {
  return typeof p==='string' && p.length>0 && !path.isAbsolute(p) &&
    p.split('/').every(part=>part!=='' && part!=='.' && part!=='..') &&
    path.posix.normalize(p)===p;
}
function lstat(fsImpl,p) {
  try { return {stat:fsImpl.lstatSync(p)}; }
  catch(e) { return {error:e&&e.code==='ENOENT'?'MISSING':'UNAVAILABLE'}; }
}
function inventoryFile(fsImpl,root,rel) {
  if(!isSafeRelative(rel)) return {path:rel,status:'UNSAFE_PATH'};
  let current=root;
  const parts=rel.split('/');
  for(let i=0;i<parts.length;i++){
    current=path.join(current,parts[i]);
    const info=lstat(fsImpl,current);
    if(info.error) return {path:rel,status:info.error};
    if(info.stat.isSymbolicLink()) return {path:rel,status:i===parts.length-1?'SYMLINK':'PARENT_SYMLINK'};
    if(i<parts.length-1 && !info.stat.isDirectory()) return {path:rel,status:'PARENT_NOT_DIRECTORY'};
    if(i===parts.length-1){
      if(!info.stat.isFile()) return {path:rel,status:'NON_REGULAR'};
      try {
        const digest=crypto.createHash('sha256').update(fsImpl.readFileSync(current)).digest('hex');
        return {path:rel,status:'REGULAR',sha256:digest,bytes:info.stat.size};
      } catch { return {path:rel,status:'UNAVAILABLE'}; }
    }
  }
  return {path:rel,status:'UNAVAILABLE'};
}
function environmentMetadata(fsImpl,envPath) {
  const info=lstat(fsImpl,envPath);
  if(info.error) return {status:info.error,contents_read:false};
  const st=info.stat;
  if(st.isSymbolicLink())return {status:'SYMLINK',contents_read:false};
  if(!st.isFile())return {status:'NON_REGULAR',contents_read:false};
  return {status:'REGULAR',mode:st.mode&0o777,owner_uid:st.uid,owner_gid:st.gid,
    permission_gate:(st.mode&0o777)===0o600?'MODE_OK':'MODE_UNSAFE',contents_read:false};
}
function preflight(fsImpl=fs,fixture=null) {
  const cfg=fixture||{};
  const pointer=cfg.pointer||POINTER;
  const releaseRoot=cfg.releasesRoot||RELEASES_ROOT;
  const expected=path.join(releaseRoot,EXPECTED_RELEASE);
  const env=cfg.env||ENV;
  const result={
    schema:'prhm.drtarjomeh.security-preflight.v1',
    audit_only:true,production_mutation:false,cutover_authorized:false,
    source_commit:SOURCE_COMMIT,expected_release:EXPECTED_RELEASE,
    pointer_identity:'UNVERIFIED',protected_env:null,files:[],
    summary:{regular:0,missing:0,restricted:0},gate:'BLOCKED'
  };
  const pointerSt=lstat(fsImpl,pointer);
  if(pointerSt.error)result.pointer_identity=pointerSt.error;
  else if(!pointerSt.stat.isSymbolicLink())result.pointer_identity='NOT_SYMLINK';
  else {
    try{result.pointer_identity=fsImpl.realpathSync(pointer)===expected?'MATCH':'MISMATCH';}
    catch{result.pointer_identity='UNAVAILABLE';}
  }
  if(result.pointer_identity==='MATCH') {
    result.files=FILES.map(p=>inventoryFile(fsImpl,expected,p));
    result.summary.regular=result.files.filter(x=>x.status==='REGULAR').length;
    result.summary.missing=result.files.filter(x=>x.status==='MISSING').length;
    result.summary.restricted=FILES.length-result.summary.regular-result.summary.missing;
  }
  result.protected_env=environmentMetadata(fsImpl,env);
  // Audit evidence cannot grant approval, even when every check succeeds.
  result.gate='BLOCKED_PENDING_RECONCILIATION_AND_LEVEL4_APPROVAL';
  return result;
}
if(require.main===module){
  if(process.argv.length!==3 || process.argv[2]!=='--audit-only'){
    process.stderr.write('Usage: node drtarjomeh-current-release-preflight-v1.js --audit-only\n');
    process.exitCode=2;
  } else {
    const result=preflight();
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.pointer_identity!=='MATCH' || result.summary.regular!==FILES.length ||
       result.protected_env.status!=='REGULAR' ||
       result.protected_env.permission_gate!=='MODE_OK') process.exitCode=1;
  }
}
module.exports={SOURCE_COMMIT,EXPECTED_RELEASE,RELEASES_ROOT,POINTER,ENV,FILES,isSafeRelative,inventoryFile,environmentMetadata,preflight};
