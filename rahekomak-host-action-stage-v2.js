'use strict';
// Fixed typed Host Action stage entrypoint. A new signed, consumed Level-4
// request must authorize its transient systemd invocation. No CLI parameters.
const installer=require('./rahekomak-host-action-repair-installer-v2.js');
async function main(){
  if(process.argv.length!==2)throw new Error('unexpected_arguments');
  const result=await installer.applyApproved();
  if(result?.ok!==true||result.installation_state!=='staged_pending_activation'||
    result.production_code_written!==false||result.production_runtime_restarted!==false)
    throw new Error('staging_result_contract_invalid');
  return result;
}
module.exports={main};
if(require.main===module)main().then(result=>{
  process.stdout.write(JSON.stringify(result)+'\n');
}).catch(error=>{
  process.stderr.write(String(error.message||error)+'\n');
  process.exitCode=1;
});
