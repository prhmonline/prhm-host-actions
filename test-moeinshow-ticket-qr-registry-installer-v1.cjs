'use strict';
/**
 * Source-only regression suite for the fixed MoeinShow registrar adapter.
 * Uses in-memory owner/asset stores; never connects to PRHM Control Plane.
 * The fake Level-4 context below is ONLY a test fixture, never an approval.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const a=require('./moeinshow-ticket-qr-registry-installer-v1.cjs');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');

const SAMPLE={
  base:[
    'const HOST_ACTION_V2_SPECS = Object.freeze({',
    "  mcp_candidate_schema_compare_v1: { operation: 'host_action.mcp_candidate_schema_compare_v1', rollback: 'fixed:none' },",
    '});',
    'const HOST_ACTION_V2_LEVEL3 = new Set(["mcp_candidate_schema_compare_v1"]);',
    '// read-only fixture '.repeat(12)
  ].join('\n'),
  executor:[
    'const HOST_ACTION_V2_SPECS = Object.freeze({',
    "  mcp_candidate_schema_compare_v1:{operation:'host_action.mcp_candidate_schema_compare_v1',kind:'mcp_candidate_schema_compare_v1'},",
    '});',
    "async function applyHostActionV2(action){ if(action==='mcp_candidate_schema_compare_v1')return true; }",
    '// executor fixture '.repeat(12)
  ].join('\n'),
  policy:JSON.stringify({
    schema_version:'prhm.approval-policy.v1',version:'source-fixture-v1',
    operations:{'host_action.example':{level:4,risk:'critical'}},typed_scopes:[]
  },null,2),
  mcp:[
    "const HostActionV2=z.enum(['mcp_candidate_schema_compare_v1','leadops_language_gate_v1']);",
    '// MCP fixture '.repeat(12)
  ].join('\n')
};
const keyMap=Object.fromEntries(Object.entries(a.OWNER_PATHS).map(([k,v])=>[v,k]));
const assetFiles={
  [a.ASSETS.helper]:fs.readFileSync(require.resolve('./moeinshow-ticket-qr-qa-v1.js')),
  [a.ASSETS.bundle]:fs.readFileSync(require.resolve('./moeinshow-ticket-qr-fixed-bundle-v1.cjs'))
};
const APPROVAL={level:4,risk:'critical',request_id:'synthetic-qa-not-an-approval'};
function prepare(){
  const modified=a.candidateOwners(SAMPLE);
  const owners=Object.fromEntries(Object.entries(a.OWNER_PATHS).map(([k,p])=>
    [k,{path:p,before_sha256:a.sha(Buffer.from(SAMPLE[k])),
      after_sha256:a.sha(Buffer.from(modified[k]))}]));
  const release={
    source_commit:'0123456789abcdef0123456789abcdef01234567',
    manifest_commit:'89abcdef0123456789abcdef0123456789abcdef',
    manifest_sha256:'3'.repeat(64),
    normalized:{
      action:a.ACTION,project:'moeinshow',
      source_commit:'0123456789abcdef0123456789abcdef01234567',
      owners,
      assets:[
        {path:a.ASSETS.helper,source_path:'moeinshow-ticket-qr-qa-v1.js',
          sha256:a.sha(assetFiles[a.ASSETS.helper])},
        {path:a.ASSETS.bundle,source_path:'moeinshow-ticket-qr-fixed-bundle-v1.cjs',
          sha256:a.sha(assetFiles[a.ASSETS.bundle])}
      ],
      health:{services:[
        'prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
        'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
      ],tool:a.ACTION}
    }
  };
  const store=new Map(Object.entries(a.OWNER_PATHS).map(([k,p])=>
    [p,Buffer.from(SAMPLE[k])]));
  for(const [k,v] of Object.entries(assetFiles))store.set(k,Buffer.from(v));
  const baseline=new Map([...store].map(([k,v])=>[k,Buffer.from(v)]));
  return {release,store,baseline};
}
function makeIO(setup,opts={}){
  const snapshotCopies=new Map();let writes=0;const log=[];
  function maybeFail(){
    writes++;
    if(opts.failAfterWrite===writes)throw new Error('synthetic_write_fail');
  }
  const io={
    readOwner:async p=>setup.store.get(p),
    readStagedAsset:async p=>assetFiles[p],
    assertSafeTarget:async p=>{
      const allowed=p in keyMap || Object.values(a.ASSETS).includes(p) ||
        p.startsWith(a.FIXTURE_ROOT);
      assert.ok(allowed,'unexpected mutable path');
    },
    serviceHealthy:async service=>service.endsWith('.service'),
    snapshot:async (kind,payload)=>{
      assert.equal(kind,'create_exact_backup');
      assert.ok(Array.isArray(payload.paths));
      const id='backup-synthetic-immutable-01';
      snapshotCopies.set(id,new Map([...setup.store].map(([k,v])=>[k,Buffer.from(v)])));
      log.push('backup');
      return id;
    },
    writeOwnerAtomic:async (p,value)=>{maybeFail();setup.store.set(p,Buffer.from(value));log.push('owner');},
    writeFixtureAtomic:async (p,value)=>{maybeFail();setup.store.set(p,Buffer.from(value));log.push('fixture');},
    removeFixture:async p=>{setup.store.delete(p);},
    restoreSnapshot:async id=>{
      const original=snapshotCopies.get(id);assert.ok(original);
      setup.store.clear();
      for(const [p,v] of original)setup.store.set(p,Buffer.from(v));
      log.push('rollback');
    },
    verifySnapshot:async id=>{
      const original=snapshotCopies.get(id);if(!original)return false;
      if(original.size!==setup.store.size)return false;
      for(const [p,v] of original)if(!setup.store.has(p) ||
        !setup.store.get(p).equals(v))return false;
      return true;
    },
    restartServices:async _=>{log.push('restart');},
    discoverTool:async action=>action===a.ACTION && opts.failDiscovery!==true,
    audit:async event=>{log.push('audit:'+event.result);}
  };
  return {io,log,restored:()=>{
    if(setup.store.size!==setup.baseline.size)return false;
    for(const [p,v] of setup.baseline)if(!setup.store.get(p)?.equals(v))return false;
    return true;
  }};
}
test('four registry transforms bounded, deterministic and not generic',()=>{
  const x=a.candidateOwners(SAMPLE);
  assert.deepEqual(Object.keys(x).sort(),Object.keys(a.OWNER_PATHS).sort());
  for(const [k,v] of Object.entries(x)){
    assert.ok(v.includes(a.ACTION),k);
    assert.notEqual(a.sha(Buffer.from(v)),a.sha(Buffer.from(SAMPLE[k])));
  }
  const p=JSON.parse(x.policy);
  assert.equal(p.operations[a.OPERATION].level,3);
  assert.equal(p.operations[a.OPERATION].expires_seconds,180);
  assert.equal(p.typed_scopes.at(-1).action,a.ACTION);
  assert.equal(p.version,'source-fixture-v1');
});
test('second install is blocked by preimage and duplicate action guards',()=>{
  const modified=a.candidateOwners(SAMPLE);
  for(const [k,v] of Object.entries(modified)){
    assert.throws(()=>a.candidateOwners({...SAMPLE,[k]:v}),/already_registered/);
  }
});
test('bundle only contains the eight SHA-bound fixture files',()=>{
  const bundle=require('./moeinshow-ticket-qr-fixed-bundle-v1.cjs');
  const fixture=a.verifyFixture(bundle);
  assert.equal(Object.keys(fixture).length,8);
  assert.ok(Object.keys(fixture).every(x=>x.startsWith(a.FIXTURE_ROOT)));
  assert.throws(()=>a.verifyFixture({...bundle,entries:{...bundle.entries,'bad.php':{text:'bad',blob_sha:'0'.repeat(40)}}}),/bundle_extra_or_missing/);
});
test('preflight refuses owner byte drift BEFORE any write',async()=>{
  const setup=prepare();const env=makeIO(setup);
  setup.store.set(a.OWNER_PATHS.mcp,Buffer.from(SAMPLE.mcp+'DRIFT'));
  await assert.rejects(a.preflight(setup.release,env.io),/preimage_sha_mcp/);
  assert.equal(env.log.length,0);
});
test('preflight refuses manifest postimage SHA drift BEFORE write',async()=>{
  const setup=prepare();const env=makeIO(setup);
  setup.release.normalized.owners.base.after_sha256='f'.repeat(64);
  await assert.rejects(a.preflight(setup.release,env.io),/postimage_sha_base/);
  assert.equal(env.log.length,0);
});
test('fail on second owner atomic write restores every preimage',async()=>{
  const setup=prepare();const env=makeIO(setup,{failAfterWrite:2});
  const c=a.createGatewayCallbacks(setup.release,env.io);
  await assert.rejects(gateway.finalizeVerifiedInstall({
    release:setup.release,approval:APPROVAL,...c
  }),/failed_rollback_verified/);
  assert.ok(env.log.includes('rollback'));
  assert.ok(env.restored());
});
test('fail on discovery restores modified registries and fixture files',async()=>{
  const setup=prepare();const env=makeIO(setup,{failDiscovery:true});
  const c=a.createGatewayCallbacks(setup.release,env.io);
  await assert.rejects(gateway.finalizeVerifiedInstall({
    release:setup.release,approval:APPROVAL,...c
  }),/failed_rollback_verified/);
  assert.ok(env.log.includes('rollback'));
  assert.ok(env.restored());
});
test('valid synthetic install calls discovery, audits and changes only fixed paths',async()=>{
  const setup=prepare();const env=makeIO(setup);
  const c=a.createGatewayCallbacks(setup.release,env.io);
  const result=await gateway.finalizeVerifiedInstall({release:setup.release,approval:APPROVAL,...c});
  assert.equal(result.ok,true);
  assert.equal(result.registry_visible,true);
  assert.equal(setup.store.get(a.OWNER_PATHS.base).toString().includes(a.ACTION),true);
  assert.equal([...setup.store.keys()].filter(x=>x.startsWith(a.FIXTURE_ROOT)).length,8);
  assert.ok(env.log.includes('audit:registered'));
});
test('unverified rollback explicitly fails closed',async()=>{
  const setup=prepare();const env=makeIO(setup,{failAfterWrite:2});
  env.io.restoreSnapshot=async()=>{throw new Error('synthetic_rollback_broken')};
  const c=a.createGatewayCallbacks(setup.release,env.io);
  await assert.rejects(gateway.finalizeVerifiedInstall({release:setup.release,approval:APPROVAL,...c}),
    /rollback_unverified/);
});
test('installer has no direct CLI apply or approval bypass',()=>{
  assert.deepEqual(a.main(['--source-review-only']),{
    source_only:true,registered:false,action:a.ACTION
  });
  for(const args of [[],['--install'],['--apply'],['--preflight'],['--source-review-only','extra']])
    assert.throws(()=>a.main(args),/direct_execution_forbidden/);
});
