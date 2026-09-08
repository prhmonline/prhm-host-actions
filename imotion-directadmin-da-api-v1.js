'use strict';

const USERNAME='imotion';
const PRIMARY_DOMAIN='imotion.ir';
const ACCOUNT_EMAIL='admin@imotion.ir';
const CREATE_ENDPOINT='/CMD_API_ACCOUNT_USER';
const DELETE_ENDPOINT='/CMD_API_SELECT_USERS';
const LIST_USERS_ENDPOINT='/CMD_API_SHOW_ALL_USERS';
const SHOW_USER_CONFIG_ENDPOINT='/CMD_API_SHOW_USER_CONFIG';
const DOMAIN_OWNERS_ENDPOINT='/CMD_API_DOMAIN_OWNERS';
const RESELLER_IPS_ENDPOINT='/CMD_API_SHOW_RESELLER_IPS';
const ALLOWED_ENDPOINTS=Object.freeze([
  CREATE_ENDPOINT,DELETE_ENDPOINT,LIST_USERS_ENDPOINT,SHOW_USER_CONFIG_ENDPOINT,
  DOMAIN_OWNERS_ENDPOINT,RESELLER_IPS_ENDPOINT,
]);

function fail(code){throw new Error(code)}
function text(v){return typeof v==='string'?v.trim():''}
function isIp(v){return /^[0-9A-Fa-f:.]+$/.test(text(v)) && text(v).length>=3 && text(v).length<=80}
function normalizeStatus(v){return text(v).toLowerCase()}

function selectCreateIp(records){
  if(!Array.isArray(records)||records.length===0)fail('directadmin_ip_inventory_empty');
  const safe=records.map((r,i)=>{
    if(!r||typeof r!=='object'||Array.isArray(r))fail('directadmin_ip_record_invalid:'+i);
    const ip=text(r.ip); const status=normalizeStatus(r.status); const value=r.value;
    if(!isIp(ip))fail('directadmin_ip_invalid:'+i);
    if(!['server','shared','free','owned'].includes(status))fail('directadmin_ip_status_invalid:'+status);
    return {ip,status,value};
  });
  const shared=safe.filter(r=>r.status==='server'||r.status==='shared').sort((a,b)=>a.ip.localeCompare(b.ip));
  if(shared.length)return shared[0].ip;
  const free=safe.filter(r=>r.status==='free').sort((a,b)=>a.ip.localeCompare(b.ip));
  if(free.length)return free[0].ip;
  fail('directadmin_no_create_ip_available');
}

const UNLIMITED=Object.freeze({
  bandwidth:'0',ubandwidth:'ON',quota:'0',uquota:'ON',inode:'0',uinode:'ON',
  vdomains:'0',uvdomains:'ON',nsubdomains:'0',unsubdomains:'ON',
  nemails:'0',unemails:'ON',nemailf:'0',unemailf:'ON',nemailml:'0',unemailml:'ON',
  nemailr:'0',unemailr:'ON',mysql:'0',umysql:'ON',domainptr:'0',udomainptr:'ON',ftp:'0',uftp:'ON',
});
const FEATURES=Object.freeze({
  aftp:'OFF',cgi:'ON',php:'ON',spam:'ON',cron:'ON',catchall:'ON',ssl:'ON',ssh:'OFF',
  sysinfo:'ON',login_keys:'ON',dnscontrol:'ON',suspend_at_limit:'OFF',skin:'evolution',language:'en',
});

function buildCreatePayload({ip,password}){
  if(!isIp(ip))fail('directadmin_create_ip_invalid');
  if(typeof password!=='string'||password.length<24||password.length>200)fail('generated_password_invalid');
  return Object.freeze({
    action:'create',add:'Submit',username:USERNAME,email:ACCOUNT_EMAIL,passwd:password,passwd2:password,
    domain:PRIMARY_DOMAIN,...UNLIMITED,...FEATURES,ip,notify:'no',
  });
}
function buildDeletePayload(username=USERNAME){
  if(username!==USERNAME)fail('delete_username_not_allowlisted');
  return Object.freeze({confirmed:'Confirm',delete:'yes',select0:USERNAME});
}
function assertEndpoint(endpoint){if(!ALLOWED_ENDPOINTS.includes(endpoint))fail('directadmin_endpoint_not_allowlisted');return endpoint}
function isSuccessResponse(value){
  if(value===null||value===undefined)return false;
  if(typeof value==='string'){
    const p=new URLSearchParams(value);
    return p.get('error')==='0';
  }
  if(typeof value==='object'&&!Array.isArray(value)){
    return String(value.error)==='0'||value.success===true;
  }
  return false;
}
function sanitize(value){
  const secretKey=/(pass|password|passwd|authorization|api[_-]?url|login[_-]?key|token|secret)/i;
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==='object'){
    const out={};for(const [k,v] of Object.entries(value))out[k]=secretKey.test(k)?'[REDACTED]':sanitize(v);return out;
  }
  if(typeof value==='string'){
    if(/https?:\/\/[^\s:@]+:[^\s@]+@/i.test(value))return '[REDACTED]';
  }
  return value;
}
function publicCreateEvidence(payload){
  return sanitize({endpoint:CREATE_ENDPOINT,payload});
}

module.exports={USERNAME,PRIMARY_DOMAIN,ACCOUNT_EMAIL,CREATE_ENDPOINT,DELETE_ENDPOINT,LIST_USERS_ENDPOINT,SHOW_USER_CONFIG_ENDPOINT,DOMAIN_OWNERS_ENDPOINT,RESELLER_IPS_ENDPOINT,ALLOWED_ENDPOINTS,UNLIMITED,FEATURES,selectCreateIp,buildCreatePayload,buildDeletePayload,assertEndpoint,isSuccessResponse,sanitize,publicCreateEvidence};
