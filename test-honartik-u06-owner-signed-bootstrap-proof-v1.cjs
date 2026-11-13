'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cp=require('node:child_process');
const S=require('./honartik-u06-owner-signed-bootstrap-proof-v1.cjs');
const H=Buffer.from('example owner-signed exact SHA-manifest\n');
function mk(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'u06-bootstrap-sshsig-'));
 const key=path.join(dir,'owner.key'),file=path.join(dir,'manifest');
 const created=cp.spawnSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',key]);
 assert.equal(created.status,0,String(created.stderr));
 fs.writeFileSync(file,H);
 const signed=cp.spawnSync('ssh-keygen',['-Y','sign','-f',key,
  '-n',S.PIN.namespace,file],{encoding:'utf8'});
 assert.equal(signed.status,0,signed.stderr);
 const armor=fs.readFileSync(file+'.sig','utf8');
 const parts=fs.readFileSync(key+'.pub','utf8').trim().split(/\s+/);
 const wire=Buffer.from(parts[1],'base64');
 const len=wire.readUInt32BE(0),off=4+len;
 const n=wire.readUInt32BE(off),pub=wire.subarray(off+4,off+4+n);
 return {dir,armor,wire,pub};
}
test('real OpenSSH SSHSIG Ed25519 namespace verifies only exact bytes and key',()=>{
 const x=mk();
 try{
  assert.equal(S.verifyPayloadSignature(H,x.armor,{wire:x.wire,pub:x.pub}),true);
  assert.throws(()=>S.verifyPayloadSignature(Buffer.from(H.toString()+'x'),
   x.armor,{wire:x.wire,pub:x.pub}),/signature_cryptographic_failure/);
  assert.throws(()=>S.verifyPayloadSignature(H,x.armor,{
   wire:Buffer.alloc(x.wire.length),pub:x.pub
  }),/signature_embedded_public_key_wrong/);
  assert.equal(S.PIN.fp,
   'SHA256:WEd6aCEVqn+FE6Yx8sTWBUfmsbKwNxz70M+x+HZsr0Q');
  assert.equal(S.LIVE_INSTALL_EXPORTED,false);
  assert.equal(S.NO_APPROVAL_ISSUER,true);
 }finally{fs.rmSync(x.dir,{recursive:true,force:true})}
});
test('manifest exact canonical 4-owner closure and TTL cannot self-authorize install',()=>{
 const now=Date.now();
 const m={
 schema:'prhm.u06.owner-signed-root-bootstrap.v1',
 host:S.PIN.host,action:S.PIN.action,operation:S.PIN.operation,
 source_commit:'a'.repeat(40),policy_post_sha256:S.PIN.policy,
 preimage_sha256:{agent_api:'b'.repeat(64)},
 postimage_sha256:{root_executor:'c'.repeat(64)},
 asset_sha256:{worker:'d'.repeat(64)},
 owner_key_fingerprint:S.PIN.fp,
 created_utc:new Date(now-10000).toISOString(),
 expires_utc:new Date(now+80000).toISOString(),nonce:'e'.repeat(64)
 };
 const raw=Buffer.from(JSON.stringify(m)+'\n');
 const expected={source_commit:m.source_commit,
  policy_post_sha256:m.policy_post_sha256,
  preimage_sha256:m.preimage_sha256,postimage_sha256:m.postimage_sha256,
  asset_sha256:m.asset_sha256};
 assert.equal(S.canonicalManifest(raw,expected).nonce,m.nonce);
 assert.throws(()=>S.canonicalManifest(Buffer.from(JSON.stringify(m,null,2)),expected),
  /manifest_not_canonical/);
 assert.throws(()=>S.canonicalManifest(Buffer.from(JSON.stringify({
  ...m,expires_utc:new Date(now-100).toISOString()
 })+'\n'),expected),/manifest_expired/);
 assert.throws(()=>S.canonicalManifest(raw,{
   ...expected,postimage_sha256:{root_executor:'f'.repeat(64)}
 }),/signed_manifest_not_reviewed_package/);
 assert.equal(S.install,undefined);
});
