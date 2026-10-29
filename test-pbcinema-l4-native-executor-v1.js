'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),cp=require('node:child_process');
const n=require('./pbcinema-l4-native-executor-v1');
const c=require('./pbcinema-l4-root-admission-contract-v1');
function receipt(action,patch={}){return{
 action,operation:'host_action.'+action,request_id:'eb875bdd-b6e0-4a86-b12c-fd6f7c741050',
 level:4,risk:'critical',verified_by_trusted_issuer:true,approval_consumed:true,
 universal_git_sha:c.RELEASE.universal_git_sha,disabled_profile_digest:c.RELEASE.disabled_profile_digest,...patch};}
test('fixed effects do not execute during import and are exactly SHA-bound',()=>{
 assert.equal(n.BINDINGS.previous.length,64);
 assert.equal(n.BINDINGS.composed,'81f18650cc674aa95fbd5ef2ee9a4d25fe10bcf3ba668eb9f7e1bd75a6726053');
 assert.equal(n.BINDINGS.repo,'/var/tmp/pbcinema-installer-source-review-20261029');
});
test('L4 executor rejects wrong action, scope, consume state or SHA',()=>{
 for(const action of c.ACTIONS.map(x=>x.action)){
   assert.equal(n.gate(receipt(action),action),true);
   for(const patch of [
     {level:3},{risk:'high'},{approval_consumed:false},{verified_by_trusted_issuer:false},
     {universal_git_sha:'0'.repeat(40)},{disabled_profile_digest:'0'.repeat(64)},
     {request_id:'not-uuid'},{operation:'host_action.generic_shell'}]){
     assert.throws(()=>n.gate(receipt(action,patch),action),/signed_level4_dispatch_missing/);
   }
 }
});
test('private client option format has no generic db or shell options',()=>{
 const pass='A'.repeat(48),text=n.optionFile(pass);
 assert.ok(text.includes('user=pbcinema_universal_backup'));
 assert.ok(text.includes('host=127.0.0.1'));
 assert.ok(text.includes('password='+pass));
 assert.throws(()=>n.optionFile('short'),/secret_format_invalid/);
});
function fixture({failLogin=false,failGrant=false,oldUser=false}={}){
 const log=[],files={},pass=Buffer.alloc(36,42);
 const platform={
   existsSync:p=>Boolean(files[p]),
   mkdirSync:(p)=>{files[p]={kind:'dir'};},
   lstatSync:p=>p.endsWith('/mysql.cnf')?
     {isFile:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o100600}:
     {isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o40700},
   openSync:(p)=>{files[p]={kind:'file'};return p;},
   writeSync:(p,value)=>{files[p].contents=value;},
   fsyncSync:()=>{},closeSync:()=>{},
   unlinkSync:p=>{delete files[p]},
   rmdirSync:p=>{delete files[p]}
 };
 const sql=(text)=>{log.push(text.slice(0,45));if(text.startsWith('SELECT COUNT'))return oldUser?'1':'0';
   if(text.startsWith('GRANT ')&&failGrant)throw Error('forced_grant_failure');
   if(text.startsWith('SHOW GRANTS'))return "GRANT USAGE ON *.* TO 'pbcinema_universal_backup'@'172.17.0.1'\nGRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON \x60cfpark_park_bazar\x60.* TO 'pbcinema_universal_backup'@'172.17.0.1'\n";
   return ''};
 const runner=(bin,args)=>{
   if(args[0]==='inspect'&&args[2].includes('NetworkSettings'))return JSON.stringify({bridge:{Gateway:'172.17.0.1'}});
   if(args[0]==='inspect')return JSON.stringify({'3306/tcp':[{HostIp:'127.0.0.1',HostPort:'3307'}]});
   if(args[0]==='run') {if(failLogin)throw Error('forced_login_failure');return 'pbcinema_universal_backup@172.17.0.1\n';}
   throw Error('unexpected');
 };
 return {platform,sql,runner,random:()=>pass,files,log};
}
test('credential fixture creates exactly one schema-local account and 0600 secret',()=>{
 const f=fixture();
 const r=n.issueCredential(receipt('pbcinema_mysql_backup_credential_issue_v1'),f);
 assert.equal(r.ok,true);assert.equal(r.credential_exposed,false);
 const secret=c.RELEASE.secret_file;
 assert.ok(f.files[secret].contents.includes('password='));
 assert.ok(f.log.some(s=>s.startsWith('GRANT SELECT')));
 assert.ok(f.log.every(s=>!s.includes('ALL PRIVILEGES')));
});
test('existing account fails closed before CREATE',()=>{
 const f=fixture({oldUser:true});
 assert.throws(()=>n.issueCredential(receipt('pbcinema_mysql_backup_credential_issue_v1'),f),/existing_db_account/);
 assert.ok(!f.log.some(s=>s.startsWith('CREATE USER')));
});
test('failed grant drops created user and creates no secret',()=>{
 const f=fixture({failGrant:true});
 assert.throws(()=>n.issueCredential(receipt('pbcinema_mysql_backup_credential_issue_v1'),f),/failed_rolled_back/);
 assert.ok(f.log.some(s=>s.startsWith('DROP USER')));
 assert.equal(f.files[c.RELEASE.secret_file],undefined);
 assert.equal(f.files[c.RELEASE.secret_file.substring(0,c.RELEASE.secret_file.lastIndexOf('/'))],undefined);
});
test('failed login removes secret and drops user',()=>{
 const f=fixture({failLogin:true});
 assert.throws(()=>n.issueCredential(receipt('pbcinema_mysql_backup_credential_issue_v1'),f),/failed_rolled_back/);
 assert.ok(f.log.some(s=>s.startsWith('DROP USER')));
 assert.equal(f.files[c.RELEASE.secret_file],undefined);
 assert.equal(f.files[c.RELEASE.secret_file.substring(0,c.RELEASE.secret_file.lastIndexOf('/'))],undefined);
});
test('upgrade Python source parses but is never executed by this test',()=>{
 const p=cp.spawnSync('/opt/prhm/universal-python/bin/python3',['-c',
   'import ast,sys;ast.parse(sys.stdin.read());print("PY_PARSE_PASS")'],
   {input:n.upgradePython,encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/PY_PARSE_PASS/);
 assert.ok(n.upgradePython.includes('install_bundle('));
 assert.ok(n.upgradePython.includes('fcntl.flock('));
 assert.ok(n.upgradePython.includes('rollback_integrity_failed'));
});
test('the production authorization failure prevents any native mutation',()=>{
 const f=fixture();
 assert.throws(()=>n.issueCredential(receipt('pbcinema_mysql_backup_credential_issue_v1',{approval_consumed:false}),f),/signed_level4_dispatch_missing/);
 assert.deepEqual(f.files,{});
});
