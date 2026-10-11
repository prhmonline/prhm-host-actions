'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const g=require('./imotion-shifa-review-preflight-v1.cjs');
function i(){return {project:g.IMOTION.project,repo:g.IMOTION.repo,root:g.IMOTION.root,
 head:g.IMOTION.head,target:g.IMOTION.target,tree:g.IMOTION.tree,github:g.IMOTION.github,
 branch:'main',paths:[...g.IMOTION.paths],fileManifest:g.IMOTION.paths.map((path,n)=>({
 path,sha256:'a'.repeat(64),mode:0o644,symlink:false,status:n<13?'modified':'untracked'}))};}
function s(){return {project:g.SHIFA.project,repo:g.SHIFA.repo,root:g.SHIFA.root,
 head:g.SHIFA.head,github:g.SHIFA.github,branch:'main',dirty:[g.SHIFA.path],
 gitUser:'prhm',readOnlyIdentity:true,privateKeyDisclosed:false,runtimeTouched:false};}
test('iMotion requires all 27 unique exact paths and SHA/modes',()=>{
 assert.equal(g.IMOTION.paths.length,27);assert.equal(new Set(g.IMOTION.paths).size,27);
 assert.equal(g.imotion(i()).evidence_shape_valid,true);
 const x=i();x.paths.pop();assert.equal(g.imotion(x).evidence_shape_valid,false);
 const y=i();y.fileManifest[0].symlink=true;assert.equal(g.imotion(y).evidence_shape_valid,false);
});
test('iMotion rejects alternate repo, target SHA, tree or arbitrary command',()=>{
 for(const key of ['repo','target','tree','head']){const x=i();x[key]='wrong';assert.equal(g.imotion(x).evidence_shape_valid,false);}
 const x=i();x.command='override';assert.equal(g.imotion(x).evidence_shape_valid,false);
});
test('shape match never grants authority or deploy',()=>{
 const x=g.imotion(i());assert.equal(x.approved,false);assert.equal(x.deployed,false);
 assert.equal(x.action_registered,false);assert.equal(x.permission_granted,false);
});
test('Shifa exact repo-scoped read-only identity and unchanged runtime',()=>{
 assert.equal(g.shifa(s()).evidence_shape_valid,true);
 for(const change of [{gitUser:'root'},{readOnlyIdentity:false},{privateKeyDisclosed:true},
  {runtimeTouched:true},{dirty:[]},{github:'bad'}]){const x=Object.assign(s(),change);
  assert.equal(g.shifa(x).evidence_shape_valid,false);}
});
test('missing or extra sensitive evidence always fails closed',()=>{
 for(const fn of [g.imotion,g.shifa]){
  assert.equal(fn(null).evidence_shape_valid,false);
  assert.equal(fn({secret:'never'}).evidence_shape_valid,false);
 }
});
