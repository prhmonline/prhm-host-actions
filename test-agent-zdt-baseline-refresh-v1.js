const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cp=require('node:child_process');

const file='bootstrap-agent-zdt-baseline-refresh-v1.js';
const TARGET_CANONICAL='/home/agent/ssh-mcp-server/ops/agent-zdt/agent-zero-downtime-bootstrap-v1.js';
const TARGET_INSTALLED='/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js';
const HELPER_BEFORE='4f1d5a14ae6e13cc25f442dceca7507e8f79088836f4735dcbcad782be126f26';
const BASE_OLD='4d4c9f1a8ff9099165f09a4df0c43735a320b20ca1c0f5c27def299a1fcabb25';
const BASE_NEW='b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877';
const EXEC_OLD='372083619c6c5dd813e413d2873a9015c647ce3a5cb5037b3c1cc4e671c2b22a';
const EXEC_NEW='5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad';
const PROTECTED=[
  '558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f',
  'cf3681ca4d4632156df2f77886afe59c07da9a86dbcb68f4217577f811b22231',
  'ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34',
  'fcf4420ab9b9c0b540f0e88f923065e16a331580cd238a097b9b1c53db34b2d0',
  '5c6ffbd60a5347ad2f21352de856bde2033b7ad5b3599301afd3139be8791102',
  '53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78',
  'd20793dc79ee6d0ffa2ee4bb3b4d5dc1c66750ba0e04f821acb3a45421dcb5ea'
];

function source(){
  assert.equal(fs.existsSync(file),true,'bootstrap implementation must exist');
  return fs.readFileSync(file,'utf8');
}

test('baseline refresh bootstrap is hard-bound to the approved targets and hashes',()=>{
  const s=source();
  for(const token of [TARGET_CANONICAL,TARGET_INSTALLED,HELPER_BEFORE,BASE_OLD,BASE_NEW,EXEC_OLD,EXEC_NEW,...PROTECTED]) assert.ok(s.includes(token),token);
  assert.ok(s.includes('/var/backups/prhm-agent-zdt-baseline-refresh/'));
  assert.ok(s.includes("agent_zdt_baseline_refresh_v1"));
});

test('bootstrap exposes only preflight and apply modes with bounded result flags',()=>{
  const s=source();
  for(const token of ['--preflight-only','--apply','production_mutation','database_mutation','service_restart_reload','replacement_count_per_file','candidate_syntax_ok','rollback_performed']) assert.ok(s.includes(token),token);
  assert.doesNotMatch(s,/systemctl/);
  assert.doesNotMatch(s,/execSync\s*\(/);
  assert.doesNotMatch(s,/child_process\.exec\s*\(/);
});

test('bootstrap contains replacement-count, byte-identity, rollback and final-sha guards',()=>{
  const s=source();
  for(const token of ['replacement_count_invalid','new_literal_already_present','helpers_not_byte_identical','candidate_helpers_not_byte_identical','rollback_sha_mismatch','resulting_helper_sha_mismatch']) assert.ok(s.includes(token),token);
});

test('unexpected CLI arguments fail before filesystem baseline work',()=>{
  assert.equal(fs.existsSync(file),true,'bootstrap implementation must exist before CLI contract can run');
  const r=cp.spawnSync(process.execPath,[file,'--bogus'],{encoding:'utf8'});
  assert.notEqual(r.status,0);
  assert.match(String(r.stderr||''),/unexpected_arguments/);
  assert.doesNotMatch(String(r.stderr||''),/ENOENT|sha_mismatch|missing:/);
});
