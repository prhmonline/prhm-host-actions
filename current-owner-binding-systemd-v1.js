'use strict';
const SERVICE='prhm-agent-selfmaint-exec.service';
const DROPIN='/etc/systemd/system/prhm-agent-selfmaint-exec.service.d/current-baseline-backup-rw.conf';
const BACKUP_ROOT='/var/backups/prhm-current-baseline-refresh-v1';
const DROPIN_CONTENT='[Service]\nReadWritePaths=/var/backups/prhm-current-baseline-refresh-v1\n';
const RESTART_UNITS=Object.freeze([SERVICE]);
function fail(code){throw new Error(code);}
function planDropin(state){
  if(!state||typeof state!=='object')fail('dropin_state_invalid');
  if(state.exists===false)return Object.freeze({state:'create',content:DROPIN_CONTENT});
  if(state.exists!==true)fail('dropin_state_invalid');
  if(state.is_symlink===true||state.is_file!==true)fail('dropin_not_regular');
  if(state.realpath!==DROPIN)fail('dropin_noncanonical');
  if(state.content!==DROPIN_CONTENT)fail('dropin_preimage_drift');
  return Object.freeze({state:'unchanged',content:DROPIN_CONTENT});
}
function normalizePaths(value){
  if(Array.isArray(value))return value.map(String);
  if(typeof value==='string')return value.trim()?value.trim().split(/\s+/):[];
  fail('effective_read_write_paths_invalid');
}
function validateEffectiveState(state){
  if(!state||typeof state!=='object')fail('effective_state_invalid');
  if(state.active_state!=='active')fail('effective_service_inactive');
  if(!Number.isInteger(Number(state.main_pid))||Number(state.main_pid)<=0)fail('effective_main_pid_invalid');
  const paths=normalizePaths(state.read_write_paths);
  if(!paths.includes(BACKUP_ROOT))fail('effective_backup_root_missing');
  if(state.protect_system!=='strict')fail('effective_protect_system_drift');
  if(!['yes','true','read-only'].includes(String(state.protect_home)))fail('effective_protect_home_drift');
  return true;
}
module.exports=Object.freeze({SERVICE,DROPIN,BACKUP_ROOT,DROPIN_CONTENT,RESTART_UNITS,planDropin,validateEffectiveState});
