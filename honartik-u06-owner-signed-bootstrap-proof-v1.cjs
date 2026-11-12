'use strict';
/*
 * U06 first-registration bootstrap verification, NOT an L4 receipt.
 * Owner must independently sign the exact SHA-reviewed manifest using the
 * pre-existing Windows Ed25519 SSH key. We verify SSHSIG cryptographically
 * against that one root-authorized public key, pinned by its fingerprint.
 * After installation, live U06 still needs separately signed consumed L4.
 */
const fs=require('node:fs'),crypto=require('node:crypto');
const PIN=Object.freeze({
 host:'prhm-production.prhm.ir',action:'honartik_u06_native_backup_register_v1',
 operation:'host_action.honartik_u06_native_backup_register_v1',
 fp:'SHA256:WEd6aCEVqn+FE6Yx8sTWBUfmsbKwNxz70M+x+HZsr0Q',
 comment:'codex-windows',file:'/root/.ssh/authorized_keys',
 namespace:'prhm-u06-owner-bootstrap-v1',
 policy:'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934'
});
const err=x=>{throw Error('u06_owner_bootstrap_'+x)};
const yes=(x,e)=>{if(!x)err(e)};
const W=x=>{const b=Buffer.from(x),h=Buffer.alloc(4);h.writeUInt32BE(b.length);return Buffer.concat([h,b])};
const HEX=/^[0-9a-f]{64}$/,COMMIT=/^[0-9a-f]{40}$/;
function part(b,i,max=50000){
 yes(i+4<=b.length,'ssh_wire_eof');
 const n=b.readUInt32BE(i);
 yes(n<=max&&i+4+n<=b.length,'ssh_wire_length');
 return [b.subarray(i+4,i+4+n),i+4+n];
}
function parseTrustedAuthorizedKey(bytes){
 yes(Buffer.isBuffer(bytes)&&bytes.length<100000,'trusted_key_bytes');
 const matches=[];
 for(const line of bytes.toString('utf8').split(/\r?\n/)){
  const items=line.trim().split(/\s+/),i=items.indexOf('ssh-ed25519');
  if(i<0||i+2>=items.length||items.slice(i+2).join(' ')!==PIN.comment)continue;
  const raw=Buffer.from(items[i+1],'base64');
  yes(raw.toString('base64').replace(/=+$/,'')===
      items[i+1].replace(/=+$/,''),'authorized_key_encoding');
  const fp='SHA256:'+crypto.createHash('sha256').update(raw)
    .digest('base64').replace(/=+$/,'');
  yes(fp===PIN.fp,'public_owner_fingerprint_drift');
  const [type,p]=part(raw,0,30),[key,end]=part(raw,p,33);
  yes(type.toString()==='ssh-ed25519'&&key.length===32&&
    end===raw.length,'trusted_key_shape');
  matches.push({wire:raw,pub:key});
 }
 yes(matches.length===1,'pinned_owner_public_key_missing');
 return matches[0];
}
function liveTrustedKey(){
 const s=fs.lstatSync(PIN.file);
 yes(s.isFile()&&!s.isSymbolicLink()&&s.uid===0&&s.gid===0&&
  (s.mode&0o777)===0o600&&s.nlink===1&&s.size<100000,
  'authorized_keys_untrusted');
 const fd=fs.openSync(PIN.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const n=fs.fstatSync(fd);
  yes(n.dev===s.dev&&n.ino===s.ino&&n.size===s.size,'key_raced');
  return parseTrustedAuthorizedKey(fs.readFileSync(fd));
 }finally{fs.closeSync(fd)}
}
function readSSHSig(armor){
 yes(typeof armor==='string'&&armor.length>=100&&armor.length<=8000,
  'armored_signature_length');
 const m=/^-----BEGIN SSH SIGNATURE-----\r?\n([A-Za-z0-9+/\r\n=]+)\r?\n-----END SSH SIGNATURE-----\r?\n?$/.exec(armor);
 yes(!!m,'signature_armor');
 const b64=m[1].replace(/[\r\n]/g,''),b=Buffer.from(b64,'base64');
 yes(b.toString('base64')===b64&&b.subarray(0,6).toString()==='SSHSIG'&&
  b.length>70,'signature_encoding_or_magic');
 yes(b.readUInt32BE(6)===1,'signature_version');
 let i=10;
 const [k,j]=part(b,i,300);i=j;
 const [ns,j2]=part(b,i,100);i=j2;
 const [reserved,j3]=part(b,i,100);i=j3;
 const [hash,j4]=part(b,i,20);i=j4;
 const [sig,j5]=part(b,i,500);i=j5;
 yes(i===b.length&&ns.toString()===PIN.namespace&&
  reserved.length===0&&hash.toString()==='sha512','signature_namespace');
 const [alg,p]=part(sig,0,30),[signature,end]=part(sig,p,80);
 yes(end===sig.length&&alg.toString()==='ssh-ed25519'&&
  signature.length===64,'signature_type');
 return {keyWire:k,signature};
}
function canonicalManifest(bytes,computed){
 yes(Buffer.isBuffer(bytes)&&bytes.length>100&&bytes.length<30000,
  'manifest_size');
 let m;try{m=JSON.parse(bytes.toString('utf8'))}catch{err('manifest_json')}
 yes(bytes.equals(Buffer.from(JSON.stringify(m)+'\n')),
  'manifest_not_canonical');
 const keys=['schema','host','action','operation','source_commit',
  'policy_post_sha256','preimage_sha256','postimage_sha256',
  'asset_sha256','owner_key_fingerprint','created_utc','expires_utc','nonce'];
 yes(Object.keys(m).sort().join('|')===keys.sort().join('|'),
  'manifest_exact_keys');
 yes(m.schema==='prhm.u06.owner-signed-root-bootstrap.v1'&&
  m.host===PIN.host&&m.action===PIN.action&&m.operation===PIN.operation&&
  m.owner_key_fingerprint===PIN.fp&&m.policy_post_sha256===PIN.policy&&
  COMMIT.test(m.source_commit||'')&&HEX.test(m.nonce||''),
  'manifest_scope_drift');
 const start=Date.parse(m.created_utc||''),end=Date.parse(m.expires_utc||'');
 yes(Number.isFinite(start)&&Number.isFinite(end)&&
  end>start&&end-start<=180000&&Date.now()>=start-30000&&
  Date.now()<=end,'manifest_expired');
 yes(computed&&m.source_commit===computed.source_commit&&
  m.policy_post_sha256===computed.policy_post_sha256&&
  JSON.stringify(m.preimage_sha256)===JSON.stringify(computed.preimage_sha256)&&
  JSON.stringify(m.postimage_sha256)===JSON.stringify(computed.postimage_sha256)&&
  JSON.stringify(m.asset_sha256)===JSON.stringify(computed.asset_sha256),
  'signed_manifest_not_reviewed_package');
 for(const o of [m.preimage_sha256,m.postimage_sha256,m.asset_sha256]){
  yes(o&&typeof o==='object'&&!Array.isArray(o)&&
   Object.values(o).every(v=>typeof v==='string'&&HEX.test(v)),
   'hash_closure_invalid');
 }
 return m;
}
function verify({manifestBytes,armor,computed,fixtureAuthorizedKeys}){
 const manifest=canonicalManifest(manifestBytes,computed);
 const key=fixtureAuthorizedKeys?
  parseTrustedAuthorizedKey(fixtureAuthorizedKeys):liveTrustedKey();
 const s=readSSHSig(armor);
 yes(s.keyWire.equals(key.wire),'signature_embedded_public_key_wrong');
 const publicKey=crypto.createPublicKey({key:Buffer.concat([
   Buffer.from('302a300506032b6570032100','hex'),key.pub
 ]),format:'der',type:'spki'});
 const hash=crypto.createHash('sha512').update(manifestBytes).digest();
 const data=Buffer.concat([Buffer.from('SSHSIG'),W(Buffer.from(PIN.namespace)),
   W(Buffer.alloc(0)),W(Buffer.from('sha512')),W(hash)]);
 yes(crypto.verify(null,data,publicKey,s.signature),
  'signature_cryptographic_failure');
 return Object.freeze({
  schema:'prhm.u06.independent-owner-registration-proof.v1',
  independent_owner_ssh_ed25519_verified:true,
  source_commit:manifest.source_commit,nonce:manifest.nonce,
  policy_candidate_sha256:PIN.policy,
  official_level4_already_issued:false,
  runtime_official_level4_still_required:true
 });
}
module.exports=Object.freeze({
 PIN,parseTrustedAuthorizedKey,readSSHSig,canonicalManifest,verify,
 LIVE_INSTALL_EXPORTED:false,NO_APPROVAL_ISSUER:true
});
if(require.main===module){
 process.stderr.write('NO DIRECT ROOT INSTALL: signed owner manifest needed.\n');
 process.exitCode=64;
}
