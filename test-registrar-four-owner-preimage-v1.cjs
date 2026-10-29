'use strict';
/**
 * Read-only, exact-SHA production-owner baseline attestation.
 * Source-only gate: NO mutation, no installer, no approval/credential handling.
 * Run against PRIVATE copies made from the already-authenticated root host.
 * Output contains only file names, SHA256 and safety contract booleans.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const SPECS=Object.freeze([
 {name:'base.server.js',owner:'base',sha:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',bytes:34422,mode:'0644'},
 {name:'executor.server.js',owner:'executor',sha:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',bytes:112811,mode:'0755'},
 {name:'mcp.hostActionsV2.js',owner:'mcp',sha:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',bytes:12287,mode:'0600'},
 {name:'approval-policy.json',owner:'policy',sha:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',bytes:30333,mode:'0644'}
]);
const VERSION='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const NEW_ACTION='prhm_action_registry_install_v1';
function sha(b){return crypto.createHash('sha256').update(b).digest('hex')}
function exactlyOnce(s,marker){assert.equal(s.split(marker).length,2,'owner-anchor-not-unique:'+marker)}
function verify(dir){
 assert.equal(typeof dir,'string');
 const result=[];
 for(const x of SPECS){
  const full=path.join(dir,x.name);
  const stat=fs.lstatSync(full);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'owner-copy-not-regular:'+x.owner);
  const b=fs.readFileSync(full);
  assert.equal(b.length,x.bytes,'owner-size-drift:'+x.owner);
  assert.equal(sha(b),x.sha,'owner-sha-drift:'+x.owner);
  const s=b.toString('utf8');
  if(x.owner==='base'){
   exactlyOnce(s,'const HOST_ACTION_V2_SPECS = Object.freeze({');
   exactlyOnce(s,"req.url === '/v2/host-actions/request'");
   exactlyOnce(s,"req.url === '/v2/host-actions/authorize-consume'");
   assert.match(s,/Object\.keys\(input\)\.length !== 1/,'base-legacy-request-contract-changed');
  } else if(x.owner==='executor'){
   exactlyOnce(s,'const HOST_ACTION_V2_SPECS = Object.freeze({');
   exactlyOnce(s,"req.url === '/v2/host-actions/request'");
   exactlyOnce(s,"req.url === '/v2/host-actions/execute'");
   assert.match(s,/Object\.keys\(input\)\.length!==1/,'executor-legacy-request-contract-changed');
  } else if(x.owner==='mcp'){
   exactlyOnce(s,'const HostActionV2=z.enum([');
   exactlyOnce(s,"mcp.registerTool('host_action_v2_request'");
   exactlyOnce(s,"mcp.registerTool('host_action_v2_apply'");
  } else {
   const policy=JSON.parse(s);
   assert.equal(policy.schema_version,'prhm.approval-policy.v1');
   assert.equal(policy.version,VERSION);
   assert.equal(policy.default_deny,true);
   assert.equal(policy.scope_freeze,true);
   assert.equal(Object.hasOwn(policy.operations,'host_action.'+NEW_ACTION),false);
   assert.equal(policy.typed_scopes.some(z=>z.action===NEW_ACTION),false);
  }
  assert.equal(s.includes(NEW_ACTION),false,'registrar-unexpectedly-already-live:'+x.owner);
  result.push({owner:x.owner,file:x.name,sha256:x.sha,bytes:x.bytes,mode_from_live_stat:x.mode,verified:true});
 }
 return Object.freeze({ok:true,read_only:true,registrar_installed:false,
  source:'pinned-production-preimages',production_mutation:false,files:result});
}
module.exports={SPECS,VERSION,NEW_ACTION,verify};
if(require.main===module){
 try{
  if(process.argv.length!==3)throw Error('usage: node test-registrar-four-owner-preimage-v1.cjs <private-owner-folder>');
  process.stdout.write(JSON.stringify(verify(process.argv[2]))+'\n');
 }catch(error){process.stderr.write('PREIMAGE_FAIL '+error.message+'\n');process.exitCode=1;}
}
