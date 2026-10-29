'use strict';
// Disposable GitHub Ubuntu VM fixture only. Not a PRHM application service.
const fs=require('node:fs'),net=require('node:net');
if(process.argv.length!==4)process.exit(61);
const owner=process.argv[2],sock=process.argv[3];
if(!fs.readFileSync(owner,'utf8').startsWith('HEALTHY_'))process.exit(73);
try{fs.unlinkSync(sock)}catch(e){if(e.code!=='ENOENT')throw e}
const server=net.createServer(c=>{
 const text=fs.readFileSync(owner,'utf8');
 if(!text.startsWith('HEALTHY_')){c.destroy();return}
 c.end('OK:'+text);
});
server.listen(sock);
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
