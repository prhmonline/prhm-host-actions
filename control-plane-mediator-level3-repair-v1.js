'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const Module=require('node:module');
const path=require('node:path');

const BASE='/home/agent/ssh-agent-api/control-plane-mediator-level3-repair-v1.base-f6850b38ecfca63946969f290a2fc51380b84e3a9e2e7bf108bd68ede5c9c2e6.js';
const BASE_SHA='f6850b38ecfca63946969f290a2fc51380b84e3a9e2e7bf108bd68ede5c9c2e6';
const ANCHOR="const args=['--unit='+unit,'--quiet','--property=Type=oneshot'";
const REPLACEMENT="const args=['--unit='+unit,'--quiet','--no-block','--property=Type=oneshot'";
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

function patchHelperSource(source){
  const count=String(source).split(ANCHOR).length-1;
  if(count!==1)throw new Error('noblock_anchor_count_'+count);
  const out=String(source).replace(ANCHOR,REPLACEMENT);
  if((out.split("'--no-block'").length-1)!==1)throw new Error('noblock_postcondition_failed');
  return out;
}
function loadBase(){
  const st=fs.lstatSync(BASE);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(BASE)!==BASE)throw new Error('mediator_base_invalid');
  const bytes=fs.readFileSync(BASE);
  if(sha(bytes)!==BASE_SHA)throw new Error('mediator_base_sha_mismatch');
  const source=patchHelperSource(bytes.toString('utf8'));
  const compiled=new Module(BASE,module);
  compiled.filename=path.join(path.dirname(BASE),'.control-plane-mediator-level3-repair-noblock-runtime-v1.js');
  compiled.paths=module.paths;
  compiled._compile(source,compiled.filename);
  const h=compiled.exports;
  if(!h||typeof h.preflight!=='function'||typeof h.apply!=='function')throw new Error('mediator_base_contract_invalid');
  return h;
}
function preflight(){return loadBase().preflight()}
function apply(second_confirmation){return loadBase().apply(second_confirmation)}
module.exports=Object.freeze({BASE,BASE_SHA,ANCHOR,REPLACEMENT,patchHelperSource,preflight,apply});
