'use strict';
/**
 * Executable boundary for the fixed independent one-shot registry worker.
 *
 * Root systemd MUST supply a sealed, private LoadCredential under its
 * CREDENTIALS_DIRECTORY and bind trusted capabilities independently.
 * It accepts no CLI arguments, alternate paths, arbitrary actions, tokens
 * in argv/env or caller-controlled source/manifest commits.
 *
 * This file alone does NOT install the trusted Host Actions v2 bootstrap or
 * activate a route. The credential, root I/O adapter and installed executable
 * must all be SHA attested by the separately approved parent launcher.
 */
const fs=require('node:fs');
const path=require('node:path');
const runner=require('./prhm-action-registry-independent-runner-contract-v1.cjs');
const sys=require('./prhm-action-registry-fixed-systemd-bridge-v1.cjs');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const PREFIX='prhm-shared-registry-bootstrap-v1-';
const CREDENTIAL='registry-approval.json';
const INPUT_FIELDS=Object.freeze(['action','project','source_commit',
 'manifest_commit','manifest_sha256','approval_token']);
// Only objects produced by the protected credential reader in this process may enter execution.
const VERIFIED_CREDENTIAL_OBJECTS=new WeakSet();
function stop(code){throw Error('registry_independent_entry_'+code)}
function requireThat(ok,code){if(!ok)stop(code)}
function resolveCredentialPath({env,unit}){
 requireThat(env&&typeof env==='object'&&
   Object.keys(env).includes('CREDENTIALS_DIRECTORY')&&
   typeof env.CREDENTIALS_DIRECTORY==='string',
   'systemd_credentials_missing');
 const dir=env.CREDENTIALS_DIRECTORY;
 requireThat(
   dir==='/run/credentials/'+unit&&
   /^prhm-shared-registry-bootstrap-v1-[a-z0-9-]+\.service$/.test(unit),
   'credential_path_or_unit_untrusted');
 return dir+'/'+CREDENTIAL;
}
function secureCredential({io=fs,env=process.env,
 cgroup=()=>fs.readFileSync('/proc/self/cgroup','utf8'),
 getuid=()=>process.getuid?.()}={}){
 const unit=sys.cgroupAttestation(cgroup(),getuid);
 const filename=resolveCredentialPath({env,unit});
 const dir=path.posix.dirname(filename),d=io.lstatSync(dir);
 requireThat(d.isDirectory()&&!d.isSymbolicLink()&&
   io.realpathSync(dir)===dir&&d.uid===0&&(d.mode&0o022)===0,
   'credential_directory_unsafe');
 const st=io.lstatSync(filename);
 requireThat(st.isFile()&&!st.isSymbolicLink()&&
   io.realpathSync(filename)===filename&&st.uid===0&&
   (st.mode&0o077)===0&&st.size>120&&st.size<=20000,
   'credential_file_unsafe');
 const fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let bytes;
 try{
  const next=io.fstatSync(fd);
  requireThat(next.isFile()&&next.dev===st.dev&&next.ino===st.ino&&
    next.uid===st.uid&&next.gid===st.gid&&
    next.mode===st.mode&&next.size===st.size,
    'credential_file_replaced');
  bytes=io.readFileSync(fd);
 } finally {io.closeSync(fd)}
 requireThat(Buffer.isBuffer(bytes)&&bytes.length===st.size,
   'credential_incomplete');
 let data;
 try{data=JSON.parse(bytes.toString('utf8'))}
 catch{stop('credential_json_invalid')}
 requireThat(data&&typeof data==='object'&&!Array.isArray(data)&&
   Object.keys(data).sort().join('|')===INPUT_FIELDS.slice().sort().join('|'),
   'credential_schema_invalid');
 const input=Object.freeze({
  action:data.action,project:data.project,source_commit:data.source_commit,
  manifest_commit:data.manifest_commit,manifest_sha256:data.manifest_sha256
 });
 const pinned=runner.immutableRelease();
 const validated=bridge.strictRequest(input);
 requireThat(
  Object.keys(input).every(k=>input[k]===pinned[k])&&
  validated.arguments_sha256===runner.sandboxPlan().approval_arguments_sha256,
  'credential_release_not_pinned');
 requireThat(typeof data.approval_token==='string'&&
  data.approval_token.length>=120&&data.approval_token.length<=16384&&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.approval_token),
  'signed_approval_token_format');
 // Only a JWS-shaped secret is accepted here; the underlying gateway
 // independently cryptographically verifies Ed25519 and consumed ledger.
 const credential=Object.freeze({input,approvalToken:data.approval_token,
  unit,secret_source:'systemd-sealed-credential'});
 VERIFIED_CREDENTIAL_OBJECTS.add(credential);
 return credential;
}
async function runWithCapabilities(params={}){
 // Reject additional callbacks including any substitute authorization executor.
 requireThat(params&&typeof params==='object'&&!Array.isArray(params)&&
   Object.keys(params).sort().join('|')==='capabilities|credential',
   'trusted_invocation_contract_invalid');
 const {credential,capabilities}=params;
 requireThat(credential&&VERIFIED_CREDENTIAL_OBJECTS.has(credential)&&
   credential.secret_source==='systemd-sealed-credential',
   'trusted_invocation_required');
 const check=bridge.strictRequest(credential.input);
 requireThat(check.arguments_sha256===runner.sandboxPlan().approval_arguments_sha256,
   'request_binding_drift');
 // No fallback to a dummy or untrusted callback: the existing bridge
 // validates ALL trusted capability functions before side effects.
 bridge.attestExistingRoute(capabilities);
 // A fake callback or a caller-provided success result cannot replace the
 // immutable bridge that verifies Ed25519, consumed ledger and one-time claim.
 const result=await bridge.applyAfterConsumption({
  input:credential.input,approvalToken:credential.approvalToken,
  capabilities
 });
 requireThat(result?.ok===true&&result?.registry_visible===true&&
   result?.rollback==='not_needed'&&
   result?.source_commit===credential.input.source_commit&&
   result?.manifest_commit===credential.input.manifest_commit,
   'signed_run_postcondition_unverified');
 return Object.freeze({
  ok:true,action:runner.immutableRelease().action,
  manifest_commit:credential.input.manifest_commit,
  source_commit:credential.input.source_commit,
  registry_visible:true,rollback:'not_needed'
 });
}
// A stand-alone invocation MUST NOT fabricate trusted callbacks. Until a
// separately reviewed root launcher binds real rollback, audit and discovery
// adapters it exits BEFORE reading any credential or editing a Production file.
async function standalone(){
 if(process.argv.length!==2)stop('no_arguments_allowed');
 stop('trusted_host_capabilities_not_staged');
}
if(require.main===module){
 standalone().catch(e=>{
  process.stderr.write(String(e?.message||'runner_blocked').slice(0,180)+'\n');
  process.exitCode=78;
 });
}
module.exports=Object.freeze({
 CREDENTIAL,INPUT_FIELDS,resolveCredentialPath,secureCredential,runWithCapabilities
});
