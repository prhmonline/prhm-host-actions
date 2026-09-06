'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const candidate=process.argv[2];
assert.ok(candidate,'candidate path required');
const node=process.execPath;
const syntax=cp.spawnSync(node,['--check',candidate],{encoding:'utf8'});
assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-selfmaint-v21-'));
try{
  const dst=path.join(tmp,'selfmaintRoutes.js');
  fs.copyFileSync(candidate,dst);
  const stub = `'use strict';\nmodule.exports={registerSelfmaintRoutes(app,ctx){const auth=(ctx&&ctx.auth)||((req,res,next)=>next());const legacy=(req,res)=>res.json({legacy:true});app.post('/selfmaint/request',auth,legacy);app.post('/selfmaint/confirm',auth,legacy);app.post('/selfmaint/apply',auth,legacy);return 'ok';}};\n`;
  fs.writeFileSync(path.join(tmp,'.selfmaintRoutes-root-stage-request-base-45f22b6879add519c51a0dadaf9840a62b1be3d0301f562f70b92656a89fa8c4.cjs'),stub,{mode:0o600});
  const mod=require(dst);const t=mod.__selfmaintLevel3ProxyTest;assert.ok(t,'test surface missing');
  assert.equal(t.ROUTES['/selfmaint/request'],'/v1/request');assert.equal(t.ROUTES['/selfmaint/confirm'],'/v1/confirm');assert.equal(t.ROUTES['/selfmaint/apply'],'/v1/apply');
  const sentinel={...t.SENTINEL};assert.equal(t.exactSentinel(sentinel),true);assert.equal(t.dispatchKind('/selfmaint/request',sentinel),'mediator');assert.equal(t.dispatchKind('/selfmaint/request',{target:'agent_mcp'}),'base');assert.equal(t.dispatchKind('/selfmaint/confirm',{}),'base');assert.equal(t.dispatchKind('/selfmaint/apply',{}),'base');assert.equal(t.dispatchKind('/unrelated',{}),'legacy');
  const registered=[];const app={post(route,...handlers){registered.push({route,handlers});return this;},get(){return this;}};const auth=(req,res,next)=>next();assert.equal(mod.registerSelfmaintRoutes(app,{auth}),'ok');
  for(const route of ['/selfmaint/request','/selfmaint/confirm','/selfmaint/apply']){const entry=registered.find(x=>x.route===route);assert.ok(entry,route+' not registered');assert.equal(entry.handlers[0],auth,route+' auth must remain first');assert.equal(entry.handlers.length,3,route+' must preserve legacy handler behind proxy');}
  console.log('CONTROL_PLANE_SELFMAINT_AGENT_API_PROXY_V21=PASS');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
