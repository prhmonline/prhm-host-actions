'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const test=require('node:test');
const src=fs.readFileSync(require.resolve('./safeFiles-zdt-v19-rebuild-gitsync-v31.js'),'utf8');

test('v31 exposes only fixed zero-input V19 remediation tools',()=>{
  assert.match(src,/control_plane_agent_zdt_v19_rebuild_current_baseline_v1/);
  assert.match(src,/control_plane_agent_zdt_v19_worktree_git_sync_v2/);
  assert.match(src,/inputSchema:\{\}/);
  assert.match(src,/33b14dff259393cbc1b989ca4721204845a742ce4912a139586e3af71faf85e6/);
  assert.match(src,/cd70da0dbf9e9b58d8bf2e66d1284eb4460863e95cc0156e9922f472562a64d1/);
});
test('git remediation is repo scoped and non-force',()=>{
  assert.match(src,/GITDIR='\/home\/prhm\/git\/prhm-host-actions\.git'/);
  assert.match(src,/writable:\[GITDIR\]/);
  assert.match(src,/git_sync_v2/);
  assert.match(src,/push','origin','HEAD:refs\/heads\//);
  assert.doesNotMatch(src,/--force|push','--force|push','-f/);
  assert.doesNotMatch(src,/BindPaths=\/home['"]/);
});
test('rebuild remains development-only and fail-closed',()=>{
  assert.match(src,/production_mutation:false/);
  assert.match(src,/CONTRACT=GREEN/);
  assert.match(src,/rebuild_failed/);
  assert.match(src,/ProtectHome=read-only/);
  assert.match(src,/ProtectSystem=strict/);
});
