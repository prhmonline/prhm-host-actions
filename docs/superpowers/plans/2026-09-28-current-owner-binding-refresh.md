# Current-Owner Binding Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and register the fixed `control_plane_current_owner_binding_refresh_v1` Host Action so PRHM Agent 3 can rebind the stale registry/V19/baseline/rolling-refresh/Titan consumers to one canonical current-owner manifest, with exact-preimage rollback and no Titan application deployment.

**Architecture:** Implement a small fixed subsystem with a deterministic owner-manifest builder, five fixed consumer adapters, narrow systemd-confinement logic, and one transactional refresh helper. Register it additively as Host Actions v29 using the existing SHA-bound bootstrap pattern; installation and execution stay behind fresh approval gates, and the workflow stops when Titan contract/preflight are GREEN.

**Tech Stack:** Node.js 20 / `prhm-node`, `node:test`, systemd, PRHM Host Actions v2, SHA-256 exact-preimage binding, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-28-current-owner-binding-refresh-design.md`

## Global Constraints

- Public action: `control_plane_current_owner_binding_refresh_v1`.
- Operation: `host_action.control_plane_current_owner_binding_refresh_v1`.
- No caller-controlled path, command, SHA, hostname, service, arbitrary content, repository selector, environment selector, replacement source, or approval token.
- Titan source/database/deploy/cutover, DirectAdmin, DNS, TLS, and public routing are out of scope.
- Manifest path: `/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1/manifest.json`.
- Keep `ProtectSystem=strict`; preserve existing service hardening.
- The only new persistent backup write grant for `prhm-agent-selfmaint-exec.service` is `/var/backups/prhm-current-baseline-refresh-v1`; never grant `/var/backups` broadly.
- Persist exact preimage bytes + SHA + uid/gid/mode before the first live-target replacement.
- Any post-mutation failure triggers exact rollback, including the systemd drop-in.
- Request creation and execution remain separate, one-time and expiry-bound. Never reuse a confirmation from another/expired request.
- Register the initial migration action as Level-4/critical, second-confirmation, one-time.
- Development uses a separate isolated implementation branch/worktree; never clean/reset unrelated `/home/prhm/worktrees/prhm-host-actions` state.
- No force push. Stage only task files. Verify local/remote HEAD equality after push.
- Success evidence must include `production_application_mutation:false`, `database_mutation:false`, `titan_cutover:false`.
- This plan never calls `titan_front_handoff_deploy_v2`. Deployment remains a later gate requiring fresh `CONFIRM_DEPLOY_PRODUCTION`.

## File Structure

Create on `impl/current-owner-binding-refresh-v1`:

- `current-owner-binding-manifest-v1.js` — fixed owner inventory validation, canonical JSON, deterministic manifest SHA.
- `test-current-owner-binding-manifest-v1.js` — owner/manifest contract.
- `current-owner-binding-adapters-v1.js` — five fixed migration/steady-state adapters.
- `test-current-owner-binding-adapters-v1.js` — preimage/idempotency/no-arbitrary-input/Titan sandbox contract.
- `current-owner-binding-systemd-v1.js` — exact self-maint drop-in candidate and effective-state validator.
- `test-current-owner-binding-systemd-v1.js` — exact path/hardening/restart-scope contract.
- `current-owner-binding-refresh-v1.js` — preflight, candidates, transaction, apply, verification, rollback.
- `test-current-owner-binding-refresh-v1.js` — ordering, preimages, rollback, no-deploy contract.
- `bootstrap-host-actions-v29-current-owner-binding-refresh.js` — SHA-bound installer/registration bootstrap.
- `test-v29-current-owner-binding-refresh.js` — registration/policy/MCP/executor/bootstrap contract.
- `.github/workflows/host-actions-v29-current-owner-binding-refresh-ci.yml` — syntax, tests, selftest, focused regressions.

Do not turn `bootstrap-host-actions-v19-agent-zdt-source-sha-refresh.js` into the new source of truth. Keep V19 as a regression fixture demonstrating the old one-SHA-at-a-time model.

## Review Focus

1. Owner path changes/symlinks between inventory and apply.
2. Unknown consumer preimage: must stop before any live write.
3. Partial drop-in/service failure: rollback must restore drop-in and service state.
4. Verification accidentally mutating Titan or consuming an unrelated approval.
5. Owner SHA changing after installer deployment: current owner may update in the manifest, but consumer migration still requires enumerated/already-migrated preimages; no generic rewriting.

---

### Task 1: Create the Isolated Worktree and Freeze Live Evidence

**Files:**
- Create: `test-current-owner-binding-manifest-v1.js`
- Create: `current-owner-binding-manifest-v1.js`

**Interfaces:**
- Branch: `impl/current-owner-binding-refresh-v1`.
- Base: exact approved documentation head containing spec + plan.
- Output: literal `OWNER_SPECS` and `INITIAL_CONSUMER_PREIMAGES`; no placeholder/TODO hashes at commit.

- [ ] **Step 1: Create the isolated worktree**

Use `superpowers:using-git-worktrees`. Do not reset/clean the shared checkout.

- [ ] **Step 2: Capture read-only live evidence**

Using fixed PRHM Agent 3 read-only surfaces, capture canonical path, type, size and SHA-256 for at least:

- `/home/agent/ssh-agent-api/server.js`;
- the live MCP/self-maint registry bridge owner used by registry bootstrap;
- `/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js`;
- the live owner/target used by `control_plane_typed_bootstrap_current_baseline_refresh_v1`;
- the live Titan handoff sandbox owner used by Titan contract/preflight;
- Base `/opt/prhm-agent-selfmaint/server.js`;
- Executor `/opt/prhm-agent-selfmaint-exec/server.js`;
- Approval Policy `/opt/prhm-company-control-plane/config/approval-policy.json`;
- MCP Host Actions v2 plugin `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`.

If a live canonical path differs from historical notes, use the verified live path and pin it literally. Never guess or broaden an allowed root.

- [ ] **Step 3: Write the RED manifest test**

Require the absent module and assert: frozen unique owner IDs; absolute literal paths; no wildcards; regular canonical fixture accepted; symlink/noncanonical/oversize rejected; canonical JSON stable across key insertion order; deterministic manifest SHA for fixed facts; no file contents/env/tokens/approvals/secrets in output.

- [ ] **Step 4: Run RED**

```bash
node --test test-current-owner-binding-manifest-v1.js
```

Expected: FAIL because implementation is absent.

- [ ] **Step 5: Implement the minimal manifest module**

Export:

```js
const SCHEMA='prhm.current-owner-binding-manifest.v1';
const OWNER_SPECS=Object.freeze([...]);
function validateFileOwner(spec,fsApi=fs) { ... }
function canonicalJson(value) { ... }
function buildManifest({capturedAt,owners,serviceFacts={}}) { ... }
```

Sort owners by logical ID before hashing. `manifest_sha256` is the SHA-256 of canonical manifest data excluding the hash field itself.

- [ ] **Step 6: Run GREEN**

```bash
node --check current-owner-binding-manifest-v1.js
node --test test-current-owner-binding-manifest-v1.js
```

- [ ] **Step 7: Commit**

```bash
git add current-owner-binding-manifest-v1.js test-current-owner-binding-manifest-v1.js
git commit -m "feat: add fixed current-owner manifest"
```

### Task 2: Implement the Five Fixed Consumer Adapters

**Files:**
- Create: `current-owner-binding-adapters-v1.js`
- Create: `test-current-owner-binding-adapters-v1.js`

**Interfaces:**
- Input: validated manifest + exact live bytes/metadata for one fixed consumer.
- Output: `{consumer_id,target_path,before_sha256,after_bytes,after_sha256,restart_units,state}`.
- Fixed IDs only: `registry_bridge`, `v19_binding`, `current_baseline_refresh`, `rolling_refresh`, `titan_handoff_sandbox`.
- State only: `migration`, `already_migrated`, or fail-closed error.

- [ ] **Step 1: Write RED adapter contracts**

Require each adapter to: accept only its fixed target; accept enumerated exact initial preimage or structurally valid already-migrated preimage; reject unknown SHA; expose no request-controlled path/command/service/content; produce deterministic candidate bytes; bind by manifest logical IDs instead of OLD_SHA -> NEW_SHA chains; remove unsupported `RestrictSUIDSGID=true` from Titan sandbox candidate while preserving approved hardening; never reference/call Titan deploy.

- [ ] **Step 2: Run RED**

```bash
node --test test-current-owner-binding-adapters-v1.js
```

- [ ] **Step 3: Implement the fixed registry**

```js
const ADAPTERS=Object.freeze({
  registry_bridge: buildRegistryBridgeCandidate,
  v19_binding: buildV19BindingCandidate,
  current_baseline_refresh: buildCurrentBaselineRefreshCandidate,
  rolling_refresh: buildRollingRefreshCandidate,
  titan_handoff_sandbox: buildTitanHandoffSandboxCandidate,
});
```

Use complete fixed templates/structured transforms whose authority is the manifest. Do not expose a generic replace API.

- [ ] **Step 4: Add idempotency**

Accept already-migrated state only when schema, manifest-binding contract and target identity validate. Malformed migrated-looking input fails closed.

- [ ] **Step 5: Run GREEN**

```bash
node --check current-owner-binding-adapters-v1.js
node --test test-current-owner-binding-adapters-v1.js
```

- [ ] **Step 6: Commit**

```bash
git add current-owner-binding-adapters-v1.js test-current-owner-binding-adapters-v1.js
git commit -m "feat: add fixed current-owner consumer adapters"
```

### Task 3: Implement the Narrow Systemd Confinement Change

**Files:**
- Create: `current-owner-binding-systemd-v1.js`
- Create: `test-current-owner-binding-systemd-v1.js`

**Interfaces:**
- Service: `prhm-agent-selfmaint-exec.service`.
- Drop-in: `/etc/systemd/system/prhm-agent-selfmaint-exec.service.d/current-baseline-backup-rw.conf`.
- Backup root: `/var/backups/prhm-current-baseline-refresh-v1`.
- Exact content: `[Service]\nReadWritePaths=/var/backups/prhm-current-baseline-refresh-v1\n`.

- [ ] **Step 1: Write RED confinement tests**

Assert exact constants/content; no parent-wide `/var/backups` grant; absent -> `create`; exact existing -> `unchanged`; differing existing -> `dropin_preimage_drift`; effective state requires active service, nonzero PID and exact path in `ReadWritePaths`; restart scope contains only selfmaint-exec.

- [ ] **Step 2: Run RED**

```bash
node --test test-current-owner-binding-systemd-v1.js
```

- [ ] **Step 3: Implement pure candidate/state validation**

Keep actual `systemctl` execution in the transaction module.

- [ ] **Step 4: Run GREEN**

```bash
node --check current-owner-binding-systemd-v1.js
node --test test-current-owner-binding-systemd-v1.js
```

- [ ] **Step 5: Commit**

```bash
git add current-owner-binding-systemd-v1.js test-current-owner-binding-systemd-v1.js
git commit -m "feat: define narrow selfmaint backup confinement"
```

### Task 4: Build the All-or-Nothing Refresh Transaction

**Files:**
- Create: `current-owner-binding-refresh-v1.js`
- Create: `test-current-owner-binding-refresh-v1.js`
- Use the three modules from Tasks 1-3.

**Interfaces:**
- `ACTION='control_plane_current_owner_binding_refresh_v1'`.
- State root: `/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1`.
- Transaction root: `/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1/transactions`.
- Backup root: `/var/backups/prhm-current-owner-binding-refresh-v1`.
- CLI only: `--preflight-only`, `--apply`.
- Functions: `preflight()`, `materializeCandidates()`, `apply()`, `rollback()`.

- [ ] **Step 1: Write RED transaction tests**

With dependency injection for tests, require: exclusive lock before inventory; exact owner/preimage snapshot before any candidate/live write; exact bytes/SHA/uid/gid/mode persisted before first replacement; fixed writable probe only inside exact state/backup dirs; all candidate syntax/static checks before first replacement; transaction record before first replacement; same-filesystem temp + atomic rename; drop-in only when `create`; daemon-reload/restart only selfmaint-exec when changed; failure after N mutations restores all N in reverse order; rollback restores metadata/drop-in; success flags are false for application/database/Titan cutover; no arbitrary shell/deploy call.

- [ ] **Step 2: Run RED**

```bash
node --test test-current-owner-binding-refresh-v1.js
```

- [ ] **Step 3: Implement preflight/candidate materialization**

Add lock, health hook, manifest generation, exact consumer snapshot, fixed writable probes and candidate generation. `--preflight-only` must report `production_mutation:false` and make no consumer mutation.

- [ ] **Step 4: Implement atomic apply/journal**

Persist transaction metadata before first live write; apply in a fixed documented order; verify post-write SHA after each write.

- [ ] **Step 5: Implement fixed verification hooks in order**

1. self-maint health;
2. V19 17/17 contract;
3. registry bootstrap readiness;
4. current-baseline real backup-before-write readiness;
5. rolling-refresh owner validation;
6. Titan contract;
7. Titan preflight.

Verification must not call Titan deploy or create/consume unrelated approval requests.

- [ ] **Step 6: Implement rollback + injected failure points**

Test-only dependency injection may fail each stage. Production input must not expose fault injection. Assert byte-identical restore and distinct `rollback_failed` evidence when rollback itself is injected to fail.

- [ ] **Step 7: Run GREEN**

```bash
node --check current-owner-binding-refresh-v1.js
node --test \
  test-current-owner-binding-manifest-v1.js \
  test-current-owner-binding-adapters-v1.js \
  test-current-owner-binding-systemd-v1.js \
  test-current-owner-binding-refresh-v1.js
```

- [ ] **Step 8: Commit**

```bash
git add current-owner-binding-refresh-v1.js test-current-owner-binding-refresh-v1.js
git commit -m "feat: add transactional current-owner binding refresh"
```

### Task 5: Build the Host Actions v29 Registration Installer

**Files:**
- Create: `bootstrap-host-actions-v29-current-owner-binding-refresh.js`
- Create: `test-v29-current-owner-binding-refresh.js`
- Embed/install the four implementation modules from Tasks 1-4.

**Interfaces:**
- Base: `/opt/prhm-agent-selfmaint/server.js`.
- Executor: `/opt/prhm-agent-selfmaint-exec/server.js`.
- Policy: `/opt/prhm-company-control-plane/config/approval-policy.json`.
- MCP plugin: `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`.
- Runtime action: `/opt/prhm-agent-selfmaint-exec/actions/control-plane-current-owner-binding-refresh-v1.js` plus fixed private module directory `/opt/prhm-agent-selfmaint-exec/actions/current-owner-binding-v1/`.

- [ ] **Step 1: Re-read exact live registration SHA evidence immediately before coding pins**

Never reuse v28/historical/session hashes. Embed current Base/Executor/Policy/MCP SHA pins and make tests reject placeholders.

- [ ] **Step 2: Write RED v29 tests**

Assert exact action/operation; exact live pins; policy Level-4 critical, second-confirmation, one-time; action absent from Level-3 set; MCP enum contains it once; executor takes no caller arguments; systemd sandbox preserves `ProtectSystem=strict` + `ProtectHome=read-only`; writable paths are exact and never broad `/var/backups`; no `bash -c`, `sh -c` or generic command/path input; embedded bytes match embedded SHAs; bootstrap preflight has no production application mutation; registration install backs up Base/Executor/Policy/MCP and rolls back exact bytes on failure.

- [ ] **Step 3: Run RED**

```bash
node --test test-v29-current-owner-binding-refresh.js
```

- [ ] **Step 4: Implement additive registration builders**

Use unique structural anchors. Preserve every existing action. Missing/multiple anchors are blockers.

- [ ] **Step 5: Implement fixed executor runner**

Launch only the fixed helper in a constrained transient unit. Writable paths are limited to exact action/state/backup/consumer/drop-in targets and `/var/backups/prhm-current-baseline-refresh-v1`; none are caller controlled.

- [ ] **Step 6: Implement bootstrap preflight/install/rollback + `--selftest-only`**

`--selftest-only` validates embedded SHA integrity and pure builders without live writes. Normal install verifies live pins, backs up, atomically writes, syntax/JSON checks, verifies post-hashes, restarts only required control-plane services, and restores exact preimages on failure.

- [ ] **Step 7: Run GREEN**

```bash
node --check bootstrap-host-actions-v29-current-owner-binding-refresh.js
node --test test-v29-current-owner-binding-refresh.js
node bootstrap-host-actions-v29-current-owner-binding-refresh.js --selftest-only
```

- [ ] **Step 8: Commit**

```bash
git add bootstrap-host-actions-v29-current-owner-binding-refresh.js test-v29-current-owner-binding-refresh.js
git commit -m "feat: register current-owner binding refresh v29"
```

### Task 6: Add CI and Run Focused Regressions

**Files:**
- Create: `.github/workflows/host-actions-v29-current-owner-binding-refresh-ci.yml`

**Interfaces:**
- PR path filters cover all new current-owner/v29 files and workflow.
- Push branch: `impl/current-owner-binding-refresh-v1`.
- `permissions: contents: read`.

- [ ] **Step 1: Add syntax/contracts/selftest/diff-check CI**

Run `node --check` on all implementation/bootstrap JS; all five new tests; bootstrap `--selftest-only`; `git diff --check`.

- [ ] **Step 2: Add focused existing regressions**

```bash
node --test test-v19-agent-zdt-source-sha-refresh.js
node --test test-selfmaint-exec-route-refresh-v1.js
node --test test-host-actions-control-plane-typed-bootstrap-transport-v1.js
```

Run broader feasible repo Node tests too. If an unrelated existing test fails, identify it and prove it also fails on branch base; never hide it.

- [ ] **Step 3: Run CI-equivalent commands in the worktree**

Task-owned tests must be GREEN.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/host-actions-v29-current-owner-binding-refresh-ci.yml
git commit -m "ci: validate current-owner binding refresh v29"
```

### Task 7: Review, Push and Governed Registration Installation

**Files:**
- No application files.
- Live change is only control-plane registration after review/approval.

**Interfaces:**
- Input: exact reviewed implementation branch HEAD.
- Output: live registration of the fixed action; refresh itself is not executed yet.

- [ ] **Step 1: Review exact branch diff**

Check arbitrary command/path surfaces, broad systemd writes, secrets, unknown-preimage fallback, action loss, rollback completeness and Titan deploy references.

- [ ] **Step 2: Run `verification-before-completion`**

Re-run task tests, focused regressions, syntax, selftest and `git diff --check` from exact HEAD.

- [ ] **Step 3: Push without force and verify local/remote HEAD equality**

Open a Draft PR containing approved spec/plan + implementation commits.

- [ ] **Step 4: Require CI GREEN on the final source SHA**

Any source fix invalidates earlier review evidence; repeat review/verification on the new head.

- [ ] **Step 5: Install/register only through an existing governed SHA-bound control-plane deployment path**

No manual SSH/copy-edit of Base/Executor/Policy/MCP. If installation requires a fresh approval request, create it and stop for exactly the confirmation literal required by that request.

- [ ] **Step 6: Verify registration without executing refresh**

Require `selfmaint_health` GREEN; action appears exactly once; no arbitrary request fields; previous actions remain; no Titan application/cutover mutation.

### Task 8: Execute the Fresh Repair Request and Prove the Titan Deploy Gate

**Files:**
- No repo changes unless a defect sends work back through Tasks 4-7 and a new reviewed head.

**Interfaces:**
- Input: fresh one-time request for `control_plane_current_owner_binding_refresh_v1` + exact active-policy confirmation.
- Output: bounded GREEN evidence chain or rolled-back failure.

- [ ] **Step 1: Create a fresh fixed-action request and read status immediately**

Record only request ID, level/risk, expiry and non-secret binding metadata.

- [ ] **Step 2: Stop for the exact confirmation required by that fresh request**

Never reuse earlier `CONFIRM_LEVEL_3_PRODUCTION` / `CONFIRM_LEVEL_4_CRITICAL`.

- [ ] **Step 3: Apply once and read persisted evidence**

On failure require `rollback_performed:true` or distinct fail-closed rollback failure; do not continue to Titan checks.

- [ ] **Step 4: Verify post-repair in order**

1. `selfmaint_health` GREEN.
2. Effective selfmaint-exec `ReadWritePaths` includes `/var/backups/prhm-current-baseline-refresh-v1`; `ProtectSystem=strict` remains.
3. V19 contract 17/17 GREEN.
4. Registry bootstrap no longer returns `registry_bridge_baseline_sha_mismatch`.
5. Current-baseline backup-before-write works without EROFS. If running the actual baseline refresh needs a separate request, create a fresh request and get its own exact confirmation.
6. Rolling-refresh validates live owner SHA. If an actual rolling refresh is needed, create a separate fresh request and get its own confirmation.
7. Blue/green API and MCP slots healthy with intended owner fingerprints.
8. `titan_host_actions_worktree_test_v1({suite:'contract_v1'})` GREEN.
9. `titan_front_handoff_preflight_v2()` GREEN.

- [ ] **Step 5: Stop at the deploy gate**

Only when Titan contract and preflight are GREEN, report evidence and request fresh:

`CONFIRM_DEPLOY_PRODUCTION`

Do not call Titan deploy inside this implementation plan.

## Final Acceptance Checklist

- [ ] Deterministic non-secret current-owner manifest.
- [ ] Five fixed idempotent adapters reject unknown preimages.
- [ ] Historical OLD_SHA -> NEW_SHA chains are no longer steady-state authority.
- [ ] Exact backup-root grant only; `ProtectSystem=strict` preserved.
- [ ] Preimages persisted before mutation; injected rollback restores byte-identical files/metadata/drop-in.
- [ ] Host Action v29 is fixed no-input and approval-bound.
- [ ] New/focused regression tests GREEN; unrelated pre-existing failures explicitly documented.
- [ ] Registry/V19 stale-binding errors gone.
- [ ] Baseline backup no longer EROFS.
- [ ] Titan sandbox no longer errors on `RestrictSUIDSGID=true`.
- [ ] V19 17/17 GREEN.
- [ ] Titan contract GREEN.
- [ ] Titan preflight GREEN.
- [ ] `selfmaint_health` GREEN.
- [ ] `production_application_mutation:false`.
- [ ] `database_mutation:false`.
- [ ] `titan_cutover:false`.
- [ ] No unrelated repository state modified.
- [ ] Stop before Titan deployment and wait for fresh `CONFIRM_DEPLOY_PRODUCTION`.
