'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const M=require('./manifests/honartik-config-center-registry-release-v2.json');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const A=require('./prhm-action-registry-v2-root-accountability-v1.cjs');
const id='12345678-1234-4234-8234-123456789abc';
const release={source_commit:F.REQUEST.source_commit,manifest_commit:F.REQUEST.manifest_commit,manifest_sha256:F.REQUEST.manifest_sha256,normalized:G.assertManifest(M)};
test('V2 owner release matching prevents old or swapped manifests',()=>{
 assert.equal(A.checkRelease(release).action,M.action);
 assert.throws(()=>A.checkRelease({...release,source_commit:'0'.repeat(40)}),/release_identity_drift/);
 assert.throws(()=>A.checkRelease({...release,normalized:{...release.normalized,action:'other'}}),/release_action_not_allowlisted/);
});
test('original state refuses wrong owner before any other file probing',()=>{
 let touched=0;
 assert.throws(()=>A.strictOriginalState(release,{uid:()=>0,io:{lstatSync:()=>{touched++}},readLiveOwner:()=>Buffer.from('wrong')}),/owner_not_restored_/);
 assert.equal(touched,0);
});
test('audit strictly bound to one request without secret fields',()=>{
 const record={request_id:id,action:M.action,project:'honartik',source_commit:F.REQUEST.source_commit,manifest_commit:F.REQUEST.manifest_commit,manifest_sha256:F.REQUEST.manifest_sha256,result:'registered',rollback:'not_needed'};
 const p=A.auditPayload(record,id);
 assert.equal(p.filename,A.AUDIT+'/'+id+'.json');
 assert.throws(()=>A.auditPayload({...record,token:'secret'},id),/input_schema_unexpected/);
 assert.throws(()=>A.auditPayload({...record,rollback:'verified'},id),/audit_success_rollback_invalid/);
 assert.throws(()=>A.appendBoundAudit(record,{requestId:id,uid:()=>1}),/root_required/);
});
