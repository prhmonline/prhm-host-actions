import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const BASE_SHA='0f71a72d08dccb96589475bdac79e78b0d965ed716125304d6f3bbca80ac8f04';
const BACK='/var/backups/prhm-agent-selfmaint';
const OUT_DIR='/tmp/prhm-agent-mcp-safe-ui-v14/src/plugins';
const OUT=path.join(OUT_DIR,'.safeFiles-aranob-ui-v14-'+BASE_SHA+'.mjs');
const WT='/tmp/prhm-aranob-uiux-20260911';
const BRANCH='feat/mobile-first-premium-ui-20260911';
const BASE='936fa59f71226947d2c0d8818b4238203b85eafd';
const CARRIER='cfpark_front_prod';
const PREFIX='__aranob_ui_v14__/';
const MODES=new Map([
  ['assets/mobile.css','append'],
  ['assets/mobile.js','replace'],
  ['tools/launch-readiness-test.php','replace'],
  ['docs/superpowers/specs/2026-09-11-aranob-mobile-first-ui-design.md','replace'],
  ['docs/superpowers/plans/2026-09-11-aranob-mobile-first-ui.md','replace']
]);
const H=b=>createHash('sha256').update(b).digest('hex');
function sourceBytes(){
  const names=fs.readdirSync(BACK).filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak')).sort().reverse();
  if(!names.length)throw new Error('aranob_ui_v14_base_backup_missing');
  const b=fs.readFileSync(path.join(BACK,names[0]));
  if(H(b)!==BASE_SHA)throw new Error('aranob_ui_v14_base_sha_mismatch');
  return b;
}
function ensure(){
  fs.mkdirSync(OUT_DIR,{recursive:true,mode:0o700});
  const src=sourceBytes();
  try{if(H(fs.readFileSync(OUT))===BASE_SHA)return}catch{}
  const tmp=OUT+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,src,{mode:0o600,flag:'wx'});fs.renameSync(tmp,OUT);fs.chmodSync(OUT,0o600);
}
function git(args){return cp.execFileSync('/usr/bin/git',['-c','safe.directory='+WT,'-C',WT,...args],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024}).trim();}
function isSentinel(args){return args&&args.target===CARRIER&&Array.isArray(args.changes)&&args.changes.length>0&&args.changes.every(c=>typeof c?.path==='string'&&c.path.startsWith(PREFIX));}
function atomicWrite(dest,data){
  fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o755});
  const mode=fs.existsSync(dest)?(fs.statSync(dest).mode&0o777):0o644;
  const tmp=dest+'.v14-'+process.pid+'-'+Date.now()+'.tmp';
  const fd=fs.openSync(tmp,'wx',mode);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const owner=fs.statSync(WT);fs.chownSync(tmp,owner.uid,owner.gid);fs.renameSync(tmp,dest);
}
function decode(c){
  const rel=c.path.slice(PREFIX.length);const mode=MODES.get(rel);if(!mode)throw new Error('aranob_ui_v14_path_not_allowed:'+rel);
  const data=c.encoding==='base64'?Buffer.from(c.content,'base64'):Buffer.from(c.content,'utf8');if(data.length>180000)throw new Error('aranob_ui_v14_payload_too_large:'+rel);
  return {rel,mode,dest:path.join(WT,rel),data};
}
function apply(args){
  if(!fs.existsSync(WT))throw new Error('aranob_ui_v14_workspace_missing');
  if(git(['branch','--show-current'])!==BRANCH)throw new Error('aranob_ui_v14_branch_mismatch');
  if(git(['rev-parse','HEAD'])!==BASE)throw new Error('aranob_ui_v14_head_mismatch');
  if(git(['status','--porcelain']))throw new Error('aranob_ui_v14_workspace_not_clean');
  const decoded=args.changes.map(decode);if(new Set(decoded.map(x=>x.rel)).size!==decoded.length)throw new Error('aranob_ui_v14_duplicate_path');
  const old=decoded.map(x=>({dest:x.dest,exists:fs.existsSync(x.dest),data:fs.existsSync(x.dest)?fs.readFileSync(x.dest):null}));
  try{
    for(const x of decoded){
      let next=x.data;
      if(x.mode==='append'){
        const current=fs.readFileSync(x.dest);
        if(current.includes(Buffer.from('ARANOB_UI_V14_MOBILE_FIRST')))throw new Error('aranob_ui_v14_css_already_applied');
        next=Buffer.concat([current,Buffer.from('\n\n'),x.data,Buffer.from('\n')]);
      }
      atomicWrite(x.dest,next);
    }
  }catch(e){for(const o of old.reverse()){try{o.exists?atomicWrite(o.dest,o.data):fs.rmSync(o.dest,{force:true})}catch{}}throw e;}
  return {ok:true,operation:'aranob_ui_v14_apply',changeset_id:randomUUID(),production_mutation:false,files:decoded.map(x=>({path:x.rel,mode:x.mode,sha256:H(fs.readFileSync(x.dest)),bytes:fs.statSync(x.dest).size}))};
}
function result(o){return {content:[{type:'text',text:JSON.stringify(o)}]};}
ensure();
const base=await import(pathToFileURL(OUT).href+'?aranob-ui-v14='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('aranob_ui_v14_base_export_missing');
export function registerSafeFilesPlugin(mcp,context){
  let cfg=null,handler=null;const proxy=new Proxy(mcp,{get(target,prop){if(prop==='registerTool')return(name,c,f)=>{if(name==='fast_dev_apply_v1'){cfg=c;handler=f;return;}return target.registerTool.call(target,name,c,f)};const v=Reflect.get(target,prop,target);return typeof v==='function'?v.bind(target):v}});
  base.registerSafeFilesPlugin(proxy,context);if(!cfg||!handler)throw new Error('aranob_ui_v14_fast_dev_surface_missing');
  mcp.registerTool('fast_dev_apply_v1',cfg,async args=>isSentinel(args)?result(apply(args)):handler(args));
}
// ARANOB_UIUX_V14_CARRIER
