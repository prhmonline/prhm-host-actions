#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='titan_staged_production_finalize_v1';
const HOSTS=Object.freeze(['titanfitness-club.com','www.titanfitness-club.com','admin.titanfitness-club.com']);
const EDGE_SERVICE='prhm-edge-nginx.service';
const NGINX_CONFIG='/etc/nginx/nginx.phase7b.conf';
const ACME_WEBROOT='/var/www/prhm-acme';
const BACKEND='10.71.0.118:80';
const LINEAGE='titanfitness-club.com-edge';
const LE_LIVE='/etc/letsencrypt/live/titanfitness-club.com-edge';
const LE_CERT='/etc/letsencrypt/live/titanfitness-club.com-edge/fullchain.pem';
const LE_KEY='/etc/letsencrypt/live/titanfitness-club.com-edge/privkey.pem';
const EDGE_CERT='/etc/nginx/certs/titan/titanfitness-club.com.cert.combined';
const EDGE_KEY='/etc/nginx/certs/titan/titanfitness-club.com.key';
const RENEW_CONF='/etc/letsencrypt/renewal/'+LINEAGE+'.conf';
const DEPLOY_SCRIPT='/usr/local/sbin/prhm-edge-cert-deploy';
const RESULT_DIR='/var/lib/prhm-agent-selfmaint-exec/titan-staged-production-finalize-v1';
const SNAP_ROOT='/var/lib/prhm-agent-selfmaint-exec/titan-staged-production-finalize-v1/snapshots';
const REPRESENTATIVE_HOST='prhm.ir';
const DEFAULT_BODY='webserver is functioning normally';

function fail(code,extra={}){const e=new Error(code);e.code=code;e.extra=extra;throw e}
function exists(p){try{fs.accessSync(p);return true}catch{return false}}
function shaFile(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}
function mkdir(p,mode=0o700){fs.mkdirSync(p,{recursive:true,mode});}
function run(bin,args,opt={}){
  const r=cp.spawnSync(bin,args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:opt.timeout||30000,env:opt.env||process.env,input:opt.input});
  if(r.error) fail('exec_error',{bin,error:r.error.message});
  if(r.status!==0) fail('exec_failed',{bin,status:r.status,stderr:String(r.stderr||'').slice(-1200)});
  return String(r.stdout||'');
}
function runLoose(bin,args,opt={}){
  const r=cp.spawnSync(bin,args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:opt.timeout||30000,env:opt.env||process.env,input:opt.input});
  return {status:r.status,stdout:String(r.stdout||''),stderr:String(r.stderr||''),error:r.error?String(r.error.message):null};
}
function atomicWrite(p,data,mode){mkdir(path.dirname(p));const tmp=p+'.tmp-'+process.pid;fs.writeFileSync(tmp,data,{mode});fs.chmodSync(tmp,mode);fs.renameSync(tmp,p)}
function bounded(s,n=240){return String(s||'').replace(/[\r\n\t]+/g,' ').slice(0,n)}
function countOf(s,needle){let n=0,i=0;while((i=s.indexOf(needle,i))>=0){n++;i+=needle.length}return n}

function findServerBlock(config,hostNeedle){
  const marker='server_name '+hostNeedle+';';
  const idx=config.indexOf(marker);
  if(idx<0||config.indexOf(marker,idx+1)>=0) fail('anchor_not_unique',{marker});
  let start=config.lastIndexOf('server {',idx);
  if(start<0) fail('server_block_start_missing');
  let depth=0,end=-1;
  for(let i=start;i<config.length;i++){
    if(config[i]==='{') depth++;
    else if(config[i]==='}') {depth--;if(depth===0){end=i+1;break}}
  }
  if(end<0) fail('server_block_end_missing');
  return {start,end,text:config.slice(start,end)};
}

function preflight(){
  const evidence={action:ACTION,production_mutation:false,database_mutation:false};
  if(run('/usr/bin/hostname',[]).trim()!=='node1.prhm.ir') fail('unexpected_edge_identity');
  const active=run('/usr/bin/systemctl',['is-active',EDGE_SERVICE]).trim();
  if(active!=='active') fail('edge_service_not_active',{active});
  if(!exists(NGINX_CONFIG)||!exists(ACME_WEBROOT)) fail('required_path_missing');
  run('/usr/sbin/nginx',['-t','-c',NGINX_CONFIG]);
  const cfg=fs.readFileSync(NGINX_CONFIG,'utf8');
  const http=findServerBlock(cfg,HOSTS.join(' '));
  if(!/listen\s+8080\s*;/.test(http.text)) fail('titan_http_listen_missing');
  if(!http.text.includes('proxy_pass http://'+BACKEND)) fail('titan_backend_unexpected');
  const httpsMarkers=[`ssl_certificate ${EDGE_CERT};`,`ssl_certificate_key ${EDGE_KEY};`];
  const httpsPresent=httpsMarkers.every(x=>cfg.includes(x));
  if(httpsPresent!==exists(EDGE_CERT)||httpsPresent!==exists(EDGE_KEY)) fail('partial_titan_https_state');
  const lineageBits=[exists(LE_CERT),exists(LE_KEY),exists(RENEW_CONF)];
  if(lineageBits.some(Boolean)&&!lineageBits.every(Boolean)) fail('unexpected_titan_lineage');
  if(lineageBits.every(Boolean)) verifySans(LE_CERT);
  const backend=runLoose('/usr/bin/curl',['-fsS','--max-time','8','-H','Host: titanfitness-club.com','http://'+BACKEND+'/']);
  if(backend.status!==0) fail('backend_unreachable',{stderr:bounded(backend.stderr)});
  for(const h of HOSTS){
    const dns=runLoose('/usr/bin/getent',['ahostsv4',h]);
    if(dns.status!==0||!dns.stdout.trim()) fail('dns_unresolved',{host:h});
    const acme=runLoose('/usr/bin/curl',['-fsS','--max-time','8','-H','Host: '+h,'http://127.0.0.1:8080/.well-known/acme-challenge/prhm-preflight-nonexistent']);
    if(acme.status!==0 && !/[34]0[13478]|404/.test(acme.stderr)) {
      const transport=runLoose('/usr/bin/curl',['-sS','-o','/dev/null','-w','%{http_code}','--max-time','8','-H','Host: '+h,'http://127.0.0.1:8080/.well-known/acme-challenge/prhm-preflight-nonexistent']);
      if(transport.status!==0||transport.stdout==='000') fail('acme_path_unreachable',{host:h});
    }
  }
  evidence.nginx_sha256=shaFile(NGINX_CONFIG).slice(0,16);
  evidence.backend_http='PASS';
  evidence.titan_https_present=httpsPresent;
  evidence.titan_lineage_present=lineageBits.every(Boolean);
  evidence.preflight='PASS';
  return evidence;
}

function snapshotState(){
  mkdir(SNAP_ROOT);const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;const dir=path.join(SNAP_ROOT,id);mkdir(dir);
  const targets=[NGINX_CONFIG,EDGE_CERT,EDGE_KEY,RENEW_CONF,DEPLOY_SCRIPT];
  const meta={id,created_at:new Date().toISOString(),files:{},lineage_present:exists(LE_CERT)&&exists(LE_KEY)&&exists(RENEW_CONF)};
  for(const p of targets){
    const present=exists(p);const rec={present};
    if(present){const st=fs.statSync(p);rec.mode=st.mode&0o7777;rec.sha256=shaFile(p);const dest=path.join(dir,'files',p.replace(/^\//,''));mkdir(path.dirname(dest));fs.copyFileSync(p,dest);fs.chmodSync(dest,0o600)}
    meta.files[p]=rec;
  }
  atomicWrite(path.join(dir,'meta.json'),JSON.stringify(meta,null,2)+'\n',0o600);
  return {dir,meta};
}

function restoreFile(snap,p){
  const rec=snap.meta.files[p];if(!rec) fail('snapshot_record_missing',{path:p});
  if(rec.present){const src=path.join(snap.dir,'files',p.replace(/^\//,''));mkdir(path.dirname(p));fs.copyFileSync(src,p);fs.chmodSync(p,rec.mode)}
  else if(exists(p)) fs.rmSync(p,{force:true});
}

function rollback(snap){
  const rb={attempted:true,ok:false};
  try{
    restoreFile(snap,NGINX_CONFIG);restoreFile(snap,DEPLOY_SCRIPT);restoreFile(snap,EDGE_CERT);restoreFile(snap,EDGE_KEY);
    if(!snap.meta.lineage_present && (exists(LE_CERT)||exists(RENEW_CONF))){
      runLoose('/usr/bin/certbot',['delete','--cert-name',LINEAGE,'--non-interactive'],{timeout:120000});
      if(exists(RENEW_CONF)) fs.rmSync(RENEW_CONF,{force:true});
    } else if(snap.meta.files[RENEW_CONF]) restoreFile(snap,RENEW_CONF);
    run('/usr/sbin/nginx',['-t','-c',NGINX_CONFIG]);
    run('/usr/bin/systemctl',['kill','-s','HUP','--kill-who=main',EDGE_SERVICE]);
    rb.ok=true;rb.marker='ROLLBACK=PASS';
  }catch(e){rb.error=e.code||e.message;rb.marker='ROLLBACK=FAIL'}
  return rb;
}

function verifySans(cert){
  const out=run('/usr/bin/openssl',['x509','-in',cert,'-noout','-ext','subjectAltName']);
  for(const h of HOSTS) if(!out.includes('DNS:'+h)) fail('san_missing',{host:h});
  const dns=(out.match(/DNS:[^,\s]+/g)||[]).map(x=>x.slice(4)).sort();
  const expected=[...HOSTS].sort();
  if(JSON.stringify(dns)!==JSON.stringify(expected)) fail('san_set_unexpected',{sans:dns});
  return 'SAN_COVERAGE=PASS';
}

function provisionTls(){
  if(exists(LE_CERT)&&exists(LE_KEY)&&exists(RENEW_CONF)){verifySans(LE_CERT);return 'reused'}
  if(exists(LE_CERT)||exists(LE_KEY)||exists(RENEW_CONF)) fail('unexpected_titan_lineage');
  run('/usr/local/sbin/prhm-certbot-ipv4',['certonly','--webroot','-w',ACME_WEBROOT,'--config-dir','/etc/letsencrypt','--work-dir','/opt/imotion-stack/letsencrypt-work','--logs-dir','/opt/imotion-stack/letsencrypt-logs','--non-interactive','--cert-name',LINEAGE,'-d',HOSTS[0],'-d',HOSTS[1],'-d',HOSTS[2]],{timeout:300000});
  if(!exists(LE_CERT)||!exists(LE_KEY)||!exists(RENEW_CONF)) fail('certificate_issue_incomplete');
  verifySans(LE_CERT);return 'issued';
}

function installCerts(){
  mkdir(path.dirname(EDGE_CERT),0o700);
  fs.copyFileSync(LE_CERT,EDGE_CERT);fs.chmodSync(EDGE_CERT,0o600);
  fs.copyFileSync(LE_KEY,EDGE_KEY);fs.chmodSync(EDGE_KEY,0o600);
}

function ensureRenewDeployMapping(){
  const s=fs.readFileSync(DEPLOY_SCRIPT,'utf8');
  const line=`copy_pair ${LINEAGE} titan/titanfitness-club.com.cert.combined titan/titanfitness-club.com.key`;
  if(s.includes(line)) return false;
  const anchor='copy_pair gisheh360-edge gisheh360/gisheh360.ir.cert.combined gisheh360/gisheh360.ir.key';
  if(countOf(s,anchor)!==1) fail('anchor_not_unique',{anchor:'deploy_script'});
  atomicWrite(DEPLOY_SCRIPT,s.replace(anchor,anchor+'\n'+line),0o700);return true;
}

function configureHttps(){
  const cfg=fs.readFileSync(NGINX_CONFIG,'utf8');
  if(cfg.includes(`ssl_certificate ${EDGE_CERT};`)||cfg.includes(`ssl_certificate_key ${EDGE_KEY};`)){
    if(cfg.includes(`ssl_certificate ${EDGE_CERT};`)&&cfg.includes(`ssl_certificate_key ${EDGE_KEY};`)) return false;
    fail('partial_titan_https_state');
  }
  const http=findServerBlock(cfg,HOSTS.join(' '));
  const listens=http.text.match(/listen\s+8080\s*;/g)||[];
  if(listens.length!==1) fail('anchor_not_unique',{anchor:'titan_listen_8080'});
  const tls=`listen 8443 ssl http2;\n        ssl_certificate ${EDGE_CERT};\n        ssl_certificate_key ${EDGE_KEY};`;
  const https=http.text.replace(/listen\s+8080\s*;/,tls);
  const next=cfg.slice(0,http.end)+'\n\n    '+https+cfg.slice(http.end);
  atomicWrite(NGINX_CONFIG,next,0o600);return true;
}

function verifyLocalSni(host){
  const r=runLoose('/usr/bin/openssl',['s_client','-connect','127.0.0.1:8443','-servername',host,'-verify_hostname',host,'-brief'],{timeout:15000,input:''});
  if(r.status!==0||!/Verification:\s*OK|Verification error:\s*OK/i.test(r.stderr+'\n'+r.stdout)) fail('local_sni_failed',{host,evidence:bounded(r.stderr+' '+r.stdout)});
  return true;
}
function fetchPublic(host,urlPath){
  const r=runLoose('/usr/bin/curl',['-fsS','--max-time','15','--connect-timeout','8','https://'+host+urlPath]);
  if(r.status!==0) fail('public_https_failed',{host,path:urlPath,stderr:bounded(r.stderr)});
  if(r.stdout.includes(DEFAULT_BODY)) fail('public_default_server_body',{host,path:urlPath});
  return r.stdout;
}
function verifyPublic(){fetchPublic(HOSTS[0],'/');fetchPublic(HOSTS[2],'/login');return true}
function verifyRepresentativeHost(){
  const r=runLoose('/usr/bin/curl',['-fsS','--max-time','10','https://'+REPRESENTATIVE_HOST+'/']);
  if(r.status!==0) fail('representative_host_failed',{host:REPRESENTATIVE_HOST,stderr:bounded(r.stderr)});return true;
}
function verifyAll(){
  const sans=verifySans(EDGE_CERT);
  for(const h of HOSTS) verifyLocalSni(h);
  verifyPublic();verifyRepresentativeHost();
  return {sans,local_sni:'PASS',public_https:'PASS',representative_host:'PASS'};
}

function main(){
  const preflightOnly=process.argv.includes('--preflight-only');
  const illegal=process.argv.slice(2).filter(x=>x!=='--preflight-only');
  if(illegal.length) fail('unexpected_argument');
  const pre=preflight();
  if(preflightOnly){console.log(JSON.stringify(pre));return}
  let snap=null;let mutationStarted=false;
  try{
    snap=snapshotState();
    mutationStarted=true;
    const cert=provisionTls();
    installCerts();
    const renewal_mapping_changed=ensureRenewDeployMapping();
    const https_config_changed=configureHttps();
    run('/usr/sbin/nginx',['-t','-c',NGINX_CONFIG]);
    run('/usr/bin/systemctl',['kill','-s','HUP','--kill-who=main',EDGE_SERVICE]);
    const verification=verifyAll();
    mkdir(RESULT_DIR);
    const result={ok:true,action:ACTION,preflight:pre,certificate:cert,renewal_mapping_changed,https_config_changed,verification,rollback:{attempted:false},production_mutation:true,database_mutation:false};
    atomicWrite(path.join(RESULT_DIR,'latest.json'),JSON.stringify(result,null,2)+'\n',0o600);
    console.log(JSON.stringify(result));
  }catch(err){
    const rb=mutationStarted&&snap?rollback(snap):{attempted:false,ok:true,marker:'ROLLBACK=PASS'};
    const result={ok:false,action:ACTION,error:err.code||err.message,error_context:err.extra||{},rollback:rb,production_mutation:mutationStarted,database_mutation:false};
    try{mkdir(RESULT_DIR);atomicWrite(path.join(RESULT_DIR,'latest.json'),JSON.stringify(result,null,2)+'\n',0o600)}catch{}
    console.log(JSON.stringify(result));
    process.exitCode=1;
  }
}

if(require.main===module) main();
module.exports={findServerBlock,verifySans};
