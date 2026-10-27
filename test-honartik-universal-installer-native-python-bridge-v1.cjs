'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./honartik-universal-installer-native-python-bridge-v1.cjs');
const {CONTRACT:C}=require('./honartik-universal-installer-l4-v1.cjs');
test('the bridge exposes no CLI, registration or generic installer executor',()=>{
 assert.equal(m.ROOT_ACTION_REGISTERED,false);
 assert.equal(m.PRODUCTION_INSTALL_AUTHORIZED,false);
 assert.equal(m.INDEPENDENT_SIGNED_LINUX_PROVENANCE_REQUIRED,true);
 assert.equal(m.run,undefined);
 assert.equal(m.cli,undefined);
 assert.equal(m.install,undefined);
 assert.equal(m.installViaFixedTrustedPython.length,3);
});
test('fixed Python bridge calls EXACT installed install_bundle signature',()=>{
 const script=m.fixedPythonCode();
 assert.match(script,/from universal\.install import install_bundle,bundle_digest/);
 assert.ok(script.includes('install_bundle(source,dest,"'+C.candidate_digest+
  '","'+C.existing_digest+'")'));
 assert.ok(script.includes('"'+C.installer_prefix+'"'));
 assert.ok(script.includes('"'+C.installer_prefix+'/versions/'+C.existing_digest+'"'));
 assert.ok(!script.includes('subprocess'));
 assert.ok(!script.includes('os.system'));
 assert.ok(!script.includes('shell=True'));
 assert.ok(!script.includes('eval('));
});
test('only a fixed candidate and immutable active Python are selected',()=>{
 const script=m.fixedPythonCode();
 assert.ok(script.includes('/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4/candidate-source'));
 assert.ok(script.includes('if bundle_digest(source)!='));
 assert.ok(script.includes('raise RuntimeError("candidate_sha_drift")'));
 assert.equal(script.split('install_bundle(').length,2);
});
test('Linux: unregistered bridge refuses nonroot without calling Python',()=>{
 if(process.getuid?.()!==0){
  assert.throws(()=>m.installViaFixedTrustedPython(
   '11111111-2222-4333-8444-555555555555',
   'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
   ()=>{throw Error('should_not_call');}),/root_required/);
 }
});
test('Python code is unchanged and cannot accept runtime source arguments',()=>{
 assert.equal(m.fixedPythonCode.length,0);
 const a=m.fixedPythonCode(),b=m.fixedPythonCode();
 assert.equal(a,b);
 assert.ok(a.includes('PRHM_FIXED_PYTHON_INSTALL_OK=1'));
});
