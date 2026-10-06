'use strict';
const ACTION='control_plane_current_owner_bootstrap_repair_v1';
function registrationPlan(){
  return {
    schema_version:'prhm.host-action-bootstrap-plan.v1',
    action:ACTION,
    operation:'host_action.control_plane_current_owner_bootstrap_repair_v1',
    risk:'critical',level:4,zero_input:true,
    helper_file:'control-plane-current-owner-bootstrap-repair-v1.js',
    test_file:'test-control-plane-current-owner-bootstrap-repair-v1.js',
    installer_directory:'/opt/prhm-agent-selfmaint-exec/actions',
    backup_root:'/var/backups/prhm-current-owner-bootstrap-repair-v1',
    no_new_privileges:true,arbitrary_command:false,arbitrary_path:false,
    production_mutation:false,database_mutation:false
  };
}
module.exports={registrationPlan};
if(require.main===module)process.stdout.write(JSON.stringify(registrationPlan())+'\n');
