'use strict';
/**
 * Local fixed-contract PREINSTALL check only. It NEVER registers an action,
 * grants permissions, stages files, signs an approval or changes Production.
 * The static SHA values in Git are hypotheses until matched against live
 * pinned file descriptors on the authorized target host.
 */
const fs=require('node:fs');
const path=require('node:path');
const {collect,OWNERS}=require('./four-owner-readonly-preflight.cjs');
const TARGET='agent3_universal_backup_engine_install_v1';
const HASH=/^[0-9a-f]{64}$/;
const KEYS=Object.freeze(['base','executor','policy','mcp']);
function stop(reason){throw Error('agent3_live_sha_preflight_denied:'+reason);}
function verify({evidence,contract}){
 if(!contract||contract.schema!=='prhm.agent3.universal-backup.registration-contract.v1'||
    contract.action!==TARGET||contract.status!=='registration_candidate_not_applied'||
    contract.host!=='prhm-production'||contract.approval?.level!==4||
    contract.approval?.one_time_signed_approval_required!==true)
   stop('untrusted_contract');
 if(!evidence||evidence.schema!=='prhm.agent3.registry-owner-evidence.v1'||
    evidence.mode!=='READ_ONLY_PREFLIGHT'||evidence.production_mutation!==false||
    evidence.enrollment_authorized!==false||evidence.cryptographically_signed!==false||
    evidence.owner_count!==4||evidence.service_count!==4||
    !Array.isArray(evidence.services)||evidence.services.length!==4||
    evidence.services.some(s=>s.active!==true||s.running!==true||s.loaded!==true))
   stop('incomplete_live_evidence');
 const pinned=contract.preimage_sha256;
 if(!pinned||Object.keys(pinned).sort().join(',')!==[...KEYS].sort().join(','))
   stop('unbound_four_owner_pins');
 for(const k of KEYS){
   const record=evidence.owners?.[k];
   if(!HASH.test(pinned[k]||'')||!record||record.path!==OWNERS[k]||
      record.sha256!==pinned[k]||evidence.hashes?.[k]!==record.sha256)
     stop('preimage_mismatch:'+k);
 }
 return Object.freeze({
    ok:true,mode:'PREINSTALL_PREIMAGE_VERIFIED_ONLY',
    project:'agent3',action:TARGET,owner_count:4,healthy_services:4,
    approval_consumed:false,registration_installed:false,installation_complete:false,
    rollback_tested:false,
    sha256:Object.fromEntries(KEYS.map(k=>[k,evidence.hashes[k]]))
 });
}
function preflight(){
 const filename=path.join(__dirname,'production-registration-contract.json');
 const st=fs.lstatSync(filename);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o022)!==0)
   stop('unsafe_pin_manifest');
 const contract=JSON.parse(fs.readFileSync(filename,'utf8'));
 const evidence=collect();
 return verify({evidence,contract});
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--check'){
   process.stderr.write('read-only --check only; no installation mode\n');
   process.exitCode=64;
 }else{
   try{process.stdout.write(JSON.stringify(preflight())+'\n');}
   catch(e){process.stderr.write(String(e.message)+'\n');process.exitCode=78;}
 }
}
module.exports=Object.freeze({verify,preflight,KEYS,TARGET});
