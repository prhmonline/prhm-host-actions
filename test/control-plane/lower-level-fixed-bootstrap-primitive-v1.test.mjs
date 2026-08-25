import assert from 'node:assert/strict';
import { FIXED, requestToolSchema, applyToolSchema, agentApiSelfmaintBinding, agentMcpSelfmaintBinding, validatePendingRequest } from '../../candidates/control-plane/lower-level-fixed-bootstrap-primitive-v1.mjs';

assert.deepEqual(requestToolSchema(), {});
assert.deepEqual(applyToolSchema(), {request_id:'uuid',second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'});
assert.equal(FIXED.agent_api.expected_sha256,'45f22b6879add519c51a0dadaf9840a62b1be3d0301f562f70b92656a89fa8c4');
assert.equal(FIXED.agent_mcp.expected_sha256,'0cc9fd75a064fdee5e4c2f161fa8bc0c4470e65cb3b079ce3abe67113b6676ab');
assert.equal(FIXED.root_scripts_candidate_sha256,'d464e0aa0b8daa6c1e623f523917c27c5da065e388c1017b3fe7d9098433e60e');
assert.deepEqual(agentApiSelfmaintBinding('X'),{target:'agent_api',path:'selfmaintRoutes.js',expected_sha256:FIXED.agent_api.expected_sha256,new_content:'X'});
assert.deepEqual(agentMcpSelfmaintBinding('Y'),{target:'agent_mcp',path:'src/plugins/selfmaint.js',expected_sha256:FIXED.agent_mcp.expected_sha256,new_content:'Y'});
const future=new Date(Date.now()+60000).toISOString();
assert.equal(validatePendingRequest({status:'pending',request_id:'11111111-1111-4111-8111-111111111111',action:FIXED.bridge_action,arguments_sha256:FIXED.bridge_arguments_sha256,expires_at:future},'11111111-1111-4111-8111-111111111111'),true);
assert.throws(()=>validatePendingRequest({status:'pending',request_id:'11111111-1111-4111-8111-111111111111',action:'wrong',arguments_sha256:FIXED.bridge_arguments_sha256,expires_at:future},'11111111-1111-4111-8111-111111111111'),/action_mismatch/);
assert.throws(()=>validatePendingRequest({status:'pending',request_id:'11111111-1111-4111-8111-111111111111',action:FIXED.bridge_action,arguments_sha256:'0'.repeat(64),expires_at:future},'11111111-1111-4111-8111-111111111111'),/arguments_sha_mismatch/);
assert.throws(()=>validatePendingRequest({status:'pending',request_id:'11111111-1111-4111-8111-111111111111',action:FIXED.bridge_action,arguments_sha256:FIXED.bridge_arguments_sha256,expires_at:'2000-01-01T00:00:00Z'},'11111111-1111-4111-8111-111111111111'),/expired/);
for (const forbidden of ['action','path','command','payload','sha256','repository','url','service','sql','environment','token','credential']) assert.equal(Object.hasOwn(requestToolSchema(),forbidden),false);
console.log('LOWER_LEVEL_FIXED_BOOTSTRAP_PRIMITIVE_TDD=PASS');
