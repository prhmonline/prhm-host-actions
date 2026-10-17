'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mod = require('./honartik-iticket-root-installer-base-rebind-candidate-v1.cjs');

const make = (base = mod.OLD_BASE_SHA) =>
  "'use strict';\nconst PREIMAGES={base:'" + base +
  "',executor:'" + 'a'.repeat(64) + "',policy:'" + 'b'.repeat(64) +
  "',mcp:'" + 'c'.repeat(64) + "'};\n" +
  "function preflight(x){if(x.base!==PREIMAGES.base)throw Error('baseline_drift:base')}\n" +
  "/* source-only fixture; no actual installer or host access */\n";

test('all operator-observed fingerprints are exact lowercase SHA-256', () => {
  for (const val of [mod.INSTALLER_SHA,mod.OLD_BASE_SHA,mod.LIVE_BASE_SHA])
    assert.match(val,/^[a-f0-9]{64}$/);
  assert.notEqual(mod.OLD_BASE_SHA, mod.LIVE_BASE_SHA);
});

test('patch changes exactly the single base owner pin', () => {
  const src=make(), output=mod.rebindSource(src);
  assert.equal(output.length,src.length);
  assert.equal(output.replace(mod.LIVE_BASE_SHA,mod.OLD_BASE_SHA),src);
  assert.equal(output.includes(mod.OLD_BASE_SHA),false);
  assert.equal(output.includes('executor:\''+'a'.repeat(64)),true);
  assert.equal(output.includes('policy:\''+'b'.repeat(64)),true);
  assert.equal(output.includes('mcp:\''+'c'.repeat(64)),true);
});

test('exact quoted base property is supported without matching unrelated fields',()=>{
  const src=make().replace("base:'",'"base":"').replace(mod.OLD_BASE_SHA+"'",mod.OLD_BASE_SHA+'"');
  assert.equal(mod.rebindSource(src).includes('"base":"'+mod.LIVE_BASE_SHA+'"'),true);
});

test('refuses old SHA when associated with a wrong or ambiguous field', () => {
  assert.throws(()=>mod.rebindSource(make('a'.repeat(64))),/unexpected_base_pin/);
  const s=make().replace("base:'","unrelated:'");
  assert.throws(()=>mod.rebindSource(s),/base_property_count/);
});

test('refuses any extra old pin, missing base, or previously patched base', () => {
  assert.throws(()=>mod.rebindSource(make()+"\n// "+mod.OLD_BASE_SHA),/old_pin_duplicate/);
  assert.throws(()=>mod.rebindSource(make().replace("base:","other:")),/base_property_count/);
  assert.throws(()=>mod.rebindSource(make(mod.LIVE_BASE_SHA)),/unexpected_base_pin/);
});

test('refuses synthetic installer and base bytes not validated to exact production SHA',()=>{
  const src=make();
  assert.throws(()=>mod.makeCandidate({}),/byte_inputs_required/);
  assert.throws(()=>mod.makeCandidate({installerBytes:Buffer.from(src),baseBytes:Buffer.from('x')}),/installer_preimage_sha_drift/);
});

test('no CLI mutation path: only pure functions are exported',()=>{
  assert.deepEqual(Object.keys(mod).sort(),[
    'ACTION','INSTALLER_SHA','LIVE_BASE_SHA','OLD_BASE_SHA',
    'LIVE_EXECUTOR_SHA','LIVE_POLICY_SHA','OLD_POLICY_SHA',
    'LIVE_MCP_SHA','OLD_MCP_SHA','RELEASE_BLOCKERS',
    'makeCandidate','rebindSource','sha256'
  ].sort());
  const source=require('node:fs').readFileSync(require.resolve('./honartik-iticket-root-installer-base-rebind-candidate-v1.cjs'),'utf8');
  for(const s of ['systemctl restart','child_process','execSync(','spawnSync(','process.argv','chmodSync(','writeFileSync(','unlinkSync(','eval('])
    assert.equal(source.includes(s),false, 'forbidden side-effect substring '+s);
});

test('observed extra owner drifts block the one-SHA installer path',()=>{
  assert.equal(mod.LIVE_POLICY_SHA,'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174');
  assert.equal(mod.LIVE_MCP_SHA,'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166');
  assert.notEqual(mod.OLD_POLICY_SHA,mod.LIVE_POLICY_SHA);
  assert.notEqual(mod.OLD_MCP_SHA,mod.LIVE_MCP_SHA);
  assert.ok(mod.RELEASE_BLOCKERS.includes('executor_expected_pin_unknown'));
  assert.ok(mod.RELEASE_BLOCKERS.includes('full_live_source_and_semantic_contract_unreviewed'));
  const program=require('node:fs').readFileSync(require.resolve('./honartik-iticket-root-installer-base-rebind-candidate-v1.cjs'),'utf8');
  assert.match(program,/fail\('four_owner_release_blocked'\)/);
  assert.equal(/candidate_bytes\s*:/.test(program),false);
});
