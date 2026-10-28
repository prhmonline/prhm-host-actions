/* SOURCE-ONLY: Honartik Issue #217 registration transaction review port from #221 exact 6effffd41c68f51bc394d42d7f334f23284dafb0. Not a registered Root-of-Trust action, L4 approval issuer, standalone CLI, or Production deployment. Independent reviewer must verify fixed owner/policy/asset target binding before any activation. */
'use strict';
// Called only by the isolated Linux crash-recovery test.
// No production paths or approvals; disposable /tmp fixture only.
const fs=require('node:fs');
const path=require('node:path');
const tx=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const base=process.argv[2];
const includeAsset=process.argv[3]==='asset';
if((process.argv.length!==3&&!(process.argv.length===4&&includeAsset))||
   !base?.includes('prhm-reg-linux-')||
   fs.realpathSync(base)!==base||!fs.statSync(base).isDirectory()){
 process.stderr.write('isolated_fixture_required\n');process.exit(77);
}
const steps=tx.KEYS.map(key=>{
 const p=path.join(base,key+'.js');
 const before=fs.readFileSync(p);
 const nextBytes=Buffer.from('verified-fake-fixture-after-'+key+'\n');
 return {key,path:p,beforeSha:tx.HASH(before),
  afterSha:tx.HASH(nextBytes),nextBytes};
});
const assets=includeAsset?(()=>{
 const p=path.join(base,'asset-dir','verified-action.cjs');
 const nextBytes=Buffer.from('new-verified-action-asset\\n');
 return [{path:p,nextBytes,afterSha:tx.HASH(nextBytes)}];
})():[];
const plan={schema:'prhm.registrar.native-transaction.v1',steps,assets,
 sourceCommit:'a'.repeat(40),manifestSha256:'b'.repeat(64)};
tx.executeCore(plan,{workRoot:path.join(base,'journal'),
 postInstall:async()=>true,postRollback:async()=>true,
 onRenamed:(key,i)=>{if((!includeAsset&&i===0)||
     (includeAsset&&key==='asset-0'))process.kill(process.pid,'SIGKILL')}
}).then(()=>process.exit(3),e=>{process.stderr.write(String(e));process.exit(4)});
