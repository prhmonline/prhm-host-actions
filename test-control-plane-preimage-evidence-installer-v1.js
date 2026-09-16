'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const IMPL=path.join(__dirname,'control-plane-preimage-evidence-installer-v1.js');
function load(){delete require.cache[require.resolve(IMPL)];return require(IMPL)}

test('exports exact installer contract',()=>{const m=load();assert.equal(m.ACTION,'control_plane_preimage_evidence_installer_v1');assert.equal(m.TARGET_ACTION,'control_plane_preimage_evidence_v1');assert.equal(m.EXECUTOR_SHA,'409b63bd48b3363eaec2b3921f77ece2767dff93f6143923bdb754fe8f4cf69c');assert.equal(m.POLICY_SHA,'9672e88b8c5033b7107e921d25bd4911216e86a8fe593ee67ac2330e0a75bab2');});

test('source contains no arbitrary target or shell surface',()=>{const s=fs.readFileSync(IMPL,'utf8');for(const t of ['process.argv','child_process','spawn(','exec(','execFile','systemctl','service ','eval('])assert.equal(s.includes(t),false,t);});

test('preflight fails closed on executor or policy sha mismatch',()=>{const m=load();const io={sha:p=>p.includes('server.js')?'bad':'9672e88b8c5033b7107e921d25bd4911216e86a8fe593ee67ac2330e0a75bab2'};assert.throws(()=>m.preflight(io),/executor_sha_mismatch/);});

test('plan is fixed and rollback-safe',()=>{const m=load();const p=m.plan();assert.deepEqual(p.target_action,'control_plane_preimage_evidence_v1');assert.equal(p.registration_scope,'fixed');assert.equal(p.rollback,true);assert.equal(p.production_application_mutation,false);assert.equal(p.database_mutation,false);});

test('installer requires privileged live evidence before any write',()=>{const m=load();const okio={sha:p=>p.includes('server.js')?'409b63bd48b3363eaec2b3921f77ece2767dff93f6143923bdb754fe8f4cf69c':'9672e88b8c5033b7107e921d25bd4911216e86a8fe593ee67ac2330e0a75bab2'};const pf=m.preflight(okio);assert.equal(pf.ok,true);assert.equal(pf.requires_privileged_live_evidence,true);assert.deepEqual(pf.required_live_paths,['/opt/prhm-agent-selfmaint/server.js','/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js']);});
