'use strict';
/**
 * ZERO-WRITE, SOURCE-ONLY LIVE PREIMAGE INSPECTOR.
 * Fixed service and project, no dynamic paths, no signing or installer action.
 * May be run only from an independently verified immutable source checkout.
 * Reading current state is not authorization for a privileged release.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const http=require('node:http');
const crypto=require('node:crypto');
const {PINS}=require('./solo-universal-v2-signed-release-contract-v1.cjs');
const fail=x=>{throw Error('solo_universal_v2_preflight_'+x)};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function safeRegular(file,mode=null){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||
     (st.mode&0o022)!==0||(mode!==null&&(st.mode&0o777)!==mode))
    fail('unsafe_root_file');
  return fs.readFileSync(file);
}
function safeDir(dir){
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||
     (st.mode&0o022)!==0)fail('unsafe_root_directory');
  return true;
}
function installedBundle(){
  const prefix=PINS.installer_prefix;
  safeDir(prefix);
  const p=path.join(prefix,'current');
  const st=fs.lstatSync(p);
  if(!st.isSymbolicLink()||st.uid!==0)fail('pointer_not_installer_symlink');
  const real=fs.realpathSync(p);
  if(real!==path.join(prefix,'versions',PINS.installed_digest))
    fail('unexpected_installed_version');
  safeDir(real);
  const scan=[];
  function walk(dir){
    for(const name of fs.readdirSync(dir).sort()){
      if(name==='__pycache__')continue;
      const item=path.join(dir,name),stat=fs.lstatSync(item);
      if(stat.isSymbolicLink())fail('bundle_symlink');
      if(stat.isDirectory())walk(item);
      else if(stat.isFile()&&name.endsWith('.py'))scan.push(item);
      else if(stat.isFile())fail('unexpected_bundle_content');
    }
  }
  walk(path.join(real,'universal'));
  const h=crypto.createHash('sha256');
  for(const item of scan.sort()){
    const rel=path.relative(real,item).split(path.sep).join('/');
    h.update(rel);h.update(Buffer.from([0]));
    h.update(safeRegular(item));h.update(Buffer.from([0]));
  }
  if(scan.length<10||h.digest('hex')!==PINS.installed_digest)
    fail('bundle_digest_mismatch');
  const raw=safeRegular(path.join(prefix,'installation.json'));
  if(sha(raw)!==PINS.manifest_preimage_sha256)
    fail('installation_manifest_drift');
  const m=JSON.parse(raw.toString('utf8'));
  if(m.digest!==PINS.installed_digest||m.entrypoint!==prefix+'/deploy-project')
    fail('manifest_fields_mismatch');
  safeRegular(path.join(prefix,'deploy-project'));
  return {digest:PINS.installed_digest,manifest_sha256:sha(raw)};
}
function serviceState(){
  const unit='prhm-solo-company-runtime.service';
  const args=['show',unit,'--no-pager','-p','ActiveState','-p','SubState',
              '-p','UnitFileState','-p','DynamicUser','-p','ProtectSystem',
              '-p','StateDirectory'];
  const r=cp.spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:5000,
    env:{PATH:'/usr/bin:/bin',LANG:'C'},maxBuffer:4096});
  if(r.error||r.status!==0)fail('systemctl_read_failure');
  const d=Object.create(null);
  for(const line of r.stdout.trim().split('\n')){
    const index=line.indexOf('=');
    if(index<1||Object.hasOwn(d,line.slice(0,index)))fail('systemctl_malformed');
    d[line.slice(0,index)]=line.slice(index+1);
  }
  for(const [k,v] of Object.entries({
    ActiveState:'active',SubState:'running',UnitFileState:'enabled',
    DynamicUser:'yes',ProtectSystem:'strict',
    StateDirectory:'prhm-solo-company',
  }))if(d[k]!==v)fail('solo_unit_not_pinned_'+k);
  const state=fs.lstatSync('/var/lib/private/prhm-solo-company');
  if(!state.isDirectory()||state.isSymbolicLink()||
     (state.mode&0o022)!==0)fail('state_directory_not_private');
  return true;
}
function listeners(){
  let entries=[];
  for(const p of ['/proc/net/tcp','/proc/net/tcp6']){
    for(const line of fs.readFileSync(p,'utf8').trim().split('\n').slice(1)){
      const parts=line.trim().split(/\s+/);
      if(parts.length>=4&&parts[3]==='0A'&&
         parts[1].split(':').pop().toUpperCase()==='224E')
        entries.push([path.basename(p),parts[1].split(':')[0].toUpperCase()]);
    }
  }
  if(JSON.stringify(entries)!==JSON.stringify([['tcp','0100007F']]))
    fail('runtime_port_public_or_unexpected');
}
function loopback(pathname){
  if(!['/health','/status'].includes(pathname))fail('endpoint_unapproved');
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port:8782,path:pathname,
      timeout:4000,agent:false},res=>{
      let chunks=[],bytes=0;
      res.on('data',b=>{
        bytes+=b.length;
        if(bytes>16384){req.destroy(Error('response_large'));return;}
        chunks.push(b);
      });
      res.on('end',()=>{
        if(res.statusCode!==200){reject(Error('http_not_200'));return;}
        try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}
        catch(e){reject(e)}
      });
    });
    req.once('timeout',()=>req.destroy(Error('timeout')));
    req.once('error',reject);
  });
}
function checkRegistry(){
  const root='/etc/deploy-control/projects',files=fs.readdirSync(root).filter(n=>n.endsWith('.json'));
  if(files.length!==6||files.some(f=>f==='solo_company.production.json'))
    fail('registry_scope_not_preimage');
  const py=["-c",
    "import sys;from pathlib import Path;"+
    "sys.path.insert(0,'"+PINS.installer_prefix+"/current');"+
    "from universal.config import validate_registry;"+
    "v=validate_registry(Path('/etc/deploy-control/projects'));"+
    "assert len(v)==6;print('VALIDATED_V1='+str(len(v)))"];
  const r=cp.spawnSync('/opt/prhm/universal-python/bin/python3',py,{
    encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin',LANG:'C'},
    maxBuffer:1024});
  if(r.error||r.status!==0||r.stdout.trim()!=='VALIDATED_V1=6')
    fail('legacy_registry_invalid');
  return files.length;
}
function checkOwnerKey(){
  const raw=safeRegular(PINS.public_key_path,0o600);
  const key=crypto.createPublicKey(raw);
  if(key.asymmetricKeyType!=='ed25519'||
     sha(key.export({type:'spki',format:'der'}))!==PINS.owner_spki_sha256)
    fail('owner_root_key_pin_mismatch');
  return true;
}
async function inspect(){
  if(typeof process.geteuid!=='function'||process.geteuid()!==0)
    fail('root_read_only_probe_required');
  const bundle=installedBundle();
  serviceState();listeners();
  if(fs.existsSync(PINS.profile_path))fail('existing_solo_profile_unexpected');
  const registry=checkRegistry();
  checkOwnerKey();
  const health=await loopback('/health'),status=await loopback('/status');
  if(health.ok!==true||health.state!=='running'||
     health.heartbeat_fresh!==true||status.state!=='running'||
     status.worker_busy!==false||
     ['queue_depth','retrying','blocked','awaiting_approval',
      'failed_total'].some(x=>status[x]!==0))
    fail('runtime_health_darkness_invalid');
  return Object.freeze({
    result:'LIVE_V2_RELEASE_PREIMAGE_PASS_NO_PERMIT',
    installed_digest:bundle.digest,
    manifest_sha256:bundle.manifest_sha256,
    existing_registry_profiles:registry,
    runtime_release:PINS.runtime_release,
    private_loopback_only:true,
    owner_public_key_pin_verified:true,
    l4_release_receipt_present:fs.existsSync(PINS.owner_receipt_path),
    signed_release_permit_validated:false,
    source_bundle_installed:false,
    production_modified:false,
  });
}
module.exports=Object.freeze({inspect,installedBundle,serviceState,listeners,
  checkRegistry,checkOwnerKey});
if(require.main===module){
  if(process.argv.length!==3||process.argv[2]!=='--read-only'){
    process.stderr.write('NO_APPLY: only --read-only is available\n');
    process.exitCode=64;
  } else inspect().then(x=>process.stdout.write(JSON.stringify(x)+'\n'))
    .catch(e=>{
      process.stderr.write('PREFLIGHT_STOP='+String(e.message).slice(0,170)+'\n');
      process.exitCode=2;
    });
}