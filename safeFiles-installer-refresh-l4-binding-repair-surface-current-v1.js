'use strict';

const BASE_SHA='41416010bd28f7eb38c57d5e0482a56d782c0f8fca42a961a8480e6f0c88a6d5';
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
