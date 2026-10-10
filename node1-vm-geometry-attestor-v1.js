'use strict';
// Node1-side zero-input diagnostic receipt candidate, inert until deployed through
// approved Agent 3 SHA-bound Host Action. No key material is stored in Git.
// Never changes VM/disk/database/service state.
const crypto=require('node:crypto'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const api=require('./node1-vm-geometry-agent-api-route-v1');
const registration=require('./node1-vm-geometry-registration-plan-v1');
const transport=require('./node1-vm-geometry-trusted-executor-v1');
const BASE='/opt/prhm-node1-readonly/vm-geometry-v1';
const SIGNING_KEY='/etc/prhm-agent3/keys/node1-readonly-receipts-ed25519.pem';
const PINNED=Object.freeze(registration.FILES.filter(x=>[
 'node1-live-vm-backup-v1.js','node1-vm-geometry-readonly-v1.js','node1-vm-geometry-runner-v1.js'
].includes(x.path)).map(x=>Object.freeze({...x})));
function deny(condition,reason){if(!condition)throw Error(reason)}
function shaGitBlob(bytes){deny(Buffer.isBuffer(bytes),'bytes_missing');return crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')}
function safeOpenRegularRootOwned(file,limit=1048576,secret=false){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const st=fs.fstatSync(fd);
  deny(st.isFile()&&st.uid===0&&(st.mode&0o022)===0&&(!secret||(st.mode&0o077)===0)&&st.size>0&&st.size<=limit,'pinned_file_insecure');
  const data=Buffer.alloc(st.size);let cursor=0;
  while(cursor<st.size){const n=fs.readSync(fd,data,cursor,st.size-cursor,cursor);deny(n>0,'pinned_file_short_read');cursor+=n}
  const after=fs.fstatSync(fd);
  deny(after.dev===st.dev&&after.ino===st.ino&&after.size===st.size&&after.mtimeMs===st.mtimeMs,'pinned_file_changed');
  return data;
 }finally{fs.closeSync(fd)}
}
function runFixed(){
 const file=path.join(BASE,'node1-vm-geometry-runner-v1.js');
 const output=cp.spawnSync(process.execPath,[file,'--readonly'],{
  shell:false,timeout:transport.fixedRequest().timeoutMs,encoding:'utf8',
  maxBuffer:transport.MAX_RESPONSE_BYTES,
  cwd:'/',stdio:['ignore','pipe','pipe'],
  env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LC_ALL:'C'}
 });
 deny(!output.error&&output.status===0&&!output.signal,'readonly_runner_nonzero');
 deny(typeof output.stdout==='string'&&Buffer.byteLength(output.stdout,'utf8')<=transport.MAX_RESPONSE_BYTES,'readonly_runner_output_unbounded');
 return output.stdout;
}
function makeBundle({getPinned,run,loadKey,now,nonce}={}){
 deny(typeof getPinned==='function'&&typeof run==='function'&&typeof loadKey==='function'&&typeof now==='function'&&typeof nonce==='function','trusted_attestor_dependencies_missing');
 // Pin all local VM runner/module source bytes before any subprocess is called.
 for(const file of PINNED){const bytes=getPinned(file.path);deny(Buffer.isBuffer(bytes)&&shaGitBlob(bytes)===file.sha,'node1_runner_source_sha_mismatch:'+file.path)}
 const stdout=run();
 deny(typeof stdout==='string'&&stdout.length>0&&Buffer.byteLength(stdout,'utf8')<=transport.MAX_RESPONSE_BYTES,'attestor_stdout_invalid');
 let result;try{result=JSON.parse(stdout)}catch{throw Error('attestor_stdout_not_json')}
 const clean=api.validateResult(result);
 deny(clean.all_domains_verified===true,'node1_vm_diagnostics_red');
 const time=now();
 deny(typeof time==='number'&&Number.isSafeInteger(time)&&time>0,'attestor_clock_untrusted');
 const nonceValue=nonce();
 deny(typeof nonceValue==='string'&&/^[A-Za-z0-9_-]{22,96}$/.test(nonceValue),'attestor_nonce_invalid');
 const request=transport.fixedRequest();
 const receipt={
  operation:request.operation,host:request.host,
  runnerPath:request.runnerPath,runnerSourceGitBlob:request.runnerSourceGitBlob,
  sourceCommit:request.sourceCommit,argv:['--readonly'],exitCode:0,
  outputSha256:crypto.createHash('sha256').update(stdout).digest('hex'),
  completedUtc:new Date(time).toISOString(),nonce:nonceValue,readOnly:true
 };
 const key=loadKey();
 let privateKey;try{privateKey=crypto.createPrivateKey(key)}catch{throw Error('attestor_private_key_unavailable')}
 deny(privateKey.asymmetricKeyType==='ed25519','attestor_wrong_key_type');
 const signature=crypto.sign(null,Buffer.from(JSON.stringify(receipt)),privateKey).toString('base64');
 transport.receiptBody(receipt);
 return Object.freeze({stdout,receipt:Object.freeze(receipt),signature});
}
function main(args=process.argv.slice(2)){
 deny(Array.isArray(args)&&args.length===1&&args[0]==='--readonly','only_readonly_attestation_supported');
 return makeBundle({
  getPinned(rel){deny(PINNED.some(x=>x.path===rel),'source_not_pinned');return safeOpenRegularRootOwned(path.join(BASE,rel))},
  run:runFixed,
  loadKey(){return safeOpenRegularRootOwned(SIGNING_KEY,16384,true)},
  now:Date.now,nonce:()=>crypto.randomBytes(24).toString('base64url')
 });
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(main())+'\n')}
 catch(e){process.stderr.write(JSON.stringify({ok:false,error:'node1_readonly_attestation_unavailable'})+'\n');process.exitCode=2}
}
module.exports={BASE,SIGNING_KEY,PINNED,shaGitBlob,safeOpenRegularRootOwned,makeBundle,main};
