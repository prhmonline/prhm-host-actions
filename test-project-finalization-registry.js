const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const readJson=(p)=>JSON.parse(fs.readFileSync(path.join(__dirname,p),'utf8'));
const registryPath=path.join(__dirname,'config/project-registry-v1.json');
const schemaPath=path.join(__dirname,'config/project-registry-v1.schema.json');
const policyPath=path.join(__dirname,'policy/project-finalization-policy-v1.md');

test('registry has a versioned projects array and unique project keys',()=>{
  const registry=readJson('config/project-registry-v1.json');
  assert.equal(registry.version,'1');
  assert.ok(Array.isArray(registry.projects));
  assert.ok(registry.projects.length>=3);
  const keys=registry.projects.map(p=>p.project_key);
  assert.equal(new Set(keys).size,keys.length);
});

test('registry contains no credential-like keys or credential-bearing URLs',()=>{
  const raw=fs.readFileSync(registryPath,'utf8');
  assert.doesNotMatch(raw,/password|api[_-]?key|authorization|private[_-]?key|access[_-]?token/i);
  assert.doesNotMatch(raw,/https?:\/\/[^\s"/]+:[^\s"@]+@/i);
});

test('schema requires immutable project identity and sheet binding',()=>{
  const schema=readJson('config/project-registry-v1.schema.json');
  assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema');
  const project=schema.$defs.project;
  for(const k of ['project_key','display_name','repositories','sheet','deployment','finalizer_ready']){
    assert.ok(project.required.includes(k),k);
  }
  for(const k of ['role','repository','allowed_branches','required_for_release']){
    assert.ok(schema.$defs.repository.required.includes(k),k);
  }
  for(const k of ['spreadsheet_id','tab','adapter']){
    assert.ok(schema.$defs.sheet.required.includes(k),k);
  }
  for(const k of ['track_staging','track_production','production_verifier']){
    assert.ok(schema.$defs.deployment.required.includes(k),k);
  }
});

test('seed registry contains only evidence-backed initial projects',()=>{
  const registry=readJson('config/project-registry-v1.json');
  const keys=registry.projects.map(p=>p.project_key).sort();
  assert.deepEqual(keys,['gisheh','park-bazar','solo-company']);
});

test('seed project repository and sheet bindings match verified identities',()=>{
  const registry=readJson('config/project-registry-v1.json');
  const expected={
    'park-bazar':{repo:'prhmonline/park-bazar',tab:'Park Bazar'},
    'gisheh':{repo:'prhmonline/gisheh',tab:'Gisheh'},
    'solo-company':{repo:'prhmonline/solo-company',tab:'Solo Company'}
  };
  for(const project of registry.projects){
    const e=expected[project.project_key];
    assert.ok(e,project.project_key);
    assert.equal(project.repositories.length,1);
    assert.equal(project.repositories[0].role,'main');
    assert.equal(project.repositories[0].repository,e.repo);
    assert.deepEqual(project.repositories[0].allowed_branches,['main','baseline/live-import-20260819']);
    assert.equal(project.repositories[0].direct_push_enabled,false);
    assert.equal(project.sheet.spreadsheet_id,'1kA4fQ8398Rj_5zYiPXHfssL3R42dr_MSmVHtIdxnP4k');
    assert.equal(project.sheet.tab,e.tab);
    assert.equal(project.sheet.adapter,'project_status_v1');
  }
});

test('seed projects remain fail-closed until production verification exists',()=>{
  const registry=readJson('config/project-registry-v1.json');
  for(const project of registry.projects){
    assert.equal(project.deployment.track_production,true);
    assert.equal(project.deployment.production_verifier,null);
    assert.equal(project.finalizer_ready,false);
  }
});

test('policy documents the mandatory completion and read-back gates',()=>{
  const policy=fs.readFileSync(policyPath,'utf8');
  for(const token of [
    'FINALIZE_PASS=NO',
    'SHEET_READBACK_VERIFIED',
    'REMOTE_SHA_VERIFIED',
    'PRODUCTION_SHA_VERIFIED',
    'git add -A',
    'change_id'
  ]){
    assert.ok(policy.includes(token),token);
  }
});

test('schema and registry files are valid JSON',()=>{
  assert.doesNotThrow(()=>JSON.parse(fs.readFileSync(schemaPath,'utf8')));
  assert.doesNotThrow(()=>JSON.parse(fs.readFileSync(registryPath,'utf8')));
});
