'use strict';
/* Fixed native PBCinema effects. Never executes at import; must be invoked
   ONLY by existing Host Action v2 executor AFTER signed approval consumption.
   Not a standalone installer, request issuer or elevated shell. */
const fs=require('node:fs'),cp=require('node:child_process');
const path=require('node:path'),crypto=require('node:crypto');
const trust=require('./pbcinema-l4-root-admission-contract-v1');
const BINDINGS=Object.freeze({
 previous:'47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181',
 manifest:'7aff8e76572fabcc558e046e687e0720aa234720e25713e262796804df714352',
 composed:'81f18650cc674aa95fbd5ef2ee9a4d25fe10bcf3ba668eb9f7e1bd75a6726053',
 repo:'/var/tmp/pbcinema-installer-source-review-20261029',
 overlay:'assets/universal-yii-rabint-20261022/universal',
 prefix:'/usr/local/libexec/deploy-control/universal',
 container:'cfpark-park-db',gateway:'172.17.0.1',
 image:'mariadb@sha256:114d40be36852d0a019afd8458f7e1cc63fd300403b115b1f32e31130d5f671b',
 python:'/opt/prhm/universal-python/bin/python3'
});
function deny(code){throw Error('pbcinema_l4_refused:'+code);}
function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
function run(file,args,opts={}) {
 const p=cp.spawnSync(file,args,{encoding:'utf8',timeout:180000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe'],...opts});
 if(p.error||p.status!==0)deny('fixed_command_failed');
 return p.stdout;
}
function gate(receipt,action) {
 if(!receipt||receipt.action!==action||receipt.operation!=='host_action.'+action||
   receipt.level!==4||receipt.risk!=='critical'||receipt.verified_by_trusted_issuer!==true||
   receipt.approval_consumed!==true||receipt.universal_git_sha!==trust.RELEASE.universal_git_sha||
   receipt.disabled_profile_digest!==trust.RELEASE.disabled_profile_digest||
   !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(receipt.request_id||'')))
   deny('signed_level4_dispatch_missing');
 // The existing issuer/executor MUST verify signature, expiry, replay and actual
 // one-time consumption before constructing receipt. Never deserialize from HTTP.
 return true;
}
function root(){if(process.getuid()!==0)deny('root_required');}
function rootSql(sql,runner=run){
 return runner('/usr/bin/docker',['exec','-i',BINDINGS.container,'sh','-c',
   'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot --batch --skip-column-names'],{input:sql});
}
function endpoint(runner=run) {
 const net=JSON.parse(runner('/usr/bin/docker',['inspect','--format','{{json .NetworkSettings.Networks}}',BINDINGS.container]));
 const ports=JSON.parse(runner('/usr/bin/docker',['inspect','--format','{{json .HostConfig.PortBindings}}',BINDINGS.container]));
 if(net.bridge?.Gateway!==BINDINGS.gateway||
    !Array.isArray(ports['3306/tcp'])||ports['3306/tcp'].length!==1||
    ports['3306/tcp'][0].HostIp!=='127.0.0.1'||ports['3306/tcp'][0].HostPort!=='3307')deny('db_network_drift');
}
function optionFile(pass){
 if(!/^[a-zA-Z0-9_-]{48}$/.test(pass))deny('secret_format_invalid');
 return '[client]\nuser='+trust.RELEASE.db_user+'\npassword='+pass+'\nhost=127.0.0.1\nport=3307\nprotocol=tcp\n';
}
function issueCredential(receipt,{runner=run,sql=rootSql,platform=fs,random=crypto.randomBytes}={}){
 gate(receipt,'pbcinema_mysql_backup_credential_issue_v1');root();endpoint(runner);
 const secret=trust.RELEASE.secret_file,dir=path.dirname(secret),user=trust.RELEASE.db_user;
 const account="'"+user+"'@'"+BINDINGS.gateway+"'";
 if(platform.existsSync(secret)||platform.existsSync(dir))deny('existing_secret_path_requires_reconciliation');
 if(sql("SELECT COUNT(*) FROM mysql.user WHERE User='"+user+"' AND Host='"+BINDINGS.gateway+"';",runner).trim()!=='0')deny('existing_db_account');
 const password=random(36).toString('base64url');const client=optionFile(password);
 let created=false,hasFile=false;
 try {
   sql('CREATE USER '+account+" IDENTIFIED BY '"+password+"';",runner);created=true;
   sql('GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON \x60cfpark_park_bazar\x60.* TO '+account+';',runner);
   const grants=sql('SHOW GRANTS FOR '+account+';',runner).split(/\r?\n/).filter(Boolean);
   if(grants.length!==2||!grants.some(s=>s.includes('USAGE ON *.*'))||
      !grants.some(s=>s.includes('cfpark_park_bazar')&&['SELECT','SHOW VIEW','TRIGGER','EVENT'].every(x=>s.includes(x)))||
      grants.some(s=>/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|SUPER|FILE|ALL PRIVILEGES)\b/i.test(s)))deny('grant_scope_drift');
   platform.mkdirSync(dir,{mode:0o700});
   const st=platform.lstatSync(dir);
   if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o777)!==0o700)deny('secret_dir_unsafe');
   const fd=platform.openSync(secret,'wx',0o600);
   try{platform.writeSync(fd,client);platform.fsyncSync(fd);}
   finally{platform.closeSync(fd);} hasFile=true;
   const f=platform.lstatSync(secret);
   if(!f.isFile()||f.isSymbolicLink()||f.uid!==0||(f.mode&0o777)!==0o600)deny('secret_mode_unsafe');
   const test=runner('/usr/bin/docker',['run','--rm','--network','host','-v',secret+':/run/mysql.cnf:ro',
     BINDINGS.image,'mariadb','--defaults-extra-file=/run/mysql.cnf','--batch',
     '--skip-column-names','-e','SELECT CURRENT_USER()']);
   if(!test.includes(user+'@'))deny('credential_login_failed');
   return {ok:true,action:receipt.action,request_id:receipt.request_id,credential_exposed:false,
      grant_scope_verified:true,secret_path:secret,rollback_performed:false};
 } catch(error) {
   let failed=false;
   if(hasFile)try{platform.unlinkSync(secret)}catch{failed=true}
   if(created)try{sql('DROP USER '+account+';',runner)}catch{failed=true}
   if(failed)deny('rollback_integrity_failed');
   deny('credential_issuance_failed_rolled_back');
 }
}
const upgradePython=[
  'import sys,os,json,hashlib,uuid,fcntl',
  'from pathlib import Path',
  "prefix=Path('/usr/local/libexec/deploy-control/universal')",
  'sys.path.insert(0,sys.argv[1])',
  'from universal.install import install_bundle,bundle_digest',
  'from universal.io import atomic_write',
  'source=Path(sys.argv[1]);expected=sys.argv[2];previous=sys.argv[3];manifest_sha=sys.argv[4]',
  "pointer=prefix/'current';manifest=prefix/'installation.json';wrapper=prefix/'deploy-project'",
  'old=pointer.resolve(strict=True);original_manifest=manifest.read_bytes();original_wrapper=wrapper.read_bytes()',
  "if old.name!=previous or hashlib.sha256(original_manifest).hexdigest()!=manifest_sha:raise ValueError('preimage_drift')",
  "if bundle_digest(source)!=expected:raise ValueError('bundle_digest_drift')",
  "with open(prefix/'engine-upgrade-20261022.lock','a+b') as lock:",
  ' fcntl.flock(lock.fileno(),fcntl.LOCK_EX)',
  ' try:',
  '  install_bundle(source,prefix,expected,previous,expected_current_content=previous,expected_manifest_sha256=manifest_sha)',
  "  if pointer.resolve(strict=True).name!=expected:raise ValueError('promotion_result_drift')",
  ' except Exception:',
  "  tmp=prefix/('.rollback-pbcinema-'+uuid.uuid4().hex)",
  '  tmp.symlink_to(old);os.replace(tmp,pointer)',
  '  atomic_write(wrapper,original_wrapper,0o755)',
  '  atomic_write(manifest,original_manifest,0o600)',
  "  if pointer.resolve(strict=True)!=old or hashlib.sha256(manifest.read_bytes()).hexdigest()!=manifest_sha:raise RuntimeError('rollback_integrity_failed')",
  '  raise',
  "print(json.dumps({'ok':True,'installed':expected,'previous':previous}))"
].join('\n');
function upgradeInstaller(receipt,{runner=run,platform=fs}={}){
 gate(receipt,'pbcinema_universal_installer_upgrade_v1');root();
 const dir=BINDINGS.prefix;
 if(path.basename(platform.realpathSync(dir+'/current'))!==BINDINGS.previous||
    sha(platform.readFileSync(dir+'/installation.json'))!==BINDINGS.manifest)deny('old_engine_drift');
 const t=platform.mkdtempSync('/var/tmp/pbcinema-reviewed-universal-');
 try {
   const source=t+'/bundle';
   platform.mkdirSync(source,{mode:0o700});
   platform.cpSync(dir+'/current/universal',source+'/universal',{recursive:true,force:false});
   const archive=runner('/usr/bin/git',['-C',BINDINGS.repo,'archive',
       trust.RELEASE.universal_git_sha,BINDINGS.overlay],{encoding:null,maxBuffer:8*1024*1024});
   runner('/usr/bin/tar',['-xf','-','-C',t],{input:archive,encoding:null});
   platform.cpSync(t+'/'+BINDINGS.overlay,source+'/universal',{recursive:true,force:true});
   const out=runner(BINDINGS.python,['-c',upgradePython,source,BINDINGS.composed,BINDINGS.previous,BINDINGS.manifest]);
   const evidence=JSON.parse(out.trim().split('\n').at(-1));
   if(evidence.ok!==true||evidence.installed!==BINDINGS.composed)deny('upgrade_result_invalid');
   return {ok:true,action:receipt.action,request_id:receipt.request_id,
     installed_digest:evidence.installed,previous_digest:BINDINGS.previous,application_cutover:false};
 }finally{platform.rmSync(t,{recursive:true,force:true});}
}
module.exports={BINDINGS,gate,optionFile,endpoint,upgradePython,issueCredential,upgradeInstaller};
