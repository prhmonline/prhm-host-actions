'use strict';
const ACTION='control_plane_installer_refresh_state_helper_rebase_v37';

function registrationPlan(){
  return {
    schema_version:'prhm.host-action-bootstrap-plan.v1',
    action:ACTION,
    operation:'host_action.control_plane_installer_refresh_state_helper_rebase_v37',
    risk:'critical',
    level:4,
    zero_input:true,
    helper_file:'installer-refresh-state-helper-rebase-v37-action.js',
    test_file:'test-installer-refresh-state-helper-rebase-v37-action.js',
    installer_directory:'/opt/prhm-agent-selfmaint-exec/actions',
    target_file:'/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js',
    expected_old_sha256:'b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e',
    expected_new_sha256:'b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb',
    backup_root:'/var/backups/prhm-installer-refresh-state-helper-rebase-v37',
    no_new_privileges:true,
    arbitrary_command:false,
    arbitrary_path:false,
    production_mutation:false,
    database_mutation:false
  };
}

module.exports=Object.freeze({registrationPlan});
if(require.main===module)process.stdout.write(JSON.stringify(registrationPlan())+'\n');
