'use strict';

const EXPECTED_IMPL='3eefb2281cd850208b0dff6d69f0211d54efa566b89b440d99da79a560c812dd';
const EXPECTED_TEST='fbbd56bd5decfc9a714f03cfff4b571e2fd36a9e130ac12c4a63f586156987e8';
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
