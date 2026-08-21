 'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {patchExecutorSource}=require('./bootstrap-host-actions-v17-2-drtarjomeh-containment-runner-transport-repair.js');
const FN=`async function applyDrTarjomehSecurityContainmentV1() {
  const childProcess = require('node:child_process');
  const args = [
    '--wait',
    '--pipe',
    '--collect',
    '--quiet',
    '/usr/local/bin/prhm-node',
    '/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-security-containment-v1.js'
  ];
  const run = childProcess.spawnSync('/usr/bin/systemd-run', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error('failed');
  const lines = String(run.stdout || '').split(/\\r?\\n/).filter(Boolean);
  let result = null;
  for (let i = lines.length - 1; i >= 0; i--) { try { const parsed = JSON.parse(lines[i]); if (parsed && parsed.schema_version === 'prhm.host-action-result.v1' && parsed.action === 'drtarjomeh_security_containment_v1') { result = parsed; break; } } catch {} }
  if (!result) throw new Error('drtarjomeh_containment_result_missing');
  return result;
}

applyHostActionV2=async function(action){return action;};`;
test('removes pipe transport and reads fixed result file without changing helper path',()=>{const out=patchExecutorSource(FN);assert.equal(out.includes("'--pipe'"),false);assert.equal(out.includes("readJson(resultPath)"),true);assert.equal(out.includes('/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-security-containment-v1.js'),true);assert.equal(out.includes("fs.unlinkSync(resultPath)"),true)});
test('fails closed when pipe transport is already absent',()=>{assert.throws(()=>patchExecutorSource(FN.replace("    '--pipe',\n",'')),/pipe_count:0/)});
test('fails closed when stdout parser invariant is missing',()=>{assert.throws(()=>patchExecutorSource(FN.replace('  const lines =','  const outputLines =')),/stdout_parser_count:0/)});
