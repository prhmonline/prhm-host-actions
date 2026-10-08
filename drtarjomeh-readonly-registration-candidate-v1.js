'use strict';
// Git-only, fail-closed candidate builder. This module NEVER installs or writes files.
// Live activation requires a separate SHA-pinned, backup/rollback-capable Level-4 action.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pins=require('./drtarjomeh-preflight-agent3-live-pins-check-v1.js');
const manifest=require('./drtarjomeh-preflight-agent3-registration-pins-v1.json');

const API_REL='honartikIticketV14PreflightRoutes.js';
const MCP_REL='src/plugins/honartikIticketPreflight.js';
const API_ROOT='/home/agent/ssh-agent-api';
const MCP_ROOT='/home/agent/ssh-mcp-server';
const AUDIT_ARTIFACT='/opt/prhm-agent-readonly-actions/drtarjomeh-current-release-preflight-v1.js';
const API_ARTIFACT='/home/agent/ssh-agent-api/drtarjomeh-preflight-agent-api-route-v1.js';
const MCP_ARTIFACT='/home/agent/ssh-mcp-server/src/plugins/drtarjomeh-preflight-mcp-adapter-v1.mjs';
const MARKER='// PRHM_DRT_READONLY_REGISTRATION_V1';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fail(code){throw new Error(code);}
function count(haystack,needle){return haystack.split(needle).length-1;}
function insertOnce(source,anchor,insertion,label){
  if(typeof source!=='string')fail(label+'_source_invalid');
  if(count(source,anchor)!==1)fail(label+'_anchor_count_'+count(source,anchor));
  return source.replace(anchor,anchor+insertion);
}
function buildApi(source){
  if(source.includes(MARKER))fail('api_already_registered');
  const importAnchor="'use strict';\n";
  const withImport=insertOnce(source,importAnchor,
    "// PRHM_DRT_READONLY_REGISTRATION_V1 import\n"+
    "const {registerDrtarjomehReadonlyPreflightRoute}=require('./drtarjomeh-preflight-agent-api-route-v1.js');\n",
    'api_import');
  const fnAnchor="  });\n}\nmodule.exports=";
  if(count(withImport,fnAnchor)!==1)fail('api_registration_anchor_count_'+count(withImport,fnAnchor));
  return withImport.replace(fnAnchor,
    "  });\n"+
    "  // PRHM_DRT_READONLY_REGISTRATION_V1 route\n"+
    "  registerDrtarjomehReadonlyPreflightRoute(app,{auth});\n"+
    "}\nmodule.exports=");
}
function buildMcp(source){
  if(source.includes(MARKER))fail('mcp_already_registered');
  const importAnchor="import { textResult } from '../core/result.js';\n";
  const withImport=insertOnce(source,importAnchor,
    "// PRHM_DRT_READONLY_REGISTRATION_V1 import\n"+
    "import {registerDrtarjomehCurrentReleasePreflight} from './drtarjomeh-preflight-mcp-adapter-v1.mjs';\n",
    'mcp_import');
  const fnAnchor="  },async()=>textResult(await agent.callAgent('/honartik/iticket/v14/preflight','POST',{})));\n";
  return insertOnce(withImport,fnAnchor,
    "  // PRHM_DRT_READONLY_REGISTRATION_V1 tool\n"+
    "  registerDrtarjomehCurrentReleasePreflight(mcp,{agent});\n",
    'mcp_registration');
}
function verifyLiveInputs(readFs=fs){
  if(pins.validateManifest()!==true)fail('manifest_invalid');
  const pre= pins.evaluateLivePins(readFs);
  if(pre.length!==4||pre.some(x=>x.status!=='MATCH'))fail('live_sha_drift');
  return pre;
}
function readBoundOwner(readFs,root,rel){
  const expected=pins.EXPECTED_PREIMAGES.find(x=>x.root===root&&x.path===rel);
  if(!expected)fail('owner_not_allowlisted');
  const conf=pins.checkConfinement(root,rel,readFs);
  if(conf.status!=='REGULAR')fail('owner_confinement_'+conf.status);
  const bytes=readFs.readFileSync(conf.file);
  if(sha(bytes)!==expected.sha256)fail('owner_sha_changed_after_preflight');
  return bytes.toString('utf8');
}
function assetPlan(readArtifact){
  const names=[
    ['drtarjomeh-current-release-preflight-v1.js',AUDIT_ARTIFACT],
    ['drtarjomeh-preflight-agent-api-route-v1.js',API_ARTIFACT],
    ['drtarjomeh-preflight-mcp-adapter-v1.mjs',MCP_ARTIFACT]
  ];
  const evidence=pins.validateArtifactBytes(readArtifact);
  if(evidence.length!==3||evidence.some(x=>x.status!=='MATCH'))fail('artifact_sha_drift');
  return names.map(([source,target])=>{
    const bytes=readArtifact(source);
    if(pins.gitBlobSha(bytes)!==manifest.approved_artifacts.find(x=>x.path===source)?.git_blob_sha)fail('artifact_recheck_failed');
    return {source,target,sha256:sha(bytes),bytes:bytes.length,mode:'0644'};
  });
}
function buildPlan(readFs=fs,readArtifact=p=>fs.readFileSync(path.join(__dirname,p))){
  verifyLiveInputs(readFs);
  const api=buildApi(readBoundOwner(readFs,API_ROOT,API_REL));
  const mcp=buildMcp(readBoundOwner(readFs,MCP_ROOT,MCP_REL));
  const artifactTargets=assetPlan(readArtifact);
  const ownerTargets=[
    {source:API_REL,target:path.join(API_ROOT,API_REL),sha256:sha(Buffer.from(api)),bytes:Buffer.byteLength(api),mode:'0644'},
    {source:MCP_REL,target:path.join(MCP_ROOT,MCP_REL),sha256:sha(Buffer.from(mcp)),bytes:Buffer.byteLength(mcp),mode:'0644'}
  ];
  if(new Set([...artifactTargets,...ownerTargets].map(x=>x.target)).size!==5)fail('duplicate_target');
  return {
    schema:'prhm.drtarjomeh.readonly-registration-candidate.v1',
    ok:true,preflight_only:true,production_mutation:false,service_restart:false,
    deploy:false,registration_authorized:false,requires_level4:true,
    base_commit:'80ba3a237b2a2bb90011f73ad7e61b5cc0a8476c',
    current_owner_pins:pins.EXPECTED_PREIMAGES.map(x=>({root:x.root,path:x.path,sha256:x.sha256})),
    files:[...artifactTargets,...ownerTargets],
    required_followup:'REVIEW_SIGNED_LEVEL4_SHA_BOUND_INSTALLER_WITH_BACKUP_ROLLBACK_HEALTH'
  };
}
function selftest(){
  pins.validateManifest();
  const artifacts=pins.validateArtifactBytes();
  if(artifacts.length!==3||artifacts.some(x=>x.status!=='MATCH'))fail('artifact_sha_drift');
  const api="'use strict';\nfunction registerHonartikIticketV14PreflightRoutes(app,{auth}){\n  app.post('/test',auth,async(req,res)=>{\n  });\n}\nmodule.exports={};\n";
  const mcp="import { textResult } from '../core/result.js';\nexport function registerHonartikIticketPreflightPlugin(mcp,{agent}){\n  mcp.registerTool('test',{inputSchema:{}},async()=>textResult(await agent.callAgent('/honartik/iticket/v14/preflight','POST',{})));\n}\n";
  const a=buildApi(api), b=buildMcp(mcp);
  if(count(a,'registerDrtarjomehReadonlyPreflightRoute(app,{auth});')!==1||
     count(b,'registerDrtarjomehCurrentReleasePreflight(mcp,{agent});')!==1)fail('candidate_registration_cardinality');
  return {ok:true,preflight_only:true,production_mutation:false,registration_authorized:false,
    approved_artifacts:artifacts.length,candidate_fixtures:2};
}
if(require.main===module){
  try{
    const args=process.argv.slice(2);
    if(args.length!==1||!['--selftest-only','--live-readonly-preflight'].includes(args[0]))fail('unsupported_mode');
    const value=args[0]==='--selftest-only'?selftest():buildPlan();
    process.stdout.write(JSON.stringify(value)+'\n');
  }catch(e){process.stderr.write(JSON.stringify({ok:false,error:String(e&&e.message||e).slice(0,160)})+'\n');process.exitCode=1;}
}
module.exports={buildApi,buildMcp,insertOnce,buildPlan,verifyLiveInputs,readBoundOwner,assetPlan,selftest,MARKER};
