#!/usr/local/bin/prhm-node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const cp=require('child_process');

const TARGET='/opt/prhm-project-factory/factory.js';
const EXPECTED_SHA='d0ecab94cc002aa03b745bd2ebafad8accc820004d70359e203c6e862882505b';
const BACKUP_ROOT='/var/backups/prhm-project-factory-v1-3-3';
const ROOT_BASE='/home/prhm/projects/generated';
const NODE='/usr/local/bin/prhm-node';
const NPM='/opt/prhm-project-factory/node/bin/npm';

function sha(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function die(msg){throw new Error(msg);}
function replaceOnce(text,oldText,newText,label){const i=text.indexOf(oldText);if(i<0)die('missing_anchor:'+label);if(text.indexOf(oldText,i+oldText.length)>=0)die('duplicate_anchor:'+label);return text.slice(0,i)+newText+text.slice(i+oldText.length);}
function run(cmd,args,opts={}){return cp.spawnSync(cmd,args,{encoding:'utf8',maxBuffer:16*1024*1024,...opts});}
function assertZero(r,label){if(r.error)die(label+'_spawn:'+r.error.message);if(r.status!==0)die(label+'_exit:'+r.status+':'+String(r.stderr||r.stdout||'').slice(-4000));}
function regularFile(f){try{return fs.statSync(f).isFile();}catch{return false;}}
function atomicWrite(target,content,st){const tmp=target+'.tmp-v1-3-3-'+process.pid;fs.writeFileSync(tmp,content,{mode:st.mode&0o777});fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);fs.renameSync(tmp,target);}
function audit(dir,label){const r=run(NPM,['audit','--json'],{cwd:dir,env:{...process.env,PATH:'/opt/prhm-project-factory/node/bin:'+(process.env.PATH||''),CI:'1',HOME:'/var/lib/prhm-project-factory',XDG_CONFIG_HOME:'/var/lib/prhm-project-factory/config',npm_config_cache:'/var/lib/prhm-project-factory/npm-cache'}});let obj=null;try{obj=JSON.parse(String(r.stdout||'').trim()||'{}');}catch(e){return{label,parse_error:e.message,exit_code:r.status,stderr:String(r.stderr||'').slice(-2000)}}const v=(obj.metadata&&obj.metadata.vulnerabilities)||{};return{label,exit_code:r.status,info:v.info||0,low:v.low||0,moderate:v.moderate||0,high:v.high||0,critical:v.critical||0,total:v.total||0};}
function cleanupE2E(root,slug){if(!fs.existsSync(root))return;const mf=path.join(root,'.prhm','project.json');if(!regularFile(mf))die('cleanup_manifest_missing:'+slug);const m=JSON.parse(fs.readFileSync(mf,'utf8'));if(m.standard_id!=='PRHM_NEW_SITE_V1'||m.slug!==slug||!m.features||m.features.security_e2e!==true)die('cleanup_manifest_guard:'+slug);fs.rmSync(root,{recursive:true,force:false,maxRetries:3,retryDelay:250});if(fs.existsSync(root))die('cleanup_failed:'+slug);}

function main(){
  const current=fs.readFileSync(TARGET);const currentSha=sha(current);if(currentSha!==EXPECTED_SHA)die('sha_mismatch:'+currentSha);const original=current.toString('utf8');const st=fs.statSync(TARGET);
  const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});const backup=path.join(BACKUP_ROOT,'factory.js.'+stamp+'.bak');fs.writeFileSync(backup,current,{mode:0o600});
  let patched=replaceOnce(original,"const FACTORY_VERSION='1.3.2';","const FACTORY_VERSION='1.3.3';",'version');
  const oldPin='create-next-app@16.2.10';const newPin='create-next-app@16.2.11';const count=patched.split(oldPin).length-1;if(count!==2)die('unexpected_old_pin_count:'+count);patched=patched.split(oldPin).join(newPin);if(patched.includes(oldPin))die('old_pin_remaining');if((patched.split(newPin).length-1)!==2)die('new_pin_count_failed');
  const candidate=TARGET+'.candidate-v1-3-3-'+process.pid+'.js';fs.writeFileSync(candidate,patched,{mode:0o600});
  const slug='factory-v133-security-e2e-'+stamp.slice(8,14).toLowerCase();const root=path.join(ROOT_BASE,slug);
  try{
    const syntax=run(NODE,['--check',candidate]);assertZero(syntax,'candidate_syntax');
    atomicWrite(TARGET,Buffer.from(patched,'utf8'),st);const installed=fs.readFileSync(TARGET);const installedSha=sha(installed);if(installed.toString('utf8')!==patched)die('postwrite_bytes_mismatch');
    const dryManifest={standard_id:'PRHM_NEW_SITE_V1',slug:'factory-v133-dryrun',name:'Factory v1.3.3 dry run',domains:['factory-v133-dryrun.invalid'],languages:['fa'],modules:['auth'],payment_adapter:null,sms_adapter:null,brand:{display_name:'Factory v1.3.3'},features:{security_upgrade_test:true}};
    const dry=run(NODE,[TARGET,'--dry-run','--manifest-base64',Buffer.from(JSON.stringify(dryManifest)).toString('base64')]);assertZero(dry,'dry_run');const plan=JSON.parse(String(dry.stdout||'').trim());if(!plan.ok||!plan.dry_run||plan.factory_version!=='1.3.3')die('dry_run_semantics_failed');const nextSteps=(plan.steps||[]).filter(x=>x.name==='next_web'||x.name==='next_admin');if(nextSteps.length!==2||nextSteps.some(x=>x.args[0]!==newPin))die('dry_run_pin_verify_failed');
    const manifest={standard_id:'PRHM_NEW_SITE_V1',slug,name:'Project Factory v1.3.3 security E2E',domains:[slug+'.invalid'],languages:['fa'],modules:['auth'],payment_adapter:null,sms_adapter:null,brand:{display_name:'Factory v1.3.3 Security E2E'},features:{security_e2e:true}};
    const e2e=run(NODE,[TARGET,'--manifest-base64',Buffer.from(JSON.stringify(manifest)).toString('base64')],{timeout:900000,env:{...process.env,PATH:'/opt/prhm-project-factory/node/bin:'+(process.env.PATH||'')}});assertZero(e2e,'e2e');if(!String(e2e.stdout||'').includes('PRHM_BOOTSTRAP_OK='+root))die('e2e_success_marker_missing');
    for(const f of [path.join(root,'apps/api/composer.json'),path.join(root,'apps/web/package.json'),path.join(root,'apps/admin/package.json'),path.join(root,'.git/HEAD'),path.join(root,'.prhm/bootstrap-state.json')])if(!regularFile(f))die('e2e_artifact_missing:'+f);
    const web=JSON.parse(fs.readFileSync(path.join(root,'apps/web/package.json'),'utf8'));const admin=JSON.parse(fs.readFileSync(path.join(root,'apps/admin/package.json'),'utf8'));if(web.dependencies?.next!=='16.2.11')die('web_next_version:'+web.dependencies?.next);if(admin.dependencies?.next!=='16.2.11')die('admin_next_version:'+admin.dependencies?.next);
    const wa=audit(path.join(root,'apps/web'),'web');const aa=audit(path.join(root,'apps/admin'),'admin');
    console.log('PROJECT_FACTORY_V133_APPLY_OK=1');console.log('BACKUP='+backup);console.log('OLD_SHA='+EXPECTED_SHA);console.log('NEW_SHA='+installedSha);console.log('WEB_NEXT='+web.dependencies.next);console.log('ADMIN_NEXT='+admin.dependencies.next);console.log('WEB_AUDIT='+JSON.stringify(wa));console.log('ADMIN_AUDIT='+JSON.stringify(aa));
    cleanupE2E(root,slug);console.log('E2E_CLEANUP_OK=1');
  }catch(e){try{cleanupE2E(root,slug);}catch(cleanErr){console.error('E2E_CLEANUP_ERROR='+cleanErr.message);}try{atomicWrite(TARGET,current,st);console.error('ROLLBACK_TO_OLD_SHA='+sha(fs.readFileSync(TARGET)));}catch(rb){console.error('ROLLBACK_FAILED='+rb.message);}throw e;}finally{try{fs.unlinkSync(candidate);}catch{}}
}
try{main();}catch(e){console.error('PROJECT_FACTORY_V133_APPLY_ERROR='+e.message);process.exit(1);}
