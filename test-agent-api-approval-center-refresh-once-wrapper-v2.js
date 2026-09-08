'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const TARGET=path.join(__dirname,'agent-api-approval-center-refresh-once-wrapper-v2.js');

test('v2 wrapper executes Approval Center refresh during module load',()=>{
  const src=fs.readFileSync(TARGET,'utf8');
  assert.match(src,/const BASE_SHA='02e75837d0c8dacc5984aad676209ec003548a016136779090ab04818feeabf3'/);
  assert.match(src,/const EXPECTED_OLD_APPROVAL_PID=3715344/);
  assert.match(src,/const POLICY_SHA='494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70'/);
  assert.match(src,/const APPROVAL_SERVER_SHA='de2569e481cd57b105b6a778cee7b32b2575fc88957d993c70760101ba39d13b'/);
  assert.doesNotMatch(src,/require\.main\s*===\s*module/);
  const refreshCall=src.lastIndexOf('refreshApprovalOnce();');
  const compileCall=src.lastIndexOf('compileBase();');
  assert.ok(refreshCall>=0,'refreshApprovalOnce must be invoked');
  assert.ok(compileCall>refreshCall,'base Agent API must compile only after refresh');
});

test('v2 remains fixed and non-generic',()=>{
  const src=fs.readFileSync(TARGET,'utf8');
  assert.match(src,/prhm-company-approval\.service/);
  assert.doesNotMatch(src,/process\.argv/);
  assert.doesNotMatch(src,/req\.body|request\.body|arbitrary/i);
  assert.doesNotMatch(src,/writeFileSync|appendFileSync|unlinkSync/);
});
