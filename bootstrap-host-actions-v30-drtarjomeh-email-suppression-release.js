'use strict';

const ACTION='drtarjomeh_email_suppression_release_bootstrap_v1';
const OPERATION='host_action.drtarjomeh_email_suppression_release_bootstrap_v1';
const ROLLBACK='host-action-v2:drtarjomeh-email-suppression-release-bootstrap-v1:backup-restore';

function fail(code){throw new Error(code)}
function assertText(value,label){if(typeof value!=='string'||!value)fail(label+'_invalid');return value}

function buildPolicyCandidate(source){
  const parsed=JSON.parse(assertText(source,'policy'));
  parsed.operations=parsed.operations||{};
  parsed.typed_scopes=Array.isArray(parsed.typed_scopes)?parsed.typed_scopes:[];
  if(Object.prototype.hasOwnProperty.call(parsed.operations,OPERATION)||parsed.typed_scopes.some(x=>x&&x.action===ACTION))fail('already_present');
  parsed.operations[OPERATION]={
    level:4,
    risk:'critical',
    requires_second_confirmation:true,
    one_time_use:true,
    requested_approver:'mohammad',
    expires_seconds:180,
    rollback_reference:ROLLBACK
  };
  parsed.typed_scopes.push({
    action:ACTION,
    operation:OPERATION,
    level:4,
    risk:'critical',
    requires_second_confirmation:true,
    one_time_use:true,
    requested_approver:'mohammad',
    expires_seconds:180,
    rollback_reference:ROLLBACK
  });
  return JSON.stringify(parsed,null,2)+'\n';
}

function buildBaseCandidate(source){
  source=assertText(source,'base');
  if(source.includes(ACTION)||source.includes(OPERATION))fail('already_present');
  const anchor='const HOST_ACTION_V2_SPECS = Object.freeze({';
  if(source.split(anchor).length!==2)fail('base_anchor_invalid');
  const entry="\n  "+ACTION+": { operation: '"+OPERATION+"', rollback: '"+ROLLBACK+"' },";
  return source.replace(anchor,anchor+entry);
}

function buildMcpCandidate(source){
  source=assertText(source,'mcp');
  if(source.includes(ACTION))fail('already_present');
  const re=/const HostActionV2\s*=\s*z\.enum\(\[([\s\S]*?)\]\);/;
  const m=source.match(re);
  if(!m)fail('mcp_anchor_invalid');
  const inner=m[1].trim();
  const next="const HostActionV2=z.enum(["+(inner?inner+",'"+ACTION+"'":"'"+ACTION+"'")+"]);";
  return source.replace(re,next);
}

function buildExecCandidate(source,helperSha){
  source=assertText(source,'exec');
  if(source.includes(ACTION)||source.includes(OPERATION))fail('already_present');
  if(!/^[a-f0-9]{64}$/.test(String(helperSha||'')))fail('helper_sha_invalid');

  let out=source;
  const specs='const HOST_ACTION_V2_SPECS = Object.freeze({';
  if(out.includes(specs)){
    out=out.replace(specs,specs+"\n  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},");
  }

  const wrapper='applyHostActionV2=async function(action){';
  if(!out.includes(wrapper))fail('exec_apply_anchor_invalid');
  const fn=[
    '',
    "const DRT_EMAIL_SUPPRESSION_HELPER='/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-email-suppression-release-bootstrap-v1.js';",
    "const DRT_EMAIL_SUPPRESSION_HELPER_SHA='"+helperSha+"';",
    "function applyDrTarjomehEmailSuppressionReleaseBootstrapV1(){",
    "  const fs=require('node:fs');",
    "  const crypto=require('node:crypto');",
    "  const cp=require('node:child_process');",
    "  const bytes=fs.readFileSync(DRT_EMAIL_SUPPRESSION_HELPER);",
    "  const actual=crypto.createHash('sha256').update(bytes).digest('hex');",
    "  if(actual!==DRT_EMAIL_SUPPRESSION_HELPER_SHA)throw new Error('drtarjomeh_email_suppression_helper_sha_mismatch');",
    "  const unit='prhm-drt-email-suppression-release-'+Date.now();",
    "  const args=['--wait','--collect','--quiet','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictNamespaces=true','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadWritePaths=/home/agent/ssh-agent-api /home/agent/ssh-mcp-server /opt/prhm-company-control-plane /var/lib/prhm-agent-selfmaint-exec /var/backups/prhm-drtarjomeh-email-suppression-release-v1 /run','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',DRT_EMAIL_SUPPRESSION_HELPER];",
    "  cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:900000,maxBuffer:1024*1024});",
    "  return {ok:true,schema_version:'prhm.host-action-result.v1',action:'"+ACTION+"',external_send_allowed:false};",
    "}",
    ''
  ].join('\n');
  out=fn+out;
  out=out.replace(wrapper,wrapper+"if(action==='"+ACTION+"')return applyDrTarjomehEmailSuppressionReleaseBootstrapV1();");
  return out;
}

module.exports={ACTION,OPERATION,ROLLBACK,buildPolicyCandidate,buildBaseCandidate,buildMcpCandidate,buildExecCandidate};
