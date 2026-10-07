'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const H='./drtarjomeh-login-source-sync-v38-host-action.js';
const B='./bootstrap-host-actions-v38-drtarjomeh-login-source-sync.js';

test('manifest is fixed Level-4 zero-input and never mutates live runtime',()=>{
  const h=require(H);
  const b=require(B).registrationPlan();
  const m=h.manifest();
  for(const x of [m,b]){
    assert.equal(x.action,'drtarjomeh_login_source_sync_v38');
    assert.equal(x.level,4);
    assert.equal(x.risk,'critical');
    assert.equal(x.zero_input,true);
    assert.equal(x.arbitrary_command,false);
    assert.equal(x.arbitrary_path,false);
    assert.equal(x.database_mutation,false);
    assert.equal(x.live_runtime_mutation,false);
  }
  assert.equal(m.source_repository,'/home/drtarjomeh/domains/drtarjomeh.ir/repository');
  assert.equal(m.active_release,'/home/drtarjomeh/domains/drtarjomeh.ir/releases/20261006-224241-0e8686eed30f');
  assert.equal(m.expected_revision,'0e8686eed30fb23bf51ca2bc345a62a227e7bc55');
  assert.equal(m.target_branch,'fix/drtarjomeh-login-pro-max-canonical-20261007');
  assert.equal(b.required_user,'drtarjomeh');
});

test('payload is exactly the six verified production login files',()=>{
  const h=require(H);
  const expected=[
    'common/themes/metronic/LoginAssets.php',
    'common/themes/metronic/views/layouts/base.php',
    'common/themes/metronic/views/user/_loginForm.php',
    'common/themes/metronic/web/css/login.css',
    'core/themes/codebase/views/layouts/login.php',
    'panel/views/user/login.php'
  ].sort();
  assert.deepEqual(Object.keys(h.PAYLOAD).sort(),expected);
  for(const [rel,digest] of Object.entries(h.PAYLOAD)){
    assert.equal(h.safeRel(rel),rel);
    assert.match(digest,/^[a-f0-9]{64}$/);
  }
  assert.equal(h.assertPayload(),true);
  assert.deepEqual(h.REQUIRED_CHANGED.slice().sort(),[
    'common/themes/metronic/LoginAssets.php',
    'common/themes/metronic/web/css/login.css',
    'core/themes/codebase/views/layouts/login.php'
  ].sort());
});

test('helper exposes no caller-controlled path, command, branch or revision input',()=>{
  const h=require(H);
  assert.equal(h.preflight.length,0);
  assert.equal(h.apply.length,0);
  assert.equal(h.manifest.length,0);
  const source=fs.readFileSync(H,'utf8');
  assert.doesNotMatch(source,/shell\s*:\s*true/);
  assert.doesNotMatch(source,/\/bin\/(ba)?sh/);
  assert.doesNotMatch(source,/execSync\s*\(/);
  assert.match(source,/GIT_TERMINAL_PROMPT:'0'/);
  assert.doesNotMatch(source,/chownSync\(WORKTREE_ROOT/);
  assert.match(source,/worktree','add','--detach'/);
  assert.match(source,/push','--porcelain','origin','HEAD:'\+TARGET_REF/);
});

test('fixed source-sync contract keeps canonical source HEAD and live pointer unchanged',()=>{
  const source=fs.readFileSync(H,'utf8');
  assert.match(source,/source_head_unchanged:true/);
  assert.match(source,/source_worktree_clean:true/);
  assert.match(source,/production_pointer_unchanged:true/);
  assert.match(source,/rollbackRemote/);
  assert.match(source,/cleanupWorktree/);
});
