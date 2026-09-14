#!/usr/local/bin/prhm-node
'use strict';

function fail(message){throw new Error(message);}

function parseBridgeEnv(text){
  if(typeof text!=='string')fail('bridge_env_invalid');
  const lines=text.split('\n');
  const matches=[];
  for(let i=0;i<lines.length;i++){
    const m=/^([A-Za-z_][A-Za-z0-9_]*)=(\d+)$/.exec(lines[i]);
    if(!m)continue;
    const key=m[1];
    if(key!=='PORT'&&!key.endsWith('_PORT'))continue;
    matches.push({key,port:Number(m[2]),lineIndex:i});
  }
  if(matches.length!==1)fail('bridge_port_assignment_count:'+matches.length);
  return matches[0];
}

function rewriteBridgeEnv(text,expectedPort=8140,replacementPort=8141){
  const parsed=parseBridgeEnv(text);
  if(parsed.port!==expectedPort)fail('bridge_port_expected_'+expectedPort+'_actual_'+parsed.port);
  const lines=text.split('\n');
  const original=lines[parsed.lineIndex];
  const prefix=parsed.key+'=';
  if(!original.startsWith(prefix))fail('bridge_port_line_mismatch');
  lines[parsed.lineIndex]=prefix+String(replacementPort);
  return lines.join('\n');
}

function diffAllowed(before,after){
  try{return rewriteBridgeEnv(before)===after;}catch{return false;}
}

module.exports={parseBridgeEnv,rewriteBridgeEnv,diffAllowed};
