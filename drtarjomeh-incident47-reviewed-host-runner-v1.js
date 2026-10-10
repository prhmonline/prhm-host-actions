'use strict';
// Incident #47 privileged fixed runner, for *trusted consumed* Host Actions v2
// dispatch only. This file is never invoked by CLI and never accepts caller args.
// No installer/registration is provided in this source file.
const cp=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs');

const ACTION='drtarjomeh_incident47_uploads_guard_install_v1';
const SITE='drtarjomeh.ir';
const APP_REPO='/home/drtarjomeh/domains/drtarjomeh.ir/repository';
const APP_SHA='c1e03335f5b9c963672af1050089d8e197a729ef';
const SCRIPT=APP_REPO+'/ops/security-cutover/incident47-host-guard-v1.py';
const POLICY=APP_REPO+'/ops/security-cutover/apache-wp-uploads-exec-deny-v1.conf';
const SHA_RE=/^[0-9a-f]{40}$/;
function fail(code){throw new Error(code);}
function run(bin,args,options={}){
  const p=cp.spawnSync(bin,args,{encoding:'utf8',timeout:options.timeout||20000,
    maxBuffer:65536,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME:'/nonexistent',LC_ALL:'C'}});
  if(p.error||p.status!==0)fail('fixed_runner_command_failed:'+String(p.error?.code||p.status));
  return String(p.stdout||'').trim();
}
function inspectPrerequisites(deps={readFile:p=>fs.readFileSync(p),cmd:run}){
  if(!SHA_RE.test(APP_SHA))fail('invalid_pinned_app_sha');
  if(deps.cmd('/usr/bin/git',['-c','safe.directory='+APP_REPO,'-C',APP_REPO,'rev-parse','HEAD'])!==APP_SHA)
    fail('application_head_sha_changed');
  if(deps.cmd('/usr/bin/git',['-c','safe.directory='+APP_REPO,'-C',APP_REPO,'status','--porcelain','--untracked-files=no']))
    fail('application_worktree_dirty');
  const a=deps.readFile(SCRIPT);
  const p=deps.readFile(POLICY);
  if(!Buffer.isBuffer(a)||!Buffer.isBuffer(p)||!a.length||!p.length)
    fail('source_bytes_invalid');
  const gitblob=b=>crypto.createHash('sha1').update(Buffer.concat([
    Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
  if(gitblob(a)!=='4f532f6a1b58d80d4010002b954fe13eaaecb420')
    fail('application_script_blob_changed');
  if(gitblob(p)!=='5adb676a1f9b7e3aa295f469a39071cfc1d1a6f5')
    fail('application_policy_blob_changed');
  return Object.freeze({source_sha:APP_SHA,source_repo:APP_REPO,
     script:SCRIPT,policy:POLICY,action:ACTION,source_verified:true});
}
// This code is a *constant*, not constructed from user parameters.
const INVOKE_PYTHON=String.raw`import hashlib,json,os,stat,types
p='/home/drtarjomeh/domains/drtarjomeh.ir/repository/ops/security-cutover/incident47-host-guard-v1.py'
source_blob='4f532f6a1b58d80d4010002b954fe13eaaecb420'
policy_blob='5adb676a1f9b7e3aa295f469a39071cfc1d1a6f5'
def gitblob(payload):
    return hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\0'+payload).hexdigest()
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
try:
    st=os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_size<100 or st.st_size>1000000:
        raise RuntimeError('reviewed_python_source_not_regular')
    source=b''
    while len(source)<=st.st_size:
        part=os.read(fd,min(65536,st.st_size-len(source)+1))
        if not part:break
        source+=part
    if len(source)!=st.st_size or gitblob(source)!=source_blob:
        raise RuntimeError('reviewed_python_source_changed')
finally:
    os.close(fd)
m=types.ModuleType('i47_reviewed_host_guard')
m.__file__=p
exec(compile(source,p,'exec'),m.__dict__)
reviewed_read=m.read_exact_regular
def verified_read(path):
    body,metadata=reviewed_read(path)
    if path==m.POLICY and gitblob(body)!=policy_blob:
        raise RuntimeError('reviewed_apache_policy_changed')
    return body,metadata
m.read_exact_regular=verified_read
policy,evidence=m.preflight('c1e03335f5b9c963672af1050089d8e197a729ef')
result=m.install_guard(policy,'c1e03335f5b9c963672af1050089d8e197a729ef',evidence)
print(json.dumps({'schema_version':'prhm.host-action-result.v1',
 'action':'drtarjomeh_incident47_uploads_guard_install_v1',
 'source_sha':result['source_sha'], 'status':result['status'],
 'target':result['destination'], 'evidence_count':len(result['evidence']),
 'rollback_performed':False,'database_mutation':False,
 'provider_credential_rotation':False}))
`;
function runAfterTrustedApproval(deps={readFile:p=>fs.readFileSync(p),cmd:run}){
  // MUST be called only by Host Actions v2 after its server-side
  // confirm + authorize-consume path. Not an authentication primitive.
  inspectPrerequisites(deps);
  const raw=deps.cmd('/usr/bin/python3',['-c',INVOKE_PYTHON],{timeout:180000});
  let out;try{out=JSON.parse(raw);}catch{fail('runner_result_invalid_json');}
  if(out.schema_version!=='prhm.host-action-result.v1'||out.action!==ACTION||
      out.source_sha!==APP_SHA||out.status!=='GUARD_APPLIED_AND_NEGATIVE_TEST_PASS'||
      out.rollback_performed!==false||out.database_mutation!==false||
      out.provider_credential_rotation!==false||out.evidence_count!==12)
    fail('runner_result_contract_invalid');
  return Object.freeze({ok:true,...out});
}
module.exports=Object.freeze({ACTION,APP_SHA,APP_REPO,SCRIPT,POLICY,
  inspectPrerequisites,runAfterTrustedApproval,INVOKE_PYTHON});
if(require.main===module){process.stderr.write('No CLI: trusted signed Host Actions v2 dispatcher only.\n');process.exitCode=64;}
