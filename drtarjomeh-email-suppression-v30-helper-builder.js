'use strict';

const EXACT_DESTINATIONS=Object.freeze([
  '/home/agent/ssh-agent-api/leadopsCampaignEmailCore.js',
  '/home/agent/ssh-agent-api/leadopsCampaignEmailRoutes.js',
  '/home/agent/ssh-agent-api/leadopsCampaignEmailService.js',
  '/home/agent/ssh-agent-api/leadopsCampaignEmailStore.js',
  '/home/agent/ssh-agent-api/leadopsRoutes.js',
  '/home/agent/ssh-agent-api/leadopsRoutesLegacy.js',
  '/home/agent/ssh-mcp-server/src/core/registry.js',
  '/home/agent/ssh-mcp-server/src/plugins/leadops.js',
  '/opt/prhm-company-control-plane/ops/leadops-email-suppression/leadops-email-suppression-foundation-v1.js',
  '/opt/prhm-company-control-plane/ops/company-os-email-suppression/company-os-email-suppression-reporting-v1.js'
]);

const SEMANTIC_DESTINATIONS=Object.freeze([
  '/opt/prhm-agent-selfmaint/server.js',
  '/opt/prhm-agent-selfmaint-exec/server.js',
  '/opt/prhm-company-control-plane/config/approval-policy.json',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
]);

const FOUNDATION='leadops_email_suppression_foundation_v1';
const REPORTING='company_os_email_suppression_reporting_v1';
const FOUNDATION_OP='host_action.leadops_email_suppression_foundation_v1';
const REPORTING_OP='host_action.company_os_email_suppression_reporting_v1';
const PRINCIPALS=Object.freeze([{principal_id:'mohammad',roles:['mcp-operator']}]);

function fail(code){throw new Error(code)}
function scope(action,operation){return{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action,risk:'high',operation,principals:PRINCIPALS}}

function mergePolicy(source){
  const p=JSON.parse(String(source));
  if(!p||typeof p!=='object'||!p.operations||!Array.isArray(p.typed_scopes))fail('policy_shape_invalid');
  const expected=[
    [FOUNDATION,FOUNDATION_OP],
    [REPORTING,REPORTING_OP]
  ];
  for(const [action,operation] of expected){
    const current=p.operations[operation];
    if(current){
      if(Number(current.level)!==3||(current.risk!==undefined&&current.risk!=='high'))fail('policy_operation_conflict:'+action);
    }else p.operations[operation]={level:3,risk:'high'};

    const scopes=p.typed_scopes.filter(x=>x&&x.action===action);
    if(scopes.length>1)fail('policy_scope_conflict:'+action);
    if(scopes.length===1){
      const s=scopes[0];
      if(s.operation!==operation||s.tool!=='host_action_v2_apply'||s.project!=='control_plane'||s.environment!=='production'||s.risk!=='high')fail('policy_scope_conflict:'+action);
    }else p.typed_scopes.push(scope(action,operation));
  }
  return JSON.stringify(p,null,2)+'\n';
}

function mergeMcp(source){
  let out=String(source);
  const re=/const HostActionV2\s*=\s*z\.enum\(\[([\s\S]*?)\]\);/;
  const m=out.match(re);
  if(!m)fail('mcp_anchor_invalid');
  let inner=m[1].trim();
  for(const action of [FOUNDATION,REPORTING]){
    if(!new RegExp("['\"]"+action+"['\"]").test(inner))inner+=(inner?',':'')+"'"+action+"'";
  }
  return out.replace(re,'const HostActionV2=z.enum(['+inner+']);');
}

function addLevel3(source){
  const re=/const HOST_ACTION_V2_LEVEL3 = new Set\((\[[\s\S]*?\])\);/;
  const m=String(source).match(re);
  if(!m)fail('level3_anchor_invalid');
  let list;
  try{list=JSON.parse(m[1])}catch{fail('level3_parse_invalid')}
  if(!Array.isArray(list))fail('level3_parse_invalid');
  for(const action of [FOUNDATION,REPORTING])if(!list.includes(action))list.push(action);
  return String(source).replace(re,'const HOST_ACTION_V2_LEVEL3 = new Set('+JSON.stringify(list)+');');
}

function mergeBase(source){
  let out=String(source);
  const anchor='const HOST_ACTION_V2_SPECS = Object.freeze({';
  if(out.split(anchor).length!==2)fail('base_anchor_invalid');
  const additions=[];
  if(!out.includes(FOUNDATION))additions.push("  "+FOUNDATION+": { operation: '"+FOUNDATION_OP+"', rollback: 'host-action-v2:leadops-email-suppression-foundation-v1:transaction-rollback' },");
  if(!out.includes(REPORTING))additions.push("  "+REPORTING+": { operation: '"+REPORTING_OP+"', rollback: 'host-action-v2:company-os-email-suppression-reporting-v1:collector-restore' },");
  if(additions.length)out=out.replace(anchor,anchor+'\n'+additions.join('\n'));
  return addLevel3(out);
}

function mergeExec(source){
  let out=String(source);
  const specs='const HOST_ACTION_V2_SPECS = Object.freeze({';
  if(out.split(specs).length!==2)fail('exec_specs_anchor_invalid');
  const additions=[];
  if(!out.includes(FOUNDATION))additions.push("  "+FOUNDATION+":{operation:'"+FOUNDATION_OP+"',kind:'"+FOUNDATION+"'},");
  if(!out.includes(REPORTING))additions.push("  "+REPORTING+":{operation:'"+REPORTING_OP+"',kind:'"+REPORTING+"'},");
  if(additions.length)out=out.replace(specs,specs+'\n'+additions.join('\n'));

  const wrapper='applyHostActionV2=async function(action){';
  if(!out.includes(wrapper))fail('exec_apply_anchor_invalid');
  const runner=[
    "const DRT_EMAIL_SUPPRESSION_FOUNDATION='/opt/prhm-company-control-plane/ops/leadops-email-suppression/leadops-email-suppression-foundation-v1.js';",
    "const DRT_EMAIL_SUPPRESSION_REPORTING='/opt/prhm-company-control-plane/ops/company-os-email-suppression/company-os-email-suppression-reporting-v1.js';",
    "function runDrtEmailSuppressionFixedAction(action,file,readWritePaths){",
    "  const cp=require('node:child_process');",
    "  const unit='prhm-'+action+'-'+Date.now();",
    "  const args=['--wait','--collect','--quiet','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictNamespaces=true','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',...readWritePaths.map(p=>'--property=ReadWritePaths='+p),'--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',file];",
    "  const r=cp.spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:600000,maxBuffer:1024*1024});",
    "  if(r.error||r.status!==0)throw new Error(action+'_failed');",
    "  const lines=String(r.stdout||'').trim().split(/\\n+/).reverse();",
    "  for(const line of lines){try{const x=JSON.parse(line);if(x&&x.ok===true&&x.action===action)return x}catch{}}",
    "  throw new Error(action+'_result_missing');",
    "}",
    "function applyLeadopsEmailSuppressionFoundationV1(){return runDrtEmailSuppressionFixedAction('"+FOUNDATION+"',DRT_EMAIL_SUPPRESSION_FOUNDATION,['/var/lib/prhm-agent-selfmaint-exec']);}",
    "function applyCompanyOsEmailSuppressionReportingV1(){return runDrtEmailSuppressionFixedAction('"+REPORTING+"',DRT_EMAIL_SUPPRESSION_REPORTING,['/var/lib/prhm-company-os-dashboard','/var/lib/prhm-agent-selfmaint-exec','/var/backups/prhm-company-os-email-suppression-reporting-v1']);}",
    ""
  ].join('\n');
  if(!out.includes('runDrtEmailSuppressionFixedAction'))out=runner+out;
  if(!out.includes("if(action==='"+FOUNDATION+"')"))out=out.replace(wrapper,wrapper+"if(action==='"+FOUNDATION+"')return applyLeadopsEmailSuppressionFoundationV1();if(action==='"+REPORTING+"')return applyCompanyOsEmailSuppressionReportingV1();");
  return out;
}

module.exports={
  EXACT_DESTINATIONS,
  SEMANTIC_DESTINATIONS,
  FOUNDATION,
  REPORTING,
  FOUNDATION_OP,
  REPORTING_OP,
  mergePolicy,
  mergeMcp,
  mergeBase,
  mergeExec
};
