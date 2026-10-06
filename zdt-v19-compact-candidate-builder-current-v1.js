'use strict';

const EXPECTED_IMPL='875a20d869d4098308e39809d6cd3150b5974a9a070caa8f790e1845b2356c5e';
const EXPECTED_TEST='f29d2d0596e5c432cb1024851cec74a2788d970a21457ebf554a3ee93ef47a0a';
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';

module.exports=Object.freeze({
  schema_version:'prhm.zdt-v19-current-builder-binding.v1',
  source_ref:'fix/agent-zdt-v19-compact-immutable-v1',
  source_blob_sha:'2baa256df515cc73c0126de32e9b862655be55d6',
  EXPECTED_IMPL,
  EXPECTED_TEST,
  CONFIRM,
  contract_tests:17,
  level:4,
  risk:'critical',
  production_mutation:false,
  database_mutation:false
});
