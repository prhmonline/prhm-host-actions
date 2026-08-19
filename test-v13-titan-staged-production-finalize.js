const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const helper=path.join(root,'titan-staged-production-finalize-v1.js');
const boot=path.join(root,'bootstrap-host-actions-v13-titan-staged-production-finalize.js');

test('Titan helper is fixed-scope, snapshot-first, reload-guarded and rollback-capable',()=>{
  assert.equal(fs.existsSync(helper),true,'helper must exist');
  const s=fs.readFileSync(helper,'utf8');
  for(const x of [
    "const ACTION='titan_staged_production_finalize_v1'",
    "titanfitness-club.com",
    "www.titanfitness-club.com",
    "admin.titanfitness-club.com",
    "/etc/nginx/nginx.phase7b.conf",
    "/etc/nginx/certs/titan/titanfitness-club.com.cert.combined",
    "/etc/nginx/certs/titan/titanfitness-club.com.key",
    "/etc/letsencrypt/live/titanfitness-club.com-edge/fullchain.pem",
    "/var/www/prhm-acme",
    "prhm-edge-nginx.service",
    "10.71.0.118:80",
    "snapshotState",
    "mutationStarted=true",
    "/usr/sbin/nginx',['-t','-c',NGINX_CONFIG]",
    "/usr/bin/systemctl',['kill','-s','HUP','--kill-who=main',EDGE_SERVICE]",
    "rollback",
    "verifySans",
    "verifyLocalSni",
    "verifyPublic",
    "verifyRepresentativeHost",
    "--preflight-only",
  ]) assert.ok(s.includes(x),`missing ${x}`);
  assert.ok(s.indexOf('snapshotState') < s.indexOf('mutationStarted=true'),'snapshot must precede mutation marker');
  assert.ok(s.indexOf("/usr/sbin/nginx',['-t','-c',NGINX_CONFIG]") < s.indexOf("/usr/bin/systemctl',['kill','-s','HUP','--kill-who=main',EDGE_SERVICE]"),'nginx -t must precede HUP');
  assert.doesNotMatch(s,/process\.argv\[[2-9]\].*(host|path|command|service)/i);
  assert.doesNotMatch(s,/privateKey\s*[:=].*console|console\.log\([^\n]*(privkey|private[_ -]?key)/i);
  assert.match(s,/catch\(err\)[\s\S]*rollback/);
});

test('Titan helper pins exact SANs and rejects ambiguous Nginx anchors',()=>{
  assert.equal(fs.existsSync(helper),true,'helper must exist');
  const s=fs.readFileSync(helper,'utf8');
  assert.match(s,/Object\.freeze\(\['titanfitness-club\.com','www\.titanfitness-club\.com','admin\.titanfitness-club\.com'\]\)/);
  assert.match(s,/anchor_not_unique/);
  assert.match(s,/unexpected_titan_lineage/);
  assert.match(s,/SAN_COVERAGE=PASS/);
  assert.match(s,/ROLLBACK=PASS/);
});

test('v13 bootstrap registers only a fixed critical Level-4 action and keeps bootstrap preflight read-only',()=>{
  assert.equal(fs.existsSync(boot),true,'bootstrap must exist');
  const s=fs.readFileSync(boot,'utf8');
  for(const x of [
    'titan_staged_production_finalize_v1',
    'host_action.titan_staged_production_finalize_v1',
    '1.13.0-host-actions-v2-titan-staged-production-finalize',
    '2026-08-19.1-titan-staged-production-finalize-v1',
    "risk:'critical'",
    'level:4',
    '--preflight-only',
    'production_mutation:false',
    'database_mutation:false',
    '/opt/prhm-agent-selfmaint-exec/actions/titan-staged-production-finalize-v1.js',
  ]) assert.ok(s.includes(x),`missing ${x}`);
  assert.doesNotMatch(s,/hostname\s*:\s*\{|command\s*:\s*\{|path\s*:\s*\{|service\s*:\s*\{/i);
  assert.match(s,/automatic rollback/i);
});
