#!/usr/local/bin/prhm-node
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const HOST='127.0.0.1';
const PORT=Number(process.env.PORT||18135);
const ROOT=__dirname;
const PUBLIC=path.join(ROOT,'public');
const SNAPSHOT='/var/lib/prhm-company-os-dashboard/snapshot.json';
const AUTH_FILE='/etc/prhm-company-os-dashboard/auth.json';
function secureEq(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function authConfig(){return JSON.parse(fs.readFileSync(AUTH_FILE,'utf8'))}
function authorized(req){const h=String(req.headers.authorization||'');if(!h.startsWith('Basic '))return false;let raw='';try{raw=Buffer.from(h.slice(6),'base64').toString('utf8')}catch{return false}const i=raw.indexOf(':');if(i<1)return false;const user=raw.slice(0,i),pass=raw.slice(i+1),cfg=authConfig();const digest=crypto.createHash('sha256').update(pass).digest('hex');return secureEq(user,cfg.username)&&secureEq(digest,cfg.password_sha256)}
function headers(extra={}){return {'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",...extra}}
function send(res,status,body,type='text/plain; charset=utf-8',extra={}){res.writeHead(status,headers({'content-type':type,...extra}));res.end(body)}
function challenge(res){send(res,401,'Authentication required','text/plain; charset=utf-8',{'www-authenticate':'Basic realm="Company OS", charset="UTF-8"'})}
function staticFile(url){let rel=url.replace(/^\/company-os\/?/,'')||'index.html';if(rel==='')rel='index.html';if(rel.includes('..')||rel.includes('\\'))return null;const f=path.join(PUBLIC,rel);if(!f.startsWith(PUBLIC+path.sep)&&f!==path.join(PUBLIC,'index.html'))return null;return f}
const server=http.createServer((req,res)=>{try{const u=new URL(req.url,'http://localhost');if(req.method!=='GET')return send(res,405,'Method Not Allowed');if(u.pathname==='/health')return send(res,200,JSON.stringify({ok:true,service:'prhm-company-os-dashboard',version:'1.0.0-read-only'}),'application/json; charset=utf-8');if((u.pathname==='/company-os'||u.pathname.startsWith('/company-os/'))&&String(req.headers['x-forwarded-proto']||'').toLowerCase()!=='https')return send(res,301,'HTTPS Required','text/plain; charset=utf-8',{'location':'https://agent.prhm.ir'+u.pathname+u.search});if(!authorized(req))return challenge(res);if(u.pathname==='/company-os/api/snapshot'){const raw=fs.readFileSync(SNAPSHOT,'utf8');return send(res,200,raw,'application/json; charset=utf-8')}if(u.pathname==='/company-os'||u.pathname.startsWith('/company-os/')){const f=staticFile(u.pathname);if(!f||!fs.existsSync(f)||!fs.statSync(f).isFile())return send(res,404,'Not Found');const ext=path.extname(f);const type=ext==='.css'?'text/css; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.html'?'text/html; charset=utf-8':'application/octet-stream';return send(res,200,fs.readFileSync(f),type)}return send(res,404,'Not Found')}catch{return send(res,500,'Internal Error')}});
server.listen(PORT,HOST,()=>console.log(JSON.stringify({ok:true,service:'prhm-company-os-dashboard',host:HOST,port:PORT,version:'1.0.0-read-only'})));
process.once('SIGTERM',()=>server.close(()=>process.exit(0)));
