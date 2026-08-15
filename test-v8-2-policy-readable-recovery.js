
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('future v8 policy file remains root-owned read-only but readable by DynamicUser',()=>{
 const s=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v8-verified-economics-replay.js'),'utf8');
 assert.match(s,/k==='policy'\?0o644:0o755/);
 assert.match(s,/fs\.chmodSync\(FILES\[k\],k==='policy'\?0o644:0o755\)/);
});

test('v8.2 recovery is content-bound and repairs only policy mode plus Approval restart',()=>{
 const s=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v8-2-policy-readable-recovery.js'),'utf8');
 assert.match(s,/afae32985861cb8b9396f4cea4b05e1c68b90a6ad55937b27c8fcf7dc84321df/);
 assert.match(s,/chmodSync\(POLICY,0o644\)/);
 assert.match(s,/prhm-company-approval\.service/);
 assert.match(s,/nsenter/);
 assert.match(s,/policy_version/);
 assert.match(s,/content_mutation:false/);
 assert.match(s,/database_mutation:false/);
 assert.match(s,/business_mutation:false/);
 assert.doesNotMatch(s,/writeFileSync\(POLICY/);
});
