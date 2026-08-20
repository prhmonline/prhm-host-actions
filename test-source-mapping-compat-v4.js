'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const fixturePath=path.join(__dirname,'artifacts/source-mapping-compat-v3/safeFiles-v3-candidate.js');
const builderPath=path.join(__dirname,'build-source-mapping-compat-v4.js');
const EXPECTED_V3_SHA='92e6e279f10fe8561a9c986d9dc90d6bc0cd284009ed9984f51fefe202ac6252';
function fixture(){return fs.readFileSync(fixturePath,'utf8');}
function sha(s){return crypto.createHash('sha256').update(s).digest('hex');}
function candidate(){
  if(!fs.existsSync(builderPath))return {content:fixture(),replacements:{}};
  delete require.cache[require.resolve('./build-source-mapping-compat-v4.js')];
  return require('./build-source-mapping-compat-v4.js').buildCandidate(fixture());
}

test('fixture is exact deployed V3 source identity',()=>{
  const source=fixture();
  assert.equal(Buffer.byteLength(source),12232);
  assert.equal(sha(source),EXPECTED_V3_SHA);
});

test('V4 adds exact zero-input sentinel and operation while preserving V2/V3',()=>{
  const {content}=candidate();
  assert.match(content,/__PRHM_SOURCE_MAPPING_COMPAT_V4__/);
  assert.match(content,/operation:'source_mapping_compat_v4'/);
  assert.match(content,/__PRHM_SOURCE_MAPPING_COMPAT_V3__/);
  assert.match(content,/__PRHM_SOURCE_MAPPING_COMPAT_V2__/);
  assert.match(content,/function sourceMappingCompatV4\(\)/);
});

test('V4 changed-path diagnostics are fixed-scope and bounded',()=>{
  const {content}=candidate();
  assert.match(content,/const MAX_CHANGED_PATHS=20;/);
  assert.match(content,/status_code/);
  assert.match(content,/relative_path/);
  assert.match(content,/tracked/);
  assert.match(content,/untracked/);
  assert.match(content,/changed_paths_truncated/);
  assert.match(content,/SourceTarget=z\.enum\(\['cfpark_front_prod','cfpark_admin_prod','gisheh360'\]\)/);
});

test('V4 reports only bounded numstat metadata and never diff hunks or file bodies',()=>{
  const {content}=candidate();
  assert.match(content,/\['diff','--numstat','HEAD','--',rel\]/);
  assert.match(content,/additions/);
  assert.match(content,/deletions/);
  assert.match(content,/binary/);
  assert.doesNotMatch(content,/diff_hunk|patch_text|file_body/);
  assert.match(content,/SENSITIVE\.test\(rel\)/);
});

test('V4 local-only commits are bounded to short sha plus sanitized subject',()=>{
  const {content}=candidate();
  assert.match(content,/const MAX_LOCAL_COMMITS=10;/);
  assert.match(content,/@\{upstream\}\.\.HEAD/);
  assert.match(content,/%h%x09%s/);
  assert.match(content,/short_sha/);
  assert.match(content,/subject/);
  assert.match(content,/local_only_commits_truncated/);
  assert.match(content,/\[REDACTED\]/);
});

test('V4 has no caller-controlled command path or remote URL output',()=>{
  const {content}=candidate();
  assert.match(content,/function sourceMappingCompatV4\(\)/);
  assert.doesNotMatch(content,/arbitraryGitPath|callerPath|customRoot|remote_url:/);
  assert.match(content,/credentials_exposed:false/);
  assert.match(content,/remote_url_exposed:false/);
});

test('V4 sentinel proxy is exact and source transform remains deterministic',()=>{
  const result=candidate();
  assert.match(result.content,/args\?\.target==='root_scripts'&&args\?\.path===SOURCE_MAPPING_COMPAT_V4_SENTINEL/);
  assert.match(result.sha256||'',/^[a-f0-9]{64}$/);
  assert.equal(result.sourceSha256,EXPECTED_V3_SHA);
  assert.deepEqual(result.replacements,{v4Sentinel:1,v4Bounds:1,v4Diagnostics:1,v4Function:1,v4Proxy:1});
});
