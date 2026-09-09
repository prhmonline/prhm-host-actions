const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),Module=require('module');
const mod=require('./central-offsite-manifest-validator-repair-v1.js');
const OLD="function manifest(s){const root=path.join(SNAP_ROOT,s),f=path.join(root,'MANIFEST');const r=cp.spawnSync('/usr/bin/sha256sum',['-c','MANIFEST'],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:400000});if(r.status!==0)throw Error('central_offsite_manifest_verify_failed');return sh(f)}";
function loadCandidate(root){
  const source=`'use strict';\nconst fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');\nconst SNAP_ROOT=${JSON.stringify(root)};\nconst sh=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');\n${OLD}\nmodule.exports={manifest};\n`;
  const out=mod.buildCandidateFromText(source);
  const m=new Module(path.join(root,'candidate.js'),module);m.filename=path.join(root,'candidate.js');m.paths=module.paths;m._compile(out.text,m.filename);return {out,manifest:m.exports.manifest};
}
function validLines(snapshot){return [
  'schema=prhm.central.snapshot.v1',`snapshot=${snapshot}`,'host=node1','created_utc=2026-09-09T09:20:19Z',
  'shifa_managed_separately=true','drtarjomeh_customer_files_excluded=true','source_code_excluded=true','secret_config_excluded=true'
];}
test('replaces exactly the legacy sha256sum validator with strict eight-key metadata validation',()=>{
  assert.equal(typeof mod.buildCandidateFromText,'function');
  const source="'use strict';\n"+OLD+"\nmodule.exports={};\n";
  const out=mod.buildCandidateFromText(source);
  assert.equal(out.replacement_count,1);
  assert.equal(out.text.includes("sha256sum'),['-c','MANIFEST']"),false);
  assert.match(out.text,/central_offsite_manifest_keyset_invalid/);
  assert.match(out.text,/central_offsite_manifest_snapshot_mismatch/);
  assert.match(out.text,/central_offsite_manifest_created_utc_invalid/);
  assert.match(out.text,/central_offsite_manifest_exclusion_flag_invalid/);
});
test('accepts the exact approved eight-key metadata contract and returns MANIFEST sha',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'central-offsite-manifest-'));const snapshot='20260909T092019Z';const dir=path.join(root,snapshot);fs.mkdirSync(dir);
  const f=path.join(dir,'MANIFEST');fs.writeFileSync(f,validLines(snapshot).join('\n')+'\n');const {manifest}=loadCandidate(root);
  assert.equal(manifest(snapshot),crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
});
test('rejects unsafe metadata drift fail-closed',()=>{
  const cases=[
    {name:'flag',mutate:l=>l.map(x=>x==='source_code_excluded=true'?'source_code_excluded=false':x),re:/central_offsite_manifest_exclusion_flag_invalid/},
    {name:'snapshot',mutate:l=>l.map(x=>x.startsWith('snapshot=')?'snapshot=20260909T000000Z':x),re:/central_offsite_manifest_snapshot_mismatch/},
    {name:'created',mutate:l=>l.map(x=>x.startsWith('created_utc=')?'created_utc=invalid':x),re:/central_offsite_manifest_created_utc_invalid/},
    {name:'keyset',mutate:l=>l.slice(0,-1),re:/central_offsite_manifest_keyset_invalid/}
  ];
  for(const c of cases){const root=fs.mkdtempSync(path.join(os.tmpdir(),'central-offsite-manifest-'));const snapshot='20260909T092019Z';const dir=path.join(root,snapshot);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'MANIFEST'),c.mutate(validLines(snapshot)).join('\n')+'\n');const {manifest}=loadCandidate(root);assert.throws(()=>manifest(snapshot),c.re,c.name)}
});
test('fails closed on anchor drift',()=>{assert.throws(()=>mod.buildCandidateFromText("function manifest(s){return 'different'}"),/central_offsite_manifest_validator_anchor_mismatch/)});
