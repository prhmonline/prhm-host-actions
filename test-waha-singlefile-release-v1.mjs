import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const wrapper=fs.readFileSync('safeFiles-waha-singlefile-release-v1.mjs','utf8');
const expected=fs.readFileSync('waha-student-bridge-registration-surface-v37.mjs');
function getEmbeddedBytes(){
  const match=wrapper.match(/const WAHA_B64='([A-Za-z0-9+/=]+)';/);
  assert.ok(match,'embedded source missing');
  return Buffer.from(match[1],'base64');
}
test('reviewed WAHA source is embedded exactly and pinned to Git blob',()=>{
  const bytes=getEmbeddedBytes();
  assert.deepEqual(bytes,expected);
  const hash=execFileSync('git',['hash-object','--stdin'],{input:bytes,encoding:'utf8'}).trim();
  assert.equal(hash,'7b6e08d2ffb9faed164115be085491fce7ce6261');
  const raw=createHash('sha1').update(Buffer.from('blob '+bytes.length))
    .update(Buffer.from([0])).update(bytes).digest('hex');
  assert.equal(raw,hash);
});
test('uses one deployable file with exact current owner and no sidecar dependencies',()=>{
  assert.match(wrapper,/OWNER_SHA256='822e2188d1cb80578fb150eb0066c522c38696459d673ef863473cf584f1c05e'/);
  assert.match(wrapper,/current_safeFiles_exact_backup_missing/);
  assert.match(wrapper,/base_cache_postwrite_sha_mismatch/);
  assert.match(wrapper,/import\('data:text\/javascript;base64,'\+exactWahaCode\(\)\)/);
  assert.doesNotMatch(wrapper,/import\s+.+from\s+'\.\/waha-current-mcp-register-filter-v1\.mjs'/);
  assert.doesNotMatch(wrapper,/(?:execSync|spawnSync|docker\s+run|http:\/\/|https:\/\/)/);
});
test('only two permitted new WAHA tools and existing current tools preserved',()=>{
  assert.match(wrapper,/const result=base\.registerSafeFilesPlugin\(mcp,context\)/);
  assert.match(wrapper,/reviewedWaha\.registerSafeFilesPlugin\(proxy,context\)/);
  assert.match(wrapper,/waha_student_bridge_registration_preflight_v1/);
  assert.match(wrapper,/waha_student_bridge_registration_apply_v1/);
  assert.match(wrapper,/waha_exact_tool_set_missing/);
  assert.match(wrapper,/waha_tool_duplicate/);
  assert.match(wrapper,/if\(!allowed\.has\(name\)\)return undefined/);
});
