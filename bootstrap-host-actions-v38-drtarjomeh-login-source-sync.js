'use strict';

const ACTION='drtarjomeh_login_source_sync_v38';

function registrationPlan(){
  return Object.freeze({
    schema_version:'prhm.host-action-bootstrap-plan.v1',
    action:ACTION,
    operation:'host_action.drtarjomeh_login_source_sync_v38',
    risk:'critical',
    level:4,
    zero_input:true,
    helper_file:'drtarjomeh-login-source-sync-v38-host-action.js',
    test_file:'test-v38-drtarjomeh-login-source-sync.js',
    installer_directory:'/opt/prhm-agent-selfmaint-exec/actions',
    backup_root:'/var/backups/prhm-drtarjomeh-login-source-sync-v38',
    required_user:'drtarjomeh',
    no_new_privileges:true,
    arbitrary_command:false,
    arbitrary_path:false,
    source_repository_mutation:true,
    remote_git_branch_mutation:true,
    live_runtime_mutation:false,
    database_mutation:false
  });
}

module.exports={ACTION,registrationPlan};
if(require.main===module)process.stdout.write(JSON.stringify(registrationPlan())+'\n');
