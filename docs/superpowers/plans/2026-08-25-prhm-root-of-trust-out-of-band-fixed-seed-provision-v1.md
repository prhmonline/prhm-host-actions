# PRHM Root-of-Trust Out-of-Band Fixed Seed Provision V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify one immutable zero-input root seed that registers only `control_plane_root_scripts_stage_transport_v1` into the existing Host Actions v2 trust chain, then provision it once through an out-of-band provider/VM-console root boundary without executing the transport itself.

**Architecture:** Follow the existing `bootstrap-host-actions-v15-*` / `v16-*` registration pattern, but narrow V1 to the three live backend layers proven necessary: base Host Actions v2 registry/spec, executor registry/dispatcher, and approval policy. The seed is fail-closed on exact production baseline SHA-256 values, verifies the fixed transport helper SHA, performs byte-exact backups, atomic replacement, service health checks, and full rollback. MCP is not patched because the live wrapper already accepts the fixed action string; requestability is verified after seed execution with a fresh Level-4 request that is not applied.

**Tech Stack:** Node.js CommonJS (`node:fs`, `node:path`, `node:crypto`, `node:child_process`), Node built-in test runner, systemd, JSON approval policy, GitHub repository `prhmonline/prhm-host-actions`, provider/VM console for the one-shot root boundary.

**Spec:** `docs/superpowers/specs/2026-08-25-prhm-root-of-trust-out-of-band-fixed-seed-provision-design.md`

## Global Constraints

- Seed action identity is fixed: `prhm-root-of-trust-fixed-seed-v1`.
- The only registered Host Actions v2 action is `control_plane_root_scripts_stage_transport_v1`.
- The seed MUST NOT execute `control_plane_root_scripts_stage_transport_v1` or `root_scripts_fixed_stage_v1`.
- No action, path, file content, command, service, environment, credential, token, Git ref, or SHA is accepted as runtime input.
- No arbitrary installer framework, shell API, generic root execution API, webhook listener, self-hosted runner, SSH deployment key, GitHub Actions secret, or long-lived credential is introduced.
- No DrTarjomeh application tree, database, payment, SMS, mail, queue, cron, or staging clone mutation is allowed.
- Production baseline SHA-256 values captured read-only on 2026-08-25 are:
  - `/opt/prhm-agent-selfmaint/server.js` = `e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd`
  - `/opt/prhm-agent-selfmaint-exec/server.js` = `1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd`
  - `/opt/prhm-company-control-plane/config/approval-policy.json` = `76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d`
  - `/home/agent/ssh-agent-api/control-plane-root-scripts-stage-transport-v1.js` = `c64d2fb4c2ae2b048f7f57f6a5e4923588b76ae8a134a540e791b03285ff4d87`
- Any baseline drift aborts before the first mutation.
- Every target must be a regular file and not a symlink.
- Production execution occurs only from a provider/VM-console root shell, using a commit-pinned artifact plus an explicit SHA-256 verification before execution.
- The seed must be idempotent: an already-correct registration returns `ALREADY_APPLIED` without rewriting files.
- Any failure after the first mutation triggers restoration of every changed file, service restart, restored-SHA verification, and health verification.
- `FAILED_ROLLED_BACK` may be emitted only after rollback verification passes; otherwise emit `FAILED_ROLLBACK_INCOMPLETE`.

---

### Task 1: Add the Root Seed Contract Tests

**Files:**
- Create: `test-prhm-root-of-trust-fixed-seed-v1.js`
- Read as pattern: `test-v15-honartik-iticket-dark-backend-batch2-registration-v1.js`
- Read as pattern: `test-v16-honartik-iticket-batch2-result-bridge-helper-refresh-registration-v1.js`

**Interfaces:**
- Consumes: no prior code.
- Produces: executable contract for `buildPatchedFrom({base, executor, policy})`, `verifyFixedContract()`, `preflightFrom(snapshot)`, `executeWithAdapter(adapter)`, and exported constants `ACTION`, `OPERATION`, `BASELINE_SHA`, `TRANSPORT_HELPER_SHA`.

- [ ] **Step 1: Write the failing structural registration test**

Create a Node built-in test that supplies minimal fixture strings containing exactly one proven anchor in each layer and asserts that only the fixed action is added:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mod = require('./bootstrap-prhm-root-of-trust-fixed-seed-v1.js');

const ACTION = 'control_plane_root_scripts_stage_transport_v1';

test('registers only the fixed root-scripts transport action in base, executor, and policy', () => {
  const base = "const HOST_ACTION_V2={\n  root_scripts_fixed_stage_v1: { operation: 'host_action.root_scripts_fixed_stage_v1', rollback: 'host-action-v2:root-scripts-fixed-stage-v1:automatic' },\n};\n";
  const executor = "const HOST_ACTION_V2_SPECS={\n  root_scripts_fixed_stage_v1:{operation:'host_action.root_scripts_fixed_stage_v1',kind:'root_scripts_fixed_stage_v1'},\n};\nconst applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){if(action==='root_scripts_fixed_stage_v1')return applyRootScriptsFixedStageV1();return applyHostActionV2Original(action);};\n";
  const policy = JSON.stringify({
    version: 'fixture',
    operations: {'host_action.root_scripts_fixed_stage_v1': {level: 4}},
    typed_scopes: [{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'root_scripts_fixed_stage_v1',risk:'critical',operation:'host_action.root_scripts_fixed_stage_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]
  });

  const out = mod.buildPatchedFrom({base, executor, policy});
  assert.match(out.base, new RegExp(ACTION));
  assert.match(out.executor, new RegExp(ACTION));
  const p = JSON.parse(out.policy);
  assert.equal(p.operations['host_action.' + ACTION].level, 4);
  assert.equal(p.typed_scopes.filter(x => x.action === ACTION).length, 1);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test test-prhm-root-of-trust-fixed-seed-v1.js
```

Expected: FAIL because `bootstrap-prhm-root-of-trust-fixed-seed-v1.js` does not exist.

- [ ] **Step 3: Add fail-closed negative cases before implementation**

Add tests that require all of these behaviors:

```js
test('rejects missing or duplicate structural anchors', () => { /* call buildPatchedFrom with missing/duplicate anchors and assert.throws */ });
test('rejects any unexpected runtime argument surface', () => { assert.equal(mod.RUNTIME_INPUTS.length, 0); });
test('pins the four production baseline hashes and transport helper SHA', () => {
  assert.deepEqual(mod.BASELINE_SHA, {
    base: 'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
    executor: '1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
    policy: '76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
  });
  assert.equal(mod.TRANSPORT_HELPER_SHA, 'c64d2fb4c2ae2b048f7f57f6a5e4923588b76ae8a134a540e791b03285ff4d87');
});
test('registration does not contain DrTarjomeh app, database, deploy, network, token, ssh, webhook, or transport execution primitives', () => { /* inspect exported source/contract and assert forbidden capabilities absent */ });
```

- [ ] **Step 4: Run the suite and verify all new tests are RED for the intended reasons**

Run:

```bash
node --test test-prhm-root-of-trust-fixed-seed-v1.js
```

Expected: FAIL only because implementation exports are missing.

- [ ] **Step 5: Commit the RED tests**

```bash
git add test-prhm-root-of-trust-fixed-seed-v1.js
git commit -m "test: define root trust fixed seed contract"
```

### Task 2: Implement the Pure Fixed Registration Transformer

**Files:**
- Create: `bootstrap-prhm-root-of-trust-fixed-seed-v1.js`
- Test: `test-prhm-root-of-trust-fixed-seed-v1.js`
- Read as pattern: `bootstrap-host-actions-v15-honartik-iticket-dark-backend-batch2-registration-v1.js`
- Read as pattern: `bootstrap-host-actions-v16-honartik-iticket-batch2-result-bridge-helper-refresh-registration-v1.js`

**Interfaces:**
- Consumes: structural anchors from current base/executor/policy.
- Produces:
  - `buildPatchedFrom({base:string, executor:string, policy:string}) -> {base:string, executor:string, policy:string}`
  - `verifyFixedContract() -> true`
  - `preflightFrom(snapshot) -> evidence object`

- [ ] **Step 1: Add immutable constants and helper primitives**

Implement these exact constants:

```js
const ACTION = 'control_plane_root_scripts_stage_transport_v1';
const OPERATION = 'host_action.control_plane_root_scripts_stage_transport_v1';
const VERSION = 'prhm-root-of-trust-fixed-seed-v1';
const RUNTIME_INPUTS = Object.freeze([]);
const PATHS = Object.freeze({
  base: '/opt/prhm-agent-selfmaint/server.js',
  executor: '/opt/prhm-agent-selfmaint-exec/server.js',
  policy: '/opt/prhm-company-control-plane/config/approval-policy.json',
  transport: '/home/agent/ssh-agent-api/control-plane-root-scripts-stage-transport-v1.js'
});
const BASELINE_SHA = Object.freeze({
  base: 'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
  executor: '1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
  policy: '76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
});
const TRANSPORT_HELPER_SHA = 'c64d2fb4c2ae2b048f7f57f6a5e4923588b76ae8a134a540e791b03285ff4d87';
```

Also implement local `sha()`, `unique()`, and JSON parsing helpers using only Node built-ins.

- [ ] **Step 2: Implement `patchBase` with a single structural anchor**

The function must:

1. reject if `ACTION` already appears in conflicting form;
2. require exactly one `root_scripts_fixed_stage_v1` Host Actions v2 spec anchor;
3. append only:

```js
control_plane_root_scripts_stage_transport_v1: {
  operation: 'host_action.control_plane_root_scripts_stage_transport_v1',
  rollback: 'host-action-v2:control-plane-root-scripts-stage-transport-v1:registration-only'
},
```

No other base source changes are permitted.

- [ ] **Step 3: Implement `patchExecutor` with spec + dispatcher only**

Require exactly one existing `root_scripts_fixed_stage_v1` spec and exactly one Host Actions v2 dispatcher fallback. Insert:

```js
control_plane_root_scripts_stage_transport_v1:{
  operation:'host_action.control_plane_root_scripts_stage_transport_v1',
  kind:'control_plane_root_scripts_stage_transport_v1'
},
```

and add one dispatcher clause that invokes a fixed function `applyControlPlaneRootScriptsStageTransportV1()`.

That fixed function must execute only the already-installed helper at:

```text
/home/agent/ssh-agent-api/control-plane-root-scripts-stage-transport-v1.js
```

through `/usr/local/bin/prhm-node`, require helper SHA `c64d2f...f4d87` before execution, require a bounded `prhm.host-action-result.v1` result, and reject any result reporting application/database mutation. Do not add arguments or environment overrides.

- [ ] **Step 4: Implement `patchPolicy`**

Parse JSON and require the existing `root_scripts_fixed_stage_v1` operation/scope as the structural predecessor. Add exactly:

```js
p.operations[OPERATION] = {level: 4};
p.typed_scopes.push({
  tool: 'host_action_v2_apply',
  project: 'control_plane',
  environment: 'production',
  action: ACTION,
  risk: 'critical',
  operation: OPERATION,
  principals: [{principal_id:'mohammad', roles:['mcp-operator']}]
});
```

Set a fixed policy version string `2026-08-25.1-control-plane-root-scripts-stage-transport-v1`.

- [ ] **Step 5: Implement idempotent detection separately from conflicting registration**

`buildPatchedFrom()` must return an explicit `alreadyApplied:true` only when all three layers already contain the exact expected action/operation/scope. A partial or structurally different registration must throw `conflicting_existing_registration`.

- [ ] **Step 6: Run tests to GREEN**

```bash
node --test test-prhm-root-of-trust-fixed-seed-v1.js
node --check bootstrap-prhm-root-of-trust-fixed-seed-v1.js
```

Expected: PASS.

- [ ] **Step 7: Commit the pure transformer**

```bash
git add bootstrap-prhm-root-of-trust-fixed-seed-v1.js test-prhm-root-of-trust-fixed-seed-v1.js
git commit -m "feat: add fixed root trust registration transformer"
```

### Task 3: Add SHA-Bound Preflight, Atomic Apply, and Rollback

**Files:**
- Modify: `bootstrap-prhm-root-of-trust-fixed-seed-v1.js`
- Modify: `test-prhm-root-of-trust-fixed-seed-v1.js`

**Interfaces:**
- Consumes: pure transformer from Task 2.
- Produces:
  - `preflight() -> bounded evidence`
  - `executeWithAdapter(adapter) -> bounded result`
  - CLI modes with no external arguments: default execute only; tests call exported functions directly.

- [ ] **Step 1: Write RED tests for filesystem preflight**

Use temporary directories and an injected adapter to prove:

- wrong baseline SHA => `baseline_sha_mismatch:<layer>` before writes;
- symlink target => `target_symlink_rejected:<layer>`;
- transport helper wrong SHA => `transport_helper_sha_mismatch`;
- candidate JSON parse failure => no writes;
- candidate JS syntax failure => no writes.

- [ ] **Step 2: Implement preflight ordering**

The production adapter must perform this exact order before mutation:

1. verify effective UID is root;
2. lstat all four fixed paths;
3. require regular non-symlink files;
4. hash base/executor/policy and compare `BASELINE_SHA` unless exact idempotent state is detected;
5. hash transport helper and compare `TRANSPORT_HELPER_SHA`;
6. build deterministic candidate strings;
7. parse candidate policy JSON;
8. validate candidate JS syntax using `/usr/local/bin/prhm-node --check` on temporary candidate files;
9. compute and record candidate `after_sha256` values.

- [ ] **Step 3: Write RED tests for atomicity and rollback**

Inject failures after each write position and assert all original bytes are restored. Add explicit tests for:

```text
failure_after_base_write
failure_after_executor_write
failure_after_policy_write
failure_during_service_restart
failure_during_post_health
```

The test result must distinguish `FAILED_ROLLED_BACK` from `FAILED_ROLLBACK_INCOMPLETE`.

- [ ] **Step 4: Implement backup and atomic replacement**

Use a fixed backup root:

```text
/var/backups/prhm-root-of-trust-fixed-seed-v1/<timestamp>/
```

For each target: preserve exact bytes, mode, uid, gid; write temp file in the same filesystem; `fsync`; apply ownership/mode; atomic rename; re-hash installed bytes.

- [ ] **Step 5: Implement minimal service restart + health verification**

Only restart services whose live source changed. Expected services are:

```text
prhm-agent-selfmaint.service
prhm-agent-selfmaint-exec.service
```

Do not restart MCP unless implementation-time discovery proves it was modified; this V1 plan does not modify MCP.

Require both services `active` after restart and require their loopback/socket health endpoints to report healthy before success.

- [ ] **Step 6: Implement verified rollback**

On any post-mutation failure:

1. restore all changed files from exact backups;
2. restore owner/mode;
3. restart changed services;
4. verify restored SHA equals the preflight SHA for each layer;
5. verify services healthy;
6. return `FAILED_ROLLED_BACK` only after all checks pass.

- [ ] **Step 7: Run the full test suite**

```bash
node --test test-prhm-root-of-trust-fixed-seed-v1.js
node --check bootstrap-prhm-root-of-trust-fixed-seed-v1.js
```

Expected: PASS.

- [ ] **Step 8: Commit rollback-safe execution**

```bash
git add bootstrap-prhm-root-of-trust-fixed-seed-v1.js test-prhm-root-of-trust-fixed-seed-v1.js
git commit -m "feat: make root trust seed rollback safe"
```

### Task 4: Seal the Artifact and Add an Operator Manifest

**Files:**
- Create: `seal-prhm-root-of-trust-fixed-seed-v1.js`
- Create: `prhm-root-of-trust-fixed-seed-v1.manifest.json`
- Modify: `test-prhm-root-of-trust-fixed-seed-v1.js`

**Interfaces:**
- Consumes: final seed artifact bytes.
- Produces: immutable manifest containing artifact SHA, fixed baseline SHA map, transport helper SHA, fixed action identity, and zero-input declaration.

- [ ] **Step 1: Write a RED sealing test**

Require the manifest schema:

```json
{
  "schema_version": "prhm.root-of-trust-seed-manifest.v1",
  "seed_id": "prhm-root-of-trust-fixed-seed-v1",
  "action_registered": "control_plane_root_scripts_stage_transport_v1",
  "artifact": "bootstrap-prhm-root-of-trust-fixed-seed-v1.js",
  "artifact_sha256": "<64 lowercase hex>",
  "runtime_inputs": [],
  "baseline_sha256": {
    "base": "e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd",
    "executor": "1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd",
    "policy": "76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d"
  },
  "transport_helper_sha256": "c64d2fb4c2ae2b048f7f57f6a5e4923588b76ae8a134a540e791b03285ff4d87"
}
```

The final test must replace the angle-bracket example with the actual literal artifact hash and assert it equals a fresh hash of the seed file.

- [ ] **Step 2: Implement the zero-argument sealer**

`seal-prhm-root-of-trust-fixed-seed-v1.js` accepts no CLI arguments. It hashes exactly `bootstrap-prhm-root-of-trust-fixed-seed-v1.js`, validates the exported contract, and writes only `prhm-root-of-trust-fixed-seed-v1.manifest.json`.

- [ ] **Step 3: Generate and pin the literal artifact SHA**

Run:

```bash
node seal-prhm-root-of-trust-fixed-seed-v1.js
node --test test-prhm-root-of-trust-fixed-seed-v1.js
sha256sum bootstrap-prhm-root-of-trust-fixed-seed-v1.js
cat prhm-root-of-trust-fixed-seed-v1.manifest.json
```

Expected: manifest `artifact_sha256` exactly matches `sha256sum`. Commit the literal generated value; do not compute it dynamically during production execution.

- [ ] **Step 4: Run prohibited-surface scan**

Run a repository-local test that fails if the seed/sealer contains runtime parsing for `process.argv.slice(2)`, arbitrary `exec`/`shell`, SSH key material, webhook listener code, generic URL input, DB clients, DrTarjomeh application paths, or generic file-path parameters.

- [ ] **Step 5: Commit the sealed artifact**

```bash
git add bootstrap-prhm-root-of-trust-fixed-seed-v1.js seal-prhm-root-of-trust-fixed-seed-v1.js prhm-root-of-trust-fixed-seed-v1.manifest.json test-prhm-root-of-trust-fixed-seed-v1.js
git commit -m "feat: seal root trust fixed seed artifact"
```

### Task 5: Add the Out-of-Band Provider/VM Console Runbook

**Files:**
- Create: `docs/runbooks/prhm-root-of-trust-fixed-seed-v1.md`

**Interfaces:**
- Consumes: committed seed artifact, manifest, commit SHA, artifact SHA.
- Produces: exact one-shot operator procedure that does not create credentials or a persistent listener.

- [ ] **Step 1: Document the only supported transfer/execution method**

The runbook must require a provider/hypervisor/VM-console root shell independent of Agent API/MCP. It must fetch from a commit-pinned public GitHub URL, not from `main`, and verify the manifest-pinned SHA before execution.

The command shape is fixed as follows; during implementation replace `COMMIT_SHA` and `ARTIFACT_SHA256` with the literal values from the final sealing commit and manifest before committing the runbook:

```bash
set -euo pipefail
install -d -m 0700 /root/prhm-root-seed-v1
cd /root/prhm-root-seed-v1
curl --fail --silent --show-error --location \
  "https://raw.githubusercontent.com/prhmonline/prhm-host-actions/COMMIT_SHA/bootstrap-prhm-root-of-trust-fixed-seed-v1.js" \
  -o seed.js
printf '%s  %s\n' 'ARTIFACT_SHA256' 'seed.js' | sha256sum -c -
/usr/local/bin/prhm-node --check seed.js
/usr/local/bin/prhm-node seed.js
```

The committed runbook MUST contain no placeholder tokens; `COMMIT_SHA` and `ARTIFACT_SHA256` are replaced with final literals before merge.

- [ ] **Step 2: Add explicit stop conditions**

The operator must stop on any baseline mismatch, helper mismatch, syntax error, symlink detection, rollback-incomplete result, service health failure, or artifact SHA mismatch. No manual edit/retry with altered paths is allowed.

- [ ] **Step 3: Add post-execution evidence commands**

Document read-only checks for:

```bash
sha256sum /opt/prhm-agent-selfmaint/server.js
sha256sum /opt/prhm-agent-selfmaint-exec/server.js
sha256sum /opt/prhm-company-control-plane/config/approval-policy.json
systemctl is-active prhm-agent-selfmaint.service
systemctl is-active prhm-agent-selfmaint-exec.service
```

The runbook must explicitly state that these are evidence only and that the transport action is not executed in this Gate.

- [ ] **Step 4: Commit the runbook**

```bash
git add docs/runbooks/prhm-root-of-trust-fixed-seed-v1.md
git commit -m "docs: add root trust seed console runbook"
```

### Task 6: Final Repository Verification Before Any Production Seed Execution

**Files:**
- Verify only; no production files modified.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: reviewed commit SHA + artifact SHA pair approved for out-of-band execution.

- [ ] **Step 1: Run all seed tests from a clean checkout**

```bash
node --test test-prhm-root-of-trust-fixed-seed-v1.js
node --check bootstrap-prhm-root-of-trust-fixed-seed-v1.js
node --check seal-prhm-root-of-trust-fixed-seed-v1.js
```

Expected: all PASS.

- [ ] **Step 2: Recompute artifact and manifest identity**

```bash
sha256sum bootstrap-prhm-root-of-trust-fixed-seed-v1.js
node -e "const m=require('./prhm-root-of-trust-fixed-seed-v1.manifest.json'); console.log(m.artifact_sha256)"
```

Expected: identical 64-character lowercase SHA values.

- [ ] **Step 3: Re-read live production baselines immediately before authorizing out-of-band execution**

Use read-only Agent 2 infrastructure access to obtain SHA-256 for the same four fixed paths. Expected values MUST still be exactly the four values in Global Constraints. Any drift invalidates the sealed artifact and returns to Task 1 with a new design review if semantics changed; do not patch around drift.

- [ ] **Step 4: Review diff for scope**

The final diff may contain only:

```text
bootstrap-prhm-root-of-trust-fixed-seed-v1.js
seal-prhm-root-of-trust-fixed-seed-v1.js
prhm-root-of-trust-fixed-seed-v1.manifest.json
test-prhm-root-of-trust-fixed-seed-v1.js
docs/runbooks/prhm-root-of-trust-fixed-seed-v1.md
```

plus this implementation plan. No production app code, credentials, workflows, deploy keys, or generic installers.

- [ ] **Step 5: Commit any final deterministic sealing/runbook SHA update**

If the final runbook needs the final commit-pinned URL, perform a deterministic two-commit seal: first commit final artifact and manifest, then commit only the runbook with that immutable artifact commit SHA. The artifact SHA must not change in the second commit.

### Task 7: Out-of-Band Seed Execution and Registration Acceptance

**Files:**
- Production mutation limited to the three fixed control-plane files from Global Constraints.
- No repository edits during execution.

**Interfaces:**
- Consumes: final reviewed artifact commit SHA + manifest artifact SHA.
- Produces: root seed result JSON and a fresh pending Level-4 Host Actions v2 request proving requestability.

- [ ] **Step 1: Execute exactly the pinned runbook from provider/VM console**

Do not run through Agent API, MCP, self-maintenance, Host Actions v1/v2, DeployHQ, GitHub Actions, or SSH deploy credentials.

Expected success result includes:

```json
{
  "schema_version": "prhm.root-of-trust-seed-result.v1",
  "seed_id": "prhm-root-of-trust-fixed-seed-v1",
  "action_registered": true,
  "services_healthy": true,
  "rollback_performed": false,
  "result": "APPLIED"
}
```

or idempotent `ALREADY_APPLIED` with zero writes.

- [ ] **Step 2: Fresh-read post-install hashes and service health via Agent 2**

Require actual evidence; do not infer PASS from the seed process exit code alone.

- [ ] **Step 3: Prove action requestability without applying it**

Call:

```text
host_action_v2_request({action:"control_plane_root_scripts_stage_transport_v1"})
```

Expected: a fresh Level-4 pending request with action binding, arguments SHA, expiry, and one-time semantics. `host_action_v2_not_allowed` is failure.

- [ ] **Step 4: Do not apply the transport in this Gate**

Record the pending request ID only as acceptance evidence. Do not send `CONFIRM_LEVEL_4_CRITICAL` and do not call `host_action_v2_apply` here.

- [ ] **Step 5: Final Gate result**

Mark `CONTROL_PLANE_ROOT_OF_TRUST_OUT_OF_BAND_FIXED_SEED_PROVISION_V1=PASS` only if repository TDD, artifact SHA, baseline checks, seed execution, post-hash verification, service health, and Level-4 requestability all pass with real evidence. Otherwise report the precise failed phase and rollback state.

## Self-Review Checklist

- Spec coverage: every Security Boundary, Fixed Scope, Preflight, Mutation Scope, Registration Semantics, Atomicity/Rollback, Idempotency, Post-Install Verification, TDD, Out-of-Band Provisioning, Non-Goals, and Acceptance Criteria requirement maps to Tasks 1-7.
- Placeholder scan: implementation artifacts and the committed runbook may contain no `TBD`, `TODO`, `COMMIT_SHA`, `ARTIFACT_SHA256`, or similar placeholder at completion. The strings appear in this plan only to define the deterministic replacement step.
- Type consistency: the fixed action is always `control_plane_root_scripts_stage_transport_v1`; operation is always `host_action.control_plane_root_scripts_stage_transport_v1`; seed identity is always `prhm-root-of-trust-fixed-seed-v1`.
- Safety: the transport action is never applied in this plan; only its registration is installed and requestability is tested.
