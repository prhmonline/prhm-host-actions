# Control Plane Typed Bootstrap Transport V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a SHA-bound, path-allowlisted, no-secret Control Plane bootstrap transport that can install exactly one pre-approved immutable package and nothing else.

**Architecture:** The transport compiles one fixed package manifest into its source. A pure validator/preflight layer proves package identity, artifact hashes, destination safety and baseline bindings without writing; a separate transaction layer stages only manifest-owned artifacts, installs them atomically, manages only the explicitly approved service/unit changes, and rolls back only invocation-owned mutations. Host Action v2 registration is installed separately and public MCP runtime activation remains a later rolling-refresh gate.

**Tech Stack:** Node.js 20, built-in `node:test`, `crypto`, `fs`, `path`, `child_process`; systemd; existing PRHM Host Action v2 Base/Executor/Approval/MCP architecture.

**Spec:** `docs/superpowers/specs/2026-08-20-control-plane-typed-bootstrap-transport-v1-design.md`

## Global Constraints

- Action: `control_plane_typed_bootstrap_transport_v1`.
- Operation: `host_action.control_plane_typed_bootstrap_transport_v1`.
- Environment: `production`; risk: `critical`; apply requires a fresh literal `CONFIRM_LEVEL_4_CRITICAL` bound to the specific persisted request.
- Request schema exposes no arbitrary package, source, repository, commit, path, file content, command, URL, environment override, token, credential, secret, or shell field.
- V1 package id is fixed: `deployhq_control_adapter_node1_recreate_v1`.
- Source repository is fixed: `prhmonline/prhm-host-actions`; source commit and manifest SHA-256 are compiled constants, not request inputs.
- Transport must never call DeployHQ API, execute a DeployHQ deployment, mutate DeployHQ targets, run `git pull`/`git checkout`, or expose a generic network fetch primitive.
- Writes are limited to manifest-owned destinations under `/opt/prhm-deployhq-control/`, `/opt/prhm-agent-selfmaint-exec/actions/`, `/var/lib/prhm-agent-selfmaint-exec/`, and exact `/etc/systemd/system/prhm-deployhq-control.service`.
- Public MCP runtime must not be restarted directly; MCP source changes report `mcp_refresh_required=true` for a later rolling gate.
- Credential values never enter the package, transport request, logs, results, exceptions, tests, or chat.
- Honartik/iMotion application content, targets, redirects, canonicals, databases and active temporary DeployHQ targets are out of scope and must remain untouched.

---

### Task 1: Fixed Package Manifest and Pure Validator

**Files:**
- Create: `control-plane-typed-bootstrap-transport-v1.js`
- Create: `test-control-plane-typed-bootstrap-transport-v1.js`

**Interfaces:**
- Produces: `ACTION`, `OPERATION`, `PACKAGE`, `ALLOWLIST`, `validateManifest(manifest)`, `validateDestination(record, fsApi)`, `validatePackageBytes(manifest, artifactBytes)`, `redactEvidence(value)`.
- Consumes: no runtime services and no network.

- [ ] **Step 1: Write failing identity and request-surface tests**

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const t=require('./control-plane-typed-bootstrap-transport-v1.js');

test('transport identity and package are immutable',()=>{
  assert.equal(t.ACTION,'control_plane_typed_bootstrap_transport_v1');
  assert.equal(t.OPERATION,'host_action.control_plane_typed_bootstrap_transport_v1');
  assert.equal(t.PACKAGE.package_id,'deployhq_control_adapter_node1_recreate_v1');
  assert.equal(t.PACKAGE.source_repo,'prhmonline/prhm-host-actions');
  assert.match(t.PACKAGE.source_commit,/^[a-f0-9]{40}$/);
  assert.match(t.PACKAGE.manifest_sha256,/^[a-f0-9]{64}$/);
});

test('runtime request surface is empty',()=>{
  assert.deepEqual(t.REQUEST_FIELDS,[]);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test-control-plane-typed-bootstrap-transport-v1.js`
Expected: FAIL because module/functions do not exist.

- [ ] **Step 3: Implement immutable manifest model and canonical hashing**

Implement `canonicalManifestBytes()` using stable key ordering and LF newline termination. `validateManifest()` must reject any extra key beyond `source_path,destination_path,sha256,mode,owner,group,replace_policy`, reject relative paths/`..`, and require exact package constants.

- [ ] **Step 4: Add destination/symlink and artifact SHA tests**

```js
test('destination outside allowlist fails closed',()=>{
  assert.throws(()=>t.validateDestination({destination_path:'/root/x'},fakeFs),/destination_not_allowlisted/);
});

test('artifact sha mismatch fails closed',()=>{
  assert.throws(()=>t.validatePackageBytes(manifest,{...bytes,'deployhq-control-adapter-v1.js':Buffer.from('tampered')}),/artifact_sha_mismatch/);
});
```

Also cover symlink destination, symlink parent, alternate path spelling, manifest chaining fields, and secret-like manifest keys.

- [ ] **Step 5: Run syntax and Task 1 suite**

Run: `node --check control-plane-typed-bootstrap-transport-v1.js && node --check test-control-plane-typed-bootstrap-transport-v1.js && node --test test-control-plane-typed-bootstrap-transport-v1.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add control-plane-typed-bootstrap-transport-v1.js test-control-plane-typed-bootstrap-transport-v1.js
git commit -m "feat: add typed bootstrap package validator"
```

### Task 2: Strict Read-Only Preflight

**Files:**
- Modify: `control-plane-typed-bootstrap-transport-v1.js`
- Modify: `test-control-plane-typed-bootstrap-transport-v1.js`

**Interfaces:**
- Produces: `preflight({fsApi,execApi,packageBytes,liveBaseline}) -> evidence`.

- [ ] **Step 1: Write failing zero-write preflight test**

```js
test('preflight performs zero writes and returns required evidence',()=>{
  const writes=[];
  const out=t.preflight({fsApi:readOnlyFs(writes),execApi:fixedVerifier(),packageBytes,liveBaseline});
  assert.equal(writes.length,0);
  assert.deepEqual(out,{...out,ok:true,preflight_only:true,production_mutation:false,source_commit_match:true,manifest_sha_match:true,all_file_sha_match:true,destination_allowlist_pass:true,symlink_guard_pass:true,syntax_pass:true,baseline_match:true});
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test-control-plane-typed-bootstrap-transport-v1.js --test-name-pattern='preflight'`
Expected: FAIL because `preflight` is absent.

- [ ] **Step 3: Implement preflight with fixed verifier commands only**

Allowed child processes are exact executable/argument tuples derived from compiled manifest only: `/usr/local/bin/prhm-node --check <private-stage-candidate>` and `systemd-analyze verify <fixed-unit-candidate>` when applicable. No request-derived executable/args are accepted. Preflight itself must validate in-memory/temp candidates without touching manifest destinations and return no secrets.

- [ ] **Step 4: Add negative preflight cases**

Cover wrong source commit, wrong manifest SHA, one artifact SHA mismatch, unsafe destination/symlink, syntax failure, baseline drift, existing destination conflict outside `replace_policy`, and secret-like evidence leakage.

- [ ] **Step 5: Run all Task 1–2 tests**

Run: `node --check control-plane-typed-bootstrap-transport-v1.js && node --test test-control-plane-typed-bootstrap-transport-v1.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add control-plane-typed-bootstrap-transport-v1.js test-control-plane-typed-bootstrap-transport-v1.js
git commit -m "feat: add read-only bootstrap preflight"
```

### Task 3: Transactional Apply and Invocation-Bound Rollback

**Files:**
- Modify: `control-plane-typed-bootstrap-transport-v1.js`
- Modify: `test-control-plane-typed-bootstrap-transport-v1.js`

**Interfaces:**
- Produces: `applyTransaction(deps)`, `rollbackJournal(journal,deps)`, `persistResult(result,deps)`.

- [ ] **Step 1: Write failing apply ownership test**

```js
test('apply writes only manifest-owned destinations',()=>{
  const trace=[];
  const out=t.applyTransaction(makeApplyDeps(trace));
  assert.equal(out.ok,true);
  assert.deepEqual(new Set(trace.filter(x=>x.kind==='write').map(x=>x.path)),new Set(PACKAGE_DESTINATIONS));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test-control-plane-typed-bootstrap-transport-v1.js --test-name-pattern='apply|rollback'`
Expected: FAIL because transaction functions are absent.

- [ ] **Step 3: Implement journal-first transaction**

Before first destination mutation, persist a root-owned invocation journal containing destination existence, original SHA, mode/ownership metadata, backup path if replacement is allowed, and original service state. Stage candidates in a root-owned `0700` directory, reverify artifact SHA/syntax, then atomically rename only to manifest destinations.

- [ ] **Step 4: Implement narrow service semantics**

`systemctl daemon-reload` is permitted only when the exact unit artifact changed. Start/restart only `prhm-deployhq-control.service`; Approval/Base/Executor restart is deferred to the registration package step. Never restart public MCP runtime.

- [ ] **Step 5: Add rollback tests**

Cover post-write SHA mismatch, adapter health failure, created-file removal, replaced-file restore from SHA-verified backup, original service-state restore, rollback failure -> `{ok:false,critical_failure:true,rollback_failed:true}`, and proof that unrelated files/services are never touched.

- [ ] **Step 6: Run full transport suite and commit**

Run: `node --check control-plane-typed-bootstrap-transport-v1.js && node --test test-control-plane-typed-bootstrap-transport-v1.js`
Expected: PASS.

```bash
git add control-plane-typed-bootstrap-transport-v1.js test-control-plane-typed-bootstrap-transport-v1.js
git commit -m "feat: add transactional bootstrap apply rollback"
```

### Task 4: Build the First Immutable DeployHQ Adapter Package

**Files:**
- Create: `packages/deployhq-control-adapter-node1-recreate-v1/manifest.json`
- Copy from reviewed PR #55 source commit: `packages/deployhq-control-adapter-node1-recreate-v1/deployhq-control-adapter-v1.js`
- Copy: `packages/deployhq-control-adapter-node1-recreate-v1/bootstrap-deployhq-control-adapter-v1.js`
- Copy: `packages/deployhq-control-adapter-node1-recreate-v1/deployhq-node1-canonical-recreate-v1.js`
- Copy: `packages/deployhq-control-adapter-node1-recreate-v1/bootstrap-host-actions-deployhq-node1-recreate-v1.js`
- Create: `test-control-plane-typed-bootstrap-package-v1.js`

**Interfaces:**
- Produces: exact immutable package bytes consumed by Tasks 1–3.

- [ ] **Step 1: Pin the exact reviewed source commit**

Read PR #55 head and record its immutable 40-hex SHA. Do not use a branch name at runtime.

- [ ] **Step 2: Write failing manifest-byte tests**

Tests assert exact source paths, exact allowed destinations, modes/owners/groups, SHA-256 for every artifact, and canonical manifest SHA.

- [ ] **Step 3: Copy exact reviewed bytes and generate manifest**

No credentials, `.env`, tokens, Authorization headers, private keys or runtime-generated content are included. The systemd unit is generated as reviewed static content and uses `LoadCredential=deployhq_email:...` and `LoadCredential=deployhq_api_key:...`; credential source paths are not package secrets.

- [ ] **Step 4: Add package secret scan**

Test rejects credential values and known secret-bearing key patterns in package metadata/evidence. It must not reject the literal safe credential names `deployhq_email` and `deployhq_api_key` used by `LoadCredential`.

- [ ] **Step 5: Run package + transport suites and commit**

Run: `node --check packages/deployhq-control-adapter-node1-recreate-v1/*.js && node --test test-control-plane-typed-bootstrap-transport-v1.js test-control-plane-typed-bootstrap-package-v1.js`
Expected: PASS.

### Task 5: Register `control_plane_typed_bootstrap_transport_v1` in Host Action v2

**Files:**
- Create: `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`
- Create: `test-host-actions-control-plane-typed-bootstrap-transport-v1.js`

**Interfaces:**
- Produces Base action registry entry, Executor registry/dispatch, Approval level-4 operation/scope, MCP enum entry, executor-owned helper/result paths, and updated ZDT SHA bindings.

- [ ] **Step 1: Capture current live baseline SHAs read-only before coding**

Capture exact SHA-256 for `/opt/prhm-agent-selfmaint/server.js`, `/opt/prhm-agent-selfmaint-exec/server.js`, `/opt/prhm-company-control-plane/config/approval-policy.json`, `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`, and `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js`. Compile these values into installer tests; do not reuse historical SHAs.

- [ ] **Step 2: Write RED registration tests**

Assert action/operation identity, one Base entry, one Executor registry/dispatch path, level-4 critical policy scope, one MCP enum entry, no pending-status-handler rewrite, and no unrelated Honartik/iMotion patch.

- [ ] **Step 3: Implement SHA-bound registration bootstrap**

Use existing V16 atomic backup/restore patterns, but patch only transport-specific anchors. Executor runner must execute the fixed helper through hardened `systemd-run` with exact read-write paths needed by the compiled manifest and no request-derived arguments.

- [ ] **Step 4: Enforce result contract**

Executor accepts only `ok=true`, correct action/schema/package id, all integrity booleans true, `deployhq_mutation=false`, `application_mutation=false`, `honartik_mutation=false`, `imotion_mutation=false`, and normal `rollback_failed=false`.

- [ ] **Step 5: Update ZDT bindings without public MCP restart**

Installer updates source SHA bindings and returns `mcp_refresh_required=true`; it restarts only Approval/Base/Executor services required for source registration.

- [ ] **Step 6: Run registration tests and commit**

Run: `node --check bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js && node --test test-host-actions-control-plane-typed-bootstrap-transport-v1.js`
Expected: PASS.

### Task 6: Integrated Security and Regression Suite

**Files:**
- Create: `test-control-plane-typed-bootstrap-transport-integration-v1.js`

**Interfaces:**
- Consumes all artifacts from Tasks 1–5.

- [ ] **Step 1: Encode all 20 spec acceptance cases as executable tests**

Cover valid manifest, source/manifest/file SHA failures, allowlist/symlink/path/command rejection, secret leakage, zero-write preflight, manifest-only apply, rollback paths, MCP no-direct-restart, Honartik/iMotion untouched, no DeployHQ API call by transport, request schema with no arbitrary fields, and idempotent/safe repeat semantics.

- [ ] **Step 2: Add forbidden-capability source scans**

Assert transport source does not contain generic `exec(`, `spawn(` with request input, arbitrary `fetch(` / URL input, `git pull`, `git checkout`, `curl | bash`, dynamic destination assignment, or secret input parsing. Fixed syntax/systemd verifier calls are permitted only through exact helper wrappers tested separately.

- [ ] **Step 3: Run complete Node suite**

Run all transport/package/registration/integration test files. Expected: zero failures.

- [ ] **Step 4: Commit and open Draft PR**

Draft PR base `main`; report changed-file count, additions/deletions, head SHA and mergeability. Do not merge.

### Task 7: Live Read-Only Preflight Gate

**Files:**
- No production writes.

**Interfaces:**
- Produces the evidence required before requesting Level-4 install authorization.

- [ ] **Step 1: Re-read live baseline SHAs and service topology**

Fail closed on any drift from Task 5 compiled baselines. Verify current public MCP topology is unchanged and no temporary Honartik/iMotion target cleanup is attempted.

- [ ] **Step 2: Run only `--preflight-only` for registration/transport candidate**

Expected evidence: `ok=true`, `preflight_only=true`, `production_mutation=false`, source/manifest/file SHA matches, allowlist/symlink/syntax/baseline PASS, no DeployHQ/application/Honartik/iMotion mutation.

- [ ] **Step 3: Verify post-preflight invariants**

Confirm Approval/Base/Executor/MCP service/runtime topology and relevant file SHAs are unchanged after preflight.

- [ ] **Step 4: Stop at Level-4 gate**

Do not install. Report the immutable candidate SHA/manifest SHA and require a fresh literal `CONFIRM_LEVEL_4_CRITICAL` specifically for installing `control_plane_typed_bootstrap_transport_v1`.

## Self-Review Checklist

- Every approved spec requirement maps to Tasks 1–7.
- No task provisions DeployHQ credentials.
- No task performs node1 recreate or Blue V4 cutover.
- No request-derived shell, path, URL, repository, commit or file content exists.
- Public MCP activation remains a later rolling-refresh gate.
- Production install and package apply remain separate Level-4 confirmations.
