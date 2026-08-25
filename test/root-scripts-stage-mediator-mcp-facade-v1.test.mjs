import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXED,
  preflightToolSchema,
  requestToolSchema,
  applyToolSchema,
  createMediatorClient,
  registerMediatorTools
} from '../candidates/control-plane/root-scripts-stage-mediator-mcp-facade-v1.mjs';

test('fixed contract exposes only the mediator socket and three tools',()=>{
  assert.equal(FIXED.socket,'/run/prhm-root-scripts-stage-mediator-v1/mediator.sock');
  assert.deepEqual(Object.keys(FIXED.tools).sort(),['apply','preflight','request']);
  assert.deepEqual(preflightToolSchema(),{});
  assert.deepEqual(requestToolSchema(),{});
  assert.deepEqual(Object.keys(applyToolSchema()).sort(),['request_id','second_confirmation']);
});

test('client sends only fixed mediator requests and validates apply inputs',async()=>{
  const seen=[];
  const transport=async req=>{seen.push(req);return {ok:true,request_id:'11111111-1111-4111-8111-111111111111'};};
  const c=createMediatorClient({transport});
  await c.preflight(); await c.request();
  await c.apply({request_id:'11111111-1111-4111-8111-111111111111',second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'});
  assert.deepEqual(seen.map(x=>[x.method,x.path]),[['POST','/v1/preflight'],['POST','/v1/request'],['POST','/v1/apply']]);
  assert.deepEqual(seen[0].body,{});assert.deepEqual(seen[1].body,{});
  assert.deepEqual(seen[2].body,{request_id:'11111111-1111-4111-8111-111111111111',second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'});
  assert.throws(()=>c.apply({request_id:'bad',second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'}),/invalid_request_id/);
  assert.throws(()=>c.apply({request_id:'11111111-1111-4111-8111-111111111111',second_confirmation:'NO'}),/critical_second_confirmation_required/);
});

test('registration exposes no arbitrary action path command payload or sha inputs',()=>{
  const tools=[]; const mcp={registerTool:(name,cfg,fn)=>tools.push({name,cfg,fn})};
  registerMediatorTools(mcp,{transport:async()=>({ok:true})});
  assert.deepEqual(tools.map(x=>x.name),[
    'control_plane_root_scripts_stage_preflight_v1',
    'control_plane_root_scripts_stage_request_v1',
    'control_plane_root_scripts_stage_apply_v1'
  ]);
  assert.deepEqual(tools[0].cfg.inputSchema,{});assert.deepEqual(tools[1].cfg.inputSchema,{});
  assert.deepEqual(Object.keys(tools[2].cfg.inputSchema).sort(),['request_id','second_confirmation']);
  const all=JSON.stringify(tools.map(x=>x.cfg.inputSchema));
  for(const forbidden of ['action','path','command','payload','sha256','repository','url','service','sql','token','credential']) assert.equal(all.includes('"'+forbidden+'"'),false);
});
