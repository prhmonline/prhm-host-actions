'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const {EventEmitter}=require('node:events');
const path=require('node:path');

const target=process.argv[2]||path.join(__dirname,'runtime','opsSelfmaintBridge.js');
const mod=require(target);
assert.equal(typeof mod.createOpsSelfmaintBridge,'function','bridge factory must exist');

let captured=null;
const originalRequest=http.request;
http.request=(options,callback)=>{
  const req=new EventEmitter();
  let body='';
  req.setTimeout=()=>req;
  req.write=chunk=>{body+=String(chunk);return true;};
  req.end=chunk=>{
    if(chunk)body+=String(chunk);
    captured={options,body:body?JSON.parse(body):{}};
    const res=new EventEmitter();
    res.statusCode=200;
    process.nextTick(()=>{
      callback(res);
      process.nextTick(()=>{res.emit('data',Buffer.from('{"ok":true,"accepted":true}'));res.emit('end');});
    });
  };
  req.destroy=err=>req.emit('error',err);
  return req;
};

(async()=>{
  try{
    const bridge=mod.createOpsSelfmaintBridge();
    const requestId='11111111-1111-4111-8111-111111111111';
    const out=await bridge.execute(JSON.stringify({operation:'selfmaint_confirm',request_id:requestId,second_confirmation:'CONFIRM_LEVEL_3_PRODUCTION',note:'TDD contract'}),{reason:'TDD contract'});
    assert.equal(out.ok,true,'Level-3 selfmaint confirmation must be accepted');
    assert.equal(captured.options.path,'/v1/confirm');
    assert.equal(captured.options.method,'POST');
    assert.equal(captured.body.request_id,requestId);
    assert.equal(captured.body.second_confirmation,'CONFIRM_LEVEL_3_PRODUCTION','bridge must forward the Level-3 literal unchanged');

    await assert.rejects(
      ()=>bridge.execute(JSON.stringify({operation:'selfmaint_confirm',request_id:requestId,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'}),{reason:'TDD contract'}),
      /Level-3 confirmation required/,
      'Level-4 literal must not be accepted by the Level-3 selfmaint confirm operation'
    );
    console.log('OPS_SELFMAINT_BRIDGE_LEVEL3_CONFIRM_V1=PASS');
  } finally {
    http.request=originalRequest;
  }
})().catch(error=>{console.error(error&&error.stack||error);process.exit(1);});
