#!/usr/local/bin/prhm-node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const TARGET = '/opt/prhm-project-factory/factory.js';
const EXPECTED_SHA = '09ee50391c7b50e1fcd36f74a3d404c7a2f703ed7809842ae0453f6af87aba7b';
const BACKUP_ROOT = '/var/backups/prhm-project-factory-v1-3-2';

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function die(msg) {
  throw new Error(msg);
}
function replaceOnce(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0) die('missing_anchor:' + label);
  if (text.indexOf(oldText, first + oldText.length) >= 0) die('duplicate_anchor:' + label);
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}
function run(cmd, args, opts={}) {
  const r = cp.spawnSync(cmd, args, {encoding:'utf8', ...opts});
  return r;
}
function assertZero(r, label) {
  if (r.error) die(label + '_spawn:' + r.error.message);
  if (r.status !== 0) die(label + '_exit:' + r.status + ':' + (r.stderr || r.stdout || '').slice(-2000));
}
function atomicWrite(target, content, st) {
  const tmp = target + '.tmp-v1-3-2-' + process.pid;
  fs.writeFileSync(tmp, content, {mode: st.mode & 0o777});
  fs.chownSync(tmp, st.uid, st.gid);
  fs.chmodSync(tmp, st.mode & 0o777);
  fs.renameSync(tmp, target);
}
function main() {
  const current = fs.readFileSync(TARGET);
  const currentSha = sha(current);
  if (currentSha !== EXPECTED_SHA) die('sha_mismatch:' + currentSha);
  const original = current.toString('utf8');
  const st = fs.statSync(TARGET);

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
  fs.mkdirSync(BACKUP_ROOT, {recursive:true, mode:0o700});
  const backup = path.join(BACKUP_ROOT, 'factory.js.' + stamp + '.bak');
  fs.writeFileSync(backup, current, {mode:0o600});

  let patched = original;
  patched = replaceOnce(
    patched,
    "const FACTORY_VERSION='1.3.1';",
    "const FACTORY_VERSION='1.3.2';",
    'version'
  );
  patched = replaceOnce(
    patched,
    "const ROOT_BASE='/home/prhm/projects/generated';",
    "const ROOT_BASE='/home/prhm/projects/generated';\nconst FACTORY_STATE='/var/lib/prhm-project-factory';\nconst XDG_CONFIG_HOME=path.join(FACTORY_STATE,'config');",
    'state_constants'
  );

  const oldRun = "function run(s){const r=spawnSync(s.command,s.args,{cwd:s.cwd,stdio:'inherit',timeout:900000,env:{...process.env,CI:'1',COMPOSER_HOME:'/var/lib/prhm-project-factory/composer',npm_config_cache:'/var/lib/prhm-project-factory/npm-cache'}});return{name:s.name,command:s.command,args:s.args,cwd:s.cwd,started_at:new Date().toISOString(),finished_at:new Date().toISOString(),exit_code:Number.isInteger(r.status)?r.status:null,signal:r.signal||null,error:r.error?r.error.message:null};}";
  const newRun = "function run(s){mkdirp(XDG_CONFIG_HOME);const started_at=new Date().toISOString();const r=spawnSync(s.command,s.args,{cwd:s.cwd,stdio:'inherit',timeout:900000,env:{...process.env,CI:'1',HOME:FACTORY_STATE,XDG_CONFIG_HOME,COMPOSER_HOME:path.join(FACTORY_STATE,'composer'),npm_config_cache:path.join(FACTORY_STATE,'npm-cache')}});return{name:s.name,command:s.command,args:s.args,cwd:s.cwd,started_at,finished_at:new Date().toISOString(),exit_code:Number.isInteger(r.status)?r.status:null,signal:r.signal||null,error:r.error?r.error.message:null};}\nfunction regularFile(f){try{return fs.statSync(f).isFile();}catch{return false;}}\nfunction stepArtifacts(s){switch(s.name){case'laravel_api':return[path.join(s.args[2],'artisan'),path.join(s.args[2],'composer.json')];case'laravel_standard_packages':return[path.join(s.cwd,'composer.json'),path.join(s.cwd,'composer.lock')];case'next_web':case'next_admin':return[path.join(s.args[1],'package.json')];case'git_init':return[path.join(s.cwd,'.git/HEAD')];default:return[];}}\nfunction verifyStep(s){for(const f of stepArtifacts(s))if(!regularFile(f))return'postcondition_missing:'+f;return null;}";
  patched = replaceOnce(patched, oldRun, newRun, 'run_and_postconditions');

  const oldLoop = "for(const s of steps){const r=run(s);state.steps.push(r);state.updated_at=new Date().toISOString();fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\\n',{mode:0o640});if(r.exit_code!==0||r.error){";
  const newLoop = "for(const s of steps){const r=run(s);const postError=verifyStep(s);if(postError&&!r.error)r.error=postError;state.steps.push(r);state.updated_at=new Date().toISOString();fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\\n',{mode:0o640});if(r.exit_code!==0||r.error){";
  patched = replaceOnce(patched, oldLoop, newLoop, 'step_postcondition_gate');

  if ((patched.match(/FACTORY_VERSION='1\.3\.2'/g)||[]).length !== 1) die('version_verify_failed');
  if ((patched.match(/XDG_CONFIG_HOME/g)||[]).length < 3) die('xdg_verify_failed');
  if ((patched.match(/postcondition_missing:/g)||[]).length !== 1) die('postcondition_verify_failed');

  const candidate = TARGET + '.candidate-v1-3-2-' + process.pid;
  fs.writeFileSync(candidate, patched, {mode:0o600});
  try {
    const syntax = run('/usr/local/bin/prhm-node', ['--check', candidate]);
    assertZero(syntax, 'candidate_syntax');

    atomicWrite(TARGET, Buffer.from(patched, 'utf8'), st);

    const installed = fs.readFileSync(TARGET);
    const installedSha = sha(installed);
    if (installed.toString('utf8') !== patched) die('postwrite_bytes_mismatch');

    const dryManifest = {
      standard_id:'PRHM_NEW_SITE_V1',
      slug:'factory-v132-dryrun',
      name:'Factory v1.3.2 dry run',
      domains:['factory-v132-dryrun.invalid'],
      languages:['fa'],
      modules:['auth'],
      payment_adapter:null,
      sms_adapter:null,
      brand:{display_name:'Factory v1.3.2'},
      features:{}
    };
    const b64 = Buffer.from(JSON.stringify(dryManifest)).toString('base64');
    const dry = run('/usr/local/bin/prhm-node', [TARGET, '--dry-run', '--manifest-base64', b64], {encoding:'utf8'});
    assertZero(dry, 'dry_run');
    const dryObj = JSON.parse((dry.stdout || '').trim());
    if (!dryObj.ok || !dryObj.dry_run || dryObj.factory_version !== '1.3.2') die('dry_run_semantics_failed');

    const negativeSlug = 'factory-v132-rollback-' + stamp.slice(8,14).toLowerCase();
    const negativeRoot = path.join('/home/prhm/projects/generated', negativeSlug);
    const negativeManifest = {
      standard_id:'PRHM_NEW_SITE_V1',
      slug:negativeSlug,
      name:'Factory v1.3.2 rollback test',
      domains:[negativeSlug + '.invalid'],
      languages:['fa'],
      modules:['auth'],
      payment_adapter:null,
      sms_adapter:null,
      brand:{display_name:'Rollback test'},
      features:{}
    };
    let negativeCode = patched;
    negativeCode = replaceOnce(
      negativeCode,
      "command:'/opt/prhm-project-factory/node/bin/npx',args:['create-next-app@16.2.10',path.join(root,'apps/web')",
      "command:'/bin/true',args:['create-next-app@16.2.10',path.join(root,'apps/web')",
      'negative_injection'
    );
    const negativeFile = '/tmp/prhm-project-factory-v132-negative-' + process.pid + '.js';
    fs.writeFileSync(negativeFile, negativeCode, {mode:0o700});
    try {
      const neg = run('/usr/local/bin/prhm-node', [negativeFile, '--manifest-base64', Buffer.from(JSON.stringify(negativeManifest)).toString('base64')], {encoding:'utf8'});
      if (neg.status === 0) die('negative_test_unexpected_success');
      const combined = (neg.stdout || '') + '\n' + (neg.stderr || '');
      if (!combined.includes('postcondition_missing:' + negativeRoot + '/apps/web/package.json')) die('negative_missing_postcondition_evidence');
      if (!combined.includes('rollback_ok')) die('negative_missing_rollback_evidence');
      if (fs.existsSync(negativeRoot)) die('negative_root_still_exists');
    } finally {
      try { fs.unlinkSync(negativeFile); } catch {}
    }

    console.log('PROJECT_FACTORY_V132_APPLY_OK=1');
    console.log('BACKUP=' + backup);
    console.log('OLD_SHA=' + EXPECTED_SHA);
    console.log('NEW_SHA=' + installedSha);
    console.log('NEGATIVE_ROLLBACK_OK=1');
  } catch (e) {
    try {
      atomicWrite(TARGET, current, st);
      console.error('ROLLBACK_TO_OLD_SHA=' + sha(fs.readFileSync(TARGET)));
    } catch (rb) {
      console.error('ROLLBACK_FAILED=' + rb.message);
    }
    throw e;
  } finally {
    try { fs.unlinkSync(candidate); } catch {}
  }
}

try { main(); } catch (e) { console.error('PROJECT_FACTORY_V132_APPLY_ERROR=' + e.message); process.exit(1); }
