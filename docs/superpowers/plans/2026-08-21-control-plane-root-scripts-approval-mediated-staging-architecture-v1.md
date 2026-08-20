# Control Plane Root Scripts Approval-Mediated Staging Architecture V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and fully test a fixed MCP facade plus a fixed privileged Approval Center mediator for staging exactly the two immutable Control Plane Root-of-Trust artifacts, without exposing approval secrets or creating any generic privileged writer.

**Architecture:** Development happens only in `prhmonline/prhm-host-actions`. The MCP candidate `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js` is derived from the verified live `safeFiles.js` baseline and exposes exactly four fixed tools. A separate development-only mediator candidate `candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js` models the privileged request/decision/validate/consume flow; production installation of either candidate is outside this plan.

**Tech Stack:** Node.js ESM, built-in `fs`, `path`, `crypto`, `zlib`, `child_process`, Zod schemas, Node test runner/assertions, existing MCP plugin conventions, existing Approval Center request/decision/validate/consume contracts.

**Spec:** `docs/superpowers/specs/2026-08-21-control-plane-root-scripts-typed-staging-capability-v1-design.md`

## Global Constraints

- Verified live MCP baseline: `20090` bytes, SHA-256 `9f291891673806e34d2681ba7b8227ddd4470f73cec12f69a7c3e9035808caa2`.
- Candidate MCP file: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`.
- Candidate mediator file: `candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js`.
- Final MCP candidate size must be `<= 120000` bytes.
- Fixed source commit for embedded artifacts: `51027bc81f16840580b3ed5ca09d6c42f78dc044`.
- Fixed staging root: `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/`.
- Fixed staged artifacts:
  - `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/control-plane-typed-bootstrap-transport-v1.js` — 72854 bytes — SHA-256 `049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335`.
  - `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js` — 109634 bytes — SHA-256 `d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e`.
- Embedded package manifest SHA-256 must remain `aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728`.
- MCP facade must never read, mint, accept, return, log, or persist approval tokens or Approval Center credentials.
- Caller-controlled `path`, `content`, `command`, `url`, `repository`, `commit`, `sha`, `project`, `role`, `environment`, `risk`, approval token, or arbitrary environment input is forbidden.
- Runtime network fetch, shell execution, `eval`, generic upload/root writer behavior, `systemctl` mutation, DeployHQ mutation, Honartik mutation, iMotion mutation, database mutation, and Root-of-Trust `--apply` are forbidden.
- Request, production source installation, MCP rolling exposure, staging execution, preflight, and later Root-of-Trust apply are separate governed gates and never reuse confirmations.

---

### Task 1: Baseline Integrity and Deterministic Artifact Packaging

**Files:**
- Modify: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Create: `test/control-plane-root-scripts/baseline-and-packaging.test.js`

**Interfaces:**
- Consumes: verified live baseline bytes and SHA above; immutable source artifact bytes from commit `51027bc81f16840580b3ed5ca09d6c42f78dc044`.
- Produces: `ARTIFACTS` constant with exact names/bytes/SHA values and `decodeArtifact(name)` returning a `Buffer` whose length/SHA exactly match the fixed contract.

- [ ] **Step 1: Write failing baseline integrity tests.**

```js
assert.equal(candidateBaselineBytes.length, 20090);
assert.equal(sha256(candidateBaselineBytes), '9f291891673806e34d2681ba7b8227ddd4470f73cec12f69a7c3e9035808caa2');
assert.equal(typeof decodeArtifact, 'function');
```

Run:
```bash
node --test test/control-plane-root-scripts/baseline-and-packaging.test.js
```
Expected RED: failure because `ARTIFACTS`/`decodeArtifact` are not defined yet.

- [ ] **Step 2: Add deterministic embedded artifact constants and decoder.**

Representative interface:
```js
const ARTIFACTS = Object.freeze({
  transport: Object.freeze({ name: 'control-plane-typed-bootstrap-transport-v1.js', bytes: 72854, sha256: '049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335', gzipBase64: '...' }),
  bootstrap: Object.freeze({ name: 'bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js', bytes: 109634, sha256: 'd3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e', gzipBase64: '...' })
});
function decodeArtifact(key) { /* gunzip fixed literal, then verify bytes + sha256 */ }
```
The generated literals must be produced deterministically from the immutable source commit during development, never fetched at runtime.

- [ ] **Step 3: Run packaging tests GREEN.**

Run:
```bash
node --test test/control-plane-root-scripts/baseline-and-packaging.test.js
```
Expected GREEN: both reconstructed files match exact byte counts and SHA-256 values; manifest SHA marker is present.

- [ ] **Step 4: Enforce candidate size ceiling.**

Run:
```bash
wc -c candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js
```
Expected: integer `<= 120000`; otherwise stop implementation fail-closed.

- [ ] **Step 5: Commit Task 1.**

```bash
git add candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js test/control-plane-root-scripts/baseline-and-packaging.test.js
git commit -m "feat: embed fixed root staging artifacts"
```

---

### Task 2: Privileged Approval Mediator Contract

**Files:**
- Create: `candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js`
- Create: `test/control-plane-root-scripts/mediator-contract.test.js`

**Interfaces:**
- Consumes: injected `approvalHttp()` and `approvalBridge()` test doubles; no real credentials.
- Produces:
  - `createRequest(): Promise<{request_id:string,binding_metadata:object}>`
  - `applyApprovedRequest({request_id,second_confirmation}, executeStage): Promise<object>`
  - `getStatus({request_id}): Promise<object>`
  - `authorizeConsume({request_id,approval_token}): Promise<{valid:true,consumed:true}>` as an internal mediator-only interface, never MCP-facing.

- [ ] **Step 1: Write failing mediator tests.**

Cover exact Level-4 binding: fixed action/operation, `project=control_plane`, `environment=production`, `risk=critical`, deterministic `arguments_sha256`, TTL 180 seconds, rollback reference, unique request ID, wrong confirmation rejection, expired/mismatched/replayed request rejection, validate-before-consume, consume-before-stage, and zero token leakage.

Run:
```bash
node --test test/control-plane-root-scripts/mediator-contract.test.js
```
Expected RED: module/functions do not exist.

- [ ] **Step 2: Implement fixed request binding.**

Representative constants:
```js
const ACTION='control_plane_root_scripts_stage_transport_v1';
const OPERATION='host_action.control_plane_root_scripts_stage_transport_v1';
const ARGUMENTS=Object.freeze({action:ACTION});
const ARGUMENTS_SHA256=sha256(Buffer.from(stableJson(ARGUMENTS)));
```
`createRequest()` may obtain request credentials only from the privileged runtime dependency supplied to the mediator; credentials must never be function parameters or returned values.

- [ ] **Step 3: Implement decision/validate/consume ordering.**

`applyApprovedRequest()` must require literal `CONFIRM_LEVEL_4_CRITICAL`, resolve the fixed request, perform decision, validate fixed bindings, consume once, then invoke injected `executeStage()` only after `consumed === true`.

- [ ] **Step 4: Run mediator tests GREEN.**

Run:
```bash
node --test test/control-plane-root-scripts/mediator-contract.test.js
```
Expected GREEN: all request/binding/replay/token-redaction cases pass.

- [ ] **Step 5: Commit Task 2.**

```bash
git add candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js test/control-plane-root-scripts/mediator-contract.test.js
git commit -m "feat: add fixed approval mediated staging contract"
```

---

### Task 3: MCP Request / Apply / Status Facade

**Files:**
- Modify: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Create: `test/control-plane-root-scripts/mcp-facade.test.js`

**Interfaces:**
- Consumes: mediator client with `createRequest`, `applyApprovedRequest`, and `getStatus` methods.
- Produces exactly four MCP-facing tools:
  - `control_plane_root_scripts_stage_transport_request_v1` — empty input.
  - `control_plane_root_scripts_stage_transport_apply_v1` — `{request_id, second_confirmation}` only.
  - `control_plane_root_scripts_stage_transport_status_v1` — `{request_id}` only.
  - `control_plane_root_scripts_transport_preflight_v1` — empty input.

- [ ] **Step 1: Write failing exact-schema tests.**

```js
assert.deepEqual(names, [
 'control_plane_root_scripts_stage_transport_request_v1',
 'control_plane_root_scripts_stage_transport_apply_v1',
 'control_plane_root_scripts_stage_transport_status_v1',
 'control_plane_root_scripts_transport_preflight_v1'
]);
assert.deepEqual(requestSchema, {});
assert.deepEqual(Object.keys(applySchema).sort(), ['request_id','second_confirmation']);
assert.deepEqual(Object.keys(statusSchema), ['request_id']);
assert.deepEqual(preflightSchema, {});
```
Also assert schemas contain none of `approval_token,path,content,command,url,repository,sha,project,role,environment,risk`.

Run:
```bash
node --test test/control-plane-root-scripts/mcp-facade.test.js
```
Expected RED: four tools are not registered yet.

- [ ] **Step 2: Register request/apply/status facade handlers.**

Handlers must only forward bounded non-secret data to the mediator. The apply handler enforces `second_confirmation === 'CONFIRM_LEVEL_4_CRITICAL'` before mediator invocation.

- [ ] **Step 3: Test no token propagation.**

Add a mediator fake that deliberately returns a private `approval_token`; facade must strip/reject it rather than returning it.

- [ ] **Step 4: Run MCP facade tests GREEN.**

Run:
```bash
node --test test/control-plane-root-scripts/mcp-facade.test.js
```
Expected GREEN: exact tool names/schemas, request/apply/status behavior, and token-redaction tests pass.

- [ ] **Step 5: Commit Task 3.**

```bash
git add candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js test/control-plane-root-scripts/mcp-facade.test.js
git commit -m "feat: expose fixed approval mediated MCP facade"
```

---

### Task 4: Atomic Two-File Staging and Invocation-Bound Rollback

**Files:**
- Modify: `candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js`
- Create: `test/control-plane-root-scripts/staging-transaction.test.js`

**Interfaces:**
- Consumes: exact decoded artifact buffers from Task 1 via an injected immutable artifact provider; fixed staging root only.
- Produces: `stageArtifacts({fsOps,artifactProvider}): {ok:boolean,evidence:object}` with invocation-local rollback journal.

- [ ] **Step 1: Write failing staging transaction tests.**

Test fixed root creation, root non-symlink requirement, two exact filenames, existing destination regular-file/non-symlink checks, same-directory temp files, `0600`, root:root ownership via injected `chown`, pre-rename SHA/length validation, atomic rename, post-write validation, rollback on second-file failure, and critical evidence on rollback failure.

Run:
```bash
node --test test/control-plane-root-scripts/staging-transaction.test.js
```
Expected RED: `stageArtifacts` is absent.

- [ ] **Step 2: Implement fixed-path filesystem guards.**

Use constants only:
```js
const STAGING_ROOT='/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1';
const DESTINATIONS=Object.freeze({transport:path.join(STAGING_ROOT,'control-plane-typed-bootstrap-transport-v1.js'),bootstrap:path.join(STAGING_ROOT,'bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js')});
```
No caller-provided path enters these values.

- [ ] **Step 3: Implement journal-first atomic writes.**

Before the first destination mutation, persist or construct invocation-local prior-state evidence. Write temp file in `STAGING_ROOT`, chmod 0600, chown root:root, verify bytes/SHA, rename, then re-read and verify.

- [ ] **Step 4: Implement bounded rollback.**

Rollback may restore/remove only the two destinations changed by this invocation. On rollback failure return bounded flags `critical_failure=true` and `rollback_failed=true`; do not attempt broad cleanup.

- [ ] **Step 5: Run staging tests GREEN.**

Run:
```bash
node --test test/control-plane-root-scripts/staging-transaction.test.js
```
Expected GREEN: all atomicity/symlink/rollback cases pass.

- [ ] **Step 6: Commit Task 4.**

```bash
git add candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js test/control-plane-root-scripts/staging-transaction.test.js
git commit -m "feat: add atomic root trust staging transaction"
```

---

### Task 5: Fixed Preflight-Only Execution

**Files:**
- Modify: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Create: `test/control-plane-root-scripts/preflight-only.test.js`

**Interfaces:**
- Consumes: metadata-only staged-file verifier and injected fixed `spawn` implementation.
- Produces: `runFixedTransportPreflight(): Promise<object>` exposed only by `control_plane_root_scripts_transport_preflight_v1`.

- [ ] **Step 1: Write failing preflight tests.**

Assert both staged files are revalidated for exact path, regular file, non-symlink, bytes, SHA-256, owner/group, and mode before execution. Assert exact executable/argv:
```text
/usr/local/bin/prhm-node /var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js --preflight-only
```
Assert shell=false and no alternate argv is reachable.

Run:
```bash
node --test test/control-plane-root-scripts/preflight-only.test.js
```
Expected RED: no preflight implementation.

- [ ] **Step 2: Implement fixed verifier and fixed spawn.**

Representative call:
```js
spawnSync('/usr/local/bin/prhm-node',[BOOTSTRAP_PATH,'--preflight-only'],{shell:false,encoding:'utf8',timeout:30000,maxBuffer:262144});
```
Do not accept command/argv/cwd/env overrides from MCP input.

- [ ] **Step 3: Add structural `--apply` absence test.**

Scan the preflight handler AST/source slice and fail if it contains an executable branch capable of appending `--apply` or caller-provided argv.

- [ ] **Step 4: Run preflight tests GREEN.**

Run:
```bash
node --test test/control-plane-root-scripts/preflight-only.test.js
```
Expected GREEN: fixed verifier/argv tests pass and `--apply` remains unreachable.

- [ ] **Step 5: Commit Task 5.**

```bash
git add candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js test/control-plane-root-scripts/preflight-only.test.js
git commit -m "feat: add fixed root trust preflight only tool"
```

---

### Task 6: Security and Integration Regression Suite

**Files:**
- Create: `test/control-plane-root-scripts/security-regression.test.js`
- Modify: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js` only if a test exposes a real defect.
- Modify: `candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js` only if a test exposes a real defect.

**Interfaces:**
- Consumes: all Task 1-5 public/test interfaces.
- Produces: one integration/security suite proving the approved architecture end-to-end without production dependencies.

- [ ] **Step 1: Write security regression tests.**

Cover: no caller approval token; no Approval Center credentials in MCP source; no arbitrary path/content/command/URL/repository/commit/SHA/project/role/environment/risk input; no runtime network fetch; no `eval`/shell; no generic root writer/upload widening; no `/root` write enablement; no `systemctl restart|reload|daemon-reload`; no DeployHQ/node1/Honartik/iMotion/database/application mutation code paths; fixed two destination paths only; replay rejection; status metadata-only; preflight `--apply` unreachable.

Run:
```bash
node --test test/control-plane-root-scripts/security-regression.test.js
```
Expected initial RED only for any still-missing security assertions; do not weaken tests to obtain GREEN.

- [ ] **Step 2: Run the full focused suite.**

```bash
node --test test/control-plane-root-scripts/*.test.js
```
Expected GREEN: zero failed, zero skipped security cases.

- [ ] **Step 3: Run syntax checks.**

```bash
node --check candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js
node --check candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js
```
Expected: both exit 0.

- [ ] **Step 4: Re-check MCP candidate size.**

```bash
wc -c candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js
```
Expected: `<=120000`.

- [ ] **Step 5: Commit Task 6.**

```bash
git add test/control-plane-root-scripts/security-regression.test.js candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js
git commit -m "test: harden approval mediated root staging architecture"
```

---

### Task 7: Candidate Verification and Draft Review Gate

**Files:**
- Create: `docs/superpowers/evidence/control-plane-root-scripts-approval-mediated-staging-v1.md`
- No production files are modified.

**Interfaces:**
- Consumes: final candidate files and complete focused test output.
- Produces: immutable candidate byte counts/SHA-256 values, test evidence, and a Draft PR/review checkpoint only.

- [ ] **Step 1: Verify the candidate still derives from the verified baseline.**

Document the original live baseline identity exactly:
```text
SAFEFILES_LIVE_BASELINE_BYTES=20090
SAFEFILES_LIVE_BASELINE_SHA256=9f291891673806e34d2681ba7b8227ddd4470f73cec12f69a7c3e9035808caa2
```
Confirm no unrelated baseline logic was intentionally removed except where the approved capability extension requires additions.

- [ ] **Step 2: Run final verification from a clean branch checkout/worktree.**

```bash
node --test test/control-plane-root-scripts/*.test.js
node --check candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js
node --check candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js
```
Expected: all tests PASS, both syntax checks exit 0.

- [ ] **Step 3: Calculate immutable candidate identities.**

```bash
wc -c candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js
sha256sum candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js
```
Record the exact resulting byte counts and SHA-256 values in the evidence document. The MCP candidate must remain `<=120000` bytes.

- [ ] **Step 4: Record forbidden-action evidence.**

Evidence must state:
```text
PRODUCTION_MUTATION=NO
SELFMAINT_REQUEST=NO
SELFMAINT_APPLY=NO
MCP_ROLLING_REFRESH=NO
PRODUCTION_STAGING=NO
ROOT_OF_TRUST_APPLY=NO
DEPLOYHQ_MUTATION=NO
HONARTIK_MUTATION=NO
IMOTION_MUTATION=NO
DATABASE_MUTATION=NO
```

- [ ] **Step 5: Commit evidence and open/update Draft PR.**

```bash
git add docs/superpowers/evidence/control-plane-root-scripts-approval-mediated-staging-v1.md
git commit -m "docs: record approval mediated staging candidate evidence"
```
Draft review must include the spec, this plan, final candidate SHA/bytes, and focused test results. Do not merge as part of this task.

---

## Execution Stop Boundary

This implementation plan authorizes development and review of Tasks 1-7 only. It explicitly does **not** authorize any of the following:

- `selfmaint_request(target=agent_mcp)` or any self-maintenance apply/confirm operation.
- Replacement of live `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js`.
- Installation of the mediator into any privileged production service.
- Restart/reload/daemon-reload of any service.
- Blue/Green/public MCP rolling refresh, exposure, or cutover.
- Creation or execution of a real production staging request.
- Writing either artifact into `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/` on production.
- Execution of `CONTROL_PLANE_BOOTSTRAP_ROOT_OF_TRUST_APPLY_V1`.
- DeployHQ/node1, Honartik, iMotion, database, SEO, payment, or application mutations.

Future governed gates, in order, are:

1. `CONTROL_PLANE_ROOT_SCRIPTS_APPROVAL_MEDIATOR_INSTALL_V1` — separately review/install the privileged mediator candidate.
2. `CONTROL_PLANE_ROOT_SCRIPTS_MCP_CAPABILITY_SELFMAINT_INSTALL_V1` — fresh SHA-bound self-maintenance request/apply for the exact MCP candidate.
3. `CONTROL_PLANE_ROOT_SCRIPTS_MCP_ROLLING_EXPOSURE_V1` — separate governed Blue/Green/public schema refresh.
4. `CONTROL_PLANE_BOOTSTRAP_ROOT_OF_TRUST_STAGED_PREFLIGHT_V1` — fresh Level-4 request/apply for exact two-file staging plus fixed `--preflight-only` evidence.
5. `CONTROL_PLANE_BOOTSTRAP_ROOT_OF_TRUST_APPLY_V1` — another fresh Level-4 for the later Root-of-Trust installation transaction.
