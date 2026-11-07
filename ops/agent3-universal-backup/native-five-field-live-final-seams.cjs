'use strict';
/**
 * Targeted follow-up to read-only native-handler evidence.
 * Reports ONLY the missing Base v2, Executor v2 and MCP boundary portions
 * plus policy typed scopes and native v2 spec/consumed hash handling.
 *
 * Exactly four SHA-pinned live owner files are read via the already reviewed
 * descriptor-safe collector. No source archive, key, token, executable command,
 * caller path or other file is accepted. No writes, no approval, no install.
 * This evidence is redacted and cannot be treated as a runnable production patch.
 */
const crypto=require('node:crypto');
const pinned=require('./four-owner-live-patch-preflight.cjs');
const previous=require('./native-five-field-live-handler-evidence.cjs');
const contract=require('./production-registration-contract.json');
const KEYS=Object.freeze(['base','executor','policy','mcp']);
const WINDOWS=Object.freeze({
 base:Object.freeze([[485,560]]),
 executor:Object.freeze([[25,43],[230,244],[966,1097]]),
 policy:Object.freeze([[339,370]]),
 mcp:Object.freeze([[1,26],[41,49]])
});
const REQUIRED_LINES=Object.freeze({base:560,executor:1097,policy:1195,mcp:49});
const MAX_RESULT_BYTES=125000;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function deny(reason){throw Error('agent3_final_seams_denied:'+reason);}
function inspect(bytes,pins=contract.preimage_sha256){
 if(!bytes||typeof bytes!=='object'||Array.isArray(bytes)||
    Object.keys(bytes).sort().join('|')!==KEYS.slice().sort().join('|'))
  deny('four_fixed_owners_required');
 let redactedCount=0,selectedCount=0;
 const owners={};
 for(const k of KEYS){
  const value=bytes[k];
  if(!Buffer.isBuffer(value)||!pins||sha(value)!==pins[k])
   deny('preimage_drift:'+k);
  const lines=value.toString('utf8').split(/\r?\n/);
  if(lines.length<REQUIRED_LINES[k])deny('owner_line_count_drift:'+k);
  const excerpts=[];
  for(const [start,end] of WINDOWS[k]){
   for(let n=start;n<=end;n++){
    const sanitized=previous.sanitizeLine(lines[n-1]);
    const row={n,text:sanitized.source};
    if(sanitized.redacted){
     row.redacted=true;
     row.source_sha256=sanitized.sha256;
     redactedCount++;
    }
    excerpts.push(row);
    selectedCount++;
   }
  }
  owners[k]={sha256:sha(value),total_lines:lines.length,windows:WINDOWS[k],excerpts};
 }
 const result={
  schema:'prhm.agent3.readonly-final-handler-seams.v1',
  mode:'SHA_PINNED_REDACTED_BOUNDED_SOURCE_WINDOWS',
  host:'prhm-production',
  owner_count:4,selected_count:selectedCount,redacted_count:redactedCount,
  owners,
  complete_source_disclosed:false,
  approved_to_install:false,
  approval_requested:false,
  approval_consumed:false,
  production_mutation:false,
  next_gate:'REVIEW_NATIVE_V2_SIGNED_FIVE_FIELD_REQUEST_AND_APPLY_WIRING'
 };
 if(Buffer.byteLength(JSON.stringify(result))>MAX_RESULT_BYTES)
  deny('output_too_large');
 return Object.freeze(result);
}
function run(){
 if(process.getuid?.()!==0)deny('root_readonly_required');
 return inspect(Object.fromEntries(KEYS.map(k=>[k,pinned.safeReadPinned(k)])));
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--inspect'){
  process.stderr.write('readonly --inspect only, no stage, apply, approval or deployment\n');
  process.exitCode=64;
 }else{
  try{process.stdout.write(JSON.stringify(run())+'\n');}
  catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=78;}
 }
}
module.exports=Object.freeze({KEYS,WINDOWS,MAX_RESULT_BYTES,inspect,run});
