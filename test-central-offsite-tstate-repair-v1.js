#!/usr/bin/env node
'use strict';
const assert=require('assert');
const vm=require('vm');
const fs=require('fs');
const source=fs.readFileSync(process.argv[2],'utf8');
function load(behavior){
  const sandbox={TIMER:'prhm-production-central-offsite-backup.timer',cp:{execFileSync(file,args){const v=behavior[args[0]];if(v&&v.throw){const e=new Error('Command failed');e.stdout=v.stdout;e.stderr=v.stderr||'';e.status=v.status||1;throw e}return v.stdout}},Error};
  vm.createContext(sandbox);vm.runInContext(source+';this.__tstate=tstate;',sandbox);return sandbox.__tstate;
}
const disabled=load({'is-enabled':{throw:true,stdout:'disabled\n',status:1},'is-active':{throw:true,stdout:'inactive\n',status:3}});
assert.deepStrictEqual(JSON.parse(JSON.stringify(disabled())),{enabled:'disabled',active:'inactive'});
const unknown=load({'is-enabled':{throw:true,stdout:'masked\n',status:1},'is-active':{throw:true,stdout:'inactive\n',status:3}});
assert.throws(()=>unknown(),/central_offsite_timer_state_unexpected/);
console.log('central-offsite tstate contract PASS');
