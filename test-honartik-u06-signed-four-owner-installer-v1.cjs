'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Installer=require('./honartik-u06-signed-four-owner-installer-v1.cjs');
const Plan=require('./honartik-u06-real-four-owner-registration-plan-v1.cjs');
const Proof=require('./honartik-u06-owner-signed-bootstrap-proof-v1.cjs');
const Tx=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const source=fs.readFileSync(require.resolve('./honartik-u06-signed-four-owner-installer-v1.cjs'),'utf8');

test('only exact four Root files, fifteen native assets and fixed five systemd units',()=>{
 assert.equal(Installer.FIXED.host,'prhm-production.prhm.ir');
 assert.equal(Installer.FIXED.ownerPaths,Plan.TARGET);
 assert.equal(Plan.ASSET_NAMES.length,15);
 assert.equal(Installer.FIXED.action,'honartik_u06_native_backup_register_v1');
 assert.equal(Installer.FIXED.policyAfter,
   'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934');
 assert.equal(Installer.FIXED.namespace,Proof.PIN.namespace);
 assert.deepEqual(Object.keys(Installer.FIXED.ownerPaths),['base','executor','mcp','policy']);
 assert.equal(Installer.AUTO_APPLY,false);
 assert.equal(Installer.NO_LEVEL4_ISSUER,true);
 assert.equal(Installer.install,undefined);
 assert.equal(Installer.execute,undefined);
 assert.equal(typeof Installer.review,'function');
 assert.equal(typeof Installer.generateFreshOwnerSigningRequest,'function');
 assert.equal(typeof Installer.applyOwnerSigned,'function');
 assert.equal(typeof Installer.recoverInterruptedInstall,'function');
 assert.equal(typeof Tx.executeCore,'function');
 assert.equal(typeof Tx.recoverAfterCrash,'function');
});

test('unsigned or forged approval cannot invoke a live installer on unprivileged CI',async()=>{
 if(process.getuid()!==0){
  assert.throws(()=>Installer.review({sourceCommit:'a'.repeat(40),stagedPath:'/tmp'}),
   /root_host_required/);
  await assert.rejects(()=>Installer.applyOwnerSigned({
   sourceCommit:'a'.repeat(40),stagedPath:'/tmp',manifestBytes:Buffer.alloc(512),
   signatureArmor:'fake'
  }),/root_host_required/);
 }
 assert.match(source,/Proof\.verify\(\{manifestBytes,armor:signatureArmor/);
 assert.match(source,/evidence\.independent_owner_ssh_ed25519_verified===true/);
 assert.match(source,/evidence\.runtime_official_level4_still_required===true/);
 assert.match(source,/createPrivateWorkRootAfterSignature\(\)/);
 assert.match(source,/burnNonce\(m\.nonce\)/);
 const verify=source.indexOf('const evidence=Proof.verify(');
 const mkdir=source.indexOf('createPrivateWorkRootAfterSignature();');
 const burn=source.indexOf('burnNonce(m.nonce);');
 const tx=source.indexOf('Tx.executeCore(plan,');
 assert.ok(verify>=0&&mkdir>verify&&burn>mkdir&&tx>burn);
 assert.match(source,/fs\.constants\.O_EXCL\|fs\.constants\.O_NOFOLLOW/);
 assert.match(source,/fs\.fsyncSync\(fd\)/);
 assert.match(source,/Tx\.assertNoPendingTransactions\(WORK_ROOT\)/);
 assert.match(source,/Tx\.verifyAssetPreimages\(plan\.assets\)/);
});
test('restart and recovery are hard bound to known services and exact Root owner postimage',()=>{
 assert.match(source,/prhm-company-approval\.service/);
 assert.match(source,/prhm-agent-selfmaint-exec\.service/);
 assert.match(source,/prhm-agent-selfmaint\.service/);
 assert.match(source,/prhm-agent-mcp-blue\.service/);
 assert.match(source,/prhm-agent-mcp-green\.service/);
 assert.match(source,/UNIT\.includes\(unit\)/);
 assert.match(source,/attestRegistration\(/);
 assert.match(source,/Tx\.recoverAfterCrash\(/);
 assert.match(source,/expectedTargets:Object\.values\(Plan\.TARGET\)/);
 assert.match(source,/expectedAssets:Plan\.ASSET_NAMES\.map/);
 assert.ok(!source.includes('child_process.execSync'));
 assert.ok(!source.includes('sudo '));
 assert.ok(!source.includes('eval('));
 assert.ok(!source.includes('process.argv[2]'));
});
