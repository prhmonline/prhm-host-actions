#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const base=require('./control-center-install-v1.js');

const {constants}=base;

function fail(message){throw new Error(message);}
function run(file,args=[],options={}){return cp.execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:options.timeout||180000,cwd:options.cwd,env:options.env||process.env}).trim();}
function runBuffer(file,args=[],options={}){return cp.execFileSync(file,args,{encoding:null,stdio:['ignore','pipe','pipe'],timeout:options.timeout||180000,cwd:options.cwd,env:options.env||process.env});}
function mkdirp(dir,mode=0o750){fs.mkdirSync(dir,{recursive:true,mode});}
function timestamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function safeValue(value,label){const v=String(value??'');if(!v||/[\r\n]/.test(v))fail(`invalid_${label}`);return v;}
function makePassword(){return `${crypto.randomBytes(18).toString('base64url')}!Aa9`;}
function makeSecret(){return crypto.randomBytes(36).toString('base64url');}

function patchAdminLoginRoute(source){
  source=String(source);
  if(source.includes('control_center_assertion'))return source;
  const gate='  if (!isSafeMutationOrigin(request)) {';
  const gateCount=source.split(gate).length-1;
  if(gateCount!==1)fail(`admin_login_gate_anchor_${gateCount}`);
  source=source.replace(gate,`  const controlCenterEmbedOrigin = process.env.CONTROL_CENTER_EMBED_ORIGIN ?? "https://agent.prhm.ir";\n  const isControlCenterOrigin = request.headers.get("origin") === controlCenterEmbedOrigin;\n  if (!isSafeMutationOrigin(request) && !isControlCenterOrigin) {`);
  const anchor='  const body = await request.text();';
  const count=source.split(anchor).length-1;
  if(count!==1)fail(`admin_login_body_anchor_${count}`);
  const block=`  const body = await request.text();

  const form = new URLSearchParams(body);
  const controlCenterAssertion = form.get("control_center_assertion");
  if (controlCenterAssertion) {
    if (!isControlCenterOrigin) {
      return NextResponse.json({ message: "Invalid Control Center origin." }, { status: 403 });
    }
    let ssoUpstream: Response;
    try {
      ssoUpstream = await fetch(
        \`${'${apiBaseUrl()}'}/api/admin/control-center-sso\`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ assertion: controlCenterAssertion }),
          cache: "no-store",
        },
      );
    } catch {
      return NextResponse.json({ message: "Config Center API is unavailable." }, { status: 502 });
    }
    const ssoPayload = (await ssoUpstream.json().catch(() => ({ message: "Invalid response from API." }))) as LoginPayload;
    if (!ssoUpstream.ok || typeof ssoPayload.token !== "string") {
      return NextResponse.json(ssoPayload, { status: ssoUpstream.ok ? 502 : ssoUpstream.status });
    }
    const response = NextResponse.redirect(new URL(form.get("return_to") || "/", request.url), 303);
    response.cookies.set("cc_admin_token", ssoPayload.token, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  }`;
  return source.replace(anchor,block);
}

function atomicReplacePreservingMetadata(file,data,fallbackMode=0o640){
  mkdirp(path.dirname(file));
  let meta=null;
  try{const st=fs.statSync(file);meta={mode:st.mode&0o777,uid:st.uid,gid:st.gid};}catch{}
  const tmp=`${file}.cc-${process.pid}-${Date.now()}.tmp`;
  const mode=meta?meta.mode:fallbackMode;
  fs.writeFileSync(tmp,data,{flag:'wx',mode});
  fs.chmodSync(tmp,mode);
  if(meta){try{fs.chownSync(tmp,meta.uid,meta.gid);}catch(error){try{fs.unlinkSync(tmp);}catch{}throw error;}}
  fs.renameSync(tmp,file);
}

function gitHasCommit(){try{run('/usr/bin/git',['-C',constants.SOURCE_REPO,'cat-file','-e',`${constants.CONTROL_PLANE_SHA}^{commit}`],{timeout:30000});return true;}catch{return false;}}
function ensureSourceCommit(){if(gitHasCommit())return;run('/usr/bin/git',base.sourceFetchArgs(),{timeout:120000});if(!gitHasCommit())fail('reviewed_source_commit_unavailable');}
function readSourceFile(rel){ensureSourceCommit();return runBuffer('/usr/bin/git',base.sourceGitShowArgs(rel),{timeout:30000});}
function runAsPrhm(file,args,cwd,timeout=600000){return run('/usr/sbin/runuser',['-u','prhm','--',file,...args],{cwd,timeout});}
function loopbackStatus(url){return Number(run('/usr/bin/curl',['-sS','-o','/dev/null','-w','%{http_code}','--max-time','10',url]));}
function localTlsStatus(url){return Number(run('/usr/bin/curl',['-sS','-o','/dev/null','-w','%{http_code}','--max-time','10','--resolve','agent.prhm.ir:443:127.0.0.1',url]));}
function backupName(file){return file.replace(/^\//,'').replaceAll('/','__');}
function backupExisting(file,dir){
  const entry={file,exists:false,type:'missing',target:null,backup:null};
  try{
    const st=fs.lstatSync(file);entry.exists=true;
    if(st.isSymbolicLink()){entry.type='symlink';entry.target=fs.readlinkSync(file);}
    else if(st.isFile()){entry.type='file';entry.backup=path.join(dir,backupName(file));fs.copyFileSync(file,entry.backup,fs.constants.COPYFILE_EXCL);const bst=fs.statSync(entry.backup);fs.chmodSync(entry.backup,0o600);entry.mode=st.mode&0o777;entry.uid=st.uid;entry.gid=st.gid;entry.backup_sha256=crypto.createHash('sha256').update(fs.readFileSync(entry.backup)).digest('hex');void bst;}
    else fail(`unsupported_backup_type:${file}`);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return entry;
}
function removePath(file){try{const st=fs.lstatSync(file);if(st.isDirectory()&&!st.isSymbolicLink())fs.rmSync(file,{recursive:true,force:true});else fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
function restoreEntry(entry){removePath(entry.file);if(!entry.exists)return;if(entry.type==='symlink'){mkdirp(path.dirname(entry.file));fs.symlinkSync(entry.target,entry.file);return;}if(entry.type==='file'){mkdirp(path.dirname(entry.file));fs.copyFileSync(entry.backup,entry.file);fs.chmodSync(entry.file,entry.mode);try{fs.chownSync(entry.file,entry.uid,entry.gid);}catch{}}}
function writeJson(file,obj){atomicReplacePreservingMetadata(file,Buffer.from(JSON.stringify(obj,null,2)+'\n'),0o600);fs.chmodSync(file,0o600);}

function install(){
  base.validateInvocation(process.argv);
  if(process.getuid&&process.getuid()!==0)fail('root_required');
  ensureSourceCommit();
  const required=[constants.CONFIG_API_ROUTES,constants.CONFIG_AUTH_CONTROLLER,constants.CONFIG_SERVICES,constants.CONFIG_API_ENV,constants.CONFIG_ADMIN_LOGIN_ROUTE,constants.CONFIG_NEXT_CONFIG,constants.APACHE_HTTPS,constants.SNAPSHOT];
  for(const file of required)if(!fs.existsSync(file))fail(`preflight_missing:${file}`);
  if(run('/usr/bin/systemctl',['is-active','prhm-company-os-dashboard.service'])!=='active')fail('company_os_not_active');
  if(run('/usr/bin/systemctl',['is-active','prhm-config-center-admin.service'])!=='active')fail('config_center_not_active');
  const configBefore=loopbackStatus('http://127.0.0.1:3005/');if(!configBefore||configBefore>=500)fail(`config_center_preflight:${configBefore}`);
  const companyBefore=localTlsStatus('https://agent.prhm.ir/company-os');if(!companyBefore||companyBefore>=500)fail(`company_os_preflight:${companyBefore}`);
  if(fs.existsSync(base.releaseDir()))fail('release_already_exists');

  const username='control-test';
  const password=makePassword();
  const passwordHash=base.makePasswordHash(password);
  const sessionSecret=makeSecret();
  const ssoSecret=makeSecret();
  const ssoAdminLogin='Mohammad';
  const runtimeEnv=base.buildRuntimeEnv({username,password,passwordHash,sessionSecret,ssoSecret,ssoAdminLogin});
  const credentialText=base.buildCredentialArtifact({username,password});
  const backupDir=path.join(constants.BACKUP_ROOT,timestamp());mkdirp(backupDir,0o700);
  const touched=[constants.CURRENT_LINK,constants.ENV_FILE,constants.SERVICE_UNIT,constants.CONFIG_API_ROUTES,constants.CONFIG_AUTH_CONTROLLER,constants.CONFIG_SERVICES,constants.CONFIG_API_ENV,constants.CONFIG_ADMIN_LOGIN_ROUTE,constants.CONFIG_NEXT_CONFIG,constants.APACHE_HTTPS];
  const manifest=touched.map(file=>backupExisting(file,backupDir));
  atomicReplacePreservingMetadata(path.join(backupDir,'manifest.json'),Buffer.from(JSON.stringify(manifest,null,2)+'\n'),0o600);
  fs.chmodSync(path.join(backupDir,'manifest.json'),0o600);
  let releaseCreated=false,configMutated=false,serviceStarted=false,apacheMutated=false;
  try{
    mkdirp(base.releaseDir(),0o750);releaseCreated=true;
    for(const rel of base.runtimeSourcePaths()){
      if(rel==='deploy/prhm-control-center.service')continue;
      const dest=path.join(base.releaseDir(),rel);
      atomicReplacePreservingMetadata(dest,readSourceFile(rel),rel==='src/server.js'?0o750:0o640);
    }
    atomicReplacePreservingMetadata(constants.ENV_FILE,Buffer.from(runtimeEnv),0o640);
    try{const parts=run('/usr/bin/getent',['group','apache']).split(':');const gid=Number(parts[2]);if(Number.isInteger(gid))fs.chownSync(constants.ENV_FILE,0,gid);}catch{}
    atomicReplacePreservingMetadata(constants.SERVICE_UNIT,readSourceFile('deploy/prhm-control-center.service'),0o644);

    atomicReplacePreservingMetadata(constants.CONFIG_API_ROUTES,Buffer.from(base.patchApiRoutes(fs.readFileSync(constants.CONFIG_API_ROUTES,'utf8'))));
    atomicReplacePreservingMetadata(constants.CONFIG_AUTH_CONTROLLER,Buffer.from(base.patchAuthController(fs.readFileSync(constants.CONFIG_AUTH_CONTROLLER,'utf8'))));
    atomicReplacePreservingMetadata(constants.CONFIG_SERVICES,Buffer.from(base.patchServicesConfig(fs.readFileSync(constants.CONFIG_SERVICES,'utf8'))));
    atomicReplacePreservingMetadata(constants.CONFIG_API_ENV,Buffer.from(base.patchLaravelEnv(fs.readFileSync(constants.CONFIG_API_ENV,'utf8'),{ssoSecret,ssoAdminLogin})));
    atomicReplacePreservingMetadata(constants.CONFIG_ADMIN_LOGIN_ROUTE,Buffer.from(patchAdminLoginRoute(fs.readFileSync(constants.CONFIG_ADMIN_LOGIN_ROUTE,'utf8'))));
    atomicReplacePreservingMetadata(constants.CONFIG_NEXT_CONFIG,Buffer.from(base.patchNextConfig(fs.readFileSync(constants.CONFIG_NEXT_CONFIG,'utf8'))));
    configMutated=true;
    for(const file of [constants.CONFIG_API_ROUTES,constants.CONFIG_AUTH_CONTROLLER,constants.CONFIG_SERVICES])run('/usr/bin/php',['-l',file],{timeout:30000});
    runAsPrhm('/usr/bin/php',['artisan','config:clear'],constants.CONFIG_API_ROOT,60000);
    runAsPrhm('/usr/bin/php',['artisan','config:cache'],constants.CONFIG_API_ROOT,60000);
    runAsPrhm('/usr/bin/npm',['run','build'],constants.CONFIG_ADMIN_ROOT,600000);
    run('/usr/bin/systemctl',['restart','prhm-config-center-admin.service'],{timeout:60000});
    if(run('/usr/bin/systemctl',['is-active','prhm-config-center-admin.service'])!=='active')fail('config_center_restart_failed');

    const tmpLink=`${constants.CURRENT_LINK}.tmp-${process.pid}`;removePath(tmpLink);mkdirp(path.dirname(constants.CURRENT_LINK));fs.symlinkSync(base.releaseDir(),tmpLink);removePath(constants.CURRENT_LINK);fs.renameSync(tmpLink,constants.CURRENT_LINK);
    run('/usr/bin/systemctl',['daemon-reload'],{timeout:60000});
    run('/usr/bin/systemctl',['enable','--now','prhm-control-center.service'],{timeout:60000});serviceStarted=true;
    if(run('/usr/bin/systemctl',['is-active','prhm-control-center.service'])!=='active')fail('control_center_not_active');
    const localLogin=loopbackStatus(`http://127.0.0.1:${constants.PORT}${constants.BASE_PATH}/login`);if(localLogin!==200)fail(`local_login_smoke:${localLogin}`);

    atomicReplacePreservingMetadata(constants.APACHE_HTTPS,Buffer.from(base.patchApacheHttps(fs.readFileSync(constants.APACHE_HTTPS,'utf8'))));apacheMutated=true;
    run('/usr/sbin/httpd',['-t'],{timeout:30000});run('/usr/bin/systemctl',['reload','httpd.service'],{timeout:60000});
    const publicLogin=localTlsStatus('https://agent.prhm.ir/control-center/login');if(publicLogin!==200)fail(`public_login_smoke:${publicLogin}`);
    const companyAfter=localTlsStatus('https://agent.prhm.ir/company-os');if(!companyAfter||companyAfter>=500)fail(`company_os_regression:${companyAfter}`);
    const configAfter=loopbackStatus('http://127.0.0.1:3005/');if(!configAfter||configAfter>=500)fail(`config_center_regression:${configAfter}`);

    mkdirp(constants.RESULT_ROOT,0o700);
    atomicReplacePreservingMetadata(constants.CREDENTIALS_FILE,Buffer.from(credentialText),0o600);fs.chmodSync(constants.CREDENTIALS_FILE,0o600);
    const result={ok:true,action:constants.ACTION,schema_version:'prhm.host-action-result.v1',installed:true,rollback_performed:false,release_sha:constants.CONTROL_PLANE_SHA,url:constants.PUBLIC_URL,username,credentials_file:constants.CREDENTIALS_FILE,backup_dir:backupDir,company_os_status:companyAfter,config_center_status:configAfter};
    writeJson(constants.RESULT_FILE,result);
    console.log(JSON.stringify(result));
    return result;
  }catch(error){
    try{
      if(serviceStarted)try{run('/usr/bin/systemctl',['disable','--now','prhm-control-center.service'],{timeout:60000});}catch{}
      for(const entry of [...manifest].reverse())try{restoreEntry(entry);}catch{}
      if(configMutated){try{runAsPrhm('/usr/bin/php',['artisan','config:clear'],constants.CONFIG_API_ROOT,60000);runAsPrhm('/usr/bin/php',['artisan','config:cache'],constants.CONFIG_API_ROOT,60000);}catch{}try{runAsPrhm('/usr/bin/npm',['run','build'],constants.CONFIG_ADMIN_ROOT,600000);run('/usr/bin/systemctl',['restart','prhm-config-center-admin.service'],{timeout:60000});}catch{}}
      try{run('/usr/bin/systemctl',['daemon-reload'],{timeout:60000});}catch{}
      if(apacheMutated){try{run('/usr/sbin/httpd',['-t'],{timeout:30000});run('/usr/bin/systemctl',['reload','httpd.service'],{timeout:60000});}catch{}}
      if(releaseCreated)try{fs.rmSync(base.releaseDir(),{recursive:true,force:true});}catch{}
    }catch{}
    throw new Error(`control_center_install_failed_rolled_back:${error.message}`);
  }
}

module.exports={...base,patchAdminLoginRoute,atomicReplacePreservingMetadata,install};

if(require.main===module){try{install();}catch(error){console.error(String(error&&error.stack||error));process.exit(1);}}
