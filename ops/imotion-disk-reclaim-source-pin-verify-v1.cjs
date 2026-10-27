'use strict';
/**
 * CI-only immutable source provenance verification for iMotion disk reclaim.
 * Does not install, approve, consume, execute or contact Production.
 * This intentionally accepts a review-only manifest, NOT the host registrar's
 * prhm.action-registry.release.v1 installation manifest.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const MANIFEST=path.resolve(__dirname,'../manifests/imotion-disk-reclaim-source-review-v1.json');
const SOURCE_COMMIT='913ed54f13dd6338ab83f32191677cde72dd6546';
const SCHEMA='prhm.imotion.disk-reclaim.source-review.v1';
const FILES=Object.freeze([
 'ops/imotion-disk-reclaim-fixed-v1.cjs',
 'ops/imotion-disk-reclaim-fixed-v1.test.cjs',
 'ops/imotion-disk-reclaim-registration-readiness-v1.cjs',
 'ops/imotion-disk-reclaim-registration-readiness-v1.test.cjs'
]);
const DIGEST=s=>crypto.createHash('sha256').update(s).digest('hex');
const BLOB=s=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+s.length+'\0')).update(s).digest('hex');
function verify(){
 const m=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
 assert.deepEqual(Object.keys(m).sort(),[
  'schema','status','repository','project','action','source_commit',
  'not_a_registration_manifest','requires_signed_l4_root_bootstrap','files'
 ].sort());
 assert.equal(m.schema,SCHEMA);
 assert.equal(m.status,'SOURCE_ONLY_PRODUCTION_NO_GO');
 assert.equal(m.repository,'prhmonline/prhm-host-actions');
 assert.equal(m.project,'imotion_admin_prod');
 assert.equal(m.action,'imotion_disk_reclaim_v1');
 assert.equal(m.source_commit,SOURCE_COMMIT);
 assert.equal(m.not_a_registration_manifest,true);
 assert.equal(m.requires_signed_l4_root_bootstrap,true);
 assert(Array.isArray(m.files)&&m.files.length===FILES.length);
 for(let i=0;i<FILES.length;i++){
  const rec=m.files[i],filename=FILES[i];
  assert.deepEqual(Object.keys(rec).sort(),['source_path','git_blob_sha1','sha256'].sort());
  assert.equal(rec.source_path,filename);
  assert.match(rec.sha256,/^[0-9a-f]{64}$/);
  assert.match(rec.git_blob_sha1,/^[0-9a-f]{40}$/);
  const sourceBytes=cp.execFileSync('/usr/bin/git',['show',SOURCE_COMMIT+':'+filename],{
   cwd:path.resolve(__dirname,'..'),timeout:15000,maxBuffer:2000000
  });
  const currentBytes=fs.readFileSync(path.resolve(__dirname,'..',filename));
  assert.equal(DIGEST(sourceBytes),rec.sha256,'pinned source drift '+filename);
  assert.equal(BLOB(sourceBytes),rec.git_blob_sha1,'pinned Git blob drift '+filename);
  assert.equal(DIGEST(currentBytes),rec.sha256,'reviewed head drift '+filename);
 }
 console.log('IMOTION_PINNED_SOURCE_REVIEW_PASS='+FILES.length);
 console.log('SOURCE_COMMIT='+SOURCE_COMMIT);
 console.log('PRODUCTION_AUTHORIZED=NO');
 return true;
}
if(require.main===module)verify();
module.exports=Object.freeze({verify,SOURCE_COMMIT,FILES});
