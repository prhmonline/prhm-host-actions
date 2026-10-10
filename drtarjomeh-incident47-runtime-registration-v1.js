'use strict';
// Source-only fixed Host Action registration builder for incident #47.
// Generates exact-site, additive, hash-bound candidates. No file/service writes.
// The reviewed runner may be invoked only AFTER existing Host Actions v2
// server-side confirm + authorize-consume succeeds; it never accepts user input.
const crypto=require('node:crypto');
const pins=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');

const ACTION=pins.ACTION;
const OPERATION=pins.OPERATION;
const HOST_BASE='4665863cbb40532298e78ba1588d45124ad20da8';
const RUNNER_TARGET='/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-incident47-reviewed-host-runner-v1.js';
const RUNNER_GIT_BLOB='368cf4c93c068093f702b399193c700cbd9a3cff';
const APP_SHA=pins.SOURCE_COMMIT;
const FALLBACK_DISPATCH='async function applyHostActionV2(action){const spec=hostActionV2Spec(action);';
const BASE_ANCHOR='const HOST_ACTION_V2_SPECS = Object.freeze({\n';
const MCP_ANCHOR="'control_plane_current_owner_binding_refresh_v1']);";
function fail(code){throw new Error(code);}
function injectExactlyOnce(s,anchor,replace,label){
  if(typeof s!=='string')fail(label+'_input_invalid');
  const n=s.split(anchor).length-1;
  if(n!==1)fail(label+'_anchor_count_'+n);
  return s.replace(anchor,replace);
}
function assertNotAlreadyRegistered(text,label){
  if(text.includes(ACTION)||text.includes(OPERATION))fail(label+'_already_registered');
}
function assertLiveBytePreimage(kind,buffer){
  const spec=pins.LIVE[kind];
  if(!spec||!Buffer.isBuffer(buffer)||!buffer.length)fail(kind+'_bytes_missing');
  if(pins.sha256(buffer)!==spec.sha256)fail(kind+'_live_preimage_mismatch');
  return buffer.toString('utf8');
}
function baseTransform(source){
  assertNotAlreadyRegistered(source,'base');
  const item="  "+ACTION+": { operation: '"+OPERATION+
    "', rollback: 'host-action-v2:drtarjomeh-incident47-guard-v1:preimage-restore' },\n";
  return injectExactlyOnce(source,BASE_ANCHOR,BASE_ANCHOR+item,'base');
}
function executorTransform(source){
  assertNotAlreadyRegistered(source,'executor');
  const spec="  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},\n";
  let out=injectExactlyOnce(source,BASE_ANCHOR,BASE_ANCHOR+spec,'executor_spec');
  const fn=String.raw