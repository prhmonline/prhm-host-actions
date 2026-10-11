import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawnSync as nodeSpawnSync} from 'node:child_process';

const wrapper=fs.readFileSync('safeFiles-waha-singlefile-journal-v4.mjs','utf8');
const reviewed=fs.readFileSync('waha-student-bridge-registration-surface-v37.mjs');
const sha=b=>createHash('sha1').update(Buffer.from('blob '+b.length)).update(Buffer.from([0])).update(b).digest('hex');
function source(){
  const match=wrapper.match(/const WAHA_B64='([A-Za-z0-9+/=]+)';/);
  assert.ok(match,'embedded audited artifact missing');
  const raw=Buffer.from(match[1],'base64');
  assert.deepEqual(raw,reviewed);
  assert.equal(sha(raw),'7b6e08d2ffb9faed164115be085491fce7ce6261');
  const first=wrapper.indexOf('function exactWahaCode(){');
  const last=wrapper.indexOf('\nloadExactPreimage();',first);
  assert.ok(first>=0&&last>first);
  const ctx={Buffer,WAHA_B64:match[1],REVIEWED_WAHA_BLOB_SHA1:sha(raw),blobHash:sha,fail:v=>{throw new Error(v);}};
  vm.runInNewContext(wrapper.slice(first,last)+'\nresult=exactWahaCode();',ctx);
  const output=Buffer.from(ctx.result,'base64').toString('utf8');
  assert.ok(!output.includes("'--wait','--collect','--pipe','--quiet'"));
  assert.ok(output.includes("'--wait','--collect','--quiet'"));
  assert.ok(output.includes("const capture=spawnSync('/usr/bin/journalctl'"));
  const check=nodeSpawnSync(process.execPath,['--check','--input-type=module'],{input:output,encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
  return output;
}
function runAudit(mode='success'){
 const m=source();
 const a=m.indexOf('function runRegistration(mode){');
 const b=m.indexOf('export function registerSafeFilesPlugin',a);
 assert.ok(a>=0&&b>a);
 let sandboxArgs, journalArgs,cleanups=0;
 const context={
  Date,STATE:'/tmp/fixed-waha-state',REG:'/tmp/fixed-waha-register.js',
  materializeArtifacts:()=>({registration_sha256:'sha-reg',worker_sha256:'sha-worker'}),
  cleanupArtifacts:()=>{cleanups++},
  fail:message=>{throw new Error(message)},
  parseLastJson:s=>JSON.parse(s.trim().split('\n').filter(x=>x.startsWith('{')).at(-1)),
  spawnSync:(binary,args,opts)=>{
   if(binary==='/usr/bin/systemd-run'){
     sandboxArgs=args;
     return mode==='sandbox_failure'?{status:1,stderr:'sandbox rejected'}:{status:0,stderr:'',stdout:''};
   }
   if(binary==='/usr/bin/journalctl'){
     journalArgs=args;
     return mode==='journal_failure'?{status:1,stderr:'journal unavailable'}:
       {status:0,stderr:'',stdout:'Started read-only unit\n{"ok":true,"schema_version":"prhm.waha-student-bridge-registration.v1","database_mutation":false,"service_control":false,"requires_zdt_refresh":true,"preflight_only":true}\nStopped read-only unit\n'};
   }
   throw Error('Unexpected child: '+binary);
  }
 };
 const func=vm.runInNewContext(m.slice(a,b)+'\nrunRegistration;',context);
 if(mode==='success'){
  const value=func('--preflight-only');
  return {value,sandboxArgs,journalArgs,cleanups};
 }
 assert.throws(()=>func('--preflight-only'),mode==='sandbox_failure'?/waha_registration_sandbox_failed/:/waha_registration_journal_capture_failed/);
 return {sandboxArgs,journalArgs,cleanups};
}
test('sandbox launcher has exact original protections but no --pipe',()=>{
 const {value,sandboxArgs,journalArgs,cleanups}=runAudit();
 assert.equal(value.ok,true);
 assert.equal(value.read_only,true);
 assert.equal(value.database_mutation,false);
 assert.equal(value.service_control,false);
 assert.ok(sandboxArgs.includes('--wait')&&sandboxArgs.includes('--collect'));
 assert.ok(!sandboxArgs.includes('--pipe'));
 for(const key of ['--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=NoNewPrivileges=true','--property=RestrictAddressFamilies=AF_UNIX'])
  assert.ok(sandboxArgs.includes(key),key+' removed');
 assert.equal(journalArgs.includes('--no-pager'),true);
 assert.ok(journalArgs.includes('-n'));
 assert.equal(cleanups,1);
});
test('failure to start sandbox or read journal fails closed and cleans up',()=>{
 assert.equal(runAudit('sandbox_failure').cleanups,1);
 assert.equal(runAudit('journal_failure').cleanups,1);
});
test('source is unchanged SHA-reviewed WAHA except anchored legacy and transport rewrites',()=>{
 const m=source();
 assert.ok(m.includes('waha_student_bridge_registration_preflight_v1'));
 assert.ok(m.includes('waha_student_bridge_registration_apply_v1'));
 assert.equal((m.match(/mcp.registerTool\(/g)||[]).length,2);
 assert.ok(!m.includes('const PATCHED_BASE_SHA=ensureBase();'));
 assert.match(wrapper,/OWNER_SHA256='822e2188d1cb80578fb150eb0066c522c38696459d673ef863473cf584f1c05e'/);
});