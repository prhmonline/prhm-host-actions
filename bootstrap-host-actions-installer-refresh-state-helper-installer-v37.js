'use strict';

const ACTION='control_plane_installer_refresh_state_helper_install_v37';

function registrationPlan(){
  return {
    schema_version:'prhm.host-action-bootstrap-plan.v1',
    action:ACTION,
    operation:'host_action.control_plane_installer_refresh_state_helper_install_v37',
    risk:'critical',
    level:4,
    zero_input:true,
    helper_file:'installer-refresh-state-helper-installer-v37.js',
    test_file:'test-installer-refresh-state-helper-installer-v37.js',
    installer_directory:'/opt/prhm-agent-selfmaint-exec/actions',
    backup_root:'/var/backups/prhm-installer-refresh-state-helper-rebase-v37',
    no_new_privileges:true,
    arbitrary_command:false,
    arbitrary_path:false,
    production_mutation:false,
    database_mutation:false
  };
}

module.exports={registrationPlan};
if(require.main===module)process.stdout.write(JSON.stringify(registrationPlan())+'\n');
