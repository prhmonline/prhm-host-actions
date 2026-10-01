#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const cp=require('node:child_process');
const http=require('node:http');
const crypto=require('node:crypto');

const ACTION='control_plane_current_owner_bootstrap_repair_v1';
const OP='host_action.'+ACTION;
const SERVICE='prhm-company-approval.service';
const POLICY='/opt/prhm-company-control-plane/config/approval-policy.json';
const EXPECTED_POLICY_SHA='aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c';
const EXPECTED_VERSION='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(s){throw new Error(s)}
function runtimePolicyHash(p){return sha(Buffer.from(JSON.stringify(p)))}
function manifest(){return {schema_version:'prhm.control-plane-approval-policy-reload.v1',action:ACTION,operation:OP,service:SERVICE,policy_path:POLICY,expected_policy_sha256:EXPECTED_POLICY_SHA,expected_policy_version:EXPECTED_VERSION,zero_input:true,database_mutation:false,arbitrary_command:false,arbitrary_path:false};}
function exactScope(p){return Array.isArray(p.typed_scopes)&&p.typed_scopes.some(x=>x&&x.tool==='host_action_v2_apply'&&x.project==='control_plane'&&x.environment==='production'&&x.action===ACTION&&x.risk==='critical'&&x.operation===OP&&Array.isArray(x.principals)&&x.principals.length===1&&x.principals[0]?.principal_id==='mohammad'&&Array.isArray(x.principals[0]?.roles)&&x.principals[0].roles.length===1&&x.principals[0].roles[0]==='mcp-operator');}
function verifyPolicy(p){if(!p||p.version!==EXPECTED_VERSION||p.operations?.[OP]?.level!==4||Object.keys(p.operations[OP]||{}).length!==1||!exactScope(p))fail('policy_contract_mismatch');return true;}
async function preflight(a=defaultAdapter()){
 const p=a.policy(); verifyPolicy(p);
 if(a.policySha()!==EXPECTED_POLICY_SHA)fail('policy_sha_mismatch');
 if(await a.serviceActive()!==true)fail('approval_service_not_active');
 const expectedHash=runtimePolicyHash(p),h=await a.health();
 const loaded=h&&h.ok===true&&h.service==='prhm-company-approval'&&h.policy_version===EXPECTED_VERSION&&h.policy_hash===expectedHash;
 return {ok:true,state:loaded?'ALREADY_APPLIED':'READY',changed:false,production_mutation:false,database_mutation:false,service_control:false,expected_policy_hash:expectedHash};
}
async function apply(a=defaultAdapter()){
 const pf=await preflight(a); if(pf.state==='ALREADY_APPLIED')return {...pf,result:'ALREADY_APPLIED'};
 await a.restart(SERVICE);
 const p=a.policy(),expectedHash=runtimePolicyHash(p); let h=null;
 for(let i=0;i<20;i++){try{h=await a.health();if(h&&h.ok===true&&h.service==='prhm-company-approval'&&h.policy_version===EXPECTED_VERSION&&h.policy_hash===expectedHash)break;}catch{} await new Promise(r=>setTimeout(r,150));}
 if(!h||h.ok!==true||h.service!=='prhm-company-approval'||h.policy_version!==EXPECTED_VERSION||h.policy_hash!==expectedHash)fail('approval_reload_postcondition_failed');
 return {ok:true,result:'SUCCEEDED',changed:true,production_mutation:true,database_mutation:false,service_control:true,policy_version:EXPECTED_VERSION,policy_hash:expectedHash};
}
function healthRequest(){return new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port:18133,path:'/health',timeout:3000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{const x=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(res.statusCode!==200)throw Error('health_http_'+res.statusCode);resolve(x)}catch(e){reject(e)}})});req.on('timeout',()=>req.destroy(Error('health_timeout')));req.on('error',reject);});}
function defaultAdapter(){return {policy:()=>JSON.parse(fs.readFileSync(POLICY,'utf8')),policySha:()=>sha(fs.readFileSync(POLICY)),serviceActive:async()=>cp.spawnSync('/usr/bin/systemctl',['is-active','--quiet',SERVICE]).status===0,health:healthRequest,restart:async s=>{if(s!==SERVICE)fail('unexpected_service');const r=cp.spawnSync('/usr/bin/systemctl',['restart',SERVICE],{encoding:'utf8'});if(r.status!==0)fail('approval_restart_failed:'+String(r.stderr||r.stdout||'').slice(0,300));}};}
function main(argv=process.argv.slice(2)){if(!Array.isArray(argv)||argv.length!==0)fail('unexpected_cli_argument');return apply(defaultAdapter());}
module.exports={manifest,preflight,apply,main,__test:{runtimePolicyHash,verifyPolicy}};
if(require.main===module)main().then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{process.stderr.write(String(e&&e.message||e)+'\n');process.exitCode=1;});
