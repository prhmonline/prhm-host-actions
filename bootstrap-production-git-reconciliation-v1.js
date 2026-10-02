'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const {TARGETS}=require('./production-git-reconciliation-v1.js');

const ACTION_ID='production_git_reconciliation_v1';
const EXECUTOR_FILE=path.join(__dirname,'production-git-reconciliation-v1.js');
const EXECUTOR_SHA256=crypto.createHash('sha256').update(fs.readFileSync(EXECUTOR_FILE)).digest('hex');
const ANNOTATIONS=Object.freeze({readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});

function enabledProjectIds(){
  return Object.values(TARGETS).filter(x=>x&&x.enabled===true).map(x=>x.project_id).sort();
}
function buildRegistrationSpec(){
  return Object.freeze({
    action_id:ACTION_ID,
    executor_sha256:EXECUTOR_SHA256,
    annotations:ANNOTATIONS,
    input_schema:Object.freeze({
      type:'object',
      additionalProperties:false,
      required:Object.freeze(['project_id']),
      properties:Object.freeze({project_id:Object.freeze({type:'string',enum:Object.freeze(enabledProjectIds())})})
    }),
    production_execution:false,
    automatic_registration:false
  });
}
function preflightPackage(){
  return {ok:true,schema_version:'prhm.host-action-package-preflight.v1',...buildRegistrationSpec()};
}

module.exports={ACTION_ID,EXECUTOR_SHA256,ANNOTATIONS,enabledProjectIds,buildRegistrationSpec,preflightPackage};
