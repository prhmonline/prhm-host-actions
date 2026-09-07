#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const cp=require('node:child_process');
const path=require('node:path');
const WT='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2';
const IMPL=path.join(WT,'bootstrap-host-actions-v18-agent-zdt-current-baseline-refresh.js');
const TEST=path.join(WT,'test-v18-agent-zdt-current-baseline-refresh.js');
const EXPECTED_IMPL='33b14dff259393cbc1b989ca4721204845a742ce4912a139586e3af71faf85e6';
const EXPECTED_TEST='cd70da0dbf9e9b58d8bf2e66d1284eb4460863e95cc0156e9922f472562a64d1';
const EXPECTED_INSTALLER='d391e32332f0707a5a8829ceb436c613da9afec073b4642e2b2edd29f5c5d57d';
const MAX_PATCH_BYTES=120000;
function sha(v){return crypto.createHash('sha256').update(v).digest('hex');}
function fail(c){throw new Error(c);}
function readBound(file,expected){const b=fs.readFileSync(file);const h=sha(b);if(h!==expected)fail('preimage_sha_mismatch:'+path.basename(file)+':'+h);return b;}
function syntaxBytes(bytes,label){const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:null,timeout:30000,maxBuffer:1000000});if(r.error||r.status!==0)fail('syntax_invalid:'+label+':'+String(r.stderr||r.stdout||''));}
function makeCompressedStage(installerSource){
 const installerBytes=Buffer.from(installerSource,'utf8');
 const installerSha=sha(installerBytes);
 if(installerSha!==EXPECTED_INSTALLER)fail('installer_sha_drift:'+installerSha);
 const compressed=zlib.brotliCompressSync(installerBytes,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:11}});
 const b64=compressed.toString('base64');
 return `
const REGISTRATION_STAGE_TRANSPORT_ACTION =
  'control_plane_current_baseline_refresh_registration_installer_stage_v1';

const REGISTRATION_INSTALLER_SOURCE_SHA256 =
  '${installerSha}';

const REGISTRATION_INSTALLER_DESTINATION =
  '/opt/prhm-agent-selfmaint-exec/actions/' +
  'current-baseline-refresh-registration-installer-v1.js';

function buildRegistrationStageTransportSource() {
  const INSTALLER_B64 =
    ${JSON.stringify(b64)};

  const INSTALLER_SHA =
    '${installerSha}';

  return \`'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const ACTION='control_plane_current_baseline_refresh_registration_installer_stage_v1';
const DESTINATION='/opt/prhm-agent-selfmaint-exec/actions/current-baseline-refresh-registration-installer-v1.js';
const INSTALLER_SHA='\${INSTALLER_SHA}';
const INSTALLER_B64='\${INSTALLER_B64}';
const BACKUP_ROOT='/var/backups/prhm-current-baseline-refresh-registration-installer-stage-v1';
function fail(code){throw new Error(code);}
function digest(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function assertRegularExact(file,label){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile())fail(label+'_not_regular');if(fs.realpathSync(file)!==file)fail(label+'_realpath_mismatch');return st;}
function installerBytes(){let bytes;try{bytes=zlib.brotliDecompressSync(Buffer.from(INSTALLER_B64,'base64'));}catch{fail('source_decompression_failed');}const actual=digest(bytes);if(actual!==INSTALLER_SHA)fail('source_sha_mismatch:'+actual);const checked=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:null,timeout:30000,maxBuffer:1000000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}});if(checked.error||checked.status!==0)fail('candidate_sha_mismatch:installer_syntax_invalid');return bytes;}
function destinationState(){if(!fs.existsSync(DESTINATION))return {exists:false,stat:null,bytes:null,sha256:null};const st=assertRegularExact(DESTINATION,'destination');const bytes=fs.readFileSync(DESTINATION);return {exists:true,stat:st,bytes,sha256:digest(bytes)};}
function atomicWrite(file,bytes,mode,uid,gid,suffix){const dir=path.dirname(file);const tmp=path.join(dir,'.'+path.basename(file)+'.'+suffix+'-'+process.pid+'-'+Date.now()+'.tmp');let fd;try{fd=fs.openSync(tmp,'wx',mode);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chmodSync(tmp,mode);fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file);}catch(error){try{if(fd!==undefined)fs.closeSync(fd);}catch{}try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}throw error;}}
function preflight(){const candidate=installerBytes();const before=destinationState();return {ok:true,schema_version:'prhm.registration-installer-stage-preflight.v1',action:ACTION,preflight_only:true,candidate_sha256:digest(candidate),destination:DESTINATION,destination_exists:before.exists,destination_sha256:before.sha256,arbitrary_path:false,arbitrary_command:false,external_network:false,production_owner_mutation:false,database_mutation:false,production_mutation:false};}
function apply(){if(process.getuid&&process.getuid()!==0)fail('root_required');const candidate=installerBytes();const before=destinationState();const parent=path.dirname(DESTINATION);const parentStat=fs.statSync(parent);const mode=before.exists?before.stat.mode&0o777:0o700;const uid=before.exists?before.stat.uid:parentStat.uid;const gid=before.exists?before.stat.gid:parentStat.gid;const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);const backupDir=path.join(BACKUP_ROOT,stamp+'-'+process.pid);fs.mkdirSync(backupDir,{recursive:true,mode:0o700});let backupPath=null;if(before.exists){backupPath=path.join(backupDir,'current-baseline-refresh-registration-installer-v1.js.bak');fs.writeFileSync(backupPath,before.bytes,{mode:0o600,flag:'wx'});}let wrote=false;try{atomicWrite(DESTINATION,candidate,mode,uid,gid,'stage');wrote=true;assertRegularExact(DESTINATION,'destination_postwrite');const finalSha=digest(fs.readFileSync(DESTINATION));if(finalSha!==INSTALLER_SHA)fail('installer_sha_mismatch:'+finalSha);const checked=cp.spawnSync('/usr/local/bin/prhm-node',['--check',DESTINATION],{encoding:'utf8',timeout:30000,maxBuffer:1000000});if(checked.error||checked.status!==0)fail('postwrite_installer_syntax_invalid');return {ok:true,schema_version:'prhm.registration-installer-stage-result.v1',action:ACTION,status:'succeeded',destination:DESTINATION,old_sha256:before.sha256,new_sha256:finalSha,backup_path:backupPath,arbitrary_path:false,arbitrary_command:false,external_network:false,production_owner_mutation:false,database_mutation:false,production_mutation:true,rollback_performed:false};}catch(error){let rollbackError=null;if(wrote){try{if(before.exists){atomicWrite(DESTINATION,before.bytes,before.stat.mode&0o777,before.stat.uid,before.stat.gid,'rollback');if(digest(fs.readFileSync(DESTINATION))!==before.sha256)fail('rollback_sha_mismatch');}else if(fs.existsSync(DESTINATION)){fs.unlinkSync(DESTINATION);}}catch(e){rollbackError=String(e&&e.message||e);}}if(rollbackError)fail('stage_failed_rollback_failed:'+String(error&&error.message||error)+':'+rollbackError);fail('stage_failed_rolled_back:'+String(error&&error.message||error));}}
function main(){const args=process.argv.slice(2);if(args.length!==1||!['--preflight-only','--apply'].includes(args[0]))fail('unexpected_arguments');const result=args[0]==='--preflight-only'?preflight():apply();process.stdout.write(JSON.stringify(result)+'\\n');}
module.exports={ACTION,DESTINATION,INSTALLER_SHA,preflight,apply};
if(require.main===module){try{main();}catch(error){console.error(JSON.stringify({ok:false,action:ACTION,error:String(error&&error.message||error)}));process.exit(1);}}
\`;
}

`;
}
function transform(){
 const implBytes=readBound(IMPL,EXPECTED_IMPL); const testBytes=readBound(TEST,EXPECTED_TEST);
 delete require.cache[require.resolve(IMPL)]; const m=require(IMPL);
 if(typeof m.buildRegistrationInstallerSource!=='function')fail('installer_builder_missing');
 const installer=m.buildRegistrationInstallerSource(); if(typeof installer!=='string')fail('installer_source_invalid');
 const start="const REGISTRATION_STAGE_TRANSPORT_ACTION ="; const end="module.exports = Object.freeze({";
 const text=implBytes.toString('utf8'); const a=text.indexOf(start), b=text.indexOf(end); if(a<0||b<=a)fail('stage_anchor_invalid');
 const core=text.slice(0,a)+makeCompressedStage(installer)+text.slice(b);
 syntaxBytes(Buffer.from(core),'core');
 const coreBytes=Buffer.from(core,'utf8'); const coreSha=sha(coreBytes);
 const coreCompressed=zlib.brotliCompressSync(coreBytes,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:11}});
 const marker='bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js';
 const wrapper=`'use strict';\nconst crypto=require('node:crypto');\nconst zlib=require('node:zlib');\nconst Module=require('node:module');\nconst CORE_SHA='${coreSha}';\nconst CORE_B64=${JSON.stringify(coreCompressed.toString('base64'))};\nconst FIXED_PROMOTION_SOURCE_MARKER='${marker}';\nfunction digest(b){return crypto.createHash('sha256').update(b).digest('hex');}\nlet coreBytes;try{coreBytes=zlib.brotliDecompressSync(Buffer.from(CORE_B64,'base64'));}catch{throw new Error('embedded_core_decompression_failed');}\nconst actual=digest(coreBytes);if(actual!==CORE_SHA)throw new Error('embedded_core_sha_mismatch:'+actual);\nconst child=new Module(__filename,module);child.filename=__filename;child.paths=module.paths;child._compile(coreBytes.toString('utf8'),__filename);module.exports=child.exports;\nvoid FIXED_PROMOTION_SOURCE_MARKER;\n`;
 const wrapperBytes=Buffer.from(wrapper,'utf8'); syntaxBytes(wrapperBytes,'wrapper');
 if(wrapperBytes.length>MAX_PATCH_BYTES)fail('candidate_impl_too_large:'+wrapperBytes.length);
 let test=testBytes.toString('utf8');
 const anchor="  assert.match(\n    source,\n    /source_sha_mismatch/\n  );\n});\n";
 if(!test.includes(anchor))fail('test_anchor_missing');
 const extra="  assert.match(\n    source,\n    /brotliDecompressSync/\n  );\n\n";
 test=test.replace(anchor,extra+anchor);
 const testOut=Buffer.from(test,'utf8'); syntaxBytes(testOut,'test');
 return {impl:wrapperBytes,test:testOut,installer_sha:EXPECTED_INSTALLER,core_sha:coreSha,impl_sha:sha(wrapperBytes),test_sha:sha(testOut),impl_bytes:wrapperBytes.length,test_bytes:testOut.length};
}
function main(){const mode=process.argv[2];const out=transform();if(mode==='--meta')return console.log(JSON.stringify({impl_sha:out.impl_sha,test_sha:out.test_sha,impl_bytes:out.impl_bytes,test_bytes:out.test_bytes,core_sha:out.core_sha,installer_sha:out.installer_sha,production_mutation:false}));if(mode==='--emit-impl')return process.stdout.write(out.impl.toString('base64'));if(mode==='--emit-test')return process.stdout.write(out.test.toString('base64'));fail('usage');}
if(require.main===module){try{main();}catch(e){console.error(String(e&&e.stack||e));process.exit(1);}}
module.exports={transform};
