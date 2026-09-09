'use strict';

const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const ART=
  'artifacts/honartik-iticket-v14-dedicated-place-probe-v1/opsExecutorRoutes.js';

const src=fs.readFileSync(ART,'utf8');

const line=src
  .split('\n')
  .find(x=>x.includes('iticket_place_contract_invalid'));

assert.ok(line,'probe parser line missing');

assert.ok(
  line.includes('const data=body&&body.data'),
  'expected legacy parser anchor missing'
);

function parseCurrent(body){
  const data=body&&body.data;
  const title=data&&data.attributes&&data.attributes.title;

  if(
    !data ||
    typeof data!=='object' ||
    String(data.id||'')!=='01ktm91d15f6mebm8qj6cbs7tb' ||
    typeof title!=='string' ||
    title.trim()===''
  ){
    throw new Error('iticket_place_contract_invalid');
  }

  return {
    resource_type:String(data.type||''),
    id:'01ktm91d15f6mebm8qj6cbs7tb',
    title:title.trim()
  };
}

const legacy={
  data:{
    id:'01ktm91d15f6mebm8qj6cbs7tb',
    type:'places',
    attributes:{title:'Legacy Place'}
  }
};

const flat={
  id:'01ktm91d15f6mebm8qj6cbs7tb',
  type:'places',
  attributes:{title:'Flat Place'}
};

assert.equal(parseCurrent(legacy).title,'Legacy Place');

assert.throws(
  ()=>parseCurrent(flat),
  /iticket_place_contract_invalid/
);

console.log('ITICKET_FLAT_ENVELOPE_RED=PASS');
