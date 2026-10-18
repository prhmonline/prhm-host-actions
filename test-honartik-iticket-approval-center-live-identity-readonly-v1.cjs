'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const a=require('./honartik-iticket-approval-center-live-identity-readonly-v1.cjs');
const keys=crypto.generateKeyPairSync('ed25519');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const basePolicy=()=>({
 schema_version:'prhm.approval-policy.v1',
 version:'2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1',
 default_deny:true,one_time_use:true,issuer:'prhm-company-approval',
 levels:{'4':{max_ttl_seconds:180,human_approval:true,second_confirmation_required:true}},
 operations:{'host_action.host_action_v2_installer_v1':{level:3}},
 typed_scopes:[]
});
const meta=()=>({uid:0,nlink:1,isFile:true,isSymbolicLink:false,mode:0o100644});
function fixture(){
 const policy=basePolicy(),policyBytes=Buffer.from(JSON.stringify(policy,null,2)+'\n');
 const publicKeyBytes=Buffer.from(keys.publicKey.export({format:'pem',type:'spki'}));
 const fingerprint=sha(keys.publicKey.export({format:'der',type:'spki'}));
 return {policyBytes,publicKeyBytes,
   policyMetadata:meta(),publicMetadata:meta(),
   expectedPolicySha:sha(policyBytes),
   health:{
     ok:true,service:'prhm-company-approval',mode:'mcp-operator',
     algorithm:'Ed25519',one_time_use:true,
     policy_version:policy.version,
     policy_hash:sha(Buffer.from(JSON.stringify(policy))),
     key_fingerprint:fingerprint,version:'1.2.0-typed-scope'
   }
 };
}
test('expected source health and public Ed25519 SPKI fingerprint agree',()=>{
 const x=fixture(),r=a.validate(x);
 assert.equal(r.status,'LIVE_HEALTH_PUBLIC_KEY_AND_POLICY_CONSISTENT');
 assert.equal(r.key_spki_sha256,x.health.key_fingerprint);
 assert.equal(r.reported_policy_sha256,x.health.policy_hash);
 assert.equal(r.issuer_binary_identity_attested,false);
 assert.equal(r.effective_l4_approval_attested,false);
 assert.equal(r.actual_replay_consumption_attested,false);
 assert.equal(r.install_authorized,false);
});
for(const [label,mutate,pattern] of [
 ['policy SHA drift',x=>x.expectedPolicySha='a'.repeat(64),/original_policy_sha_drift/],
 ['wrong policy hash',x=>x.health.policy_hash='a'.repeat(64),/health_policy_mismatch/],
 ['wrong policy version',x=>x.health.policy_version='unknown',/health_policy_mismatch/],
 ['different public key',x=>x.publicKeyBytes=Buffer.from(crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})),/health_key_fingerprint_mismatch/],
 ['wrong fingerprint in health',x=>x.health.key_fingerprint='a'.repeat(64),/health_key_fingerprint_mismatch/],
 ['wrong signing algorithm',x=>x.health.algorithm='RSA',/health_service_mismatch/],
 ['wrong issuer name',x=>x.health.service='untrusted',/health_service_mismatch/],
 ['wrong mode',x=>x.health.mode='unknown',/health_service_mismatch/],
 ['global one-time off',x=>x.health.one_time_use=false,/health_service_mismatch/],
 ['health service down',x=>x.health.ok=false,/health_service_mismatch/],
 ['default deny off',x=>{const p=JSON.parse(x.policyBytes.toString());p.default_deny=false;x.policyBytes=Buffer.from(JSON.stringify(p));x.expectedPolicySha=sha(x.policyBytes)},/policy_schema_or_controls/],
 ['policy globally one-time off',x=>{const p=JSON.parse(x.policyBytes.toString());p.one_time_use=false;x.policyBytes=Buffer.from(JSON.stringify(p));x.expectedPolicySha=sha(x.policyBytes)},/policy_schema_or_controls/],
 ['public key symlink',x=>x.publicMetadata.isSymbolicLink=true,/file_trust_public/],
 ['public key non-root',x=>x.publicMetadata.uid=1000,/file_trust_public/],
 ['public key world-writable',x=>x.publicMetadata.mode=0o100666,/file_trust_public/],
 ['policy hardlink',x=>x.policyMetadata.nlink=2,/file_trust_policy/],
 ['policy group-writable',x=>x.policyMetadata.mode=0o100664,/file_trust_policy/],
 ['RSA public key',x=>x.publicKeyBytes=Buffer.from(crypto.generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'})),/public_key_not_ed25519/]
])test('fail-closed local issuer evidence: '+label,()=>{
 const x=fixture();mutate(x);
 assert.throws(()=>a.validate(x),pattern);
});
test('read from descriptor with O_NOFOLLOW, reject symlink and preserve file identity',t=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-issuer-readonly-test-'));
 t.after(()=>fs.rmSync(d,{recursive:true,force:true}));
 const file=path.join(d,'plain'),link=path.join(d,'link');
 fs.writeFileSync(file,'public only');
 fs.symlinkSync(file,link);
 const r=a.checkedRegular(file);
 assert.equal(r.bytes.toString('utf8'),'public only');
 assert.throws(()=>a.checkedRegular(link),/unsafe_file/);
});
test('only fixed local endpoint and public material, never private key or approval records',()=>{
 assert.equal(a.ENDPOINT,'http://127.0.0.1:18133/health');
 assert.equal(a.PUBLIC,'/var/lib/prhm-company-approval/ed25519-public.pem');
 const src=fs.readFileSync(require.resolve('./honartik-iticket-approval-center-live-identity-readonly-v1.cjs'),'utf8');
 for(const needle of ["approval_token","ed25519-private.pem","require('node:child_process')",
   "writeFileSync(","renameSync(","fs.unlinkSync(","fs.mkdirSync(",
   "POST","'/v1/consume'","'/v1/requests'"])
   assert.equal(src.includes(needle),false,'unsafe primitive '+needle);
});
