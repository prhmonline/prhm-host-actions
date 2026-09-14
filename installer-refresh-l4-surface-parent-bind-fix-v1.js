'use strict';

const OLD_ANCHOR="function runState(args,apply=false){const w=apply?[STATE_ROOT,'/opt/prhm-company-control-plane','/var/backups/prhm-installer-refresh-l4-binding-repair-v1','/run']:[STATE_ROOT],u='prhm-installer-refresh-l4-surface-'+Date.now()+'-'+process.pid,a=['--wait','--pipe','--quiet','--unit='+u";

const NEW_ANCHOR="function runState(args,apply=false){const w=apply?['/var/lib/prhm-agent-selfmaint-exec','/opt/prhm-company-control-plane','/var/backups','/run']:['/var/lib/prhm-agent-selfmaint-exec'],u='prhm-installer-refresh-l4-surface-'+Date.now()+'-'+process.pid,a=['--wait','--pipe','--quiet','--unit='+u";

function patchSource(source){
  if(typeof source!=='string')throw new Error('source_invalid');
  const count=source.split(OLD_ANCHOR).length-1;
  if(count!==1)throw new Error('anchor_count:'+count);
  const content=source.replace(OLD_ANCHOR,NEW_ANCHOR);
  if(content.includes(OLD_ANCHOR))throw new Error('old_anchor_remains');
  for(const required of [
    "CONFIRM_LEVEL_4_CRITICAL",
    "control_plane_installer_refresh_l4_binding_repair_request_v1",
    "control_plane_installer_refresh_l4_binding_repair_status_v1",
    "control_plane_installer_refresh_l4_binding_repair_apply_v1"
  ]) if(!content.includes(required))throw new Error('required_binding_missing:'+required);
  return Object.freeze({
    ok:true,
    replacement_count:1,
    content,
    production_mutation:false,
    permission_change:false,
    confirmation_change:false,
    action_binding_change:false
  });
}

module.exports=Object.freeze({OLD_ANCHOR,NEW_ANCHOR,patchSource});
