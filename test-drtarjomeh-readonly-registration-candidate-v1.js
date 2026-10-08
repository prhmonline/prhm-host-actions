'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const impl=require('./drtarjomeh-readonly-registration-candidate-v1.js');
const pins=require('./drtarjomeh-preflight-agent3-live-pins-check-v1.js');

const API="'use strict';\nfunction registerHonartikIticketV14PreflightRoutes(app,{auth}){\n  app.post('/test',auth,async(req,res)=>{\n  });\n}\nmodule.exports={};\n";
const MCP="import { textResult } from '../core/result.js';\nexport function registerHonartikIticketPreflightPlugin(mcp,{agent}){\n  mcp.registerTool('test',{inputSchema:{}},async()=>textResult(await agent.callAgent('/honartik/iticket/v14/preflight','POST',{})));\n}\n";
test('approved artifact files and 4 live-owner hashes are fixed',()=>{
  assert.equal(pins.validateManifest(),true);
  assert.equal(pins.EXPECTED_PREIMAGES.length,4);
  assert.equal(impl.selftest().approved_artifacts,3);
  assert.equal(impl.selftest().production_mutation,false);
  assert.equal(impl.selftest().registration_authorized,false);
});
test('API insertion stays inside existing registration body and is additive',()=>{
  const out=impl.buildApi(API);
  assert.equal(out.split('app.post(\'/test\'').length-1,1);
  assert.equal(out.split('registerDrtarjomehReadonlyPreflightRoute(app,{auth});').length-1,1);
  assert.match(out,/registerDrtarjomehReadonlyPreflightRoute\(app,\{auth\}\);\n\}\nmodule\.exports=/);
  assert.match(out,/require\('\.\/drtarjomeh-preflight-agent-api-route-v1\.js'\)/);
  assert.throws(()=>impl.buildApi(out),/already_registered/);
  assert.throws(()=>impl.buildApi("'use strict';\nmodule.exports={}"),/anchor_count/);
});
test('MCP insertion preserves existing tool registration and is replay-safe',()=>{
  const out=impl.buildMcp(MCP);
  assert.equal(out.split("mcp.registerTool('test'").length-1,1);
  assert.equal(out.split('registerDrtarjomehCurrentReleasePreflight(mcp,{agent});').length-1,1);
  assert.match(out,/registerDrtarjomehCurrentReleasePreflight\(mcp,\{agent\}\);\n\}/);
  assert.match(out,/from '\.\/drtarjomeh-preflight-mcp-adapter-v1\.mjs'/);
  assert.throws(()=>impl.buildMcp(out),/already_registered/);
  assert.throws(()=>impl.buildMcp("import { textResult } from '../core/result.js';"),/anchor_count/);
});
test('no live SHA drift can pass preflight and neither mode mutates production',()=>{
  const dir={isDirectory:()=>true,isSymbolicLink:()=>false,isFile:()=>false};
  const file={isDirectory:()=>false,isSymbolicLink:()=>false,isFile:()=>true};
  const fake={lstatSync:p=>p.endsWith('.js')?file:dir,readFileSync:()=>Buffer.from('stale-preimage')};
  assert.throws(()=>impl.verifyLiveInputs(fake),/live_sha_drift/);
  const invalid=spawnSync(process.execPath,[path.join(__dirname,'drtarjomeh-readonly-registration-candidate-v1.js'),'--install'],{encoding:'utf8'});
  assert.equal(invalid.status,1);
  assert.match(invalid.stderr,/unsupported_mode/);
  const s=fs.readFileSync(path.join(__dirname,'drtarjomeh-readonly-registration-candidate-v1.js'),'utf8');
  assert.doesNotMatch(s,/writeFileSync|renameSync|unlinkSync|execFileSync|spawnSync|systemctl|fetch\(/);
});
test('asset plan is exactly three reviewed Git blobs with fixed destinations',()=>{
  const plan=impl.assetPlan(p=>fs.readFileSync(path.join(__dirname,p)));
  assert.equal(plan.length,3);
  assert.equal(new Set(plan.map(x=>x.target)).size,3);
  assert.ok(plan.every(x=>x.sha256.length===64&&x.bytes>0));
  assert.throws(()=>impl.assetPlan(()=>Buffer.from('tampered')),/artifact_sha_drift/);
});
test('CLI is restricted to source selftest and readonly on-host mode',()=>{
  const cli=spawnSync(process.execPath,[path.join(__dirname,'drtarjomeh-readonly-registration-candidate-v1.js'),'--selftest-only'],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);
  const result=JSON.parse(cli.stdout);
  assert.equal(result.ok,true);
  assert.equal(result.preflight_only,true);
  assert.equal(result.production_mutation,false);
  assert.equal(result.registration_authorized,false);
});
