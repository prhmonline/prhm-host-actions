'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const {parseSection,validate,prove,REMOTE,BUNDLE,BYTE_SIZE,classify}=require('./gdrive-dedicated-oauth-candidate-preflight-v1.js');
const token=n=>JSON.stringify({access_token:'access-'+n,refresh_token:'refresh-value-'+n+'-012345678901234567890'});
const old={type:'drive',scope:'drive.file',client_id:'',client_secret:'',token:token('old'),team_drive:'',root_folder_id:''};
const newer={type:'drive',scope:'drive',client_id:'123456-abc.apps.googleusercontent.com',client_secret:'GOCSPX-synthetic-test-secret',token:token('new'),team_drive:'',root_folder_id:''};
const stat=(n=BYTE_SIZE)=>({error:null,exit_code:0,stdout:JSON.stringify({Name:BUNDLE,Path:BUNDLE,Size:n,IsDir:false}),stderr:''});

test('parse exact expected remote only, never logs token',()=>{
 const cfg='[gdrive-backup]\ntype = drive\nscope = drive.file\nclient_id = \ntoken = '+token('old')+'\n';
 assert.equal(parseSection(cfg).scope,'drive.file');
 assert.throws(()=>parseSection(cfg+'[other]\ntype=drive\n'),/REMOTE_SECTION_NOT_EXACT/);
});
test('current legacy scope is incompatible with custom-client migration',()=>{
 assert.equal(old.scope,'drive.file');
 assert.equal(validate(old,newer).candidate_full_drive_scope,true);
 for(const scope of ['drive.file','drive.readonly','drive.metadata.readonly','']){
  assert.throws(()=>validate(old,{...newer,scope}),/CANDIDATE_SCOPE_MUST_BE_DRIVE/);
 }
});
test('token must have been refreshed under the new OAuth application',()=>{
 assert.throws(()=>validate(old,{...newer,token:old.token}),/OAUTH_REAUTH_NOT_PROVEN/);
 assert.throws(()=>validate(old,{...newer,token:JSON.stringify({access_token:'foo'})}),/CANDIDATE_REFRESH_TOKEN_MISSING/);
});
test('reject missing client and changed account root',()=>{
 assert.throws(()=>validate(old,{...newer,client_id:''}),/CUSTOM_OAUTH_CREDENTIALS_MISSING/);
 assert.throws(()=>validate(old,{...newer,root_folder_id:'changed'}),/DRIVE_ROOT_CHANGED/);
 assert.throws(()=>validate(old,{...newer,team_drive:'changed'}),/DRIVE_TARGET_CHANGED/);
});
test('two stat results with exact expected size required',()=>{
 const p=prove(()=>stat());assert.equal(p.status,'CANDIDATE_PROVEN_READ_ONLY');
 assert.equal(p.verified,true);assert.equal(p.observations.length,2);
});
test('transient provider failure blocks and does not expose error',()=>{
 const x=prove(()=>({exit_code:1,error:null,stderr:'429 quota secret=SENSITIVE',stdout:''}));
 assert.equal(x.verified,false);
 assert.equal(x.observations[0].result,'rate_limited');
 assert.equal(JSON.stringify(x).includes('SENSITIVE'),false);
});
test('wrong size or filename prevents cutover',()=>{
 assert.equal(prove(()=>stat(BYTE_SIZE-1)).verified,false);
 const bad=prove(()=>({exit_code:0,error:null,stderr:'',stdout:JSON.stringify({Name:'other',Size:BYTE_SIZE})}));
 assert.equal(bad.verified,false);
});
test('verify-only CLI never accepts apply and never emits secrets',()=>{
 const r=cp.spawnSync(process.execPath,[path.join(__dirname,'gdrive-dedicated-oauth-candidate-preflight-v1.js'),'--apply'],{encoding:'utf8',timeout:6000});
 assert.equal(r.status,3);
 assert.match(r.stdout,/"status": "BLOCKED"/);
 assert.match(r.stdout,/"production_config_mutation": false/);
 assert.doesNotMatch(r.stdout,/access_token|refresh_token|client_secret/);
});
