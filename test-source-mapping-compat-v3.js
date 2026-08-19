'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');

const fixturePath=path.join(__dirname,'fixtures/source-mapping-compat-v3/safeFiles-v2-current.js');
const EXPECTED_SOURCE_SHA='87da44a939478786b9a48585c1cccacd862b683831dbba976d8b6a85869d2473';

function fixture(){return fs.readFileSync(fixturePath,'utf8');}
function sha(s){return crypto.createHash('sha256').update(s).digest('hex');}
function builder(){return require('./build-source-mapping-compat-v3.js');}

test('fixture is exact live V2 source identity',()=>{
  const source=fixture();
  assert.equal(Buffer.byteLength(source),11842);
  assert.equal(sha(source),EXPECTED_SOURCE_SHA);
});

test('builder fails closed on source drift',()=>{
  const {buildCandidate}=builder();
  assert.throws(()=>buildCandidate(fixture()+'\n'),/source_sha_mismatch/);
});

test('candidate adds fixed per-root safe.directory and does not restore HOME',()=>{
  const {content,replacements}=builder().buildCandidate(fixture());
  assert.match(content,/\['-c',`safe\.directory=\$\{root\}`,'-C',root,\.\.\.args\]/);
  assert.doesNotMatch(content,/\bHOME\s*:/);
  assert.doesNotMatch(content,/process\.env\.HOME/);
  assert.equal(replacements.gitSafeDirectory,1);
});

test('candidate keeps sanitized remote contract and hidden changed paths',()=>{
  const {content}=builder().buildCandidate(fixture());
  assert.match(content,/owner_repo:`\$\{owner\}\/\$\{repo\}`/);
  assert.match(content,/credentials_exposed:false,remote_url_exposed:false/);
  assert.match(content,/paths_exposed:false/);
});

test('candidate adds only fixed CF Park base_env DB candidate and still returns name only',()=>{
  const {content,replacements}=builder().buildCandidate(fixture());
  assert.match(content,/common\/config\/base_env\.php/);
  assert.match(content,/database_name:m\[1\],credentials_exposed:false,source_content_exposed:false/);
  assert.equal(replacements.dbCandidate,1);
});

test('candidate preserves V2 and adds exact V3 sentinel and operation',()=>{
  const {content,replacements}=builder().buildCandidate(fixture());
  assert.match(content,/__PRHM_SOURCE_MAPPING_COMPAT_V2__/);
  assert.match(content,/__PRHM_SOURCE_MAPPING_COMPAT_V3__/);
  assert.match(content,/operation:'source_mapping_compat_v3'/);
  assert.match(content,/sourceMappingCompatV2\(\)/);
  assert.match(content,/sourceMappingCompatV3\(\)/);
  assert.equal(replacements.v3Sentinel,1);
  assert.equal(replacements.v3Function,1);
  assert.equal(replacements.v3Proxy,1);
});

test('candidate reports deterministic sha and no caller-controlled path surface',()=>{
  const result=builder().buildCandidate(fixture());
  assert.match(result.sha256,/^[a-f0-9]{64}$/);
  assert.equal(result.sourceSha256,EXPECTED_SOURCE_SHA);
  assert.match(result.content,/const SourceTarget=z\.enum\(\['cfpark_front_prod','cfpark_admin_prod','gisheh360'\]\)/);
  assert.doesNotMatch(result.content,/arbitraryGitPath|callerPath|customRoot/);
});
