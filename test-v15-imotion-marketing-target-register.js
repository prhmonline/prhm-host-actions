'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const ROOT=__dirname;
const helperPath=path.join(ROOT,'imotion-marketing-target-register-v1.js');
const bootstrapPath=path.join(ROOT,'bootstrap-host-actions-v15-imotion-marketing-target-register.js');
const TARGET={
  name:'imotion_marketing_prod',
  root:'/mnt/imotion-prod-vm/domains/imotion.ir/public_html',
  remoteHost:'imotion-prod-vm',
  remoteRoot:'/home/imotion/domains/imotion.ir/public_html',
  description:'iMotion marketing WordPress production site'
};

test('helper exposes the exact fixed iMotion marketing target binding',()=>{
  const helper=require(helperPath);
  assert.equal(helper.ACTION,'imotion_marketing_target_register_v1');
  assert.deepEqual(helper.TARGET,TARGET);
});

test('helper injects target into Agent API baseline source exactly once',()=>{
  const helper=require(helperPath);
  const base=`const projects={\n  imotion_front_prod:{root:'/mnt/imotion-prod-vm/domains/i-motion.ir/public_html',remoteHost:'imotion-prod-vm',remoteRoot:'/home/imotion/domains/i-motion.ir/public_html'},\n  imotion_admin_prod:{root:'/mnt/imotion-prod-vm/domains/admin.i-motion.ir/public_html'}\n};`;
  const out=helper.injectImotionMarketingProject(base);
  assert.match(out,/imotion_marketing_prod/);
  assert.match(out,/domains\/imotion\.ir\/public_html/);
  assert.equal((out.match(/imotion_marketing_prod/g)||[]).length,1);
  assert.throws(()=>helper.injectImotionMarketingProject(out),/already_present/);
});

test('helper patches wrapper compile, project command schema, safe-file target and ZDT manifest',()=>{
  const helper=require(helperPath);
  const api=`const compiled={filename:'x',_compile(){}}; const source='x'; compiled._compile(source,compiled.filename);`;
  const apiOut=helper.patchAgentApiServer(api);
  assert.match(apiOut,/injectImotionMarketingProject/);
  assert.match(apiOut,/compiled\._compile\(injectImotionMarketingProject\(source\),compiled\.filename\)/);

  const project=`import fs from 'node:fs';\nfunction proxy(mcp){return mcp;}\nexport function registerProjectPlugin(mcp,context){return base.registerProjectPlugin(proxy(mcp),context);}`;
  const projectOut=helper.patchProjectPlugin(project);
  assert.match(projectOut,/imotion_marketing_prod/);
  assert.match(projectOut,/run_project_command/);
  assert.match(projectOut,/registerProjectPluginOriginal/);

  const safe=`const ExpandedTarget=z.enum(['imotion_front_prod','imotion_admin_prod','root_scripts']);`;
  const safeOut=helper.patchSafeFiles(safe);
  assert.match(safeOut,/'imotion_marketing_prod'/);

  const zdt=`const EXPECTED_SHA=Object.freeze({\n'/home/agent/ssh-agent-api/server.js':'70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c',\n'/home/agent/ssh-mcp-server/src/plugins/project.js':'f0a6cc26250ff0f6de05d2d67c3789a84a33c4ded8d1f0d6a1048389e955c511',\n'/home/agent/ssh-mcp-server/src/plugins/safeFiles.js':'2f4cedb73d58bff927e09e8d0b534a08cf49f08b3e5da54f47900f57d8a5f910'\n});`;
  const zdtOut=helper.patchZdtManifest(zdt,{api:'a'.repeat(64),project:'b'.repeat(64),safeFiles:'c'.repeat(64)});
  assert.match(zdtOut,/'a{64}'/);
  assert.match(zdtOut,/'b{64}'/);
  assert.match(zdtOut,/'c{64}'/);
});

test('bootstrap registers a fixed Level-4 Host Action with no production-site mutation',()=>{
  const bootstrap=require(bootstrapPath);
  assert.equal(bootstrap.ACTION,'imotion_marketing_target_register_v1');
  assert.equal(bootstrap.OPERATION,'host_action.imotion_marketing_target_register_v1');
  assert.equal(bootstrap.BASELINE.base,'b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877');
  assert.equal(bootstrap.BASELINE.executor,'5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad');
  assert.equal(bootstrap.BASELINE.mcp,'ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34');
  assert.equal(bootstrap.BASELINE.policy,'c56f3f7c35e6ac22735f0689371e8ca4a7de6f8c375436a456798f8df0b7596a');
  const policy=JSON.parse(bootstrap.patchPolicy(JSON.stringify({version:'old',operations:{},typed_scopes:[]})));
  assert.deepEqual(policy.operations[bootstrap.OPERATION],{level:4});
  const scope=policy.typed_scopes.find(x=>x.action===bootstrap.ACTION);
  assert.equal(scope.tool,'host_action_v2_apply');
  assert.equal(scope.risk,'critical');
  assert.equal(scope.project,'control_plane');
});

test('helper result contract explicitly excludes WordPress, database, redirect and canonical mutation',()=>{
  const src=fs.readFileSync(helperPath,'utf8');
  for(const marker of ['production_site_mutation:false','database_mutation:false','redirect_mutation:false','canonical_mutation:false','requires_zdt_refresh:true']) assert.match(src,new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')));
  assert.doesNotMatch(src,/wp-cli|wp\s+option|UPDATE\s+wp_|INSERT\s+INTO|redirect.*write|canonical.*write/i);
});

test('both installer and helper carry rollback-before-partial-success guards',()=>{
  const helper=fs.readFileSync(helperPath,'utf8');
  const bootstrap=fs.readFileSync(bootstrapPath,'utf8');
  assert.match(helper,/mutated\.push/);
  assert.match(helper,/reverse\(\)/);
  assert.match(helper,/rollback_performed/);
  assert.match(bootstrap,/phase:'prepared'/);
  assert.match(bootstrap,/restoreBackup/);
  assert.match(bootstrap,/rollback/);
});


test('ZDT manifest fails closed when project or safeFiles bindings are absent',()=>{
  const helper=require(helperPath);
  const onlyApi=`const X={\n'/home/agent/ssh-agent-api/server.js':'70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c'\n};`;
  assert.throws(()=>helper.patchZdtManifest(onlyApi,{api:'a'.repeat(64),project:'b'.repeat(64),safeFiles:'c'.repeat(64)}),/zdt_(path_missing|sha_binding_count).*project\.js/);
  const apiAndProject=`const X={\n'/home/agent/ssh-agent-api/server.js':'70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c',\n'/home/agent/ssh-mcp-server/src/plugins/project.js':'f0a6cc26250ff0f6de05d2d67c3789a84a33c4ded8d1f0d6a1048389e955c511'\n};`;
  assert.throws(()=>helper.patchZdtManifest(apiAndProject,{api:'a'.repeat(64),project:'b'.repeat(64),safeFiles:'c'.repeat(64)}),/zdt_(path_missing|sha_binding_count).*safeFiles\.js/);
});

test('Agent API compile patch tolerates whitespace and line breaks',()=>{
  const helper=require(helperPath);
  const api=`const compiled={filename:'x',_compile(){}}; const source='x';\ncompiled ._compile (\n  source,\n  compiled.filename\n);`;
  const out=helper.patchAgentApiServer(api);
  assert.match(out,/injectImotionMarketingProject/);
});

test('safeFiles enum patch tolerates whitespace around assignment and enum call',()=>{
  const helper=require(helperPath);
  const safe=`const ExpandedTarget = z.enum( [ 'imotion_front_prod', 'imotion_admin_prod', 'root_scripts' ] );`;
  const out=helper.patchSafeFiles(safe);
  assert.match(out,/imotion_marketing_prod/);
});

test('comment mentioning target name does not count as existing project binding',()=>{
  const helper=require(helperPath);
  const base=`// planned name: imotion_marketing_prod\nconst projects={\n  imotion_front_prod:{root:'/mnt/imotion-prod-vm/domains/i-motion.ir/public_html',remoteHost:'imotion-prod-vm',remoteRoot:'/home/imotion/domains/i-motion.ir/public_html'},\n  imotion_admin_prod:{root:'/mnt/imotion-prod-vm/domains/admin.i-motion.ir/public_html'}\n};`;
  const out=helper.injectImotionMarketingProject(base);
  assert.equal((out.match(/imotion_marketing_prod\s*:/g)||[]).length,1);
});
