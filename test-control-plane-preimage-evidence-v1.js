'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const IMPL=path.join(__dirname,'control-plane-preimage-evidence-v1.js');
function load(){delete require.cache[require.resolve(IMPL)];return require(IMPL)}
test('exports fixed evidence contract',()=>{const m=load();assert.equal(m.ACTION,'control_plane_preimage_evidence_v1');assert.deepEqual(m.PATHS,['/opt/prhm-agent-selfmaint/server.js','/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js']);});
test('source exposes no write or command execution surface',()=>{const s=fs.readFileSync(IMPL,'utf8');for(const t of ['writeFile','chmod','chown','rename','unlink','rmSync','spawn','exec(','systemctl','service '])assert.equal(s.includes(t),false,t);});
test('result exposes metadata only and no content',()=>{const m=load();const r=m.collectWith({stat:p=>({size:p.length,mtime:new Date('2026-01-02T03:04:05Z')}),read:p=>Buffer.from('secret-'+p)});assert.equal(r.ok,true);assert.equal(r.files.length,2);for(const f of r.files){assert.deepEqual(Object.keys(f).sort(),['mtime','path','readable','sha256','size']);assert.equal('content' in f,false);}});
test('fails closed if either fixed path is unreadable',()=>{const m=load();assert.throws(()=>m.collectWith({stat:p=>({size:1,mtime:new Date()}),read:p=>{if(p.includes('hostActionsV2'))throw new Error('EACCES');return Buffer.from('x')}}),/evidence_read_failed/);});
test('rejects arbitrary path injection',()=>{const m=load();assert.equal(m.collectWith.length,1);assert.equal(m.PATHS.includes('/tmp/anything'),false);});
