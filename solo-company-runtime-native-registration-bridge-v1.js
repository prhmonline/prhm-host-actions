'use strict';
/**
 * SOURCE-ONLY: exact six-file plan bridge into the previously tested native
 * atomic registrar. No CLI, root grant, signer, public-key provisioning,
 * service restart, network call, or production apply capability is exported.
 *
 * Provider-owned trusted dispatcher must independently authenticate a
 * canonical signed one-time receipt and then invoke executeCore with the
 * immutable plan and real Health/rollback callbacks.
 */
const native=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const tx=require('./solo-company-runtime-signed-registration-transaction-v1.js');
const receipt=require('./solo-company-runtime-provider-signed-receipt-v1.js');

const OWNER_ORDER=Object.freeze(['approval','executor','mcp','policy']);
const ASSET_ORDER=Object.freeze(['core','worker']);
const fail=c=>{throw new Error('solo_native_bridge_'+c)};
function convertExactPlan(plan){
  tx.verifyPlan(plan);
  const byKind=new Map(plan.steps.map(s=>[s.kind,s]));
  if(byKind.size!==6)fail('duplicate_step');
  if(native.KEYS.join(',')!=='base,executor,mcp,policy')fail('registrar_version_mismatch');
  const steps=OWNER_ORDER.map((kind,index)=>{
    const s=byKind.get(kind);
    if(!s)fail('missing_owner_'+kind);
    if(s.uid!==0||s.gid!==0||(s.mode&0o022)!==0)fail('unsafe_owner_metadata_'+kind);
    return {key:native.KEYS[index],path:s.path,
      beforeSha:s.before_sha256,afterSha:s.after_sha256,
      nextBytes:Buffer.from(s.bytes),
      expectedUid:s.uid,expectedGid:s.gid,expectedMode:s.mode};
  });
  const assets=ASSET_ORDER.map(kind=>{
    const s=byKind.get(kind);
    if(!s)fail('missing_asset_'+kind);
    if(s.uid!==0||s.gid!==0||(s.mode&0o022)!==0)fail('unsafe_asset_metadata_'+kind);
    // Enforce core's exact existing SHA and worker's required absence INSIDE
    // native executeCore under its own lock; not only at plan construction.
    return {path:s.path,nextBytes:Buffer.from(s.bytes),afterSha:s.after_sha256,
      expectedBeforeSha:s.before_sha256};
  });
  if(byKind.get('worker').before_sha256!==null||
     byKind.get('core').before_sha256!==tx.PINS.core_before)
    fail('asset_before_images_invalid');
  const converted={
    schema:'prhm.registrar.native-transaction.v1',
    sourceCommit:tx.SOURCE_COMMITS.host,
    manifestSha256:receipt.hashPlan(plan),
    steps,assets
  };
  native.checkPlan(converted);
  return converted;
}
function preflightReceipt({plan,token,publicKeyPem,pinnedPublicKeySha256,requestId,nowSeconds}={}){
  // Preview only. Does not trust caller-supplied key hash as a production pin.
  const nativePlan=convertExactPlan(plan);
  const signed=receipt.verifyReceipt({token,publicKeyPem,pinnedPublicKeySha256,
    plan,requestId,nowSeconds});
  if(signed.plan_sha256!==nativePlan.manifestSha256)
    fail('signed_manifest_mismatch');
  return Object.freeze({nativePlan,verifiedReceipt:signed,authorized:false});
}
function consumeForTrustedDriver({preflight,ledgerDir,nowSeconds}={}){
  if(!preflight||preflight.authorized!==false||
     preflight.verifiedReceipt?.verified!==true||!preflight.nativePlan)
    fail('verified_preflight_required');
  // Caller must independently attest pin and authenticated origin.
  // Merely invoking this function does not grant Host Action privileges.
  const result=receipt.consumeReceipt(preflight.verifiedReceipt,ledgerDir,nowSeconds);
  return Object.freeze({verified:true,consumed:result.consumed,
    receiptId:result.jti,operation:result.operation,
    nativePlan:preflight.nativePlan,
    executable:false,needsProviderDispatcher:true});
}
module.exports=Object.freeze({OWNER_ORDER,ASSET_ORDER,
  convertExactPlan,preflightReceipt,consumeForTrustedDriver});
if(require.main===module){
  process.stderr.write('NO_CLI: Provider-controlled signed Level-4 native dispatcher required\n');
  process.exitCode=64;
}
