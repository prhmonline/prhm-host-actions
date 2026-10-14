'use strict';
/**
 * A NON-PRODUCTION synthetic coupling of the fixed V2 exclusive lock and WAL.
 *
 * This is explicitly not a root launcher. It cannot execute filesystem
 * operations, stage files, approve a request, consume L4 or release a lock.
 * The separately SHA-reviewed trusted root host adapter must provide actual
 * authenticated intent->step->postcondition->done wiring. Until then there
 * must be no executable Production apply mode.
 */
const fs=require('node:fs');
const WAL=require('./prhm-action-registry-v2-bootstrap-wal-v1.cjs');
const LOCK=require('./prhm-action-registry-v2-bootstrap-exclusive-lock-v1.cjs');
function fail(s){throw Error('registry_v2_bootstrap_session_'+s)}
function check(b,s){if(!b)fail(s)}
function absent(io,p){
 try{io.lstatSync(p)}
 catch(e){if(e?.code==='ENOENT')return true;throw e}
 return false;
}
function createSyntheticSession({io,proposal}={}){
 check(io&&io!==fs&&typeof io.lstatSync==='function'&&
   typeof io.openSync==='function','production_session_not_authorized');
 const pHash=WAL.digestProposal(proposal);
 const locker=LOCK.createSyntheticLock({io,proposal});
 const journal=WAL.createSyntheticWriter({io,proposal});
 let state='NEW';
 function inspect(){
  check(state==='HEADER_DURABLE','session_not_started');
  const owner=locker.inspect();
  const wal=journal.inspect();
  check(owner.proposal_sha256===pHash&&wal.completed===0&&
    wal.pending===null&&wal.total===proposal.operation_count&&
    owner.request_id===wal.request_id&&
    wal.safe_to_resume===false,'session_drift');
  return Object.freeze({schema:'prhm.registry-v2.bootstrap-session-guard.v1',
   status:'SYNTHETIC_EXCLUSIVE_HEADER_DURABLE',
   request_id:owner.request_id,
   proposal_sha256:pHash,lock_present:true,
   wal_header_durable:true,
   simulated_only:true,can_start_production:false,approved:false,
   install_authorized:false,approval_consumed:false});
 }
 function initialize(){
  check(state==='NEW','session_reused');
  // Reserve no lock if an existing journal is already unowned/stale.
  check(absent(io,LOCK.LOCK)&&absent(io,WAL.JPATH),
    'foreign_lock_or_journal_present');
  // Any failure after acquiring the lock MUST leave it in place. No cleanup.
  state='INDETERMINATE';
  locker.acquire();
  const progress=journal.begin();
  check(progress.completed===0&&progress.pending===null&&
    progress.safe_to_resume===false,'journal_not_fresh');
  state='HEADER_DURABLE';
  return inspect();
 }
 return Object.freeze({initialize,inspect});
}
module.exports=Object.freeze({createSyntheticSession});
