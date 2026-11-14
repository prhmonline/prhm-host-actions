'use strict';
/**
 * U06 five-actor SHARED-LOCK INTEGRATION CONTRACT — source/fixture only.
 *
 * Unlike the underlying generic lock, this dispatcher requires the same
 * acquire -> assert -> fixed actor callback -> terminal proof -> release
 * contract for all five named U06 operations. It is a testable boundary:
 * production native handlers are NOT linked and cannot be reached here.
 *
 * Caller-supplied callbacks and terminal receipts are FIXTURE ONLY and
 * confer no authentication, host action, L4, MySQL, or Root authority.
 * No live endpoint, arbitrary command execution, or production CLI.
 */
const crypto=require('node:crypto');
const Shared=require('./honartik-u06-shared-exclusive-lock-v1.cjs');
const KINDS=Shared.KINDS;
const HASH=/^[a-f0-9]{64}$/;
const REQUIRED=Object.freeze([...KINDS]);
const deny=(why)=>{throw Error('u06_shared_integration_'+why)};
const need=(v,why)=>{if(!v)deny(why)};
function exactHandlers(handlers){
 need(handlers&&typeof handlers==='object'&&!Array.isArray(handlers)&&
   Object.keys(handlers).sort().join('|')===REQUIRED.slice().sort().join('|')&&
   REQUIRED.every(kind=>typeof handlers[kind]==='function'),
   'all_five_handlers_required');
 return Object.freeze(Object.fromEntries(REQUIRED.map(k=>[k,handlers[k]])));
}
function terminalReceipt(kind,result){
 need(result&&typeof result==='object'&&!Array.isArray(result)&&
   Object.keys(result).sort().join('|')===
     ['kind','terminal','evidence_sha256','production_mutated'].sort().join('|')&&
   result.kind===kind&&result.terminal===true&&
   HASH.test(result.evidence_sha256||'')&&
   result.production_mutated===false,
   'terminal_evidence_required');
 return result;
}
function createUnprivilegedFixtureU06Integration(root,handlers){
 // Fixture gate requires unprivileged Linux and a one-use /tmp name.
 const gate=Shared.createUnprivilegedFixtureSharedGate(root);
 const fixed=exactHandlers(handlers);
 return Object.freeze({
  actorKinds:REQUIRED,
  async run(kind,payload=undefined){
   need(REQUIRED.includes(kind),'kind_unrecognized');
   // Gate acquisition is the FIRST operation: callback cannot observe
   // filesystem state or create side effects before lock is present.
   const lease=gate.begin(kind);
   const cap=Object.freeze({
    kind,
    assertHeld(){
     need(gate.assertHeld(lease,kind)===true,'not_shared_lock_owner');
     return true;
    }
   });
   try{
    cap.assertHeld();
    const result=await fixed[kind](cap,payload);
    cap.assertHeld();
    terminalReceipt(kind,result);
    gate.finish(lease,kind,{terminalProof:true});
    return Object.freeze({
      kind,terminal:true,receipt_sha256:crypto.createHash('sha256')
        .update(JSON.stringify(result)).digest('hex'),
      production_mutated:false,
      fixture_only:true
    });
   }catch(e){
    // Intentionally DO NOT release on failed, incomplete or ambiguous
    // operation. The original lease remains a durable recovery blocker.
    throw e;
   }
  },
  inspect(){ return gate.inspect(); }
 });
}
module.exports=Object.freeze({
 KINDS,createUnprivilegedFixtureU06Integration,
 ROOT_ENTRYPOINT:false,PRODUCTION_AUTHORIZED:false,
 NATIVE_BACKUP_ENABLED:false,LEVEL4_ISSUER:false
});
if(require.main===module){
 process.stderr.write('U06 integrated actors are unprivileged fixtures only; no Root action.\n');
 process.exitCode=64;
}
