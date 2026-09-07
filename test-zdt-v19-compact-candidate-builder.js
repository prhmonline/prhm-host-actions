#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(process.argv[2]||'zdt-v19-compact-candidate-builder.js','utf8');
test('builder is read-only toward V19 worktree',()=>{assert.doesNotMatch(source,/writeFileSync\(\s*IMPL|renameSync\([^\n]*IMPL|unlinkSync\([^\n]*IMPL/);assert.match(source,/EXPECTED_IMPL='33b14dff/);assert.match(source,/EXPECTED_TEST='cd70da0d/);});
test('builder preserves immutable installer SHA and uses brotli',()=>{assert.match(source,/d391e32332f0707a5a8829ceb436c613da9afec073b4642e2b2edd29f5c5d57d/);assert.match(source,/brotliCompressSync/);assert.match(source,/brotliDecompressSync/);assert.match(source,/source_sha_mismatch/);});
test('builder emits only candidates/meta and enforces patch size',()=>{assert.match(source,/--emit-impl/);assert.match(source,/--emit-test/);assert.match(source,/--meta/);assert.match(source,/MAX_PATCH_BYTES=120000/);assert.doesNotMatch(source,/writeFileSync\(\s*IMPL/);assert.doesNotMatch(source,/renameSync\([^\n]*IMPL/);});
