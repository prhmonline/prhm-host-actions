#!/usr/local/bin/prhm-node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const constants = Object.freeze({
  ACTION: 'control_center_install_v1',
  PORT: 18140,
  BASE_PATH: '/control-center',
  PUBLIC_URL: 'https://agent.prhm.ir/control-center/',
  SNAPSHOT: '/var/lib/prhm-company-os-dashboard/snapshot.json',
  CONTROL_PLANE_SHA: 'ce40ec5a14e6a6b29e8e9fc555cc16a7621a4757',
  SOURCE_REPO: '/opt/prhm-company-control-plane',
  SOURCE_BRANCH: 'design/unified-control-center',
  RELEASE_ROOT: '/var/lib/prhm-control-center/releases',
  CURRENT_LINK: '/var/lib/prhm-control-center/current',
  ENV_FILE: '/etc/prhm-control-center/control-center.env',
  SERVICE_UNIT: '/etc/systemd/system/prhm-control-center.service',
  CONFIG_API_ROUTES: '/srv/prhm-config-center/current/apps/api/routes/api.php',
  CONFIG_AUTH_CONTROLLER: '/srv/prhm-config-center/current/apps/api/app/Http/Controllers/Api/Admin/AuthController.php',
  CONFIG_SERVICES: '/srv/prhm-config-center/current/apps/api/config/services.php',
  CONFIG_API_ENV: '/srv/prhm-config-center/current/apps/api/.env',
  CONFIG_API_ROOT: '/srv/prhm-config-center/current/apps/api',
  CONFIG_ADMIN_ROOT: '/srv/prhm-config-center/current/apps/admin',
  CONFIG_ADMIN_LOGIN_ROUTE: '/srv/prhm-config-center/current/apps/admin/src/app/api/session/login/route.ts',
  CONFIG_NEXT_CONFIG: '/srv/prhm-config-center/current/apps/admin/next.config.ts',
  APACHE_HTTPS: '/etc/httpd/conf.d/prhm-vhosts-ssl.conf',
  BACKUP_ROOT: '/var/backups/prhm-control-center-install-v1',
  RESULT_ROOT: '/var/lib/prhm-agent-selfmaint-exec/control-center-install-v1',
  RESULT_FILE: '/var/lib/prhm-agent-selfmaint-exec/control-center-install-v1/latest.json',
  CREDENTIALS_FILE: '/var/lib/prhm-agent-selfmaint-exec/control-center-install-v1/credentials.txt',
});

const RUNTIME_SOURCE_PATHS = Object.freeze([
  'package.json',
  'src/server.js',
  'src/auth.js',
  'src/config-sso.js',
  'src/routes.js',
  'src/render.js',
  'src/upstream.js',
  'src/modules/company-os.js',
  'src/modules/config-center.js',
  'src/opportunities/model.js',
  'src/opportunities/leadops-reader.js',
  'src/opportunities/render.js',
  'src/opportunities/divar-classifier.js',
  'src/opportunities/divar-draft.js',
  'src/opportunities/sources/karlancer.js',
  'src/opportunities/sources/parscoders.js',
  'src/opportunities/sources/divar.js',
  'public/control-center.css',
  'deploy/prhm-control-center.service',
]);
const RUNTIME_ALLOWLIST = new Set(RUNTIME_SOURCE_PATHS);

function fail(message) { throw new Error(message); }
function exactlyOnce(source, needle, label) {
  const count = String(source).split(needle).length - 1;
  if (count !== 1) fail(`${label}_anchor_${count}`);
}
function releaseDir(){ return `${constants.RELEASE_ROOT}/${constants.CONTROL_PLANE_SHA}`; }
function runtimeSourcePaths(){ return [...RUNTIME_SOURCE_PATHS]; }
function validateInvocation(argv=process.argv){ if(!Array.isArray(argv)||argv.length!==2) fail('unexpected_arguments'); }
function sourceGitShowArgs(rel){ if(!RUNTIME_ALLOWLIST.has(rel)) fail('source_path_not_allowlisted'); return ['-C',constants.SOURCE_REPO,'show',`${constants.CONTROL_PLANE_SHA}:apps/control-center/${rel}`]; }
function sourceFetchArgs(){ return ['-C',constants.SOURCE_REPO,'fetch','--no-tags','origin',`+refs/heads/${constants.SOURCE_BRANCH}:refs/remotes/origin/${constants.SOURCE_BRANCH}`]; }
function run(file,args=[],options={}){ return cp.execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:options.timeout||180000,cwd:options.cwd,env:options.env||process.env}).trim(); }
function runBuffer(file,args=[],options={}){ return cp.execFileSync(file,args,{encoding:null,stdio:['ignore','pipe','pipe'],timeout:options.timeout||180000,cwd:options.cwd,env:options.env||process.env}); }
function shaBytes(bytes){ return crypto.createHash('sha256').update(bytes).digest('hex'); }
function timestamp(){ return new Date().toISOString().replace(/[:.]/g,'-'); }

function patchApiRoutes(source) {
  source = String(source);
  if (source.includes("'/control-center-sso'")) return source;
  const anchor = '    Route::middleware([';
  exactlyOnce(source, anchor, 'api_routes');
  const block = [
    "    Route::post(",
    "        '/control-center-sso',",
    "        [AuthController::class, 'controlCenterSso']",
    "    )->middleware('throttle:20,1');",
    '',
  ].join('\n');
  return source.replace(anchor, block + anchor);
}

function patchAuthController(source) {
  source = String(source);
  if (source.includes('public function controlCenterSso(')) return source;
  const hashUse = 'use Illuminate\\Support\\Facades\\Hash;';
  exactlyOnce(source, hashUse, 'auth_hash_use');
  source = source.replace(hashUse, hashUse + '\nuse Illuminate\\Support\\Facades\\Cache;');
  const anchor = '    public function login(Request $request): JsonResponse';
  exactlyOnce(source, anchor, 'auth_login');
  const method = `    public function controlCenterSso(Request $request): JsonResponse
    {
        if (! in_array($request->ip(), ['127.0.0.1', '::1'], true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $assertion = (string) $request->input('assertion', '');
        $secret = (string) config('services.control_center.secret', '');
        $adminLogin = Str::lower(trim((string) config('services.control_center.admin_login', '')));
        if (strlen($secret) < 32 || $adminLogin === '' || substr_count($assertion, '.') !== 1) {
            return response()->json(['message' => 'Invalid SSO configuration.'], 503);
        }

        [$payload, $signature] = explode('.', $assertion, 2);
        $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, $secret, true)), '+/', '-_'), '=');
        if (! hash_equals($expected, $signature)) {
            return response()->json(['message' => 'Invalid assertion.'], 401);
        }

        $decoded = base64_decode(strtr($payload, '-_', '+/'), true);
        $data = is_string($decoded) ? json_decode($decoded, true) : null;
        $now = time();
        $iat = is_array($data) ? ($data['iat'] ?? null) : null;
        $exp = is_array($data) ? ($data['exp'] ?? null) : null;
        $nonce = is_array($data) ? (string) ($data['n'] ?? '') : '';
        if (! is_int($iat) || ! is_int($exp) || $exp <= $now || $iat > $now + 5 || ($exp - $iat) > 60 || strlen($nonce) < 8) {
            return response()->json(['message' => 'Expired assertion.'], 401);
        }
        if (! Cache::add('admin.control_center_sso.' . hash('sha256', $nonce), true, 60)) {
            return response()->json(['message' => 'Assertion already used.'], 409);
        }

        $user = User::query()
            ->whereRaw('LOWER(email) = ?', [$adminLogin])
            ->orWhereRaw('LOWER(name) = ?', [$adminLogin])
            ->first();
        if (! $user || $user->email_verified_at === null) {
            return response()->json(['message' => 'SSO admin unavailable.'], 403);
        }

        $expiresAt = now()->addHours(8);
        $token = $user->createToken('config-center-control-center-sso', ['config-admin'], $expiresAt);
        return response()->json([
            'token' => $token->plainTextToken,
            'token_type' => 'Bearer',
            'expires_at' => $expiresAt->toIso8601String(),
            'user' => $this->userPayload($user),
        ]);
    }

`;
  return source.replace(anchor, method + anchor);
}

function patchServicesConfig(source) {
  source=String(source);
  if(source.includes("'control_center' => [")) return source;
  const anchor='\n];\n';
  exactlyOnce(source,anchor,'services_config');
  const block=`\n    'control_center' => [\n        'secret' => env('CONTROL_CENTER_CONFIG_SSO_SECRET'),\n        'admin_login' => env('CONTROL_CENTER_SSO_ADMIN_LOGIN'),\n    ],\n`;
  return source.replace(anchor,block+anchor);
}

function patchAdminLoginRoute(source) {
  source = String(source);
  if (source.includes('control_center_assertion')) return source;
  const anchor = '  const body = await request.text();';
  exactlyOnce(source, anchor, 'admin_login_body');
  const block = `  const body = await request.text();

  const form = new URLSearchParams(body);
  const controlCenterAssertion = form.get("control_center_assertion");
  if (controlCenterAssertion) {
    const embedOrigin = process.env.CONTROL_CENTER_EMBED_ORIGIN ?? "https://agent.prhm.ir";
    const origin = request.headers.get("origin") ?? "";
    if (origin !== embedOrigin) {
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
    const token = ssoPayload.token;
    const response = NextResponse.redirect(new URL(form.get("return_to") || "/", request.url), 303);
    response.cookies.set("cc_admin_token", token, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  }`;
  return source.replace(anchor, block);
}

function patchNextConfig(source) {
  source = String(source);
  source = source.replace(/\n\s*\{ key: "X-Frame-Options", value: "DENY" \},/, '');
  if (source.includes("frame-ancestors https://agent.prhm.ir https://control.prhm.ir")) return source;
  const anchor = '"frame-ancestors \'none\'"';
  exactlyOnce(source, anchor, 'next_frame_ancestors');
  return source.replace(anchor, '"frame-ancestors https://agent.prhm.ir https://control.prhm.ir"');
}

function safeEnvValue(value,label){ const v=String(value??''); if(!v||/[\r\n]/.test(v)) fail(`invalid_env_value_${label}`); return v; }
function patchLaravelEnv(source,{ssoSecret,ssoAdminLogin}){
  let lines=String(source).replace(/\r\n/g,'\n').split('\n');
  function setKey(key,value){
    value=safeEnvValue(value,key);
    const re=new RegExp(`^${key}=`); let seen=0;
    lines=lines.map(line=>{if(re.test(line)){seen++;return `${key}=${value}`;}return line;});
    if(seen>1) fail(`duplicate_env_key_${key}`);
    if(seen===0){if(lines.length&&lines[lines.length-1]!=='')lines.push('');lines.push(`${key}=${value}`);}
  }
  setKey('CONTROL_CENTER_CONFIG_SSO_SECRET',ssoSecret);
  setKey('CONTROL_CENTER_SSO_ADMIN_LOGIN',ssoAdminLogin);
  return lines.join('\n').replace(/\n*$/,'\n');
}

function makePasswordHash(password,saltHex=crypto.randomBytes(16).toString('hex')){
  const salt=Buffer.from(String(saltHex),'hex');
  if(salt.length<16) fail('password_salt_too_short');
  const digest=crypto.scryptSync(String(password),salt,64).toString('hex');
  return `scrypt$${salt.toString('hex')}$${digest}`;
}
function makePassword(){ return `${crypto.randomBytes(18).toString('base64url')}!Aa9`; }
function makeSecret(){ return crypto.randomBytes(36).toString('base64url'); }
function buildCredentialArtifact({username,password}){ return `url=${constants.PUBLIC_URL}\nusername=${safeEnvValue(username,'username')}\npassword=${safeEnvValue(password,'password')}\n`; }

function buildRuntimeEnv({username,password,passwordHash,sessionSecret,ssoSecret,ssoAdminLogin}) {
  void password;
  const values={username,passwordHash,sessionSecret,ssoSecret,ssoAdminLogin};
  for(const [key,value] of Object.entries(values)) if(!String(value||'')) fail(`runtime_env_missing_${key}`);
  return [
    `CONTROL_CENTER_PORT=${constants.PORT}`,
    `CONTROL_CENTER_BASE_PATH=${constants.BASE_PATH}`,
    `CONTROL_CENTER_TEST_USER=${username}`,
    `CONTROL_CENTER_TEST_PASSWORD_HASH=${passwordHash}`,
    `CONTROL_CENTER_SESSION_SECRET=${sessionSecret}`,
    'CONTROL_CENTER_SESSION_TTL_SECONDS=1800',
    `CONTROL_CENTER_CONFIG_SSO_SECRET=${ssoSecret}`,
    `CONTROL_CENTER_SSO_ADMIN_LOGIN=${ssoAdminLogin}`,
    `CONTROL_CENTER_OPPORTUNITIES_SNAPSHOT=${constants.SNAPSHOT}`,
    'COMPANY_OS_URL=http://127.0.0.1:18135',
    'CONFIG_CENTER_URL=http://127.0.0.1:3005',
    'CONFIG_CENTER_PUBLIC_URL=https://config.prhm.ir',
    'CONFIG_CENTER_PUBLIC_ALLOWLIST=config.prhm.ir',
    'DIVAR_DISCOVERY_ENABLED=1',
    'DIVAR_CACHE_SECONDS=600',
    '',
  ].join('\n');
}

function patchApacheHttps(source){
  source=String(source);
  const expected=`ProxyPass ${constants.BASE_PATH} http://127.0.0.1:${constants.PORT}${constants.BASE_PATH}`;
  if(source.includes('ProxyPass /control-center ')){
    if(!source.includes(expected)) fail('apache_control_center_route_conflict');
    return source;
  }
  const matches=[...source.matchAll(/<VirtualHost\s+\*:443>[\s\S]*?<\/VirtualHost>/g)];
  const target=matches.find(m=>/\bServerName\s+agent\.prhm\.ir\b/.test(m[0]));
  if(!target) fail('apache_agent_vhost_not_found');
  const block=[
    `  ProxyPass ${constants.BASE_PATH} http://127.0.0.1:${constants.PORT}${constants.BASE_PATH}`,
    `  ProxyPassReverse ${constants.BASE_PATH} http://127.0.0.1:${constants.PORT}${constants.BASE_PATH}`,
  ].join('\n');
  const patchedVhost=target[0].replace('</VirtualHost>',`${block}\n</VirtualHost>`);
  return source.slice(0,target.index)+patchedVhost+source.slice(target.index+target[0].length);
}

function rollbackTargets(){
  return [
    constants.CURRENT_LINK,
    constants.ENV_FILE,
    constants.CONFIG_API_ROUTES,
    constants.CONFIG_AUTH_CONTROLLER,
    constants.CONFIG_SERVICES,
    constants.CONFIG_API_ENV,
    constants.CONFIG_ADMIN_LOGIN_ROUTE,
    constants.CONFIG_NEXT_CONFIG,
    constants.APACHE_HTTPS,
    constants.SERVICE_UNIT,
  ];
}

function gitHasCommit(){ try{ run('/usr/bin/git',['-C',constants.SOURCE_REPO,'cat-file','-e',`${constants.CONTROL_PLANE_SHA}^{commit}`],{timeout:30000}); return true; }catch{return false;} }
function ensureSourceCommit(){
  if(gitHasCommit()) return;
  run('/usr/bin/git',sourceFetchArgs(),{timeout:120000});
  if(!gitHasCommit()) fail('reviewed_source_commit_unavailable');
}
function readSourceFile(rel){ ensureSourceCommit(); return runBuffer('/usr/bin/git',sourceGitShowArgs(rel),{timeout:30000}); }
function mkdirp(dir,mode=0o750){ fs.mkdirSync(dir,{recursive:true,mode}); }
function atomicWrite(file,data,mode=0o640){ mkdirp(path.dirname(file)); const tmp=`${file}.control-center-${process.pid}-${Date.now()}.tmp`; fs.writeFileSync(tmp,data,{mode,flag:'wx'}); fs.chmodSync(tmp,mode); fs.renameSync(tmp,file); }
function backupName(file){ return file.replace(/^\//,'').replaceAll('/','__'); }
function backupExisting(file,dir,manifest){
  const entry={file,exists:fs.existsSync(file),is_symlink:false,target:null,backup:null};
  if(entry.exists){ const st=fs.lstatSync(file); entry.is_symlink=st.isSymbolicLink(); if(entry.is_symlink)entry.target=fs.readlinkSync(file); else if(st.isFile()){entry.backup=path.join(dir,backupName(file));fs.copyFileSync(file,entry.backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(entry.backup,0o600);} }
  manifest.push(entry); return entry;
}
function restoreManifest(manifest){
  for(const entry of [...manifest].reverse()){
    try{ if(fs.existsSync(entry.file)||fs.lstatSync(entry.file)){ try{fs.unlinkSync(entry.file);}catch{} } }catch{}
    if(entry.exists){ if(entry.is_symlink)fs.symlinkSync(entry.target,entry.file); else if(entry.backup)fs.copyFileSync(entry.backup,entry.file); }
  }
}
function apacheStatus(){ return Number(run('/usr/bin/curl',['-sS','-o','/dev/null','-w','%{http_code}','--max-time','8','--resolve','agent.prhm.ir:443:127.0.0.1','https://agent.prhm.ir/company-os'])); }
function loopbackStatus(url){ return Number(run('/usr/bin/curl',['-sS','-o','/dev/null','-w','%{http_code}','--max-time','8',url])); }
function runAsPrhm(command,args,cwd,timeout=300000){ return run('/usr/sbin/runuser',['-u','prhm','--',command,...args],{cwd,timeout}); }
function writeJson(file,obj){ atomicWrite(file,Buffer.from(JSON.stringify(obj,null,2)+'\n'),0o600); }

function install(){
  validateInvocation();
  if(process.getuid&&process.getuid()!==0) fail('root_required');
  ensureSourceCommit();
  for(const f of [constants.CONFIG_API_ROUTES,constants.CONFIG_AUTH_CONTROLLER,constants.CONFIG_SERVICES,constants.CONFIG_API_ENV,constants.CONFIG_ADMIN_LOGIN_ROUTE,constants.CONFIG_NEXT_CONFIG,constants.APACHE_HTTPS,constants.SNAPSHOT]) if(!fs.existsSync(f)) fail(`preflight_missing:${f}`);
  if(run('/usr/bin/systemctl',['is-active','prhm-company-os-dashboard.service'])!=='active') fail('company_os_not_active');
  if(run('/usr/bin/systemctl',['is-active','prhm-config-center-admin.service'])!=='active') fail('config_center_admin_not_active');
  const configBefore=loopbackStatus('http://127.0.0.1:3005/'); if(!configBefore||configBefore>=500) fail('config_center_preflight_failed');
  const oldCompanyStatus=apacheStatus(); if(!oldCompanyStatus||oldCompanyStatus>=500) fail('company_os_public_preflight_failed');
  if(fs.existsSync(releaseDir())) fail('release_already_exists');

  const password=makePassword(), username='control-test', passwordHash=makePasswordHash(password), sessionSecret=makeSecret(), ssoSecret=makeSecret(), ssoAdminLogin='Mohammad';
  const envText=buildRuntimeEnv({username,password,passwordHash,sessionSecret,ssoSecret,ssoAdminLogin});
  const credentials=buildCredentialArtifact({username,password});
  const backupDir=path.join(constants.BACKUP_ROOT,timestamp()); mkdirp(backupDir,0o700);
  const manifest=[];
  for(const f of [constants.CURRENT_LINK,constants.ENV_FILE,constants.SERVICE_UNIT,constants.CONFIG_API_ROUTES,constants.CONFIG_AUTH_CONTROLLER,constants.CONFIG_SERVICES,constants.CONFIG_API_ENV,constants.CONFIG_ADMIN_LOGIN_ROUTE,constants.CONFIG_NEXT_CONFIG,constants.APACHE_HTTPS]) backupExisting(f,backupDir,manifest);
  atomicWrite(path.join(backupDir,'manifest.json'),Buffer.from(JSON.stringify(manifest,null,2)+'\n'),0o600);
  let releaseCreated=false, configTouched=false, apacheTouched=false, serviceTouched=false;
  try{
    mkdirp(releaseDir(),0o750); releaseCreated=true;
    for(const rel of RUNTIME_SOURCE_PATHS){
      if(rel==='deploy/prhm-control-center.service') continue;
      const dest=path.join(releaseDir(),rel); atomicWrite(dest,readSourceFile(rel),rel==='src/server.js'?0o750:0o640);
    }
    const serviceUnit=readSourceFile('deploy/prhm-control-center.service');
    atomicWrite(constants.ENV_FILE,Buffer.from(envText),0o640);
    try{const group=run('/usr/bin/getent',['group','apache']).split(':');const gid=Number(group[2]);if(Number.isInteger(gid))fs.chownSync(constants.ENV_FILE,0,gid);}catch{}
    atomicWrite(constants.SERVICE_UNIT,serviceUnit,0o644);

    const routes=patchApiRoutes(fs.readFileSync(constants.CONFIG_API_ROUTES,'utf8'));
    const controller=patchAuthController(fs.readFileSync(constants.CONFIG_AUTH_CONTROLLER,'utf8'));
    const services=patchServicesConfig(fs.readFileSync(constants.CONFIG_SERVICES,'utf8'));
    const apiEnv=patchLaravelEnv(fs.readFileSync(constants.CONFIG_API_ENV,'utf8'),{ssoSecret,ssoAdminLogin});
    const loginRoute=patchAdminLoginRoute(fs.readFileSync(constants.CONFIG_ADMIN_LOGIN_ROUTE,'utf8'));
    const nextConfig=patchNextConfig(fs.readFileSync(constants.CONFIG_NEXT_CONFIG,'utf8'));
    atomicWrite(constants.CONFIG_API_ROUTES,Buffer.from(routes),0o640);
    atomicWrite(constants.CONFIG_AUTH_CONTROLLER,Buffer.from(controller),0o640);
    atomicWrite(constants.CONFIG_SERVICES,Buffer.from(services),0o640);
    atomicWrite(constants.CONFIG_API_ENV,Buffer.from(apiEnv),0o600);
    atomicWrite(constants.CONFIG_ADMIN_LOGIN_ROUTE,Buffer.from(loginRoute),0o640);
    atomicWrite(constants.CONFIG_NEXT_CONFIG,Buffer.from(nextConfig),0o640);
    configTouched=true;
    for(const f of [constants.CONFIG_API_ROUTES,constants.CONFIG_AUTH_CONTROLLER,constants.CONFIG_SERVICES]) run('/usr/bin/php',['-l',f],{timeout:30000});
    runAsPrhm('/usr/bin/php',['artisan','config:clear'],constants.CONFIG_API_ROOT,60000);
    runAsPrhm('/usr/bin/php',['artisan','config:cache'],constants.CONFIG_API_ROOT,60000);
    runAsPrhm('/usr/bin/npm',['run','build'],constants.CONFIG_ADMIN_ROOT,600000);
    run('/usr/bin/systemctl',['restart','prhm-config-center-admin.service'],{timeout:60000});
    if(run('/usr/bin/systemctl',['is-active','prhm-config-center-admin.service'])!=='active') fail('config_center_restart_failed');

    const tmpLink=`${constants.CURRENT_LINK}.tmp-${process.pid}`; try{fs.unlinkSync(tmpLink);}catch{} fs.symlinkSync(releaseDir(),tmpLink); fs.renameSync(tmpLink,constants.CURRENT_LINK);
    run('/usr/bin/systemctl',['daemon-reload'],{timeout:60000});
    run('/usr/bin/systemctl',['enable','--now','prhm-control-center.service'],{timeout:60000}); serviceTouched=true;
    if(run('/usr/bin/systemctl',['is-active','prhm-control-center.service'])!=='active') fail('control_center_service_not_active');
    const localLogin=loopbackStatus(`http://127.0.0.1:${constants.PORT}${constants.BASE_PATH}/login`); if(localLogin!==200) fail(`control_center_local_smoke:${localLogin}`);

    const apacheNext=patchApacheHttps(fs.readFileSync(constants.APACHE_HTTPS,'utf8')); atomicWrite(constants.APACHE_HTTPS,Buffer.from(apacheNext),0o644); apacheTouched=true;
    run('/usr/sbin/httpd',['-t'],{timeout:30000}); run('/usr/bin/systemctl',['reload','httpd.service'],{timeout:60000});
    const publicLogin=Number(run('/usr/bin/curl',['-sS','-o','/dev/null','-w','%{http_code}','--max-time','10','--resolve','agent.prhm.ir:443:127.0.0.1','https://agent.prhm.ir/control-center/login'])); if(publicLogin!==200) fail(`control_center_public_smoke:${publicLogin}`);
    const companyAfter=apacheStatus(); if(!companyAfter||companyAfter>=500) fail(`company_os_regression:${companyAfter}`);
    const configAfter=loopbackStatus('http://127.0.0.1:3005/'); if(!configAfter||configAfter>=500) fail(`config_center_regression:${configAfter}`);

    mkdirp(constants.RESULT_ROOT,0o700); atomicWrite(constants.CREDENTIALS_FILE,Buffer.from(credentials),0o600);
    const result={ok:true,action:constants.ACTION,schema_version:'prhm.host-action-result.v1',installed:true,rollback_performed:false,release_sha:constants.CONTROL_PLANE_SHA,url:constants.PUBLIC_URL,username,credentials_file:constants.CREDENTIALS_FILE,backup_dir:backupDir,old_company_os_status:oldCompanyStatus,post_company_os_status:companyAfter,config_status:configAfter};
    writeJson(constants.RESULT_FILE,result); console.log(JSON.stringify(result)); return result;
  } catch(error){
    try{ if(serviceTouched){try{run('/usr/bin/systemctl',['disable','--now','prhm-control-center.service'],{timeout:60000});}catch{}} if(apacheTouched||manifest.some(x=>x.file===constants.APACHE_HTTPS)){restoreManifest(manifest.filter(x=>x.file===constants.APACHE_HTTPS));try{run('/usr/sbin/httpd',['-t'],{timeout:30000});run('/usr/bin/systemctl',['reload','httpd.service'],{timeout:60000});}catch{}} restoreManifest(manifest.filter(x=>x.file!==constants.APACHE_HTTPS)); if(configTouched){try{runAsPrhm('/usr/bin/php',['artisan','config:clear'],constants.CONFIG_API_ROOT,60000);runAsPrhm('/usr/bin/php',['artisan','config:cache'],constants.CONFIG_API_ROOT,60000);}catch{} try{runAsPrhm('/usr/bin/npm',['run','build'],constants.CONFIG_ADMIN_ROOT,600000);run('/usr/bin/systemctl',['restart','prhm-config-center-admin.service'],{timeout:60000});}catch{}} try{run('/usr/bin/systemctl',['daemon-reload'],{timeout:60000});}catch{} if(releaseCreated)try{fs.rmSync(releaseDir(),{recursive:true,force:true});}catch{} }catch{}
    throw new Error(`control_center_install_failed_rolled_back:${error.message}`);
  }
}

module.exports = {
  constants,
  releaseDir,
  runtimeSourcePaths,
  sourceGitShowArgs,
  sourceFetchArgs,
  validateInvocation,
  patchLaravelEnv,
  buildCredentialArtifact,
  makePasswordHash,
  buildRuntimeEnv,
  patchApacheHttps,
  rollbackTargets,
  patchApiRoutes,
  patchAuthController,
  patchServicesConfig,
  patchAdminLoginRoute,
  patchNextConfig,
  install,
};

if(require.main===module){ try{ install(); }catch(error){ console.error(String(error&&error.stack||error)); process.exit(1); } }
