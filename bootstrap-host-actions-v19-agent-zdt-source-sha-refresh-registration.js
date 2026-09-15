'use strict';

const ACTION = 'agent_zdt_source_sha_refresh_publisher_v1';
const OPERATION = 'host_action.agent_zdt_source_sha_refresh_publisher_v1';
const ROLLBACK = 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore';
const BASELINE = Object.freeze({
  base: '981a430f5448a1b0dc3c25886756ecf7cd655352660bb49905ab2650a131d764',
  executor: '451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48',
  policy: 'd7b7270f32d90cd55515ffb8337c08481bf58865c2e34858e3ebdf0056362cb7'
});
const PUBLISHER = Object.freeze({
  path: '/home/agent/ssh-agent-api/bootstrap-agent-zdt-source-sha-refresh-v19.sh',
  sha256: '35273ffc75f7c08ef68797945426ab4108e03b09e66122d398b51a7fab79658f'
});

function fail(code) { throw new Error(code); }
function count(source, needle) { return source.split(needle).length - 1; }
function requireAbsent(source, needle, label) { if (source.includes(needle)) fail(label + '_already_registered'); }

function specBlockEnd(source, start) {
  const end = source.indexOf('\n});', start);
  if (end < 0) fail('anchor_specs_end_missing');
  return end;
}

function patchBase(source) {
  if (typeof source !== 'string') fail('base_source_invalid');
  requireAbsent(source, ACTION, 'base_action');
  requireAbsent(source, OPERATION, 'base_operation');
  const start = source.indexOf('const HOST_ACTION_V2_SPECS = Object.freeze({');
  if (start < 0) fail('anchor_base_specs_missing');
  const end = specBlockEnd(source, start);
  const entry = `,\n  ${ACTION}: { operation: '${OPERATION}', rollback: '${ROLLBACK}' }`;
  let out = source.slice(0, end) + entry + source.slice(end);

  const levelRe = /const HOST_ACTION_V2_LEVEL3 = new Set\((\[[^\n]*\])\);/;
  const m = out.match(levelRe);
  if (!m) fail('anchor_base_level3_missing');
  let items;
  try { items = JSON.parse(m[1]); } catch { fail('base_level3_invalid'); }
  if (!Array.isArray(items)) fail('base_level3_invalid');
  if (items.includes(ACTION)) fail('base_level3_already_registered');
  items.push(ACTION);
  out = out.replace(levelRe, `const HOST_ACTION_V2_LEVEL3 = new Set(${JSON.stringify(items)});`);

  if (count(out, `  ${ACTION}: {`) !== 1 || !out.includes(`\"${ACTION}\"`) || count(out, OPERATION) !== 1) fail('base_postcondition_failed');
  return out;
}

const EXECUTOR_CODE = `
const AGENT_ZDT_SOURCE_SHA_REFRESH_PUBLISHER = '${PUBLISHER.path}';
const AGENT_ZDT_SOURCE_SHA_REFRESH_PUBLISHER_SHA256 = '${PUBLISHER.sha256}';
function applyAgentZdtSourceShaRefreshPublisherV1(){
  if(!fs.existsSync(AGENT_ZDT_SOURCE_SHA_REFRESH_PUBLISHER))throw new Error('source_sha_publisher_missing');
  const st=fs.lstatSync(AGENT_ZDT_SOURCE_SHA_REFRESH_PUBLISHER);
  if(!st.isFile()||st.isSymbolicLink())throw new Error('source_sha_publisher_not_regular');
  const actual=crypto.createHash('sha256').update(fs.readFileSync(AGENT_ZDT_SOURCE_SHA_REFRESH_PUBLISHER)).digest('hex');
  if(actual!==AGENT_ZDT_SOURCE_SHA_REFRESH_PUBLISHER_SHA256)throw new Error('source_sha_publisher_sha_mismatch');
  const unit='prhm-agent-zdt-source-sha-refresh-publisher-'+Date.now();
  const args=['--wait','--collect','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictAddressFamilies=AF_UNIX','--property=CapabilityBoundingSet=','--property=AmbientCapabilities=','--property=RestrictNamespaces=true','--property=ReadWritePaths=/opt/prhm-agent-selfmaint-exec/actions /var/backups/prhm-agent-zdt-source-sha-refresh-v19','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/bin/bash',AGENT_ZDT_SOURCE_SHA_REFRESH_PUBLISHER];
  const stdout=cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
  const line=stdout.split('\\n').map(x=>x.trim()).filter(Boolean).findLast(x=>x.startsWith('{')&&x.endsWith('}'));
  if(!line)throw new Error('source_sha_publisher_result_missing');
  let r;try{r=JSON.parse(line)}catch{throw new Error('source_sha_publisher_result_invalid_json')}
  if(r.ok!==true||r.action!=='agent_zdt_existing_topology_rolling_refresh_source_sha_refresh_v19'||r.target!=='/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js'||r.old_action_sha256!=='0fd63f7f8fe346ced5fbbfa3a7a4bc96253e498528934aaa3c7232e986b832bf'||r.production_application_mutation!==false||r.database_mutation!==false)throw new Error('source_sha_publisher_result_invalid');
  return r;
}
`;

function patchExecutor(source) {
  if (typeof source !== 'string') fail('executor_source_invalid');
  requireAbsent(source, ACTION, 'executor_action');
  requireAbsent(source, OPERATION, 'executor_operation');
  requireAbsent(source, PUBLISHER.sha256, 'executor_publisher_sha');

  const start = source.indexOf('const HOST_ACTION_V2_SPECS = Object.freeze({');
  if (start < 0) fail('anchor_executor_specs_missing');
  const end = specBlockEnd(source, start);
  let out = source.slice(0, end) + `,\n  ${ACTION}:{operation:'${OPERATION}',kind:'${ACTION}'}` + source.slice(end);

  const dispatchAnchor = 'const applyHostActionV2Original=applyHostActionV2;\n';
  const dispatchIndex = out.indexOf(dispatchAnchor);
  if (dispatchIndex < 0) fail('anchor_executor_dispatch_original_missing');
  out = out.slice(0, dispatchIndex) + EXECUTOR_CODE + '\n' + out.slice(dispatchIndex);

  const wrapperRe = /applyHostActionV2=async function\(action\)\{([^}]*)\};/;
  const wm = out.match(wrapperRe);
  if (!wm) fail('anchor_executor_dispatch_wrapper_missing');
  if (wm[1].includes(ACTION)) fail('executor_dispatch_already_registered');
  const body = `if(action==='${ACTION}')return applyAgentZdtSourceShaRefreshPublisherV1();` + wm[1];
  out = out.replace(wrapperRe, `applyHostActionV2=async function(action){${body}};`);

  if (count(out, OPERATION) !== 1 || !out.includes(PUBLISHER.sha256) || !out.includes(`if(action==='${ACTION}')return applyAgentZdtSourceShaRefreshPublisherV1()`)) fail('executor_postcondition_failed');
  return out;
}

function patchPolicy(source) {
  if (typeof source !== 'string') fail('policy_source_invalid');
  let p;
  try { p = JSON.parse(source); } catch { fail('policy_json_invalid'); }
  if (!p || typeof p !== 'object' || Array.isArray(p) || !p.operations || !Array.isArray(p.typed_scopes)) fail('policy_shape_invalid');
  if (p.operations[OPERATION]) fail('policy_operation_already_registered');
  if (p.typed_scopes.some(x => x && (x.action === ACTION || x.operation === OPERATION))) fail('policy_scope_already_registered');
  p.operations[OPERATION] = {level: 3};
  p.typed_scopes.push({
    tool: 'host_action_v2_apply', project: 'control_plane', environment: 'production',
    action: ACTION, risk: 'high', operation: OPERATION,
    principals: [{principal_id:'mohammad', roles:['mcp-operator']}]
  });
  return JSON.stringify(p, null, 2) + '\n';
}

module.exports = Object.freeze({ACTION, OPERATION, ROLLBACK, BASELINE, PUBLISHER, patchBase, patchExecutor, patchPolicy});
