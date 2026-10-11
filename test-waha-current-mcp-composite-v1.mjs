import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerOnlyWahaTools,WAHA_TOOL_NAMES} from './waha-current-mcp-register-filter-v1.mjs';

const makeMcp=()=>({
  names:['existing_safe_files_tool','leadops_current_tool'],
  registerTool(name){this.names.push(name);}
});

test('registers only two reviewed WAHA tools without removing current tools',()=>{
  const mcp=makeMcp();
  const result=registerOnlyWahaTools(mcp,{tag:'test'},(proxy)=>{
    proxy.registerTool('existing_safe_files_tool',{});
    proxy.registerTool(WAHA_TOOL_NAMES[0],{});
    proxy.registerTool('unrelated_privileged_tool',{});
    proxy.registerTool(WAHA_TOOL_NAMES[1],{});
  });
  assert.deepEqual(mcp.names,[
    'existing_safe_files_tool','leadops_current_tool',
    WAHA_TOOL_NAMES[0],WAHA_TOOL_NAMES[1]
  ]);
  assert.equal(result.retained_existing_tools,true);
  assert.deepEqual(result.registered,WAHA_TOOL_NAMES);
});

test('refuses incomplete registration and duplication',()=>{
  assert.throws(()=>registerOnlyWahaTools(makeMcp(),{},proxy=>{
    proxy.registerTool(WAHA_TOOL_NAMES[0],{});
  }),/exact_tool_set_missing/);
  assert.throws(()=>registerOnlyWahaTools(makeMcp(),{},proxy=>{
    proxy.registerTool(WAHA_TOOL_NAMES[0],{});
    proxy.registerTool(WAHA_TOOL_NAMES[0],{});
    proxy.registerTool(WAHA_TOOL_NAMES[1],{});
  }),/duplicate_tool_registration/);
});

test('rejects invalid callers and filters unrelated tools',()=>{
  assert.throws(()=>registerOnlyWahaTools({}, {},()=>{}),/invalid_inputs/);
  assert.throws(()=>registerOnlyWahaTools(makeMcp(),{},null),/invalid_inputs/);
  const mcp=makeMcp();
  const result=registerOnlyWahaTools(mcp,{},proxy=>{
    proxy.registerTool('stop_all_services',{});
    for(const name of WAHA_TOOL_NAMES)proxy.registerTool(name,{});
  });
  assert.equal(mcp.names.includes('stop_all_services'),false);
  assert.equal(result.registered.length,2);
});

test('composite is pinned to exact current SafeFiles and reviewed WAHA artifact',()=>{
  const source=readFileSync('safeFiles-waha-current-composite-v1.mjs','utf8');
  assert.match(source,/822e2188d1cb80578fb150eb0066c522c38696459d673ef863473cf584f1c05e/);
  assert.match(source,/7b6e08d2ffb9faed164115be085491fce7ce6261/);
  assert.match(source,/safeFiles_current_exact_backup_missing/);
  assert.match(source,/waha_reviewed_source_blob_mismatch/);
  assert.match(source,/CURRENT_SAFE_FILES_SHA256/);
  assert.match(source,/registerOnlyWahaTools\(mcp,context,reviewedWaha\.registerSafeFilesPlugin\)/);
  assert.match(source,/Buffer\.from\(\[0\]\)/);
  assert.doesNotMatch(source,/(?:spawnSync|execSync|fetch\(|http:\/\/|https:\/\/)/);
});
