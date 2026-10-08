'use strict';
// Fixed Agent 3 Node1 transport verification. This is NOT a transport driver:
// an authenticated, deployed Agent 3 remote executor must supply the 'transport'.
// Import has no effects. No arbitrary host, command, SSH or file paths accepted.
const api=require('./node1-vm-geometry-agent-api-route-v1');
const registration=require('./node1-vm-geometry-registration-plan-v1');
const manifest=require('./node1-vm-geometry-deploy-preflight-v1');
const crypto=require('node:crypto');
const NODE1='server1.prhm.ir';
const OP=api.OP;
const RUNNER_PATH='/opt/prhm-node1-readonly/vm-geometry-v1/node1-vm-geometry-runner-v1.js';
const RUNNER_SOURCE='node1-vm-geometry-runner-v1.js';
const MAX_RESPONSE_BYTES=65536;
const READ_TIMEOUT_MS=100000;
const CLOCK_SKEW_MS=120000;
const PUBKEY_PATH='/etc/prhm-agent3/trust/node1-readonly-receipts-ed25519.pem';
// Production trust root MUST be installed out-of-band and cannot be supplied by
// the caller or by the remote node. No default/test PEM is embedded in source.
function fail(code){throw Error(code)}
function strictString(x,code){if(typeof x!=='string'||!x)fail(code);return x}
const expectedRunnerBlob=registration.FILES.find(f=>f.path===RUNNER_SOURCE)?.sha;
if(!/^[a-f0-9]{40}$/.test(expectedRunnerBlob||''))fail('runner_blob_pin_missing');
function fixedRequest(){
 return Object.freeze({
   operation:OP,host:NODE1,runnerPath:RUNNER_PATH,
   runnerSourceGitBlob:expectedRunnerBlob,
   sourceCommit:registration.SOURCE_COMMIT,
   argv:Object.freeze(['--readonly']),
   timeoutMs:READ_TIMEOUT_MS,outputLimitBytes:MAX_RESPONSE_BYTES,
   readOnly:true,arbitraryCommand:false,mutation:false
 });
}
function receiptBody(body){
 if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid_receipt_body');
 const expected=new Set(['operation','host','runnerPath','runnerSourceGitBlob','sourceCommit','argv','exitCode','outputSha256','completedUtc','nonce','readOnly']);
 if(Object.keys(body).length!==expected.size||Object.keys(body).some(k=>!expected.has(k)))fail('unexpected_receipt_field');
 const req=fixedRequest();
 for(const name of ['operation','host','runnerPath','runnerSourceGitBlob','sourceCommit'])
   if(body[name]!==req[name])fail('receipt_identity_mismatch:'+name);
 if(!Array.isArray(body.argv)||body.argv.length!==1||body.argv[0]!=='--readonly')fail('receipt_argv_mismatch');
 if(body.readOnly!==true||body.exitCode!==0)fail('receipt_execution_not_readonly_success');
 if(!/^[a-f0-9]{64}$/.test(body.outputSha256||''))fail('receipt_output_sha_invalid');
 if(typeof body.nonce!=='string'||!/^[A-Za-z0-9_-]{22,96}$/.test(body.nonce))fail('receipt_nonce_invalid');
 const ts=Date.parse(body.completedUtc||'');
 if(!Number.isFinite(ts))fail('receipt_timestamp_invalid');
 return Object.freeze(body);
}
function verifyTransportEvidence(result,{verifyReceipt,now=Date.now,seenNonce}={}){
 if(!result||typeof result!=='object'||Array.isArray(result))fail('transport_result_invalid');
 if(typeof verifyReceipt!=='function'||typeof seenNonce!=='function'||typeof now!=='function')fail('trusted_receipt_verifier_missing');
 const {stdout,receipt,signature}=result;
 if(typeof stdout!=='string'||Buffer.byteLength(stdout,'utf8')>MAX_RESPONSE_BYTES||stdout.length===0)fail('transport_output_invalid');
 if(typeof signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(signature))fail('receipt_signature_invalid');
 receiptBody(receipt);
 const time=Date.parse(receipt.completedUtc);
 if(Math.abs(now()-time)>CLOCK_SKEW_MS)fail('receipt_stale_or_future');
 const got=crypto.createHash('sha256').update(stdout,'utf8').digest('hex');
 if(got!==receipt.outputSha256)fail('receipt_stdout_hash_mismatch');
 // Cryptographic trust validation occurs *only* inside the separately
 // installed Agent3 verifier with a pinned public key. Tests inject an
 // independent verifier; the remote must never supply a public key.
 const serialized=Buffer.from(JSON.stringify(receipt));
 if(verifyReceipt({payload:serialized,signature,publicKeyPath:PUBKEY_PATH})!==true)fail('receipt_cryptographic_verification_failed');
 if(seenNonce(receipt.nonce)!==false)fail('receipt_replayed');
 let parsed;try{parsed=JSON.parse(stdout)}catch{fail('runner_output_not_json')}
 const clean=api.validateResult(parsed);
 if(clean.all_domains_verified!==true)fail('node1_probe_not_green');
 return Object.freeze({...clean,evidence:{
   transport:'agent3-fixed-readonly',cryptographicReceiptVerified:true,
   sourceCommit:registration.SOURCE_COMMIT,runnerGitBlob:expectedRunnerBlob,
   completedUtc:receipt.completedUtc
 }});
}
function makeTrustedExecutor({transport,verifyReceipt,now,seenNonce}={}){
 if(!transport||typeof transport.runFixed!=='function'||typeof verifyReceipt!=='function'||typeof seenNonce!=='function')fail('trusted_agent3_components_not_registered');
 return async function(operation,params){
   if(operation!==OP||!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).length!==0)fail('not_fixed_node1_operation');
   const result=await transport.runFixed(fixedRequest());
   return verifyTransportEvidence(result,{verifyReceipt,now,seenNonce});
 };
}
module.exports={OP,NODE1,PUBKEY_PATH,MAX_RESPONSE_BYTES,RUNNER_PATH,fixedRequest,receiptBody,verifyTransportEvidence,makeTrustedExecutor};
