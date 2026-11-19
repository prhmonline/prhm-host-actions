'use strict';
/**
 * Fixed zero-write privileged read-only attestor for PBCinema typed registry.
 * SOURCE ONLY: must be invoked from an independently authorized root-owned
 * read-only workflow. It does not obtain, relax, or grant permissions.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const registration=require('./pbcinema-banners-host-action-registration-v1.cjs');
const PATHS=Object.freeze({
  base:registration.BASE_OWNER,
  exec:registration.EXEC_OWNER,
  policy:registration.POLICY_OWNER,
  mcp:registration.MCP_OWNER,
});
const KEYS=Object.freeze(['base','exec','policy','mcp']);
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code){throw new Error('pbcinema_preflight_'+code)}
function attestOne(key,lib=fs){
  if(!Object.prototype.hasOwnProperty.call(PATHS,key))fail('unknown_owner');
  const file=PATHS[key],st=lib.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)!==0)fail('untrusted_file_'+key);
  const source=lib.readFileSync(file);
  if(!Buffer.isBuffer(source) || source.length<500 || source.length>2000000)fail('invalid_content_'+key);
  const sha=digest(source);
  return Object.freeze({key,sha,expected:registration.EXPECTED_PREIMAGES[key],match:sha===registration.EXPECTED_PREIMAGES[key],bytes:source.length,source});
}
function attestAll(lib=fs){
  const scans=KEYS.map(k=>attestOne(k,lib));
  const match=scans.every(x=>x.match);
  let preview=null,reason=null;
  if(match){
    try {
      const sources=Object.fromEntries(scans.map(x=>[x.key,x.source.toString('utf8')]));
      const bundle=registration.candidateBundle(sources);
      preview=Object.freeze(bundle.candidate_sha256);
    } catch(e){reason=String(e.message||e).replace(/[\r\n]/g,'').slice(0,180);}
  }
  // Neither owner bytes nor potentially sensitive policy keys leave this scope.
  return Object.freeze({ok:match&&!!preview,action:registration.ACTION,read_only:true,
    current_sha256:Object.freeze(Object.fromEntries(scans.map(x=>[x.key,x.sha]))),
    owner_match:Object.freeze(Object.fromEntries(scans.map(x=>[x.key,x.match]))),
    candidate_sha256:preview,block_reason:!match?'owner_preimage_mismatch':reason,
    production_mutation:false,approval_issued:false});
}
function main(argv=process.argv){
  if(argv.length!==3||argv[2]!=='--preflight')fail('unsupported_arguments');
  if(process.getuid()!==0)fail('requires_preapproved_root_read_only_action');
  const result=attestAll(fs);
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.ok)process.exitCode=78;
}
if(require.main===module){
  try{main()}catch(e){process.stderr.write(String(e.message||e).slice(0,180)+'\n');process.exitCode=78;}
}
module.exports=Object.freeze({PATHS,KEYS,digest,attestOne,attestAll,main});
