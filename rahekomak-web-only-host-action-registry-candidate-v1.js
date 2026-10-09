'use strict';
// Read-only, exact-preimage registration candidate for the fixed RahKomak
// web-only host action. This module NEVER installs or applies an action.
const crypto=require('node:crypto');
const ACTION='rahekomak_web_only_release_v1';
const OPERATION='host_action.'+ACTION;
const SHA='e628baa430aa60bdf949fc70d993098152bb8b7c';
const HELPER_SHA='a99696f3c371f6ad39ee450f1579af345de8a39f483734b63821f018aaea12d5';
const POLICY_VERSION='2026-10-09.1-rahekomak-web-only-release-v1';
const POLICY_BASE='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const PINNED=Object.freeze({
 base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
 executor:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
 mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',
 policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'
});
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function fail(code){throw new Error(code)}
function replaceOne(s,needle,replacement,scope){
 if(typeof s!=='string'||s.split(needle).length!==2)fail(scope+'_anchor_not_unique');
 if(s.includes("'"+ACTION+"'")||s.includes(ACTION+":")||s.includes('"'+ACTION+'"'))fail(scope+'_already_registered');
 return s.replace(needle,replacement);
}
const BASE_ANCHOR="  rahekomak_production_deploy_v1: { operation: 'host_action.rahekomak_production_deploy_v1', rollback: 'host-action-v2:rahekomak-production-deploy-v1:helper-transaction-rollback' },";
const BASE_ADD="  "+ACTION+": { operation: '"+OPERATION+"', rollback: 'host-action-v2:rahekomak-web-only-release-v1:static-out-restore' },";
function patchBase(source){
 return replaceOne(source,BASE_ANCHOR,BASE_ANCHOR+'\n'+BASE_ADD,'base');
}
const EXEC_ANCHOR="  rahekomak_production_deploy_v1:{operation:'host_action.rahekomak_production_deploy_v1',kind:'rahekomak_production_deploy_v1'},";
const EXEC_ADD="  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},";
const DISPATCH_ANCHOR="applyHostActionV2=async function(action){";
const EXEC_FUNCTION=String.raw