import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const BASE_SHA='6a4a5df37d6172b4f045f4be7e61bea7ca495da6a1636b3663c9a92485cc94ed';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE=path.join(HERE,'.project-aranob-pubkey-inventory-base-'+BASE_SHA+'.mjs');
const BACK='/var/backups/prhm-agent-selfmaint';
const PREFIX='agent_mcp-src_plugins_project.js-';
const DIR='/home/prhm/.ssh';
const TOKEN='ARANOB_GIT_KEY_INVENTORY_V1';
const DA_TARGET='10.71.0.10';
const FIXED_DOMAINS=Object.freeze(['imotion.ir','admin.imotion.ir','gym.imotion.ir','sale.imotion.ir','i-motion.ir','admin.i-motion.ir','test.i-motion.ir','imotion-iran.ir']);
const MAX=600000;
const ENV={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/home/agent',LC_ALL:'C.UTF-8'};
const H=b=>createHash('sha256').update(b).digest('hex');
function fail(x){throw new Error(x)}
function ensureBase(){try{if(H(fs.readFileSync(BASE))===BASE_SHA)return}catch{}const suffix='-'+BASE_SHA+'.bak';const name=fs.readdirSync(BACK).filter(n=>n.startsWith(PREFIX)&&n.endsWith(suffix)).sort().reverse()[0];if(!name)fail('aranob_pubkey_base_missing');const b=fs.readFileSync(path.join(BACK,name));if(H(b)!==BASE_SHA)fail('aranob_pubkey_base_sha_mismatch');const t=BASE+'.'+process.pid+'.tmp';fs.writeFileSync(t,b,{mode:0o600,flag:'wx'});fs.renameSync(t,BASE);fs.chmodSync(BASE,0o600)}
ensureBase();
const base=await import(pathToFileURL(BASE).href+'?sha='+BASE_SHA);
if(typeof base.registerProjectPlugin!=='function')fail('aranob_pubkey_base_export_missing');
function match(a){return a&&a.project==='control_plane'&&a.command===TOKEN&&(!a.access||a.access==='read')}
function inventory(){const items=[];if(fs.existsSync(DIR)){for(const n of fs.readdirSync(DIR).sort()){if(!n.endsWith('.pub')||!/^[A-Za-z0-9._-]+$/.test(n))continue;const p=path.join(DIR,n);const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())continue;const v=fs.readFileSync(p,'utf8').trim();if(/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+( .*)?$/.test(v))items.push({name:n,public_key:v})}}return {ok:true,action:'aranob_git_public_key_inventory_v1',read_only:true,items,private_key_exposed:false,production_mutation:false,database_mutation:false}}
function run(bin,args,{input=null,timeout=30000,maxBuffer=MAX,allowFailure=false}={}){const r=spawnSync(bin,args,{input,encoding:'utf8',timeout,maxBuffer,shell:false,env:ENV});if(r.error)fail('imotion_da_probe_exec_error:'+path.basename(bin)+':'+r.error.message);if(r.status!==0&&!allowFailure)fail('imotion_da_probe_exec_failed:'+path.basename(bin)+':'+String(r.stderr||r.stdout||r.status).slice(0,1400));return {status:Number.isInteger(r.status)?r.status:null,stdout:String(r.stdout||'').trim(),stderr:String(r.stderr||'').trim()}}
function keyscanBoundMaterial(){
  const scan=run('/usr/bin/ssh-keyscan',['-T','5','-t','ed25519',DA_TARGET],{timeout:8000,allowFailure:true});
  if(scan.status!==0||!scan.stdout)fail('imotion_da_hostkey_scan_failed');
  const lines=scan.stdout.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
  if(lines.length!==1)fail('imotion_da_hostkey_scan_cardinality');
  const parts=lines[0].split(/\s+/);
  if(parts.length<3||parts[0]!==DA_TARGET||parts[1]!=='ssh-ed25519')fail('imotion_da_hostkey_scan_unexpected');
  const raw=Buffer.from(parts[2],'base64');if(!raw.length)fail('imotion_da_hostkey_blob_invalid');
  const fingerprint='SHA256:'+createHash('sha256').update(raw).digest('base64').replace(/=+$/,'');
  return {known_hosts:lines[0]+'\n',fingerprint};
}
function remoteBound(script,knownHosts){
  const kh='/tmp/prhm-imotion-da-kh-'+process.pid+'-'+Date.now();
  fs.writeFileSync(kh,knownHosts,{mode:0o600,flag:'wx'});
  try{
    const args=['-o','BatchMode=yes','-o','ConnectTimeout=8','-o','ConnectionAttempts=1','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+kh,'-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','VerifyHostKeyDNS=no','root@'+DA_TARGET,'/bin/bash','-s'];
    return run('/usr/bin/ssh',args,{input:script,timeout:45000,maxBuffer:MAX,allowFailure:true});
  } finally {try{fs.unlinkSync(kh)}catch{}}
}
function script(){
  const domains=FIXED_DOMAINS.map(x=>`'${x}'`).join(' ');
  return `set -euo pipefail
export LC_ALL=C.UTF-8
DA=/usr/local/directadmin/directadmin
echo IMOTION_DA_PREFLIGHT_V2=1
printf 'HOSTNAME='; hostname
if [ -x "$DA" ]; then echo DIRECTADMIN_BINARY=yes; else echo DIRECTADMIN_BINARY=no; exit 31; fi
printf 'DIRECTADMIN_VERSION='; "$DA" version | tr '\n' ' ' | sed 's/[[:space:]]\\+/ /g'; echo
printf 'DIRECTADMIN_ADMIN='; "$DA" admin
printf 'DIRECTADMIN_SERVICE='; systemctl is-active directadmin || true
if ss -ltn 2>/dev/null | grep -Eq '[:.]2222[[:space:]]'; then echo PORT_2222_LISTENING=yes; else echo PORT_2222_LISTENING=no; fi
if [ -d /usr/local/directadmin/data/users/imotion ]; then echo IMOTION_USER_EXISTS=yes; else echo IMOTION_USER_EXISTS=no; fi
printf 'DIRECTADMIN_USER_COUNT='
find /usr/local/directadmin/data/users -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '
echo
SERVER_IP="$("$DA" config-get server_ip 2>/dev/null || true)"
printf 'SERVER_IP=%s\n' "$SERVER_IP"
if "$DA" api-url --help >/dev/null 2>&1; then echo ROOT_API_URL_CAPABLE=yes; else echo ROOT_API_URL_CAPABLE=no; fi
if "$DA" login-url --help >/dev/null 2>&1; then echo LOGIN_URL_CAPABLE=yes; else echo LOGIN_URL_CAPABLE=no; fi
if "$DA" taskq --help >/dev/null 2>&1; then echo TASKQ_CAPABLE=yes; else echo TASKQ_CAPABLE=no; fi
for d in ${domains}; do
  owner=''
  if [ -r /etc/virtual/domainowners ]; then owner="$(awk -F: -v x="$d" '$1==x{gsub(/[[:space:]]/,"",$2);print $2;exit}' /etc/virtual/domainowners || true)"; fi
  if [ -n "$owner" ]; then printf 'DOMAIN_OWNER %s=%s\n' "$d" "$owner"; else printf 'DOMAIN_OWNER %s=NONE\n' "$d"; fi
done
if [ -r /usr/local/directadmin/data/admin/ip.list ]; then
  printf 'ADMIN_IP_COUNT='; grep -Ec '^[0-9]+(\\.[0-9]+){3}$' /usr/local/directadmin/data/admin/ip.list || true
else
  echo ADMIN_IP_COUNT=0
fi
if command -v mariadb >/dev/null 2>&1; then echo DB_CLIENT=mariadb; elif command -v mysql >/dev/null 2>&1; then echo DB_CLIENT=mysql; else echo DB_CLIENT=NONE; fi
echo PRODUCTION_MUTATION=no
echo IMOTION_DA_PREFLIGHT_V2_COMPLETE=YES
`;
}
function parseLines(s){const out={},owners={};for(const line of String(s).split(/\r?\n/)){if(line.startsWith('DOMAIN_OWNER ')){const x=line.slice(13),i=x.indexOf('=');if(i>0)owners[x.slice(0,i)]=x.slice(i+1);continue}const i=line.indexOf('=');if(i>0)out[line.slice(0,i)]=line.slice(i+1)}out.DOMAIN_OWNERS=owners;return out}
function directAdminPreflight(){
  const key=keyscanBoundMaterial();
  const r=remoteBound(script(),key.known_hosts);
  const p=parseLines(r.stdout);
  const domainOwners=Object.fromEntries(FIXED_DOMAINS.map(d=>[d,(p.DOMAIN_OWNERS?.[d]||'NONE')==='NONE'?null:p.DOMAIN_OWNERS[d]]));
  const cleanOwners=FIXED_DOMAINS.every(d=>domainOwners[d]===null);
  const serviceActive=p.DIRECTADMIN_SERVICE==='active',port=p.PORT_2222_LISTENING==='yes',userAbsent=p.IMOTION_USER_EXISTS==='no',api=p.ROOT_API_URL_CAPABLE==='yes',login=p.LOGIN_URL_CAPABLE==='yes',taskq=p.TASKQ_CAPABLE==='yes',db=p.DB_CLIENT&&p.DB_CLIENT!=='NONE'?p.DB_CLIENT:null;
  const ok=r.status===0&&p.DIRECTADMIN_BINARY==='yes'&&serviceActive&&port&&userAbsent&&api&&login&&taskq&&Boolean(db)&&Boolean(p.DIRECTADMIN_VERSION)&&Boolean(p.DIRECTADMIN_ADMIN)&&cleanOwners;
  return {ok,action:'imotion_directadmin_preflight_v2',read_only:true,target:DA_TARGET,host_key_bound:true,trust_model:'tofu-keyscan-session-bound',host_key_fingerprint:key.fingerprint,host_key_fingerprint_sha256:key.fingerprint,ssh_exit_code:r.status,hostname:p.HOSTNAME||null,directadmin_version:p.DIRECTADMIN_VERSION||null,admin_user:p.DIRECTADMIN_ADMIN||null,directadmin_admin:p.DIRECTADMIN_ADMIN||null,service_active:serviceActive,directadmin_service:p.DIRECTADMIN_SERVICE||null,port_2222_listening:port,user_imotion_absent:userAbsent,imotion_user_exists:!userAbsent,directadmin_user_count:Number(p.DIRECTADMIN_USER_COUNT||0),server_ip:p.SERVER_IP||null,api_url_capable:api,root_api_url_capable:api,login_url_capable:login,taskq_capable:taskq,admin_ip_count:Number(p.ADMIN_IP_COUNT||0),db_client:db,db_client_present:Boolean(db),domain_owners:domainOwners,domains:FIXED_DOMAINS.map(d=>({domain:d,owner:domainOwners[d]||'NONE'})),all_imotion_domains_unowned:cleanOwners,production_mutation:false,database_mutation:false,service_control:false,stderr:r.status===0?'':r.stderr.slice(0,1200)};
}
export function registerProjectPlugin(mcp,context){
  const wrap=(name,h)=>name==='ops_execute'?async a=>match(a)?{content:[{type:'text',text:JSON.stringify(inventory())}]}:h(a):h;
  const proxy=new Proxy(mcp,{get(t,p){if(p==='tool')return(n,d,s,h)=>t.tool(n,d,s,wrap(n,h));if(p==='registerTool')return(n,c,h)=>t.registerTool(n,c,wrap(n,h));const v=t[p];return typeof v==='function'?v.bind(t):v}});
  const out=base.registerProjectPlugin(proxy,context);
  mcp.registerTool('imotion_directadmin_preflight_v2',{title:'iMotion DirectAdmin Preflight v2',description:'Fixed zero-input read-only preflight for DirectAdmin at the only allowed target. The SSH session is bound to the same scanned ed25519 host key through a transient known_hosts file with StrictHostKeyChecking=yes. Returns action-ready identity/capability/user/domain evidence and performs no mutation.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async()=>({content:[{type:'text',text:JSON.stringify(directAdminPreflight())}]}));
  return out;
}
// IMOTION_DIRECTADMIN_SCHEMA_REPUBLISH_V2
