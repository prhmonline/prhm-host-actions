#!/usr/bin/env node
'use strict';
/*
 * PRHM single-entry deployment readiness gate (read-only).
 * This is NOT a privileged deploy tool. Production writes must only be
 * executed by separately registered, fixed SHA-bound adapters with approval.
 */
const fs=require('node:fs'), cp=require('node:child_process'),path=require('node:path');
const entry=(root,stack,adapter='unregistered',branch='main')=>Object.freeze({root,stack,adapter,branch});
const PROFILES=Object.freeze({
 shifa:entry('/home/prhm/projects/shifa-platform','laravel-php','fixed-shifa-adapter'),
 honartik_front_prod:entry('/home/honartik/domains/honartik.ir/public_html','next','unregistered'),
 honartik_admin_prod:entry('/home/honartik/domains/dashboard.honartik.ir/public_html','yii','unregistered'),
 honartik_front_staging:entry('/home/prhm/domains/honartik-staging.prhm.ir/honartik-front','next-staging'),
 honartik_admin_staging:entry('/home/prhm/domains/honartik-api-staging.prhm.ir/honartik-back','yii-staging'),
 imotion_front_prod:entry('/mnt/imotion-prod-vm/domains/i-motion.ir/public_html','next-vm','fixed-imotion-adapter'),
 imotion_admin_prod:entry('/mnt/imotion-prod-vm/domains/admin.i-motion.ir/public_html','yii-vm','fixed-imotion-adapter'),
 tarjomeh_wordpress:entry('/home/prhm/domains/tarjomeh.prhm.ir/public_html','wordpress'),
 drtarjomeh_prod:entry('/home/drtarjomeh/domains/drtarjomeh.ir/public_html','yii'),
 moeinshow_front_prod:entry('/home/moeinshow/domains/moeinshow.com/public_html','web'),
 gisheh360:entry('/home/gisheh360/domains/gisheh360.ir/public_html','php'),
 titan_front_prod:entry('/home/fitness/domains/titanfitness-club.com/public_html','next','fixed-titan-adapter'),
 titan_back_prod:entry('/home/fitness/domains/admin.titanfitness-club.com/public_html','yii'),
 cfpark_front_prod:entry('/home/cfpark/domains/cfpark.ir/public_html','next'),
 cfpark_admin_prod:entry('/home/cfpark/domains/dashboard.cfpark.ir/public_html','yii'),
 aranob:entry('/home/prhm/domains/aranob.prhm.ir/public_html','php-pwa','fixed-aranob-adapter'),
 prhm_site:entry('/home/prhm/domains/prhm.ir/public_html','wordpress'),
 ticketing_core_back_wave4:entry('/root/prhm-dev/worktrees/ticketing-core-back-wave4','yii-dev','unregistered','wave4/transaction-safety'),
 moeinshow_admin_prod:entry('/home/moeinshow/domains/dashboard.moeinshow.com/public_html','yii'),
 prhm_config_center:entry('/home/prhm/projects/generated/prhm-config-center','next'),
 rahekomak:entry('/home/prhm/projects/generated/rahekomak','static-next','web-only-manual-level4'),
 help:entry('/home/prhm/projects/generated/help','static-next')
});
const SHA=/^[a-f0-9]{40}$/;
function git(root,args) {
 const result=cp.spawnSync('/usr/bin/git',['-c','safe.directory='+root,'-C',root,...args],{encoding:'utf8',timeout:12000,maxBuffer:2*1024*1024,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME||'/root',GIT_OPTIONAL_LOCKS:'0'}});
 if(result.error||result.status!==0)throw new Error('git_unavailable');
 return result.stdout.trim();
}
function inspect(name,opts={}){
 const p=PROFILES[name];if(!p)throw new Error('project_not_allowlisted');
 const r={project:name,stack:p.stack,adapter:p.adapter,root:p.root,ready:false,blockers:[],head:null,branch:null,changed_files:null};
 if(opts.sha!==undefined&&!SHA.test(opts.sha))throw new Error('sha_must_be_40_hex');
 let st;
 try{st=fs.lstatSync(p.root)}catch{r.blockers.push('root_missing');return r}
 if(!st.isDirectory()||st.isSymbolicLink()){r.blockers.push('root_invalid');return r}
 try{
  const top=git(p.root,['rev-parse','--show-toplevel']);
  if(top!==p.root){r.blockers.push('git_root_mismatch');return r}
  r.head=git(p.root,['rev-parse','HEAD']);
  r.branch=git(p.root,['branch','--show-current'])||'(detached)';
  r.changed_files=git(p.root,['status','--porcelain=v1','--untracked-files=normal']).split('\n').filter(Boolean).length;
 }catch{r.blockers.push('git_missing_or_invalid');return r}
 if(r.branch!==p.branch)r.blockers.push('branch_mismatch');
 if(r.changed_files!==0)r.blockers.push('dirty_git');
 if(opts.sha&&r.head!==opts.sha)r.blockers.push('sha_mismatch');
 if(p.adapter==='unregistered')r.blockers.push('deploy_adapter_unregistered');
 if(!opts.sha)r.blockers.push('target_sha_required_for_release');
 r.ready=r.blockers.length===0;
 return r;
}
function main(argv=process.argv.slice(2)){
 if(argv.length===1&&argv[0]==='--all'){
  const rows=Object.keys(PROFILES).map(p=>inspect(p));
  return {ok:true,read_only:true,mode:'inventory',total:rows.length,profiles:rows};
 }
 if(argv.length!==4||argv[0]!=='--project'||argv[2]!=='--sha')throw new Error('usage: --all OR --project <allowlisted-id> --sha <40hex>');
 return {ok:true,read_only:true,mode:'preflight',profile:inspect(argv[1],{sha:argv[3]})};
}
if(require.main===module){
 try{const res=main();process.stdout.write(JSON.stringify(res)+'\n');process.exitCode=res.mode==='preflight'&&!res.profile.ready?3:0}
 catch(e){process.stderr.write(JSON.stringify({ok:false,error:e.message})+'\n');process.exitCode=2}
}
module.exports={PROFILES,SHA,inspect,main};
