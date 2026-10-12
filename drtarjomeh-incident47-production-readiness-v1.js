'use strict';
// Incident #47: fixed-scope read-only readiness assessment.
// NO install, no approval, no filesystem mutation, no credential disclosure.
// This is not an authorization or production-change adapter.
const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const crypto=require('node:crypto');
const pins=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');
const registry=require('./drtarjomeh-incident47-runtime-registration-v1.js');

const ROOT='/home/drtarjomeh/domains/drtarjomeh.ir';
const CHECKOUT=ROOT+'/repository';
const CURRENT=ROOT+'/public_html';
const EXPECTED_RELEASE=ROOT+'/releases/20261010-security-5d4e6cf0';
const UPLOADS=ROOT+'/shared/frontend/wp-content/uploads';
const GUARD='/etc/httpd/conf.d/95-drt-wordpress-uploads-deny.conf';
const FENCE='host_action.'+registry.ACTION;
const FILES=Object.freeze({
  script:Object.freeze({...pins.APP_BLOBS.guard,fullpath:CHECKOUT+'/'+pins.APP_BLOBS.guard.path}),
  conf:Object.freeze({...pins.APP_BLOBS.policy,fullpath:CHECKOUT+'/'+pins.APP_BLOBS.policy.path}),
});
const SUSPECTS=Object.freeze([
  Object.freeze({rel:'hkobrps/yfgmh1z/fxpbvit/f0x.php',sha:'66ac0abb56a84aa401756b705683ebb81127edffca203799f78c50f89d4556bb'}),
  Object.freeze({rel:'hkobrps/yfgmh1z/fxpbvit/index.php',sha:'5a6eeb1b02c2833ddb720ca2699403d757163b4936da2f74f8f99ee0217d4a3d'}),
  Object.freeze({rel:'iavclhz/goqyezm/pf1laoq/index.php',sha:'316ff0784b0bbd408957754fc187a4b19973f0c60e8de6f8be4fdfdd5b846075'}),
  Object.freeze({rel:'yfwvqsa/zvrseia/kjotasr/1.php',sha:'66ac0abb56a84aa401756b705683ebb81127edffca203799f78c50f89d4556bb'}),
  Object.freeze({rel:'yfwvqsa/zvrseia/kjotasr/index.php',sha:'5a6eeb1b02c2833ddb720ca2699403d757163b4936da2f74f8f99ee0217d4a3d'}),
]);
const CONFIGS=Object.freeze([
  '.htaccess','hkobrps/yfgmh1z/.htaccess',
  'hkobrps/yfgmh1z/fxpbvit/php.ini','iavclhz/goqyezm/.htaccess',
  'iavclhz/goqyezm/pf1laoq/php.ini','yfwvqsa/zvrseia/.htaccess',
  'yfwvqsa/zvrseia/kjotasr/php.ini'
]);
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const blobSha=b=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');

function safeRead(reader,p){
  // Read only from an O_NOFOLLOW file descriptor. A second pathname lookup
  // after lstat could observe different attacker-controlled upload bytes.
  let fd;
  try{
    const before=reader.lstatSync(p);
    if(before.isSymbolicLink()||!before.isFile()||
      before.size>1024*1024||before.size<=0)return null;
    fd=reader.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const opened=reader.fstatSync(fd);
    if(!opened.isFile()||opened.size!==before.size||
      opened.dev!==before.dev||opened.ino!==before.ino)return null;
    const bytes=reader.readFileSync(fd);
    const after=reader.fstatSync(fd);
    if(!Buffer.isBuffer(bytes)||bytes.length!==opened.size||
      after.dev!==opened.dev||after.ino!==opened.ino||
      after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)return null;
    return bytes;
  }catch{return null;}
  finally{if(fd!==undefined)reader.closeSync(fd);}
}
function inspect({read=fs,run,now=()=>new Date().toISOString()}={}){
  // Pass exactly one fixed set of read-only CLI checks.
  const exec=run||((cmd,args)=>{
    const r=cp.spawnSync(cmd,args,{encoding:'utf8',timeout:15000,maxBuffer:65536});
    return r.status===0?String(r.stdout||'').trim():null;
  });
  const reasons=[],indicators={};
  const flag=(code)=>{if(!reasons.includes(code))reasons.push(code);};
  const env={app_repo:CHECKOUT,expected_application_commit:pins.SOURCE_COMMIT,
    action:registry.ACTION,hostaction_source_sha:registry.HOST_BASE};
  const head=exec('/usr/bin/git',['-c','safe.directory='+CHECKOUT,'-C',CHECKOUT,'rev-parse','HEAD']);
  indicators.app_checkout_match=head===pins.SOURCE_COMMIT;
  if(!indicators.app_checkout_match)flag('SOURCE_APP_CHECKOUT_SHA_MISMATCH');
  const worktree=exec('/usr/bin/git',['-c','safe.directory='+CHECKOUT,'-C',CHECKOUT,
    'status','--porcelain','--untracked-files=no']);
  indicators.worktree_clean=worktree==='';
  if(!indicators.worktree_clean)flag('SOURCE_APP_WORKTREE_UNVERIFIED');
  for(const [kind,pin] of Object.entries(FILES)){
    const bytes=safeRead(read,pin.fullpath);
    indicators['source_'+kind+'_verified']=!!bytes&&blobSha(bytes)===pin.git_blob_sha;
    if(!indicators['source_'+kind+'_verified'])flag('MISSING_OR_DRIFTED_APP_'+kind.toUpperCase());
  }
  try{indicators.release_match=read.realpathSync(CURRENT)===EXPECTED_RELEASE;}
  catch{indicators.release_match=false;}
  if(!indicators.release_match)flag('PRODUCTION_RELEASE_DRIFT');
  try{indicators.uploads_mount_match=read.realpathSync(CURRENT+'/frontend/wp-content/uploads')===read.realpathSync(UPLOADS);}
  catch{indicators.uploads_mount_match=false;}
  if(!indicators.uploads_mount_match)flag('SHARED_UPLOADS_MOUNT_DRIFT');
  let valid=0;
  for(const item of SUSPECTS){
    const bytes=safeRead(read,UPLOADS+'/'+item.rel);
    if(bytes&&sha256(bytes)===item.sha)valid++;
  }
  indicators.suspicious_exact_preimages=valid;
  if(valid!==SUSPECTS.length)flag('SUSPECT_PREIMAGE_DRIFT');
  indicators.sidecar_configs_present=CONFIGS.filter(rel=>safeRead(read,UPLOADS+'/'+rel)).length;
  if(indicators.sidecar_configs_present!==CONFIGS.length)flag('SIDECAR_CONFIG_DRIFT');
  indicators.live_owner_hashes_match=Object.entries(pins.LIVE).every(([kind,p])=>{
    const bytes=safeRead(read,p.path);
    return bytes&&sha256(bytes)===p.sha256;
  });
  if(!indicators.live_owner_hashes_match)flag('CONTROL_PLANE_SHA_DRIFT');
  let parsed;
  try{const b=safeRead(read,pins.LIVE.policy.path);parsed=b?JSON.parse(b.toString('utf8')):null;}catch{parsed=null;}
  indicators.new_action_registered=!!parsed?.operations?.[FENCE];
  indicators.apache_guard_installed=!!safeRead(read,GUARD);
  indicators.apache_syntax_ok=exec('/usr/sbin/apachectl',['-t'])!==null;
  if(!indicators.apache_syntax_ok)flag('APACHE_SYNTAX_FAIL');
  if(indicators.new_action_registered)flag('ACTION_ALREADY_REGISTERED_RECHECK_POLICY');
  if(indicators.apache_guard_installed)flag('GUARD_ALREADY_INSTALLED_RECHECK_POLICY');
  return Object.freeze({
    schema:'prhm.drtarjomeh.incident47.production-readiness.v1',
    timestamp:now(),target:'drtarjomeh.ir',requested_action:registry.ACTION,
    source_repo:'prhmonline/drtarjomeh',source_sha:pins.SOURCE_COMMIT,
    host_actions_base:registry.HOST_BASE,allow_arbitrary_commands:false,
    registration_authorized:false,production_mutation:false,
    // Installed-file metadata is NOT proof of effective Apache/FPM denial.
    // Only an authorized benign HTTP+HTTPS negative origin test can prove it.
    security_guard_present:indicators.apache_guard_installed,
    security_guard_active:false,
    effective_php_denial_verified:false,
    missing_effectiveness_evidence:Object.freeze([
      'ORIGIN_HTTP_BENIGN_PHP_403',
      'ORIGIN_HTTPS_BENIGN_PHP_403',
      'STATIC_MEDIA_HEALTH',
      'RECURRENCE_MONITORING_24H'
    ]),
    indicators:Object.freeze(indicators),blockers:Object.freeze(reasons),
    status:reasons.length?'BLOCKED':'READY_FOR_REVIEW_NOT_AUTHORIZED',
    note:'No root writes. READY does not establish signed L4 authorization.'
  });
}
function cli(argv=process.argv.slice(2)){
  if(argv.length!==1||argv[0]!=='--readonly')throw new Error('read_only_mode_required');
  const value=inspect();
  process.stdout.write(JSON.stringify(value)+'\n');
  if(value.status==='BLOCKED')process.exitCode=2;
  return value;
}
module.exports=Object.freeze({ROOT,CHECKOUT,EXPECTED_RELEASE,FILES,SUSPECTS,CONFIGS,
  safeRead,inspect,cli});
if(require.main===module){
  try{cli();}
  catch(error){process.stderr.write('I47_READONLY_PREFLIGHT_FAILED\n');process.exitCode=3;}
}
