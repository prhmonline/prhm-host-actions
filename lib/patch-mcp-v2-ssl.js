#!/usr/bin/env node
'use strict';

const fs = require('fs');
const ACTION = 'repair_node1_ssl_deploy_v1';

function fail(message){ throw new Error(message); }
function count(text, needle){ let n=0,p=0; while((p=text.indexOf(needle,p))!==-1){ n++; p+=needle.length; } return n; }
function replaceOnce(text, oldText, newText, label){
  const n=count(text,oldText); if(n!==1) fail(label+'_cardinality:'+n); return text.replace(oldText,newText);
}
function transform(text){
  if(text.includes("'repair_node1_ssl_deploy_v1'")){
    const enumCount=count(text,"'repair_node1_ssl_deploy_v1'");
    if(enumCount!==1) fail('ssl_action_existing_cardinality:'+enumCount);
    return text;
  }
  const oldEnum="const HostActionV2=z.enum(['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1','agent_api_capability_minimize_v1']);";
  const newEnum="const HostActionV2=z.enum(['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1','agent_api_capability_minimize_v1','repair_node1_ssl_deploy_v1']);";
  let out=replaceOnce(text,oldEnum,newEnum,'host_action_v2_enum');
  out=replaceOnce(
    out,
    "description:'Create a Level-4 request for one of three fixed staged Agent API hardening actions. No arbitrary command, path, or service input.'",
    "description:'Create a Level-4 request for one fixed Host Actions v2 operation, including staged Agent API hardening and the fixed node1 SSL deploy repair. No arbitrary command, host, path, or service input.'",
    'request_description'
  );
  out=replaceOnce(
    out,
    "description:'Execute one previously approved fixed staged Agent API hardening action with stage-local automatic rollback.'",
    "description:'Execute one previously approved fixed Host Actions v2 operation with automatic rollback where the fixed action mutates state.'",
    'apply_description'
  );
  if(count(out,"'repair_node1_ssl_deploy_v1'")!==1) fail('ssl_action_final_cardinality_invalid');
  return out;
}
if(require.main===module){ const file=process.argv[2]; if(!file||process.argv.length!==3)fail('usage: patch-mcp-v2-ssl.js FILE'); process.stdout.write(transform(fs.readFileSync(file,'utf8'))); }
module.exports={transform};
