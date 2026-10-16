'use strict';
/**
 * NO-MUTATION Root registrar survey. Fixed exact files, preimage pins,
 * count-only registration anchors; no source excerpts/secrets/tokens.
 * Does NOT authorize or install any Host Action, policy or sudoers.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const CHECKED=Object.freeze([
  Object.freeze({role:'base',path:'/opt/prhm-agent-selfmaint/server.js',sha:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',mode:0o644}),
  Object.freeze({role:'executor',path:'/opt/prhm-agent-selfmaint-exec/server.js',sha:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',mode:0o755}),
  Object.freeze({role:'policy',path:'/opt/prhm-company-control-plane/config/approval-policy.json',sha:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',mode:0o644}),
  Object.freeze({role:'mcp',path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',sha:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',mode:0o600}),
  Object.freeze({role:'helper',path:'/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js',sha:'b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb',mode:0o600})
]);
const ANCHORS=Object.freeze({
  base:Object.freeze(['host_action_v2_request','host_action_v2_apply','host_action_v2_installer_v1','imotion_credential_bind_v1','deploy_control_cutover_install_v1','prhm_action_registry_install_v1']),
  executor:Object.freeze(['HOST_ACTION_V2_SPECS','applyHostActionV2','host_action_v2_installer_v1','imotion_credential_bind_v1','deploy_control_cutover_install_v1','prhm_action_registry_install_v1']),
  mcp:Object.freeze(['host_action_v2_request','host_action_v2_apply','host_action_v2_status','deploy_control_cutover_install_v1','prhm_action_registry_install_v1'])
});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function count(s,needle){
  if(typeof s!=='string'||typeof needle!=='string'||!needle)throw Error('input_invalid');
  return s.split(needle).length-1;
}
function readFixed(x){
  if(!CHECKED.includes(x))throw Error('target_not_allowlisted');
  const st=fs.lstatSync(x.path);
  if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>2*1024*1024||
     st.uid!==0||st.gid!==0||(st.mode&0o777)!==x.mode)
    throw Error('file_type_or_owner_or_mode_untrusted:'+x.role);
  const fd=fs.openSync(x.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.dev!==st.dev||before.ino!==st.ino||before.size!==st.size)
      throw Error('pre_read_race:'+x.role);
    const buf=fs.readFileSync(fd);
    const after=fs.fstatSync(fd);
    if(after.ino!==before.ino||after.dev!==before.dev||after.size!==before.size||
       buf.length!==before.size||after.mtimeMs!==before.mtimeMs)
      throw Error('concurrent_file_change:'+x.role);
    return buf;
  }finally{fs.closeSync(fd);}
}
function summarize(read=readFixed){
  const checks=[];
  let policy=null;
  for(const x of CHECKED){
    let record={role:x.role,sha_match:false,owner_mode_trusted:false,anchors:null,error:null};
    try{
      const bytes=read(x);
      if(!Buffer.isBuffer(bytes))throw Error('bytes_not_buffer');
      record.sha_match=hash(bytes)===x.sha;
      record.owner_mode_trusted=read===readFixed;
      if(!record.sha_match)throw Error('preimage_sha_mismatch');
      if(x.role==='policy'){
        const p=JSON.parse(bytes.toString('utf8'));
        policy={version:p.version,operation_count:Object.keys(p.operations||{}).length,
          typed_scope_count:Array.isArray(p.typed_scopes)?p.typed_scopes.length:null,
          action_present:Object.hasOwn(p.operations||{},'host_action.deploy_control_cutover_install_v1'),
          registrar_present:Object.hasOwn(p.operations||{},'host_action.prhm_action_registry_install_v1')};
      }else if(ANCHORS[x.role]){
        const s=bytes.toString('utf8');
        record.anchors=Object.fromEntries(ANCHORS[x.role].map(a=>[a,count(s,a)]));
      }
    }catch(e){record.error=String(e.message||e).slice(0,100);}
    checks.push(record);
  }
  const fail=checks.some(x=>!x.sha_match||x.error)||!policy||
    policy.version!=='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1'||
    policy.operation_count!==75||policy.typed_scope_count!==52||
    policy.action_present||policy.registrar_present;
  return Object.freeze({
    schema_version:'prhm.deploy-control.registration-root-survey.v1',
    ok:!fail,read_only:true,production_mutation:false,approval_created:false,
    approval_consumed:false,host_action_registered:false,may_install:false,
    policy,checks
  });
}
module.exports=Object.freeze({CHECKED,ANCHORS,count,readFixed,summarize});
if(require.main===module){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--read-only'||process.getuid?.()!==0)
      throw Error('root_read_only_flag_required');
    const result=summarize();
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    process.exitCode=result.ok?0:2;
  }catch(e){
    process.stderr.write(JSON.stringify({ok:false,read_only:true,
      error:String(e.message||e).slice(0,100),production_mutation:false})+'\n');
    process.exitCode=3;
  }
}
