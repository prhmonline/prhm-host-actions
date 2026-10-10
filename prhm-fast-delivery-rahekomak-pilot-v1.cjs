#!/usr/bin/env node
'use strict';
/*
 * Live-source, isolated-build pilot for RahKomak.
 * No production apply, native Host Action registration, or approval consumption.
 * The ONLY CLI mode is --verify <exact-current-commit>.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const gate=require('./prhm-fast-delivery-gate-v1.cjs');

const PROFILE='rahekomak';
const ROOT=gate.PROFILES[PROFILE].root;
const WEB=path.join(ROOT,'apps/web');
const HELPER=path.join(ROOT,'infra/docker/web-only-release-v1.cjs');
const HELPER_SHA='bf901961635986ff917bade164610ecc80cd3e9ebb549ef79ecc9efecce41320';
const RUNTIME=path.join(ROOT,'infra/docker/runtime/web-only');
const LIVE=path.join(WEB,'out');
const ACTION='rahekomak_web_only_release_v1';
const NUMBERS=Object.freeze(['121','122','194','124','195']);
const SHA256=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=s=>{throw new Error(s)};
function fixedEnv(extra={}){
  // Whitelist only the pinned SHA. Approval values must never be passed
  // to test/build child processes or accepted as caller overrides.
  if(Object.keys(extra).some(k=>k!=='RAHEKOMAK_RELEASE_SHA'))
   fail('unsafe_environment_override');
  if(extra.RAHEKOMAK_RELEASE_SHA!==undefined &&
     !gate.SHA.test(extra.RAHEKOMAK_RELEASE_SHA))fail('invalid_child_sha');
  return {PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/root',
    LANG:'C.UTF-8',NEXT_TELEMETRY_DISABLED:'1',...extra};
}
function fixed(bin,args,opts={}){
 const r=cp.spawnSync(bin,args,{cwd:opts.cwd||ROOT,env:fixedEnv(opts.env),
  encoding:'utf8',timeout:opts.timeout||120000,maxBuffer:8*1024*1024,
  stdio:['ignore','pipe','pipe']});
 if(r.error||r.status!==0)fail('fixed_command_failed:'+path.basename(bin)+':'+
  String(r.error?.message||r.stderr||r.stdout||'').slice(-650));
 return String(r.stdout||'').trim();
}
const git=(args,opts={})=>fixed('/usr/bin/git',['-C',ROOT,...args],opts);
function checkRequest(sha){
 if(!gate.SHA.test(sha||''))fail('sha_must_be_40_hex');
 const p=gate.inspect(PROFILE,{sha});
 if(!p.ready||p.blockers.length!==0)fail('git_preflight_failed:'+p.blockers.join(','));
 if(p.root!==ROOT||p.adapter!=='web-only-manual-level4')fail('profile_identity_mismatch');
 if(!fs.statSync(HELPER).isFile()||SHA256(fs.readFileSync(HELPER))!==HELPER_SHA)
  fail('pinned_release_helper_mismatch');
 const live=fs.lstatSync(LIVE);
 if(!live.isDirectory()||live.isSymbolicLink())fail('live_out_invalid');
 const baseline=SHA256(fs.readFileSync(path.join(LIVE,'index.html')));
 // Never use --apply, even if caller environment includes old approvals.
 const raw=fixed('/usr/local/bin/prhm-node',[HELPER,'--preflight'],
   {env:{RAHEKOMAK_RELEASE_SHA:sha}});
 let evidence;
 try{evidence=JSON.parse(raw)}catch{fail('preflight_response_not_json')}
 if(!evidence||evidence.ok!==true||evidence.sha!==sha||
  evidence.action!==ACTION||evidence.mode!=='preflight'||
  evidence.database_changed!==false||evidence.admin_changed!==false||
  evidence.apache_changed!==false)fail('fixed_preflight_contract_mismatch');
 return {sha,baseline_sha256:baseline,evidence};
}
function assertStaticCandidate(out,sha){
 const helper=require(HELPER);
 const candidate=helper.ensureStaticCandidate(out);
 const bundle=fs.readFileSync(path.join(out,candidate.page_bundle.slice(1)),'utf8');
 if(!NUMBERS.every(n=>bundle.includes(n)))fail('contact_in_candidate_missing');
 return {sha,page_bundle:candidate.page_bundle,bytes:candidate.bytes};
}
function verify(sha){
 const first=checkRequest(sha);
 // This is an ephemeral isolated git worktree, NEVER the Apache DocumentRoot.
 fs.mkdirSync(RUNTIME,{recursive:true,mode:0o700});
 const stage=fs.mkdtempSync(path.join(RUNTIME,'pilot-source-'));
 fs.rmdirSync(stage);
 let created=false,asset=null;
 try{
  git(['worktree','add','--detach',stage,sha],{timeout:180000});
  created=true;
  fs.symlinkSync(path.join(WEB,'node_modules'),path.join(stage,'apps/web/node_modules'),'dir');
  if(fs.existsSync(path.join(ROOT,'node_modules')))
   fs.symlinkSync(path.join(ROOT,'node_modules'),path.join(stage,'node_modules'),'dir');
  const stageWeb=path.join(stage,'apps/web');
  for(const [script,timeout] of [['test',180000],['typecheck',120000],
                                ['lint',120000],['build',600000]]){
   fixed('/usr/bin/npm',['--prefix',stageWeb,'run',script],{cwd:stage,timeout});
  }
  asset=assertStaticCandidate(path.join(stageWeb,'out'),sha);
  if(SHA256(fs.readFileSync(path.join(LIVE,'index.html')))!==first.baseline_sha256)
   fail('live_web_output_changed_during_pilot');
  const checked=gate.inspect(PROFILE,{sha});
  if(!checked.ready)fail('source_changed_during_pilot');
  return {ok:true,project:PROFILE,action:ACTION,sha,mode:'verify',
   tests:'passed',typecheck:'passed',lint:'passed',build:'passed',
   baseline_sha256:first.baseline_sha256,
   page_bundle:asset.page_bundle,contact_numbers:[...NUMBERS],
   production_changed:false,release_executed:false,
   adapter_registered:false,native_approval_consumed:false,
   remaining:'register_sha_bound_native_action_and_approval_center'};
 }finally{
  if(created){
   try{git(['worktree','remove','--force',stage],{timeout:180000});}catch{}
  }
  if(fs.existsSync(stage))try{fs.rmSync(stage,{recursive:true,force:true});}catch{}
 }
}
function main(argv=process.argv.slice(2)){
 if(argv.length!==2||argv[0]!=='--verify')fail('only_verify_mode_supported');
 return verify(argv[1]);
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(main())+'\n');}
 catch(e){process.stderr.write(JSON.stringify({ok:false,code:String(e.message).slice(0,700)})+'\n');process.exitCode=1;}
}
module.exports={ROOT,WEB,HELPER,HELPER_SHA,ACTION,NUMBERS,fixedEnv,checkRequest,assertStaticCandidate,verify,main};
