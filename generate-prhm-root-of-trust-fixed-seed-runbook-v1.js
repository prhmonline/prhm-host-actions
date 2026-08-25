#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const manifest=require('./prhm-root-of-trust-fixed-seed-v1.manifest.json');

function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function buildRunbookForCommit(commit){
  if(!/^[a-f0-9]{40}$/.test(commit)) throw new Error('invalid_artifact_commit');
  if(!/^[a-f0-9]{64}$/.test(manifest.artifact_sha256)) throw new Error('invalid_artifact_sha');
  const artifact=fs.readFileSync('bootstrap-prhm-root-of-trust-fixed-seed-v1.js');
  if(sha(artifact)!==manifest.artifact_sha256) throw new Error('artifact_manifest_sha_mismatch');
  const url=`https://raw.githubusercontent.com/prhmonline/prhm-host-actions/${commit}/bootstrap-prhm-root-of-trust-fixed-seed-v1.js`;
  return `# PRHM Root-of-Trust Fixed Seed V1 — Provider Console Runbook\n\n`+
`Artifact commit: \`${commit}\`\n\nArtifact SHA-256: \`${manifest.artifact_sha256}\`\n\n`+
`## Trust boundary\n\nRun this only from the provider/VM console as root. Do not run it through Agent API, MCP, self-maintenance, Host Actions, DeployHQ, GitHub Actions, or an SSH deployment credential.\n\n`+
`## Stop conditions\n\nStop immediately if artifact SHA verification fails, the seed reports baseline mismatch, transport-helper mismatch, symlink rejection, candidate syntax failure, service-health failure, or \`FAILED_ROLLBACK_INCOMPLETE\`. The transport action itself is not executed in this Gate.\n\n`+
'```bash\nset -euo pipefail\ninstall -d -m 0700 /root/prhm-root-seed-v1\ncd /root/prhm-root-seed-v1\n'+
`curl --fail --silent --show-error --location "${url}" -o seed.js\n`+
`printf '%s  %s\\n' '${manifest.artifact_sha256}' 'seed.js' | sha256sum -c -\n`+
'/usr/local/bin/prhm-node --check seed.js\n/usr/local/bin/prhm-node seed.js\n\n'+
'# Read-only post-install evidence\n'+
'sha256sum /opt/prhm-agent-selfmaint/server.js\n'+
'sha256sum /opt/prhm-agent-selfmaint-exec/server.js\n'+
'sha256sum /opt/prhm-company-control-plane/config/approval-policy.json\n'+
'systemctl is-active prhm-agent-selfmaint.service\n'+
'systemctl is-active prhm-agent-selfmaint-exec.service\n```\n';
}
function buildRunbook(){
  if(process.argv.length!==2) throw new Error('unexpected_arguments');
  const commit=cp.execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  return buildRunbookForCommit(commit);
}
function main(){
  const body=buildRunbook();
  fs.mkdirSync('docs/runbooks',{recursive:true});
  fs.writeFileSync('docs/runbooks/prhm-root-of-trust-fixed-seed-v1.md',body,'utf8');
  process.stdout.write(JSON.stringify({ok:true,runbook:'docs/runbooks/prhm-root-of-trust-fixed-seed-v1.md'})+'\n');
}
module.exports={buildRunbook,buildRunbookForCommit};
if(require.main===module){try{main();}catch(e){console.error(JSON.stringify({ok:false,error:String(e?.message||e)}));process.exit(1);}}
