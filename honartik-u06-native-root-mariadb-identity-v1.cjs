'use strict';
// A fixed, non-CLI U06 production DB identity component.
// The Root handler must first verify and consume official L4 approval and
// fsync the one-use fence via the native trust module. No arbitrary SQL,
// account, path, command, image or host are accepted from the caller.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cp=require('node:child_process'),crypto=require('node:crypto');
const Trust=require('./honartik-u06-native-root-l4-admission-v1.cjs');
const P=Object.freeze({
 host:'prhm-production.prhm.ir',container:'prhm-mariadb',
 image:'sha256:27e8ebbe7dde20c1ec66c864629109cfcad003843315929ee25b262bc11fbef3',
 network:'host',database:'honartik_db',account:'honartik_universal_backup',
 account_host:'127.0.0.1',
 credential:'/etc/deploy-control/secrets/honartik_back/mysql.cnf',
 profile:'/etc/deploy-control/projects/honartik_back.production.json',
 profile_sha:'79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698',
 adapter:'/usr/local/libexec/deploy-control/universal/current/universal/adapters/database.py',
 adapter_sha:'d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3'
});
const SQL_ADMIN=[
 'set -eu',
 'pw="$(printenv MARIADB_ROOT_PASSWORD 2>/dev/null || true)"',
 'if [ -z "$pw" ]; then pw="$(printenv MYSQL_ROOT_PASSWORD 2>/dev/null || true)"; fi',
 'if [ -z "$pw" ]; then for f in /run/secrets/mysql_root_password /run/secrets/mariadb_root_password /run/secrets/db_root_password; do if [ -r "$f" ]; then pw="$(cat "$f")"; break; fi; done; fi',
 'if [ -n "$pw" ]; then export MYSQL_PWD="$pw"; fi',
 'exec mariadb -uroot -N -B --batch'
].join('\n');
const Q="'honartik_universal_backup'@'127.0.0.1'";
const HEX_USER='0x686f6e617274696b5f756e6976657273616c5f6261636b7570';
const HEX_HOST='0x3132372e302e302e31';
const HEX_DB='0x686f6e617274696b5f6462';
const H=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=x=>{throw Error('u06_mariadb_native_'+x)};
const must=(x,e)=>{if(!x)fail(e)};
function ownedPinned(file,sha){
 const a=fs.lstatSync(file);must(a.isFile()&&!a.isSymbolicLink()&&
 a.uid===0&&a.gid===0&&a.nlink===1&&(a.mode&0o022)===0,'owner');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const b=fs.fstatSync(fd);must(a.dev===b.dev&&a.ino===b.ino&&a.size===b.size,'race');
 must(H(fs.readFileSync(fd))===sha,'preimage_sha');}finally{fs.closeSync(fd)}
}
function fileAbsent(file){
 try{fs.lstatSync(file);return false}
 catch(e){if(e.code==='ENOENT')return true;throw e}
}
function assertDirectory(){
 const s=fs.lstatSync(path.dirname(P.credential));
 must(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&s.gid===0&&
  (s.mode&0o777)===0o700,'credential_dir_not_private');
}
function docker(args,input){
 const r=cp.spawnSync('/usr/bin/docker',args,{
  input,encoding:'utf8',timeout:20000,maxBuffer:131072,
  stdio:['pipe','pipe','pipe']});
 // NEVER include stderr, SQL or env in an error or job report.
 must(!r.error&&!r.signal&&r.status===0,'docker_fixed_operation_failed');
 return r.stdout.trim();
}
function sql(statement){
 must(typeof statement==='string'&&statement.length<=2048&&
  !/[\0\r]/.test(statement),'query_shape');
 return docker(['exec','-i',P.container,'sh','-lc',SQL_ADMIN],statement+'\n');
}
function preflight(){
 must(process.getuid?.()===0&&os.hostname()===P.host,'root_host');
 ownedPinned(P.profile,P.profile_sha);ownedPinned(P.adapter,P.adapter_sha);
 assertDirectory();
 must(docker(['inspect',P.container,'--format',
  '{{.Image}}|{{.HostConfig.NetworkMode}}'])===P.image+'|'+P.network,'docker_drift');
 const q='SELECT @@version; SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='+HEX_DB+
  ' AND table_type=0x42415345205441424c45;'+
  'SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema='+HEX_DB+';'+
  'SELECT COUNT(*) FROM mysql.user WHERE User='+HEX_USER+' AND Host='+HEX_HOST+';';
 const rows=sql(q).split(/\r?\n/);
 must(rows.length===4&&rows[0].startsWith('10.6.')&&rows[1]==='69'&&
  rows[2]==='49','live_schema_or_version_drift');
 must(rows[3]==='0'&&fileAbsent(P.credential),'backup_identity_preexisting');
 return Object.freeze({db_version:rows[0],tables:69,foreign_keys:49,
  user_absent:true,credential_absent:true});
}
function grantsExact(){
 const rows=sql('SHOW GRANTS FOR '+Q+';').split(/\r?\n/);
 must(rows.length===2,'wrong_grant_count');
 const exact=['EVENT','SELECT','SHOW VIEW','TRIGGER'].sort().join(',');
 let g=0,d=0;
 for(const row of rows){
  const m=/^GRANT ([A-Z ,]+) ON (.*?) TO /i.exec(row);
  must(!!m&&!/WITH GRANT OPTION/i.test(row),'grant_untrusted');
  const kind=m[1].split(',').map(x=>x.trim().toUpperCase()).sort().join(',');
  if(m[2]==='*.*'&&kind==='USAGE')g++;
  else if((m[2]==='honartik_db.*'||
    m[2]===String.fromCharCode(96)+'honartik_db'+String.fromCharCode(96)+'.*')&&
    kind===exact)d++;
  else fail('unexpected_privilege_or_scope');
 }
 must(g===1&&d===1,'missing_exact_grants');
}
function credential(password){
 must(/^[a-zA-Z0-9_-]{64}$/.test(password)&&fileAbsent(P.credential),
  'credential_creation_precondition');
 const fd=fs.openSync(P.credential,fs.constants.O_WRONLY|fs.constants.O_EXCL|
  fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
 try{const x=fs.fstatSync(fd);must(x.uid===0&&(x.mode&0o777)===0o600,'mode');
 fs.writeFileSync(fd,'[client]\nuser='+P.account+'\npassword='+password+
  '\nhost=127.0.0.1\nport=3306\nprotocol=tcp\n');fs.fsyncSync(fd);}
 finally{fs.closeSync(fd)}
 const dir=fs.openSync(path.dirname(P.credential),fs.constants.O_RDONLY|
  fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
}
function verifyClient(){
 const r=cp.spawnSync('/usr/bin/mysql',[
  '--defaults-extra-file='+P.credential,'--host=127.0.0.1','--port=3306',
  '--batch','--skip-column-names','--execute=SELECT 1'
 ],{encoding:'utf8',timeout:12000,maxBuffer:8192,stdio:['ignore','pipe','pipe']});
 must(!r.error&&r.status===0&&r.stdout.trim()==='1','client_tcp_login_failed');
}
function provisionAfterOfficialL4(){
 preflight();
 const password=crypto.randomBytes(48).toString('base64url');
 must(password.length===64,'entropy');
 let created=false;
 try{
  sql('CREATE USER '+Q+" IDENTIFIED BY '"+password+"';");created=true;
  sql('GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON honartik_db.* TO '+Q+';');
  grantsExact();credential(password);verifyClient();
  return Object.freeze({schema:'prhm.u06.native-mariadb-identity.v1',
   account:P.account,host:P.account_host,database:P.database,
   grants_exact:true,private_credential_fsynced:true,
   tcp_login_verified:true,secret_exposed:false});
 }catch(e){
  // Only rollback after a CONFIRMED successful CREATE; ambiguous CREATE
  // keeps the durable outer journal/lease for root-level reconciliation.
  if(created){
   let ok=false;
   try{
    if(!fileAbsent(P.credential)){
     const s=fs.lstatSync(P.credential);
     must(s.isFile()&&!s.isSymbolicLink()&&s.uid===0&&
      (s.mode&0o777)===0o600,'rollback_file_untrusted');
     fs.unlinkSync(P.credential);
    }
    sql('DROP USER '+Q+';');
    ok=sql('SELECT COUNT(*) FROM mysql.user WHERE User='+HEX_USER+
      ' AND Host='+HEX_HOST+';')==='0';
   }catch{}
   if(!ok)fail('CRITICAL_ROLLBACK_UNVERIFIED_RETAIN_JOURNAL');
  }
  fail(created?'provision_reverted':'CRITICAL_CREATE_AMBIGUOUS_RETAIN_JOURNAL');
 }
}
function createLiveBoundProvider(requestId,loadSealedToken){
 const t=Trust.createLiveRootL4Callbacks(requestId,loadSealedToken);
 let proof=null,armed=null;
 return Object.freeze({
  readOnlyPreflight:preflight,
  verifyNativeConsumedSignedLevel4(F,journal){
   proof=t.verifyNativeConsumedSignedLevel4(F,journal);return proof;
  },
  reserveNativeLevel4ReplayFence(F,journal,approval){
   must(proof!==null&&proof===approval,'receipt_not_verified');
   must(t.reserveNativeLevel4ReplayFence(F,journal,approval)===true,'fence_not_durable');
   armed=journal.id;proof=null;return true;
  },
  provisionBackupOnlyIdentityAndPrivateCredential(F,journal){
   must(armed!==null&&journal&&journal.id===armed&&F&&
    F.operation==='honartik_back.production.native_backup',
    'approval_and_journal_required');
   armed=null;return provisionAfterOfficialL4();
  }
 });
}
module.exports=Object.freeze({
 P,createLiveBoundProvider,
 ROOT_ACTION_REGISTERED:false,DIRECT_APPLY_EXPORTED:false,
 PRODUCTION_IDENTITY_CREATED:false
});
