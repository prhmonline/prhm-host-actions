'use strict';
/**
 * Source-only candidate for the EXISTING root executor's fixed Registrar
 * entrypoint. No independent HTTP/CLI, signer, root bootstrap or installer.
 * The Provider's reviewed bootstrap must install this and companion libraries
 * with root-owned immutable source and provision the private directories.
 * Do not treat inclusion in Git or CI as authorization to deploy.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const gate=require('./shared-registrar-root-trust-preflight-v1.cjs');
const native=require('./shared-registrar-native-filesystem-v1.cjs');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');

const REPO='/var/lib/prhm-agent-selfmaint-exec/trusted-source/prhm-host-actions';
const GIT_DIR=path.join(REPO,'.git');
const STAGED='/var/lib/prhm-agent-selfmaint-exec/registrar-staged-assets-v1';
const BUILDER='/opt/prhm-agent-selfmaint-exec/actions/shared-registrar-three-owner-candidate-builder-v1.cjs';
const POLICY_BUILDER='/opt/prhm-agent-selfmaint-exec/actions/shared-registrar-policy-candidate-builder-v1.cjs';
const DISCOVERY_PROBE='/opt/prhm-agent-selfmaint-exec/actions/shared-registrar-mcp-discovery-probe-v1.cjs';
const GIT_BIN='/usr/bin/git';
const SYSTEMCTL='/usr/bin/systemctl';
const NODE='/usr/local/bin/prhm-node';
const REPO_ID='prhmonline/prhm-host-actions';
const POLICY_SERVICE='prhm-company-approval.service';
const SHA40=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const PROJECTS=Object.freeze({pbcinema:'manifests/pbcinema.json',honartik:'manifests/honartik.json'});
const ASSET_ROOT='/opt/prhm-agent-selfmaint-exec/actions/';
const ASSET_NAME=/^[a-z0-9][a-z0-9_.-]{2,120}$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(reason){throw Error('registrar_host_hook_'+reason)}
function secureDir(dir,modeStrict){
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||
    (st.mode&0o022)!==0||fs.realpathSync(dir)!==dir||
    (modeStrict&&(st.mode&0o077)!==0))fail('root_directory_untrusted');
 return dir;
}
function fixedRef(ref){
 if(!SHA40.test(ref||''))fail('git_ref_not_exact_sha');
 return ref;
}
function gitObject(ref,sourcePath){
 fixedRef(ref);
 if(!/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(sourcePath||'')||
    sourcePath.split('/').some(x=>x==='.'||x==='..')||
    sourcePath.startsWith('-'))fail('git_path_not_allowlisted');
 secureDir(REPO,true);
 secureDir(GIT_DIR,true);
 const oid=cp.execFileSync(GIT_BIN,
   ['--git-dir='+GIT_DIR,'rev-parse','--verify',ref+'^{commit}'],
   {encoding:'utf8',timeout:10000,maxBuffer:256});
 if(oid.trim()!==ref)fail('git_commit_unverified');
 const result=cp.execFileSync(GIT_BIN,
   ['--git-dir='+GIT_DIR,'show',ref+':'+sourcePath],
   {encoding:'buffer',timeout:10000,maxBuffer:1048576});
 if(!Buffer.isBuffer(result)||result.length===0||result.length>1048576)
    fail('git_blob_invalid');
 return result;
}
function rootReady(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
   fail('root_required');
 secureDir(REPO,true);
 secureDir(STAGED,true);
 // Never trust missing unprovisioned bootstrap dependencies.
 if(!fs.existsSync(GIT_DIR))fail('git_object_store_missing');
}
function fixedManifest({repo,commit,project}){
 rootReady();
 if(repo!==REPO_ID||typeof project!=='string'||
   !Object.prototype.hasOwnProperty.call(PROJECTS,project))
   fail('project_not_registered');
 fixedRef(commit);
 const manifestPath=PROJECTS[project];
 return Object.freeze({path:manifestPath,bytes:gitObject(commit,manifestPath)});
}
function fixedSource({repo,commit,path:sourcePath}){
 rootReady();
 if(repo!==REPO_ID)fail('source_repo_mismatch');
 return gitObject(commit,sourcePath);
}
function stagedAsset(dest){
 rootReady();
 if(typeof dest!=='string'||!dest.startsWith(ASSET_ROOT))
  fail('asset_destination_rejected');
 const name=dest.slice(ASSET_ROOT.length);
 if(!ASSET_NAME.test(name))fail('asset_name_invalid');
 const file=path.join(STAGED,name);
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file||
    st.uid!==0||st.gid!==0||(st.mode&0o077)!==0)
    fail('asset_stage_untrusted');
 const bytes=fs.readFileSync(file);
 if(bytes.length===0||bytes.length>1048576)fail('asset_stage_size');
 return bytes;
}
function attestedBuilder(file,commit,gitPath){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||
   (st.mode&0o022)!==0||fs.realpathSync(file)!==file)
   fail('builder_untrusted');
 const actual=fs.readFileSync(file);
 if(sha(actual)!==sha(fixedSource({repo:REPO_ID,commit,path:gitPath})))
   fail('builder_git_blob_drift');
 // The fixed root-owned module is the ONLY local code executable here.
 return require(file);
}
function candidateOwners({repo,sourceCommit,release}){
 rootReady();
 if(repo!==REPO_ID||!release?.normalized||
    release.normalized.source_commit!==sourceCommit)
   fail('release_binding_invalid');
 fixedRef(sourceCommit);
 const builder=attestedBuilder(BUILDER,sourceCommit,
   'shared-registrar-three-owner-candidate-builder-v1.cjs');
 const policy=attestedBuilder(POLICY_BUILDER,sourceCommit,
   'shared-registrar-policy-candidate-builder-v1.cjs');
 const out={};
 for(const key of native.KEYS){
  const owner=gate.OWNERS[key];
  const bytes=fs.readFileSync(owner.path);
  if(sha(bytes)!==owner.sha256)fail('owner_preimage_drift:'+key);
  if(key==='policy')out[key]=policy.build(bytes).bytes;
  else {
    const name={base:'base.server.js',executor:'executor.server.js',
      mcp:'mcp.hostActionsV2.js'}[key];
    out[key]=builder.buildOne(name,bytes).bytes;
  }
  const rec=release.normalized.owners[key];
  if(!rec||rec.before_sha256!==owner.sha256||
     rec.after_sha256!==sha(out[key]))fail('candidate_manifest_drift:'+key);
 }
 return Object.freeze(out);
}
function checkedServices(services){
 if(!Array.isArray(services)||services.length!==gate.SERVICES.length||
    services.join('|')!==gate.SERVICES.join('|'))
  fail('service_set_not_fixed');
 return services;
}
function serviceState(unit){
 const actual=cp.execFileSync(SYSTEMCTL,['is-active',unit],
  {encoding:'utf8',timeout:10000,maxBuffer:2048}).trim();
 return actual==='active';
}
function restart(unit){
 cp.execFileSync(SYSTEMCTL,['restart',unit],
  {timeout:40000,maxBuffer:8192,stdio:['ignore','pipe','pipe']});
 if(!serviceState(unit))fail('restart_not_healthy:'+unit);
}
async function discover(expectedAction,project,sourceCommit){
 if(typeof expectedAction!=='string'||!/^([a-z][a-z0-9_]{5,100})$/.test(expectedAction)||
    !Object.prototype.hasOwnProperty.call(PROJECTS,project))
   fail('discovery_binding_invalid');
 fixedRef(sourceCommit);
 const st=fs.lstatSync(DISCOVERY_PROBE);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||
    fs.realpathSync(DISCOVERY_PROBE)!==DISCOVERY_PROBE||
    (st.mode&0o022)!==0)fail('discovery_probe_untrusted');
 // Bind executable probe itself to the exact immutable source commit:
 // no unreviewed root-owned helper can silently replace the review artifact.
 const trusted=fs.readFileSync(DISCOVERY_PROBE);
 const fromGit=fixedSource({repo:REPO_ID,commit:sourceCommit,
   path:'shared-registrar-mcp-discovery-probe-v1.cjs'});
 if(sha(trusted)!==sha(fromGit))fail('discovery_probe_source_commit_drift');
 const probe=require(DISCOVERY_PROBE);
 if(typeof probe.verify!=='function')fail('discovery_probe_interface_missing');
 if(await probe.verify({action:expectedAction,project})!==true)
   fail('mcp_tool_not_discovered');
 return true;
}
async function verifyLive({services,action,project,rolledBack,sourceCommit}){
 rootReady();
 checkedServices(services);
 fixedRef(sourceCommit);
 // Policy must be reloaded on both install and rollback before consumers.
 restart(POLICY_SERVICE);
 for(const unit of services)restart(unit);
 if(!services.every(serviceState))fail('four_services_unhealthy');
 // On rollback the old registry may not contain the NEW action; the probe
 // must validate the fixed legacy host_action_v2_status tool instead.
 return discover(rolledBack?'host_action_v2_status':action,project,sourceCommit);
}
function createTrustedHooks(){
 rootReady();
 return Object.freeze({nativeInstallerHooks:()=>Object.freeze({
  readPinnedGitManifest:fixedManifest,
  readPinnedGitSource:fixedSource,
  readStagedAsset:stagedAsset,
  getPinnedCandidateOwners:candidateOwners,
  reloadAndVerifyHealth:p=>verifyLive({...p,rolledBack:false}),
  restoreAndVerifyHealth:p=>verifyLive({...p,rolledBack:true})
 })});
}
module.exports=Object.freeze({
 createTrustedHooks,
 // Pure guards are exposed for negative contract tests only.
 fixedRef,checkedServices
});
if(require.main===module){
 process.stderr.write('Native host hooks are not a standalone bootstrap or installer.\n');
 process.exitCode=64;
}
