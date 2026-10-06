'use strict';

const crypto=require('node:crypto');

const ACTION='control_plane_agent_zdt_v19_current_mcp_rebase_v36';
const CURRENT_IMPL_SHA='875a20d869d4098308e39809d6cd3150b5974a9a070caa8f790e1845b2356c5e';
const TARGET_IMPL_SHA='8d28b78a5ea1626cfd7f853bf31007e6404ceb78837a284d67a0c6dd39fd2c49';

const REPLACEMENTS=Object.freeze([
  Object.freeze({
    old:'8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075',
    next:'103dfdf49f95794e84dfa40d97d1622aabb2efb7a373809010262def63fd00d8',
    label:'rahekomak_mcp_baseline'
  }),
  Object.freeze({
    old:'0dc6889891749e8b81271819a9afed8ccbeacddc4526a893d363e8d6819ac4a0',
    next:'d2f8fee8c4c95d5f79b13d67c3188c3d8e3feb8f10f1202e1f6e810672963d15',
    label:'rahekomak_mcp_candidate'
  })
]);

const production_mutation=false;
const database_mutation=false;
const directadmin_mutation=false;
const imotion_runtime_mutation=false;

function digest(source){
  return crypto.createHash('sha256').update(source,'utf8').digest('hex');
}

function patchImplementation(source){
  if(typeof source!=='string'||digest(source)!==CURRENT_IMPL_SHA){
    throw new Error('v36_current_impl_sha_mismatch');
  }

  let content=source;
  for(const replacement of REPLACEMENTS){
    const count=content.split(replacement.old).length-1;
    if(count!==1){
      throw new Error('v36_'+replacement.label+'_anchor_'+count);
    }
    content=content.replace(replacement.old,replacement.next);
  }

  const targetSha=digest(content);
  if(targetSha!==TARGET_IMPL_SHA){
    throw new Error('v36_target_impl_sha_mismatch:'+targetSha);
  }

  return Object.freeze({
    ok:true,
    action:ACTION,
    old_sha256:CURRENT_IMPL_SHA,
    new_sha256:TARGET_IMPL_SHA,
    replacement_count:REPLACEMENTS.length,
    content,
    production_mutation,
    database_mutation,
    directadmin_mutation,
    imotion_runtime_mutation
  });
}

module.exports=Object.freeze({
  ACTION,
  CURRENT_IMPL_SHA,
  TARGET_IMPL_SHA,
  REPLACEMENTS,
  patchImplementation,
  production_mutation,
  database_mutation,
  directadmin_mutation,
  imotion_runtime_mutation
});
