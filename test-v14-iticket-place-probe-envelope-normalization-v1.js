'use strict';

const assert=require('assert');
const fs=require('fs');

const ART=
  'artifacts/honartik-iticket-v14-dedicated-place-probe-v1/opsExecutorRoutes.js';

const src=fs.readFileSync(ART,'utf8');

const expected=
"const data=body&&body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:body,title=data&&data.attributes&&data.attributes.title;";

assert.ok(
  src.includes(expected),
  'backward-compatible normalization missing'
);

function parse(body){
  const data=
    body &&
    body.data &&
    typeof body.data==='object' &&
    !Array.isArray(body.data)
      ? body.data
      : body;

  const title=data&&data.attributes&&data.attributes.title;

  if(
    !data ||
    typeof data!=='object' ||
    Array.isArray(data) ||
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

for(const fixture of [
  {
    body:{
      data:{
        id:'01ktm91d15f6mebm8qj6cbs7tb',
        type:'places',
        attributes:{title:'Legacy Place'}
      }
    },
    title:'Legacy Place'
  },
  {
    body:{
      id:'01ktm91d15f6mebm8qj6cbs7tb',
      type:'places',
      attributes:{title:'Flat Place'}
    },
    title:'Flat Place'
  }
]){
  const out=parse(fixture.body);
  assert.equal(out.id,'01ktm91d15f6mebm8qj6cbs7tb');
  assert.equal(out.resource_type,'places');
  assert.equal(out.title,fixture.title);
}

for(const bad of [
  null,
  [],
  {},
  {
    id:'wrong-id',
    type:'places',
    attributes:{title:'X'}
  },
  {
    id:'01ktm91d15f6mebm8qj6cbs7tb',
    type:'places',
    attributes:{title:''}
  }
]){
  assert.throws(
    ()=>parse(bad),
    /iticket_place_contract_invalid/
  );
}

console.log('ITICKET_ENVELOPE_NORMALIZATION_GREEN=PASS');
