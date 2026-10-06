'use strict';

const BASE_SHA='d5e938f63ef89c7427edad92cd047f1c150f898db5cbb6d1a84cbb6c1bac6161';
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';
const REQUEST_TOOL='control_plane_installer_refresh_l4_binding_repair_request_v1';
const STATUS_TOOL='control_plane_installer_refresh_l4_binding_repair_status_v1';
const APPLY_TOOL='control_plane_installer_refresh_l4_binding_repair_apply_v1';

module.exports=Object.freeze({
  schema_version:'prhm.installer-refresh-current-surface-binding.v1',
  source_ref:'fix/installer-refresh-l4-parent-bind-waha-v3',
  source_blob_sha:'712100af1473b76a229417888867b5b3275b67ec',
  BASE_SHA,
  CONFIRM,
  tools:Object.freeze([REQUEST_TOOL,STATUS_TOOL,APPLY_TOOL]),
  level:4,
  risk:'critical',
  production_mutation:false,
  database_mutation:false
});
