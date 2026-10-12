'use strict';
// Reviewed action helper: called ONLY after the trusted Agent 3 executor consumes
// a signed one-time Level-4 approval. This script cannot approve itself.
const fs=require('node:fs');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const ACTION='leadops_backup_role_provision_v1';
const SQL_FILE='/opt/prhm-agent-selfmaint-exec/actions/leadops-backup-role-provision-v1.sql';
const SQL_GIT_BLOB='0ecbca4fd712f8a6e87595be526305763ad539d3';
const CONTAINER='drtarjomeh-leadops-staging-postgres-1';
const DATABASE='leadops';
const OPERATOR='leadops_admin';
function fail(s){throw Error(s);}
function gitBlob(bytes){return crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');}
function exec(args,{input}={}){
  return cp.execFileSync('/usr/bin/docker',args,{encoding:'utf8',input,timeout:60000,
    maxBuffer:1<<20,stdio:['pipe','pipe','pipe']}).trim();
}
function query(sql,role){
  return exec(['exec','-i',CONTAINER,'psql','-X','-v','ON_ERROR_STOP=1','-U',role,'-d',DATABASE,'-Atc',sql]);
}
function main(){
  const sql=fs.readFileSync(SQL_FILE);
  if(gitBlob(sql)!==SQL_GIT_BLOB)fail('bound_sql_blob_mismatch');
  if(exec(['inspect',CONTAINER,'--format','{{.State.Running}}'])!=='true')fail('container_unavailable');
  if(query('SELECT current_database(),current_user',OPERATOR)!=='leadops|leadops_admin')fail('operator_mismatch');
  if(query("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='leadops_backup')",OPERATOR)!=='f')
    fail('role_already_exists');
  // The bound SQL is one BEGIN..COMMIT transaction. On any SQL error,
  // psql ON_ERROR_STOP exits nonzero and PostgreSQL discards uncommitted work.
  // The role is not re-granted or dropped by any automatic retry.
  exec(['exec','-i',CONTAINER,'psql','-X','-v','ON_ERROR_STOP=1',
        '-U',OPERATOR,'-d',DATABASE],{input:sql});
  const state=query("SELECT count(*) FROM pg_roles WHERE rolname='leadops_backup' AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit AND rolconnlimit=1",OPERATOR);
  if(state!=='1')fail('role_postcheck_mismatch_manual_review_required');
  const read=query("SELECT has_table_privilege('leadops_backup','marketplace.economic_input_facts','SELECT'),has_table_privilege('leadops_app','marketplace.economic_input_facts','SELECT')",OPERATOR);
  if(read!=='t|f')fail('protected_table_boundary_postcheck_mismatch_manual_review_required');
  process.stdout.write(JSON.stringify({
    schema_version:'prhm.host-action-result.v1',ok:true,action:ACTION,
    database:DATABASE,created_role:'leadops_backup',
    source_sql_git_blob:SQL_GIT_BLOB,
    app_sensitive_table_select:false,backup_sensitive_table_select:true,
    rollback_performed:false,
    postcommit_rollback:'manual_approved_revoke_role_only',
    no_application_data_write:true
  })+'\n');
}
if(require.main===module){try{main();}catch(e){process.stderr.write('LEADOPS_BACKUP_ROLE_FAIL='+String(e.message).slice(0,160)+'\n');process.exitCode=1;}}
module.exports={ACTION,SQL_FILE,SQL_GIT_BLOB,CONTAINER,DATABASE,OPERATOR,gitBlob,main};
