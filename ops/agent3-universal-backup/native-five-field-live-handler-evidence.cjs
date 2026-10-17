'use strict';
/**
 * Safe narrow evidence capture to unblock Agent3 native five-field wiring.
 * DO NOT print all Control Plane owners, environment, keys, tokens or entire
 * execution modules. This tool is READ-ONLY; it never uploads or writes data.
 *
 * All four owner files are read through O_NOFOLLOW descriptor, inode/size/
 * mode/race checks and SHA-pinned live preimages. Only fixed line windows
 * containing native request/consume/dispatch and policy/MCP entrypoints
 * are eligible for a bounded, REDACTED terminal report.
 *
 * The output is operator-reviewable evidence, NOT an installed action, signed
 * approval, exact source handoff, production code release, or deployment key.
 * Any skipped/redacted line must be independently reviewed before using it
 * in the final four-owner source patch.
 */
const crypto=require('node:crypto');
const preflight=require('./four-owner-live-patch-preflight.cjs');
const pins=require('./production-registration-contract.json');
const NAMES=Object.freeze(['base','executor','policy','mcp']);
const WINDOWS=Object.freeze({
 base:Object.freeze([[244,280],[443,485]]),
 executor:Object.freeze([[432,478],[686,718],[887,966]]),
 policy:Object.freeze([[222,240],[842,869]]),
 mcp:Object.freeze([[27,40]])
});
const MIN_LINES=Object.freeze({base:485,executor:966,policy:869,mcp:40});
const MAX_SOURCE_LINE=7500;
const MAX_OUTPUT_CHARS=110000;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function deny(reason){throw Error('agent3_native_handler_evidence_denied:'+reason);}
const SENSITIVE=/(?:process\.env(?:\.|\[)|authorization\s*[:=]|Bearer\s+[A-Za-z0-9._-]{12,}|private[_-]?key|client[_-]?secret|password\s*[:=]|cookie\s*[:=]|secret\s*[:=]|-----BEGIN|(?:gh[pousr]_|sk-|AIza)[A-Za-z0-9_-]{16,})/i;
const HIGH_ENTROPY=/\b(?:[A-Fa-f0-9]{96,}|[A-Za-z0-9+/_-]{120,}={0,2})\b/g;
function sanitizeLine(line){
 if(typeof line!=='string')deny('invalid_line');
 const raw=Buffer.from(line,'utf8');
 const digest=sha(raw);
 if(line.length>MAX_SOURCE_LINE)return Object.freeze({
   redacted:true,why:'OVERSIZED_SOURCE_LINE',
   sha256:digest,chars:line.length,source:'[REDACTED_OVERSIZED_LINE]'
 });
 if(SENSITIVE.test(line))return Object.freeze({
   redacted:true,why:'SENSITIVE_SOURCE_LINE',
   sha256:digest,chars:line.length,source:'[REDACTED_SENSITIVE_LINE]'
 });
 // Long literals are redacted individually, not truncated, because JSX/JS
 // one-liners may place the critical branch at the end of the source line.
 const cleaned=line.replace(HIGH_ENTROPY,'[REDACTED_LONG_LITERAL]');
 return Object.freeze({redacted:cleaned!==line,sha256:digest,chars:line.length,
   source:cleaned});
}
function project(buffers,expectedPins=pins.preimage_sha256){
 if(!buffers||typeof buffers!=='object'||Array.isArray(buffers)||
    Object.keys(buffers).sort().join('|')!==NAMES.slice().sort().join('|'))
  deny('exact_four_buffers_required');
 const owners={};
 let total=0,redacted=0;
 for(const name of NAMES){
  const b=buffers[name];
  if(!Buffer.isBuffer(b)||!expectedPins||sha(b)!==expectedPins[name])
   deny('owner_sha_mismatch:'+name);
  const lines=b.toString('utf8').split(/\r?\n/);
  if(lines.length<MIN_LINES[name])deny('insufficient_owner_lines:'+name);
  const selected=[];
  for(const [start,end] of WINDOWS[name]){
   for(let number=start;number<=end;number++){
    const value=sanitizeLine(lines[number-1]);
    if(value.redacted)redacted++;
    // Line-by-line digest lets operator correlate sanitized excerpts with
    // the precise SHA-pinned source without disclosing omitted sensitive data.
    selected.push(Object.freeze({line:number,...value}));
   }
  }
  owners[name]=Object.freeze({
   original_sha256:sha(b),total_source_lines:lines.length,
   sections:WINDOWS[name],
   selected:Object.freeze(selected)
  });
  total+=JSON.stringify(owners[name]).length;
 }
 if(total>MAX_OUTPUT_CHARS)deny('bounded_output_exceeded');
 return Object.freeze({
  schema:'prhm.agent3.native-handler-redacted-evidence.v1',
  mode:'READ_ONLY_BOUNDED_FOUR_OWNER_HANDLERS',
  host:'prhm-production',owners:Object.freeze(owners),
  selected_lines:Object.values(owners).reduce((n,v)=>n+v.selected.length,0),
  redacted_lines:redacted,
  unsafe_to_apply:true,production_mutation:false,
  approval_issued:false,approval_consumed:false,
  source_export_complete:false,
  next_gate:'HUMAN_REVIEW_EXCERPTS_AND_IMPLEMENT_NATIVE_SIGNED_FIVE_FIELD_DISPATCH'
 });
}
function run(){
 if(process.getuid?.()!==0)deny('root_readonly_required');
 const bytes=Object.fromEntries(NAMES.map(k=>[k,preflight.safeReadPinned(k)]));
 return project(bytes);
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--handlers'){
  process.stderr.write('read-only --handlers only; no apply, stage or approval\n');
  process.exitCode=64;
 }else{
  try{process.stdout.write(JSON.stringify(run())+'\n');}
  catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=78;}
 }
}
module.exports=Object.freeze({
 NAMES,WINDOWS,MIN_LINES,MAX_SOURCE_LINE,MAX_OUTPUT_CHARS,
 sanitizeLine,project,run
});
