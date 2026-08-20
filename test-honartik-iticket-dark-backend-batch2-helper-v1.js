const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const helper=require('./honartik-iticket-dark-backend-batch2-helper-v1.js');

test('Batch2 helper is SHA-bound to Batch1 and renders the exact isolated service surface',()=>{
  assert.equal(helper.WORKTREE,'/home/honartik/worktrees/iticket-dark-v1-back');
  assert.equal(helper.EXPECTED_HEAD,'54d8038a64ce64e78c84dfeaffbb4cca36446108');
  assert.equal(helper.EXPECTED_BRANCH,'feature/iticket-dark-v1');
  assert.deepEqual(helper.BASELINE_SHA256,{
    'app/components/iticket/IticketConfig.php':'033b636fd5b491006e2ee6f129720301aea1778f0b3e412423cc25b94ecce66f',
    'app/components/iticket/IticketClient.php':'d717f45ab691ff2da664a0fbfbe964f348f1944d75f80e2b6d9b0f79469ee723',
    'app/components/iticket/tests/DarkGateTest.php':'1153e731f404e45fe3d7b9ce55f0551085ec4394d195512f3ace3762261fd1e2'
  });
  const files=helper.renderFiles();
  const required=[
    'app/components/iticket/support/IticketPath.php',
    'app/components/iticket/catalog/IticketCatalogAdapter.php',
    'app/components/iticket/catalog/IticketCatalogService.php',
    'app/components/iticket/schedules/IticketScheduleAdapter.php',
    'app/components/iticket/schedules/IticketScheduleService.php',
    'app/components/iticket/seats/IticketSeatAdapter.php',
    'app/components/iticket/seats/IticketSeatService.php',
    'app/components/iticket/orders/IticketResellerOrderAdapter.php',
    'app/components/iticket/orders/IticketResellerOrderService.php',
    'app/components/iticket/tests/Batch2DarkNetworkTest.php',
    'app/components/iticket/tests/CatalogAdapterTest.php',
    'app/components/iticket/tests/ScheduleAdapterTest.php',
    'app/components/iticket/tests/SeatAdapterTest.php',
    'app/components/iticket/tests/ResellerOrderAdapterTest.php'
  ];
  assert.deepEqual(Object.keys(files).sort(),required.sort());
});

test('all outbound API paths are centralized through IticketClient and match OpenAPI v1',()=>{
  const files=helper.renderFiles();
  const prod=Object.entries(files).filter(([p])=>!p.includes('/tests/'));
  const joined=prod.map(([,s])=>s).join('\n');
  for(const forbidden of ['curl_init','curl_exec','Guzzle','stream_socket_client','fsockopen']) assert.equal(joined.includes(forbidden),false,forbidden);
  assert.match(files['app/components/iticket/catalog/IticketCatalogService.php'],/request\('GET', IticketPath::withQuery\('\/shows'/);
  assert.match(files['app/components/iticket/schedules/IticketScheduleService.php'],/\/schedules\/shows/);
  assert.match(files['app/components/iticket/seats/IticketSeatService.php'],/\/schedules\/' \. IticketPath::id\(\$scheduleId\) \. '\/seats/);
  assert.match(files['app/components/iticket/orders/IticketResellerOrderService.php'],/request\('POST', '\/reseller\/orders\/reserve'/);
  assert.match(files['app/components/iticket/orders/IticketResellerOrderService.php'],/\/reseller\/orders\/' \. IticketPath::id\(\$orderId\) \. '\/cancel/);
});

test('helper includes rollback, PHP lint, Batch1 regression, Batch2 tests and no production/deploy/network behavior',()=>{
  const src=require('node:fs').readFileSync(path.join(__dirname,'honartik-iticket-dark-backend-batch2-helper-v1.js'),'utf8');
  for(const needle of ['rollback','php_lint_failed','DarkGateTest.php','Batch2DarkNetworkTest.php','production_application_tree_mutation:false','database_mutation:false','deploy:false','external_network:false','token_read:false']) assert.match(src,new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});


test('reconciliation classifies all-absent, all-exact and fails closed on partial or mismatch',()=>{
  const fs=require('node:fs');
  const os=require('node:os');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'iticket-b2-reconcile-'));
  const rendered={'a/x.txt':'one','b/y.txt':'two'};
  try{
    assert.equal(helper.classifyRenderedState(root,rendered),'all_absent');
    fs.mkdirSync(path.join(root,'a'),{recursive:true});
    fs.writeFileSync(path.join(root,'a/x.txt'),'one');
    assert.throws(()=>helper.classifyRenderedState(root,rendered),/batch2_partial_existing_state/);
    fs.mkdirSync(path.join(root,'b'),{recursive:true});
    fs.writeFileSync(path.join(root,'b/y.txt'),'two');
    assert.equal(helper.classifyRenderedState(root,rendered),'all_exact');
    fs.writeFileSync(path.join(root,'b/y.txt'),'tampered');
    assert.throws(()=>helper.classifyRenderedState(root,rendered),/batch2_existing_sha_mismatch:b\/y.txt/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('result bridge persists latest.json atomically and exports the fixed result path',()=>{
  const fs=require('node:fs');
  const os=require('node:os');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'iticket-b2-result-'));
  try{
    const target=path.join(root,'latest.json');
    const result={ok:true,action:'honartik_iticket_dark_backend_batch2_v1'};
    helper.persistResult(target,result);
    assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),result);
    assert.equal(fs.statSync(target).mode & 0o777,0o600);
    assert.equal(helper.RESULT_FILE,'/var/lib/prhm-agent-selfmaint-exec/honartik-iticket-dark-backend-batch2-v1/latest.json');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
