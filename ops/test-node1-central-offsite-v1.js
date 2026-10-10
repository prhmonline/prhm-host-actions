'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const script=path.join(__dirname,'prhm-node1-central-offsite-v1.sh');
const source=fs.readFileSync(script,'utf8');
const {inspect,C}=require('./node1-central-backup-preflight-v1.js');
function exec(file,args,options={}){
 const r=cp.spawnSync(file,args,{encoding:'utf8',timeout:45000,maxBuffer:100000,...options});
 assert.equal(r.error,undefined,r.error?.message);
 assert.equal(r.status,0,String(r.stderr).slice(-700));
 return r.stdout;
}
test('shell runner parses but has no unapproved installation side effects',()=>{
 exec('/usr/bin/bash',['-n',script]);
 assert.ok(source.includes('sftp:prhm-node1-backup:/repo/central-production'));
 assert.ok(source.includes('RESTIC_PASSWORD_FILE="$PASSFILE"'));
 assert.ok(source.includes('sftp.command=$SFTP_COMMAND'));
 assert.ok(source.includes('--read-data-subset=5%'));
 assert.ok(source.includes('restore "$RESTIC_ID"'));
 assert.ok(source.includes('sha256sum -c SHA256SUMS'));
 for(const absent of ['restic forget',' restic prune','rclone ','ssh root@','ssh -oStrictHostKeyChecking=no','rm -rf /srv','DROP DATABASE','mysql -e']){
  assert.ok(!source.includes(absent),absent);
 }
});
test('preflight is fixed, reports blocked without credentials, and accepts no arbitrary host',()=>{
 const x=inspect(
  ()=>JSON.stringify({status:'pass',snapshot:'20261010T092103Z'}),
  ()=>false,()=>({ok:false,stdout:'',exit:1})
 );
 assert.equal(x.status,'BLOCKED_PROVISIONING');
 assert.equal(x.target,'server1.prhm.ir');
 assert.equal(x.remote_mutation,false);
 assert.equal(x.production_mutation,false);
 assert.ok(x.blockers.includes('node1_restricted_account'));
 assert.equal(C.node1Host,'185.191.76.138');
});
test('synthetic encrypted restic backup, repository check and recovered bytes',()=>{
 const BIN='/var/lib/prhm-central-gdrive-restic/restic-0.19.1';
 if(!fs.existsSync(BIN))return;
 const tmp=fs.mkdtempSync('/var/tmp/prhm-node1-restic-synthetic.');
 try{
  const input=path.join(tmp,'input'),repo=path.join(tmp,'repo'),recovered=path.join(tmp,'restore'),pass=path.join(tmp,'password');
  fs.mkdirSync(input,{mode:0o700});
  const payload=crypto.randomBytes(65536);
  fs.writeFileSync(path.join(input,'payload.bin'),payload);
  fs.writeFileSync(pass,crypto.randomBytes(48).toString('base64')+'\n',{mode:0o600});
  const env={...process.env,RESTIC_REPOSITORY:repo,RESTIC_PASSWORD_FILE:pass,RESTIC_CACHE_DIR:path.join(tmp,'cache')};
  exec(BIN,['init'],{env});
  exec(BIN,['backup','--tag','synthetic-no-production',input],{env});
  exec(BIN,['check','--read-data'],{env});
  exec(BIN,['restore','latest','--target',recovered],{env});
  const recoveredFile=path.join(recovered,input.replace(/^\/+/,''),'payload.bin');
  assert.ok(fs.existsSync(recoveredFile));
  assert.deepEqual(fs.readFileSync(recoveredFile),payload);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
