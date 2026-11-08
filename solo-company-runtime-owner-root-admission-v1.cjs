'use strict';
/**
 * OWNER-GOVERNED admission policy for Solo Root registration.
 *
 * This is a DIFFERENT trust issuer from Provider Root-of-Trust. It never
 * impersonates provider, mints grants, generates keys, invokes a shell, or
 * writes production files. Only a separately pinned privileged dispatcher may
 * call admitOwner after checking live production code, exact source identity,
 * and the explicit owner-signed waiver for that final source commit.
 */
const crypto=require('node:crypto');
const fs=require('node:fs');
const receipt=require('./solo-company-runtime-provider-signed-receipt-v1.js');
const tx=require('./solo-company-runtime-signed-registration-transaction-v1.js');
const KEY_PIN='d161f17f3d3446185e9b106b459b693eb3f453653d8221fc7d8e3f6b987f477b';
const KEY_FILE='/root/prhm-owner-public-key.candidate.pem';
const WAIVER_DIR='/root/prhm-solo-trust-evidence';
const KIND='PRHM-SOLO-OWNER-REVIEW-WAIVER-V1';
const SHA40=/^[a-f0-9]{40}$/;
const FAIL=c=>{throw Error('solo_owner_admission_'+c)};
function trustedRegular(file,allowedMode){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file||
    st.uid!==0||st.gid!==0||(st.mode&0o777)!==allowedMode)
    FAIL('root_file_unsafe');
  return fs.readFileSync(file);
}
function pinnedPublicKey(pem){
  const key=crypto.createPublicKey(pem);
  if(key.asymmetricKeyType!=='ed25519')FAIL('wrong_public_key_type');
  const der=key.export({format:'der',type:'spki'});
  if(tx.hash(der)!==KEY_PIN)FAIL('public_key_pin_mismatch');
  return key;
}
function waiverMessage(hostHead,isoDate){
  if(!SHA40.test(hostHead)||!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(isoDate||''))
    FAIL('waiver_source_date_invalid');
  return KIND+'|DATE='+isoDate+
    '|PR232_SHA='+hostHead+'|SSHAGENT_PR60_SHA='+tx.SOURCE_COMMITS.sshagent+
    '|KEY_SHA256='+KEY_PIN+'|INDEPENDENT_REVIEW=WAIVED_BY_OWNER'+
    '|LEVEL4_RECEIPT=NOT_ISSUED|PRODUCTION_INSTALL=NOT_AUTHORIZED';
}
function verifyWaiver({publicKeyPem,message,signature,hostHead}={}){
  const key=pinnedPublicKey(publicKeyPem);
  if(!Buffer.isBuffer(message)||!Buffer.isBuffer(signature)||signature.length!==64)
    FAIL('waiver_bytes_invalid');
  const m=message.toString('ascii');
  if(!Buffer.from(m,'ascii').equals(message))FAIL('waiver_encoding_invalid');
  const date=m.match(/^PRHM-SOLO-OWNER-REVIEW-WAIVER-V1\|DATE=(20[0-9]{2}-[0-9]{2}-[0-9]{2})\|/);
  if(!date||m!==waiverMessage(hostHead,date[1]))FAIL('waiver_commit_mismatch');
  if(!crypto.verify(null,message,key,signature))FAIL('waiver_signature_invalid');
  return Object.freeze({verified:true,review_waived:true,host_head:hostHead,
    signer_key_pin:KEY_PIN,registration_authorized:false});
}
function verifyOwnerPermit({token,plan,requestId,nowSeconds,publicKeyPem}={}){
  pinnedPublicKey(publicKeyPem);
  const grant=receipt.verifyOwnerReceipt({
    token,plan,requestId,nowSeconds,publicKeyPem,
    pinnedPublicKeySha256:KEY_PIN
  });
  if(!grant.verified||grant.operation!==receipt.OPERATION||grant.level!==4)
    FAIL('l4_receipt_invalid');
  return grant;
}
function admitOwner({token,plan,requestId,nowSeconds,hostHead}={}){
  // Fixed root-only inputs. No caller-selected public key / signer / waiver.
  if(process.getuid()!==0||process.geteuid()!==0)FAIL('root_required');
  const publicKeyPem=trustedRegular(KEY_FILE,0o600);
  const message=trustedRegular(WAIVER_DIR+'/waiver.txt',0o600);
  const signature=trustedRegular(WAIVER_DIR+'/waiver.sig',0o600);
  const waiver=verifyWaiver({publicKeyPem,message,signature,hostHead});
  const grant=verifyOwnerPermit({token,plan,requestId,nowSeconds,publicKeyPem});
  return Object.freeze({waiver,grant,public_key_pin:KEY_PIN,
    authorized_for_install:false,needs_durable_receipt_consumption:true});
}
module.exports=Object.freeze({KEY_PIN,KEY_FILE,WAIVER_DIR,KIND,
  waiverMessage,pinnedPublicKey,verifyWaiver,verifyOwnerPermit,admitOwner});
if(require.main===module){
  process.stderr.write('NO_CLI: owner admission alone does not install or authorize root writes\n');
  process.exitCode=64;
}
