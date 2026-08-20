'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const fixturePath=path.join(__dirname,'artifacts/source-mapping-compat-v4/safeFiles-v4-candidate.js');
const builderPath=path.join(__dirname,'build-source-mapping-compat-v4-1.js');
const EXPECTED_V4_SHA='22dfb51356b3a89d0b6150b6e67e10ebc5464fb66cb67c9e2a75cb6d2e521481';
function fixture(){return fs.readFileSync(fixturePath,'utf8');}
function sha(s){return crypto.createHash('sha256').update(s).digest('hex');}
function candidate(){
  if(!fs.existsSync(builderPath))return {content:fixture(),replacements:{}};
  delete require.cache[require.resolve('./build-source-mapping-compat-v4-1.js')];
  return require('./build-source-mapping-compat-v4-1.js').buildCandidate(fixture());
}

test('fixture is exact deployed V4 source identity',()=>{
  const source=fixture();
  assert.equal(Buffer.byteLength(source),17114);
  assert.equal(sha(source),EXPECTED_V4_SHA);
});

test('V4.1 preserves leading-space porcelain records with a raw Git helper',()=>{
  const {content}=candidate();
  assert.match(content,/function fixedGitRaw\(target,args\)\{/);
  assert.match(content,/return String\(r\.stdout\|\|''\);\n\}/);
  assert.match(content,/const raw=fixedGitRaw\(target,\['status','--porcelain=v1','-z','--untracked-files=all'\]\);/);
});

test('V4.1 keeps trimmed fixedGit semantics for non-NUL Git commands',()=>{
  const {content}=candidate();
  assert.match(content,/function fixedGit\(target,args\)[\s\S]*?return String\(r\.stdout\|\|''\)\.trim\(\);/);
});

test('regression reproduces trim corruption of worktree-only porcelain status',()=>{
  const raw=' M src/app.js\0?? new.txt\0';
  assert.equal(raw.split('\0')[0].slice(0,2),' M');
  assert.notEqual(raw.trim().split('\0')[0].slice(0,2),' M');
});

test('V4.1 transform is deterministic and exactly two replacements',()=>{
  const result=candidate();
  assert.equal(result.sourceSha256,EXPECTED_V4_SHA);
  assert.match(result.sha256||'',/^[a-f0-9]{64}$/);
  assert.deepEqual(result.replacements,{rawGitHelper:1,statusRawCall:1});
});
