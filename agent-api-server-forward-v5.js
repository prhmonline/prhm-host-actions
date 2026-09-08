#!/usr/local/bin/prhm-node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const Module=require('module');

const BASE_SERVER_SHA='8e873aa564f685b6002a273856b523639dd2631533742242236ac8c0c6372154';
const OLD_HELPER_SHA='cf6e71a4978e29e089c1fdb45c4f344eee09fcb8ffe59e859da093aed8ca80d3';
const CURRENT_HELPER_SHA='dda9fa1d892c450153c9a1585bf662797e32545e64d4f80e8e1e631d3b25e508';
const OLD_API_PIN='1a04dfc43fedfec9eef4c5a4b79ccd61d63d0cb1145de83b0aa95529f87d7def';
const CURRENT_API_PIN='05b0af5fd6f8ef640ab67ca1ed786818a45b3b439b8fc3fb02ee8cb7b8ccfac8';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const count=(s,n)=>s.split(n).length-1;
function fail(m){throw new Error(m)}
function loadBase(){
  const names=fs.readdirSync(__dirname).filter(n=>n.startsWith('server.js.agent-backup.')).sort().reverse();
  for(const name of names){
    const full=path.join(__dirname,name);
    let st;try{st=fs.lstatSync(full)}catch{continue}
    if(!st.isFile()||st.isSymbolicLink())continue;
    const bytes=fs.readFileSync(full);
    if(sha(bytes)===BASE_SERVER_SHA)return bytes;
  }
  fail('forward_v5_base_backup_missing');
}
const bytes=loadBase();
let source=bytes.toString('utf8');
if(count(source,OLD_HELPER_SHA)!==1||count(source,CURRENT_HELPER_SHA)!==0)fail('forward_v5_helper_anchor_mismatch');
if(count(source,OLD_API_PIN)!==1||count(source,CURRENT_API_PIN)!==0)fail('forward_v5_api_pin_anchor_mismatch');
source=source.replace(OLD_HELPER_SHA,CURRENT_HELPER_SHA).replace(OLD_API_PIN,CURRENT_API_PIN);
if(count(source,OLD_HELPER_SHA)!==0||count(source,CURRENT_HELPER_SHA)!==1)fail('forward_v5_helper_postcondition');
if(count(source,OLD_API_PIN)!==0||count(source,CURRENT_API_PIN)!==1)fail('forward_v5_api_pin_postcondition');
const m=new Module(__filename,module);
m.filename=__filename;
m.paths=module.paths;
m._compile(source,__filename);
