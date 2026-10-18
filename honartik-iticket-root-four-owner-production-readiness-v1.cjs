'use strict';
/**
 * FIXED FOUR-OWNER ROOT *READ-ONLY* PRODUCTION READINESS CHECK.
 *
 * No root adapter writes exist here. Source may be executed as root only for
 * preflight: fixed paths, pinned preimages, candidate in-memory postimages,
 * owner metadata, path parent-dir trust boundary, and code syntax.
 *
 * This file provides no install, restart, approval, signature or rollback
 * ability. Result always contains INSTALL_AUTHORIZED=NO.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const struct=require('./honartik-iticket-current-owner-live-readonly-cli-v1.cjs');
const contract=require('./honartik-iticket-worktree-level4-policy-contract-v1.cjs');
const KEYS=Object.freeze(['base','exec','policy','mcp']);
const OWNER=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
});
const PRE=struct.EXPECTED;
const POST=Object.freeze({
  base:'629212ae3052eab380ea1b3fc7c0b15395dfb23a251331762ebb781e1bbf1b2f',
  exec:'9dade5d2a9a9722c1dd1283a3a1002325da02e134804aca1ea6d673cf2de3e87',
  policy:'9a2c47db59211a638976ee181e8a5b246c79f082371d82a7396c6a07f646faa7',
  mcp:'52d3c0c04cd3bb26815403e2c089f9a408047bd9d376536ae570df669a7fd2a3'
});
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=(name)=>{throw Error('root_readiness_blocked_'+name);};
function inspectDirectoryChain(root,file,lstat){
  if(!path.isAbsolute(file)||path.normalize(file)!==file)fail('noncanonical_path');
  let d=path.dirname(file);
  while(true){
    const st=lstat(d);
    if(!st.isDirectory()||st.isSymbolicLink())fail('parent_not_real_directory');
    // A world/group-writable ancestor permits replacement after preflight.
    // A non-root-writable ancestor remains a critical trust boundary.
    if(st.uid!==0||(st.mode&0o022)!==0)fail('parent_untrusted_'+d);
    if(d===root)break;
    const next=path.dirname(d);
    if(next===d)fail('not_under_root');
    d=next;
  }
}
function inspectOwnerFromAdapter(key,io){
  const fixed=OWNER[key];
  if(!fixed)fail('owner_key_invalid');
  inspectDirectoryChain('/',fixed,io.lstat);
  const st=io.lstat(fixed);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.uid!==0)fail('owner_untrusted_'+key);
  if((st.mode&0o022)!==0)fail('owner_writable_by_others_'+key);
  // Adapter must implement descriptor-based nofollow + fstat identity checks.
  // Never trust a readFile(path) that can race with lstat(path).
  const snap=io.readPinned(fixed,st);
  if(!snap||!Buffer.isBuffer(snap.bytes)||!snap.fstat||
     snap.fstat.dev!==st.dev||snap.fstat.ino!==st.ino||
     snap.fstat.uid!==st.uid||snap.fstat.gid!==st.gid||
     snap.fstat.mode!==st.mode||snap.fstat.nlink!==st.nlink)
    fail('owner_race_or_invalid_descriptor_'+key);
  if(sha256(snap.bytes)!==PRE[key])fail('owner_preimage_drift_'+key);
  const text=snap.bytes.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(snap.bytes))fail('utf8_invalid_'+key);
  return {text,uid:st.uid,gid:st.gid,mode:st.mode&0o7777};
}
function audit(io){
  if(!io||typeof io.lstat!=='function'||typeof io.readPinned!=='function')
    fail('io_missing');
  if(Object.keys(OWNER).some(key=>OWNER[key]!==struct.FILES[key]))
    fail('path_mapping_drift');
  const input={},metadata={};
  for(const k of KEYS){
    const info=inspectOwnerFromAdapter(k,io);
    input[k]=info.text;
    metadata[k]={uid:info.uid,gid:info.gid,mode:info.mode};
  }
  const proposed=struct.transforms(input);
  proposed.policy=contract.transform(input.policy);
  const hashes={};
  for(const k of KEYS){
    hashes[k]=sha256(Buffer.from(proposed[k],'utf8'));
    if(hashes[k]!==POST[k])fail('prospective_postimage_drift_'+k);
  }
  for(const k of ['base','exec']){
    try{new vm.Script(proposed[k],{filename:k+'.js'});}
    catch{fail('syntax_'+k);}
  }
  // MCP compiled separately in syntax-only VM ESM; never module-evaluated.
  if(typeof vm.SourceTextModule!=='function'){
    return Object.freeze({
      schema:'prhm.iticket.root4.readiness.v1',source_digest:'PASS',
      owner_metadata:metadata,prospective_post_sha256:hashes,
      owner_parent_trust:'PASS',mcp_esm_syntax:'NOT_TESTED',
      approval_enforced:'NOT_ATTESTED',installer_ready:false,
      install_authorized:false,production_mutation:false
    });
  }
  try{new vm.SourceTextModule(proposed.mcp);}catch{fail('mcp_esm_syntax');}
  return Object.freeze({
    schema:'prhm.iticket.root4.readiness.v1',source_digest:'PASS',
    owner_metadata:metadata,prospective_post_sha256:hashes,
    owner_parent_trust:'PASS',mcp_esm_syntax:'PASS',
    approval_enforced:'NOT_ATTESTED',installer_ready:false,
    install_authorized:false,production_mutation:false
  });
}
function fileReader(){
  return {
    lstat:fixed=>fs.lstatSync(fixed),
    readPinned:(file,pre)=>{
      const flags=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC;
      const fd=fs.openSync(file,flags);
      try{
        const before=fs.fstatSync(fd);
        if(before.dev!==pre.dev||before.ino!==pre.ino||!before.isFile())
          fail('owner_changed_before_read');
        const bytes=fs.readFileSync(fd);
        const after=fs.fstatSync(fd);
        if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||
           after.ctimeMs!==before.ctimeMs||after.dev!==before.dev||
           after.ino!==before.ino)fail('owner_changed_during_read');
        return {bytes,fstat:after};
      }finally{fs.closeSync(fd);}
    }
  };
}
function main(){
  if(process.argv.length!==2)fail('no_arguments_allowed');
  if(process.getuid?.()!==0)fail('requires_root_for_readiness');
  const result=audit(fileReader());
  console.log('ROOT_OWNER_PREIMAGES='+result.source_digest);
  console.log('ROOT_OWNER_PARENT_TRUST='+result.owner_parent_trust);
  for(const k of KEYS){
    console.log('PROSPECTIVE_'+k.toUpperCase()+'_SHA256='+result.prospective_post_sha256[k]);
  }
  console.log('MCP_ESM_SYNTAX='+result.mcp_esm_syntax);
  console.log('EFFECTIVE_L4_ISSUER='+result.approval_enforced);
  console.log('SIGNED_ROOT_ADAPTER_READY=NO');
  console.log('INSTALL_AUTHORIZED=NO');
  console.log('PRODUCTION_MUTATION=NO');
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports=Object.freeze({KEYS,OWNER,PRE,POST,sha256,inspectDirectoryChain,audit,fileReader});
