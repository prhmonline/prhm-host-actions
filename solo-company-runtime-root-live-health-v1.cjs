'use strict';
/**
 * Read-only, fixed-scope production health witness for Solo Root registration.
 * Uses only fixed units and two loopback health endpoints. No restart,
 * deployment, authorization, secret output or shell-evaluated input.
 */
const fs=require('node:fs');
const cp=require('node:child_process');
const http=require('node:http');
const cutover=require('./solo-company-runtime-root-cutover-contract-v1.cjs');
const RELEASE_FILE='/opt/prhm-solo-company/.release-sha';
const SYSTEMCTL='/usr/bin/systemctl';
const fail=c=>{throw Error('solo_live_health_'+c)};
function readUnit(unit){
  if(!cutover.REQUIRED.includes(unit))fail('unit_not_allowlisted');
  const out=cp.spawnSync(SYSTEMCTL,[
    'show',unit,'--no-pager','-p','LoadState','-p','ActiveState','-p','SubState','-p','MainPID'
  ],{encoding:'utf8',timeout:5000,maxBuffer:8192,
     env:{PATH:'/usr/bin:/bin',LANG:'C'}});
  if(out.error||out.status!==0)fail('unit_probe_failed');
  const props=Object.create(null);
  for(const line of out.stdout.trim().split('\n')){
    const n=line.indexOf('=');
    if(n<1)fail('unit_probe_malformed');
    const key=line.slice(0,n);
    if(Object.hasOwn(props,key))fail('unit_probe_duplicate');
    props[key]=line.slice(n+1);
  }
  if(props.LoadState!=='loaded')fail('unit_not_loaded');
  if(!/^[0-9]+$/.test(props.MainPID||''))fail('pid_invalid');
  return {active:props.ActiveState,sub:props.SubState,pid:Number(props.MainPID)};
}
function loopbackHealth(url,{expectJson=false}={}){
  if(![cutover.APPROVAL_HEALTH.url,cutover.SOLO_HEALTH].includes(url))
    fail('url_not_allowlisted');
  return new Promise((resolve,reject)=>{
    const req=http.get(url,{timeout:3000,agent:false},res=>{
      let bytes=0,chunks=[];
      res.on('data',chunk=>{
        bytes+=chunk.length;
        if(bytes>16384){req.destroy(Error('response_too_large'));return}
        chunks.push(chunk);
      });
      res.once('end',()=>{
        if(res.statusCode!==200){reject(Error('http_not_200'));return}
        if(!expectJson){resolve({status:200});return}
        try{resolve({status:200,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))})}
        catch{reject(Error('invalid_health_json'))}
      });
    });
    req.once('timeout',()=>req.destroy(Error('timeout')));
    req.once('error',reject);
  });
}
function releaseMarker(){
  const st=fs.lstatSync(RELEASE_FILE);
  if(!st.isFile()||st.isSymbolicLink()||
    fs.realpathSync(RELEASE_FILE)!==RELEASE_FILE||
    (st.mode&0o022)!==0)fail('release_marker_unsafe');
  return fs.readFileSync(RELEASE_FILE,'utf8').trim();
}
async function attest({unitProbe=readUnit,httpProbe=loopbackHealth,releaseProbe=releaseMarker}={}){
  const states=Object.create(null);
  for(const unit of cutover.REQUIRED)states[unit]=await unitProbe(unit);
  const service=cutover.assess(states);
  const approval=await httpProbe(cutover.APPROVAL_HEALTH.url,{expectJson:true});
  const solo=await httpProbe(cutover.SOLO_HEALTH);
  const probes={
    approval:approval.body,
    solo_http_status:solo.status,
    solo_release:await releaseProbe()
  };
  cutover.assertHealth(probes);
  return Object.freeze({
    result:'PASS',live_service_count:cutover.REQUIRED.length,
    approval_http_status:approval.status,solo_http_status:solo.status,
    solo_release:probes.solo_release,router_healthy:service.router_healthy,
    blue_green_healthy:service.blue_green_healthy,
    no_runtime_restart:true,production_mutation:false
  });
}
module.exports=Object.freeze({RELEASE_FILE,SYSTEMCTL,readUnit,loopbackHealth,
  releaseMarker,attest});
if(require.main===module){
  if(process.argv.length!==3||process.argv[2]!=='--read-only'){
    process.stderr.write('NO_APPLY: this tool only performs read-only health attestation\n');
    process.exitCode=64;
  }else{
    attest().then(x=>process.stdout.write(JSON.stringify(x)+'\n'))
      .catch(e=>{process.stderr.write('HEALTH_ATTESTATION_FAIL='+
        String(e.message).slice(0,150)+'\n');process.exitCode=2});
  }
}
