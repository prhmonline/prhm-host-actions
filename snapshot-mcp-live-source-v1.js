#!/usr/local/bin/prhm-node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const zlib=require('zlib');

const ROOT='/home/agent/ssh-mcp-server';
const MAX_FILE_BYTES=500000;
const FIXED=['server.js','package.json','src/core/registry.js'];

function sha256(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function assertSafeRel(rel){
  if(typeof rel!=='string'||rel.startsWith('/')||rel.includes('..')||!/^[A-Za-z0-9._\/-]+$/.test(rel)) throw new Error('unsafe_relative_path:'+String(rel));
}
function readOne(rel){
  assertSafeRel(rel);
  const abs=path.join(ROOT,rel);
  const real=fs.realpathSync(abs);
  if(real!==ROOT && !real.startsWith(ROOT+path.sep)) throw new Error('path_escape:'+rel);
  const st=fs.statSync(real);
  if(!st.isFile()) throw new Error('not_file:'+rel);
  if(st.size>MAX_FILE_BYTES) throw new Error('file_too_large:'+rel+':'+st.size);
  const buf=fs.readFileSync(real);
  return {size:buf.length,sha256:sha256(buf),content_b64:buf.toString('base64')};
}

const pluginDir=path.join(ROOT,'src/plugins');
const pluginNames=fs.readdirSync(pluginDir,{withFileTypes:true})
  .filter(d=>d.isFile()&&/^[A-Za-z0-9._-]+\.js$/.test(d.name))
  .map(d=>d.name)
  .sort();
const rels=[...FIXED,...pluginNames.map(n=>'src/plugins/'+n)];
const files={};
for(const rel of rels) files[rel]=readOne(rel);
const payload={
  schema_version:'prhm.mcp-source-snapshot.v1',
  captured_at:new Date().toISOString(),
  root:ROOT,
  file_count:rels.length,
  files
};
const raw=Buffer.from(JSON.stringify(payload),'utf8');
const gz=zlib.gzipSync(raw,{level:9});
const envelope={
  ok:true,
  schema_version:'prhm.mcp-source-snapshot-envelope.v1',
  file_count:rels.length,
  raw_bytes:raw.length,
  gzip_bytes:gz.length,
  gzip_sha256:sha256(gz),
  archive_b64:gz.toString('base64')
};
process.stdout.write(JSON.stringify(envelope)+'\n');
