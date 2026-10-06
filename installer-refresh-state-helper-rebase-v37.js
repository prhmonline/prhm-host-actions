'use strict';

const crypto=require('node:crypto');

const ACTION='control_plane_installer_refresh_state_helper_rebase_v37';
const CURRENT_STATE_SHA='b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e';
const TARGET_STATE_SHA='b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb';
const CURRENT_TMP_EXPR="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
const TARGET_TMP_EXPR="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";
const production_mutation=false;
const database_mutation=false;

function sha(source){
  return crypto.createHash('sha256').update(source,'utf8').digest('hex');
}

function patchStateHelper(source){
  if(typeof source!=='string'||sha(source)!==CURRENT_STATE_SHA){
    throw new Error('v37_current_state_sha_mismatch');
  }
  const count=source.split(CURRENT_TMP_EXPR).length-1;
  if(count!==1){
    throw new Error('v37_tmp_path_anchor_'+count);
  }
  const content=source.replace(CURRENT_TMP_EXPR,TARGET_TMP_EXPR);
  const newSha=sha(content);
  if(newSha!==TARGET_STATE_SHA){
    throw new Error('v37_target_state_sha_mismatch:'+newSha);
  }
  return Object.freeze({
    ok:true,
    action:ACTION,
    old_sha256:CURRENT_STATE_SHA,
    new_sha256:TARGET_STATE_SHA,
    replacement_count:1,
    content,
    production_mutation,
    database_mutation
  });
}

module.exports=Object.freeze({
  ACTION,
  CURRENT_STATE_SHA,
  TARGET_STATE_SHA,
  CURRENT_TMP_EXPR,
  TARGET_TMP_EXPR,
  patchStateHelper,
  production_mutation,
  database_mutation
});
