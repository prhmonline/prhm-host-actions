
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const helperPath=path.join(__dirname,'real-market-shadow-uat-v1.js');
const workerPath=path.join(__dirname,'worker-fixture.js');
const TARGET='4264d724-0015-4250-991b-544ed4aa6313';
function loadPatchWorker(){
  let src=fs.readFileSync(helperPath,'utf8');
  src=src.replace("try{main()}catch(e){process.stderr.write(String(e&&e.stack||e)+'\\n');process.exit(1)}",'module.exports={patchWorker};');
  src=src.replace("if(crypto.createHash('sha256').update(src).digest('hex')!==EXPECTED_WORKER_SHA)fail('worker_source_sha_mismatch');",'');
  const sandbox={module:{exports:{}},exports:{},require,process:{...process,getuid:()=>0},console,Buffer,setTimeout,clearTimeout};
  vm.runInNewContext(src,sandbox,{filename:helperPath});
  return sandbox.module.exports.patchWorker;
}
test('patchWorker embeds literal opportunity UUID and no TARGET expression',()=>{
  const patchWorker=loadPatchWorker();
  const worker="const VER =\n  'p0-shadow-v1';\nconst LOCK =\n  '/run/prhm-p0-shadow-worker/run.lock';\n) econ\n        on true\n\n      where not exists (\n";
  const out=patchWorker(worker,'00000000-0000-4000-8000-000000000001');
  assert.match(out,new RegExp("where o\\.id = '"+TARGET+"'::uuid"));
  assert.equal(out.includes('${TARGET}'),false);
});
