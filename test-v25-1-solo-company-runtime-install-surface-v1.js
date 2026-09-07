'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const x=require('./bootstrap-host-actions-v25-1-solo-company-runtime-install-surface-v1.js');
test('candidate is fixed and bound to active runtime',()=>{const b=x.candidate();assert.equal(crypto.createHash('sha256').update(b).digest('hex'),x.CANDIDATE_SAFEFILES_SHA);const s=b.toString();for(const v of [x.SAFEFILES_BASE_SHA,x.EXPECTED_REGISTRY_SHA,x.EXPECTED_HOST_ACTIONS_V2_SHA,x.PLUGIN_SHA,x.CORE_SHA])assert.match(s,new RegExp(v));assert.match(s,/solo_company_runtime_install_surface_v1/);assert.doesNotMatch(s,/process\.argv/);});
