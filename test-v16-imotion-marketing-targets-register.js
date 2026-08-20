'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const helper=require('./imotion-marketing-targets-register-v2.js');
const bootstrap=require('./bootstrap-host-actions-v16-imotion-marketing-targets-register.js');

test('helper identity and targets are split correctly',()=>{
  assert.equal(helper.ACTION,'imotion_marketing_targets_register_v2');
  assert.equal(helper.TARGETS.front.name,'imotion_marketing_front_prod');
  assert.equal(helper.TARGETS.sale.name,'imotion_sale_wordpress_prod');
  assert.match(helper.TARGETS.front.root,/domains\/imotion\.ir\/public_html$/);
  assert.match(helper.TARGETS.sale.root,/domains\/sale\.imotion\.ir\/public_html$/);
});

test('target verification distinguishes static front and WordPress sale without reading wp-config',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'imotion-v16-'));
  const front=path.join(tmp,'front'),sale=path.join(tmp,'sale');
  fs.mkdirSync(path.join(front,'.git'),{recursive:true});
  fs.writeFileSync(path.join(front,'index.html'),'<html></html>');
  fs.mkdirSync(path.join(sale,'wp-content'),{recursive:true});
  fs.writeFileSync(path.join(sale,'wp-config.php'),'DO_NOT_READ_SECRET_MARKER');
  const out=helper.verifyTargetRoots({front:{root:front},sale:{root:sale}});
  assert.deepEqual(out,{front_target_root_exists:true,static_front_detected:true,sale_target_root_exists:true,wordpress_detected:true,targets_verified:true});
  fs.rmSync(path.join(front,'.git'),{recursive:true,force:true});
  assert.throws(()=>helper.verifyTargetRoots({front:{root:front},sale:{root:sale}}),/front_git_missing_or_unsafe/);
  fs.rmSync(tmp,{recursive:true,force:true});
});

test('Agent API project injection adds both targets exactly once',()=>{
  const src=`const projects={\n  imotion_front_prod:{root:'/mnt/imotion-prod-vm/domains/i-motion.ir/public_html',remoteRoot:'/home/imotion/domains/i-motion.ir/public_html'},\n  imotion_admin_prod:{root:'/mnt/imotion-prod-vm/domains/admin.i-motion.ir/public_html'}\n};`;
  const out=helper.injectImotionMarketingProjects(src);
  assert.equal((out.match(/imotion_marketing_front_prod\s*:/g)||[]).length,1);
  assert.equal((out.match(/imotion_sale_wordpress_prod\s*:/g)||[]).length,1);
  assert.match(out,/sale\.imotion\.ir\/public_html/);
});

test('MCP project and safeFiles patches expose both targets',()=>{
  const project=`export function registerProjectPlugin(mcp,context){const schema=z.object({project:z.enum(['imotion_front_prod','imotion_admin_prod'])});mcp.tool('run_project_command','x',schema,()=>{});}`;
  const po=helper.patchProjectPlugin(project);
  assert.match(po,/imotion_marketing_front_prod/);
  assert.match(po,/imotion_sale_wordpress_prod/);
  const safe=`const ExpandedTarget = z.enum(['imotion_front_prod','imotion_admin_prod']);`;
  const so=helper.patchSafeFiles(safe);
  assert.match(so,/'imotion_marketing_front_prod','imotion_sale_wordpress_prod'/);
});

test('bootstrap patches registries, dispatch, pending status, and namespace precreate',()=>{
  const base=`  imotion_marketing_target_register_v1: { operation: 'host_action.imotion_marketing_target_register_v1', rollback: 'host-action-v2:imotion-marketing-target-register-v1:source-restore' },\n  drtarjomeh_security_containment_v1:`;
  assert.match(bootstrap.patchBase(base),/imotion_marketing_targets_register_v2/);
  const executor=`  imotion_marketing_target_register_v1:{operation:'host_action.imotion_marketing_target_register_v1',kind:'imotion_marketing_target_register_v1'},\n  drtarjomeh_security_containment_v1:\nconst applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){if(action==='imotion_marketing_target_register_v1')return applyImotionMarketingTargetRegisterV1();return applyHostActionV2Original(action);};\nif (req.method === 'POST' && req.url === '/v2/host-actions/status') {const body=await readBody(req);const requestId=validateUuid(body.request_id);const file=hostActionV2JobFile(requestId);if(!fs.existsSync(file))return json(res,404,{ok:false,error:'host_action_v2_status_not_found'});return json(res,200,{ok:true,job:sanitize(readJson(file))});}`;
  const eo=bootstrap.patchExecutor(executor);
  assert.match(eo,/imotion_marketing_targets_register_v2/);
  assert.match(eo,/fs\.mkdirSync\(IMOTION_MARKETING_TARGETS_BACKUP/);
  assert.match(eo,/hostActionV2RequestFile/);
  assert.match(eo,/status:'pending'/);
  assert.match(eo,/host_action_v2_request_expired/);
  assert.match(eo,/ReadWritePaths=.*prhm-imotion-marketing-targets-v2/);
});

test('policy and MCP schema add only V2',()=>{
  const policy=JSON.stringify({operations:{},typed_scopes:[]});
  const p=JSON.parse(bootstrap.patchPolicy(policy));
  assert.equal(p.operations['host_action.imotion_marketing_targets_register_v2'].level,4);
  assert.equal(p.typed_scopes[0].action,'imotion_marketing_targets_register_v2');
  const mcp=`const HostActionV2=z.enum(['imotion_marketing_target_register_v1','drtarjomeh_security_containment_v1']);`;
  const mo=bootstrap.patchMcp(mcp);
  assert.match(mo,/'imotion_marketing_target_register_v1','imotion_marketing_targets_register_v2','drtarjomeh_security_containment_v1'/);
});

test('ZDT patch refreshes stale bindings to current/candidate hashes',()=>{
  const src=`'7efeeb17253bc52aeac1f362c377fd4121984f49f159fd9e72ae7e06897ded56' '70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c' '85229ccd95e98523e9d87468df1fcaec4107c6834f5c4e0bc108b265a0a499cf' '6bd9c56b4d5889c1d70d8278bcd66f48cab9561f2429cd3489a5b42ab1bbc35f'`;
  const h={mcp:'1'.repeat(64),base:'2'.repeat(64),executor:'3'.repeat(64)};
  const out=bootstrap.patchZdt(src,h);
  assert.match(out,new RegExp('1'.repeat(64)));
  assert.match(out,new RegExp('2'.repeat(64)));
  assert.match(out,new RegExp('3'.repeat(64)));
  assert.match(out,/7171a63ac5a7e72cd7c0af7d0c90e7d16abd17ed1af623441c44387444e77b23/);
});

test('V16 source contains no production-site mutation path',()=>{
  const src=fs.readFileSync(path.join(__dirname,'imotion-marketing-targets-register-v2.js'),'utf8');
  assert.match(src,/production_site_mutation:false/);
  assert.match(src,/database_mutation:false/);
  assert.match(src,/redirect_mutation:false/);
  assert.match(src,/canonical_mutation:false/);
});
