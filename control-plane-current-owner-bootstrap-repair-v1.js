'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='control_plane_current_owner_bootstrap_repair_v1';
const INSTALLER='/opt/prhm-agent-selfmaint-exec/actions/host-action-v2-installer-v1.js';
const MEDIATOR='/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js';
const BACKUP_ROOT='/var/backups/prhm-current-owner-bootstrap-repair-v1';
const OWNER_PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
});
const OWNER_SHA=Object.freeze({
  base:'ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f',
  exec:'a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4',
  policy:'aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c',
  mcp:'8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075'
});
const shaBytes=b=>crypto.createHash('sha256').update(b).digest('hex');
const shaFile=p=>shaBytes(fs.readFileSync(p));
const fail=m=>{throw new Error(m)};
function assertRegular(p,label){
  const st=fs.lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(p)!==p)fail(label+'_invalid');
  return st;
}
function manifest(){
  return {
    schema_version:'prhm.current-owner-bootstrap-repair.v1',action:ACTION,
    owner_paths:{...OWNER_PATHS},owner_sha256:{...OWNER_SHA},installer_path:INSTALLER,
    mediator_path:MEDIATOR,backup_root:BACKUP_ROOT,zero_input:true,
    production_mutation:false,database_mutation:false,arbitrary_command:false,arbitrary_path:false
  };
}
function verifyOwners(paths=OWNER_PATHS){
  const out={};
  for(const k of Object.keys(OWNER_PATHS)){
    assertRegular(paths[k],'owner_'+k); out[k]=shaFile(paths[k]);
    if(out[k]!==OWNER_SHA[k])fail('owner_sha_mismatch:'+k);
  }
  return out;
}
function preflight(){
  const owner_sha256=verifyOwners();
  assertRegular(INSTALLER,'installer_target');
  assertRegular(MEDIATOR,'root_mediator');
  const parent=path.dirname(BACKUP_ROOT),pst=fs.lstatSync(parent);
  if(!pst.isDirectory()||pst.isSymbolicLink()||fs.realpathSync(parent)!==parent)fail('backup_parent_invalid');
  const ownerSources=Object.fromEntries(Object.entries(OWNER_PATHS).map(([k,p])=>[k,fs.readFileSync(p,'utf8')]));
  const candidate=buildFromTemplate(fs.readFileSync(INSTALLER,'utf8'),ownerSources);
  const currentInstallerSha=shaFile(INSTALLER);
  return {
    ok:true,action:ACTION,preflight_only:true,owner_sha256,candidate_sha256:candidate.sha256,
    changed:false,would_change:candidate.sha256!==currentInstallerSha,rollback_performed:false,production_mutation:false,
    database_mutation:false,arbitrary_command:false,arbitrary_path:false
  };
}
function countExact(s,n){return String(s).split(String(n)).length-1;}
function replaceOne(s,a,b,label){
  const n=countExact(s,a); if(n!==1)fail('transform_anchor_mismatch:'+label+':'+n); return s.replace(a,b);
}
function verifyOwnerSources(ownerSources){
  if(!ownerSources||typeof ownerSources!=='object'||Array.isArray(ownerSources))fail('owner_sources_invalid');
  for(const k of Object.keys(OWNER_SHA)){
    if(typeof ownerSources[k]!=='string')fail('owner_source_missing:'+k);
    if(shaBytes(Buffer.from(ownerSources[k],'utf8'))!==OWNER_SHA[k])fail('owner_sha_mismatch:'+k);
  }
}
function buildFromTemplate(template,ownerSources){
  verifyOwnerSources(ownerSources);
  let source=String(template);
  const fAnchor="const F={base:'/opt/prhm-agent-selfmaint/server.js',exec:'/opt/prhm-agent-selfmaint-exec/server.js',policy:'/opt/prhm-company-control-plane/config/approval-policy.json',mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',helper:'/opt/prhm-agent-selfmaint-exec/actions/honartik-git-worktree-fixed-v1.js'};";
  const baseline="const BASELINE=Object.freeze("+JSON.stringify(OWNER_SHA)+");";
  const oldCheck="const st=JSON.parse(fs.readFileSync(STATE,'utf8'));for(const k of ['base','exec','policy','mcp'])if(sha(F[k])!==st.post_bootstrap_sha256[k])throw Error('baseline_drift:'+k);";
  const newCheck="const st=JSON.parse(fs.readFileSync(STATE,'utf8'));for(const k of ['base','exec','policy','mcp'])if(sha(F[k])!==BASELINE[k])throw Error('baseline_drift:'+k);";
  const bc=countExact(source,baseline),oc=countExact(source,oldCheck),nc=countExact(source,newCheck);
  const baselineRe=/const BASELINE=Object\.freeze\(\{"base":"[a-f0-9]{64}","exec":"[a-f0-9]{64}","policy":"[a-f0-9]{64}","mcp":"[a-f0-9]{64}"\}\);/g;
  const priorBaselines=source.match(baselineRe)||[];
  if(bc===0&&oc===1&&nc===0){
    source=replaceOne(source,fAnchor,fAnchor+'\n'+baseline,'baseline_insert');
    source=replaceOne(source,oldCheck,newCheck,'baseline_check');
  }else if(bc===0&&oc===0&&nc===1&&priorBaselines.length===1){
    source=replaceOne(source,priorBaselines[0],baseline,'baseline_refresh');
  }else if(!(bc===1&&oc===0&&nc===1))fail('candidate_binding_state_invalid:'+bc+':'+oc+':'+nc+':'+priorBaselines.length);
  for(const bad of ['rahekomak_production_deploy_v1','prhm_config_center_edge_helper_binding_repair_v1'])if(source.includes(bad))fail('forbidden_historical_action:'+bad);
  const bytes=Buffer.from(source,'utf8');
  const ck=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:'utf8',timeout:30000,maxBuffer:300000});
  if(ck.error||ck.status!==0)fail('candidate_syntax_invalid:'+String(ck.stderr||ck.stdout||ck.error||'').slice(-1000));
  return {bytes,sha256:shaBytes(bytes),metadata:{syntax_valid:true,owner_sha256:{...OWNER_SHA},template_sha256:shaBytes(Buffer.from(String(template),'utf8'))}};
}
function buildInstallerCandidate(ownerSources){
  verifyOwnerSources(ownerSources);
  return buildFromTemplate(fs.readFileSync(INSTALLER,'utf8'),ownerSources);
}
function readOwnerSources(paths){
  return Object.fromEntries(Object.keys(OWNER_SHA).map(k=>[k,fs.readFileSync(paths[k],'utf8')]));
}
function writeFsync(file,bytes,mode){
  const fd=fs.openSync(file,'wx',mode);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function syntaxFile(file){
  const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check',file],{encoding:'utf8',timeout:30000,maxBuffer:300000});
  if(r.error||r.status!==0)fail('candidate_file_syntax_invalid:'+String(r.stderr||r.stdout||r.error||'').slice(-1000));
}
function restoreFile(file,preimage,st){
  const tmp=file+'.rollback-'+process.pid+'-'+Date.now()+'.tmp';
  writeFsync(tmp,preimage,st.mode&0o777); fs.chownSync(tmp,st.uid,st.gid); fs.chmodSync(tmp,st.mode&0o777); fs.renameSync(tmp,file);
  if(shaFile(file)!==shaBytes(preimage))fail('rollback_sha_mismatch');
}
function resultBase(candidate,ownerSha){return {
  action:ACTION,preflight_only:false,owner_sha256:ownerSha,candidate_sha256:candidate&&candidate.sha256||null,
  database_mutation:false,arbitrary_command:false,arbitrary_path:false
};}
function applyToPaths({installer,owners,state_dir,fail_after_first_rename=false,production=false}){
  let renamed=false,rollback=false,preimage=null,st=null,candidate=null,ownerSha=null,runDir=null;
  try{
    ownerSha=verifyOwners(owners); assertRegular(installer,'installer_target');
    const ownerSources=readOwnerSources(owners); preimage=fs.readFileSync(installer); st=fs.lstatSync(installer);
    candidate=buildFromTemplate(preimage.toString('utf8'),ownerSources);
    if(candidate.sha256===shaBytes(preimage))return {ok:true,...resultBase(candidate,ownerSha),changed:false,rollback_performed:false,production_mutation:false};
    fs.mkdirSync(state_dir,{recursive:true,mode:0o700});
    runDir=path.join(state_dir,'run-'+Date.now()+'-'+process.pid); fs.mkdirSync(runDir,{mode:0o700});
    writeFsync(path.join(runDir,'installer.preimage.bak'),preimage,0o600);
    const tmp=installer+'.current-owner-repair-'+process.pid+'-'+Date.now()+'.tmp.js';
    writeFsync(tmp,candidate.bytes,st.mode&0o777); fs.chownSync(tmp,st.uid,st.gid); fs.chmodSync(tmp,st.mode&0o777);
    syntaxFile(tmp); if(shaFile(tmp)!==candidate.sha256)fail('candidate_tmp_sha_mismatch');
    fs.renameSync(tmp,installer); renamed=true;
    if(fail_after_first_rename)fail('injected_after_first_rename');
    if(shaFile(installer)!==candidate.sha256)fail('post_write_sha_mismatch');
    const afterOwners=verifyOwners(owners);
    if(JSON.stringify(afterOwners)!==JSON.stringify(ownerSha))fail('owner_postcondition_changed');
    const out={ok:true,...resultBase(candidate,ownerSha),changed:true,rollback_performed:false,production_mutation:production===true,backup_dir:runDir};
    writeFsync(path.join(runDir,'result.json'),Buffer.from(JSON.stringify(out,null,2)+'\n'),0o600);
    return out;
  }catch(error){
    if(renamed&&preimage&&st){
      try{restoreFile(installer,preimage,st);rollback=true}catch(rb){throw new Error('repair_failed_rollback_failed:'+String(error&&error.message||error)+':'+String(rb&&rb.message||rb))}
    }
    return {ok:false,...resultBase(candidate,ownerSha),changed:false,rollback_performed:rollback,production_mutation:false,error:String(error&&error.message||error).slice(0,1000)};
  }
}
function fixtureTree(){
  const root=fs.mkdtempSync('/tmp/prhm-current-owner-fixture-');
  const installer=path.join(root,'host-action-v2-installer-v1.js'); fs.copyFileSync(INSTALLER,installer);
  const owners={};
  for(const [k,p] of Object.entries(OWNER_PATHS)){const dst=path.join(root,k+path.extname(p));fs.copyFileSync(p,dst);owners[k]=dst;}
  return {root,installer,owners};
}
function rollbackFixture(){
  const f=fixtureTree();
  try{
    const installerBefore=shaFile(f.installer),ownersBefore=verifyOwners(f.owners);
    const r=applyToPaths({installer:f.installer,owners:f.owners,state_dir:path.join(f.root,'state'),fail_after_first_rename:true});
    return {...r,installer_restored:shaFile(f.installer)===installerBefore,owners_unchanged:JSON.stringify(verifyOwners(f.owners))===JSON.stringify(ownersBefore)};
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
}
function successFixture(){
  const f=fixtureTree();
  try{
    const ownersBefore=verifyOwners(f.owners);
    const first=applyToPaths({installer:f.installer,owners:f.owners,state_dir:path.join(f.root,'state1')});
    const firstInstallerSha=shaFile(f.installer);
    const second=applyToPaths({installer:f.installer,owners:f.owners,state_dir:path.join(f.root,'state2')});
    return {first,second,first_installer_sha:firstInstallerSha,second_installer_sha:shaFile(f.installer),owners_unchanged:JSON.stringify(verifyOwners(f.owners))===JSON.stringify(ownersBefore)};
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
}
function apply(){
  if(process.getuid&&process.getuid()!==0)fail('root_required');
  preflight();
  const out=applyToPaths({installer:INSTALLER,owners:OWNER_PATHS,state_dir:BACKUP_ROOT,production:true});
  if(out.ok!==true)fail('repair_apply_failed:'+out.error);
  return out;
}
module.exports={
  manifest,preflight,buildInstallerCandidate,apply,
  __test:{rollbackFixture,successFixture}
};
if(require.main===module){
  const mode=process.argv[2]||'preflight';
  const out=mode==='apply'?apply():preflight();
  process.stdout.write(JSON.stringify(out)+'\n');
}
