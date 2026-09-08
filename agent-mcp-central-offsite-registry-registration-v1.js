'use strict';
const crypto=require('node:crypto');

const CONTRACT=Object.freeze({
  schema_version:'prhm.agent-mcp-central-offsite-registry-registration.v1',
  target:'/home/agent/ssh-mcp-server/src/core/registry.js',
  expected_old_sha256:'0d69b284f8bcf9b772a711dff962a614bd0c1234ee03b87f3faa70877eadb48c',
  find:"  registerHostActionsPlugin(mcp, context);\n",
  replace:"  registerHostActionsPlugin(mcp, context);\n  registerCentralOffsitePlugin(mcp, context);\n",
  arbitrary_path:false,
  arbitrary_command:false
});

function sha256(text){return crypto.createHash('sha256').update(text).digest('hex');}
function transform(source,expectedOldSha256=CONTRACT.expected_old_sha256,contract=CONTRACT){
  if(sha256(source)!==expectedOldSha256)throw new Error('preimage_sha_mismatch');
  const count=source.split(contract.find).length-1;
  if(count!==1)throw new Error('anchor_count_mismatch:'+count);
  const out=source.replace(contract.find,contract.replace);
  if(out===source)throw new Error('no_change');
  if((out.split('registerCentralOffsitePlugin(mcp, context);').length-1)!==1)throw new Error('central_offsite_registration_count_invalid');
  return out;
}

module.exports={CONTRACT,sha256,transform};
