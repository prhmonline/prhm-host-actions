const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');

function loadHealthFunctions(){
  const src=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v5-leadops-economics-foundation.js'),'utf8')
    .replace(/\nmain\(\);\s*$/, '\nmodule.exports={loopbackHealth,unixHealth};\n');
  const temp=path.join(os.tmpdir(),'prhm-v5-health-'+process.pid+'-'+Date.now()+'.js');
  fs.writeFileSync(temp,src);
  delete require.cache[temp];
  const mod=require(temp);
  fs.unlinkSync(temp);
  return mod;
}

function transientCurlFailures(successBody){
  let attempts=0;
  const original=cp.spawnSync;
  cp.spawnSync=(file,args,opts)=>{
    if(file==='/usr/bin/curl'){
      attempts++;
      if(attempts<3)return {status:7,stdout:'',stderr:"curl: (7) Couldn't connect to server"};
      return {status:0,stdout:successBody,stderr:''};
    }
    return original(file,args,opts);
  };
  return {attempts:()=>attempts,restore:()=>{cp.spawnSync=original;}};
}

test('loopback health tolerates transient service readiness failures',()=>{
  const fake=transientCurlFailures('{"ok":true,"service":"mcp"}');
  try{
    const {loopbackHealth}=loadHealthFunctions();
    assert.deepEqual(loopbackHealth(8123),{ok:true,service:'mcp'});
    assert.equal(fake.attempts(),3);
  }finally{fake.restore();}
});

test('unix health tolerates transient socket readiness failures',()=>{
  const fake=transientCurlFailures('{"ok":true,"service":"selfmaint"}');
  try{
    const {unixHealth}=loadHealthFunctions();
    assert.deepEqual(unixHealth('/run/example.sock'),{ok:true,service:'selfmaint'});
    assert.equal(fake.attempts(),3);
  }finally{fake.restore();}
});
