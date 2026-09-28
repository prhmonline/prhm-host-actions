# Current-Owner Binding Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and register the fixed `control_plane_current_owner_binding_refresh_v1` Host Action so the live PRHM Agent 3 control-plane can rebind the currently stale registry/V19/baseline/rolling-refresh/Titan consumers to one canonical current-owner manifest, with exact-preimage rollback and no Titan application deployment.

**Architecture:** Implement a small fixed subsystem consisting of a deterministic owner-manifest builder, fixed consumer adapters, narrow systemd-confinement logic, and one transactional refresh helper. Register it additively as Host Actions v29 using the repository's existing SHA-bound bootstrap pattern; installation and later execution stay behind fresh approval gates, and the repair stops after Titan contract/preflight turn GREEN.

**Tech Stack:** Node.js 20 / `prhm-node`, `node:test`, systemd, PRHM Host Actions v2 approval/control-plane, SHA-256 exact-preimage binding, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-28-current-owner-binding-refresh-design.md`

## Global Constraints

- Public action name is exactly `control_plane_current_owner_binding_refresh_v1`.
- Operation name is exactly `host_action.control_plane_current_owner_binding_refresh_v1`.
- The caller supplies no path, command, SHA, hostname, service, arbitrary content, repository selector, environment selector, or approval token.
- Titan application source, database, DirectAdmin, DNS, TLS, public routing, deploy, and cutover are out of scope.
- The canonical manifest path is `/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1/manifest.json`.
- The self-maint executor remains under `ProtectSystem=strict`.
- The only new persistent writable backup path granted to `prhm-agent-selfmaint-exec.service` is `/var/backups/prhm-current-baseline-refresh-v1`.
- No broad `ReadWritePaths=/var/backups` grant is allowed.
- Exact preimages are persisted before the first live-target replacement; any later failure triggers byte-exact rollback including mode/uid/gid and the systemd drop-in.
- Request creation and execution remain separate, one-time, expiry-bound operations. Never reuse confirmation from another or expired request.
- Installation and execution use the active policy's required confirmation. The initial critical migration must be registered as Level-4/critical unless the approved policy mechanism itself rejects that classification.
- Development occurs on a separate isolated implementation branch/worktree; do not clean/reset unrelated state in `/home/prhm/worktrees/prhm-host-actions`.
- No force push. Stage only task files. Verify remote/local HEAD equality after push.
- Successful repair evidence must include `production_application_mutation:false`, `database_mutation:false`, and `titan_cutover:false`.
- `titan_front_handoff_deploy_v2` must never be called by this plan. Deployment remains a later explicit gate requiring fresh `CONFIRM_DEPLOY_PRODUCTION`.

## File Structure

Create these focused implementation files on `impl/current-owner-binding-refresh-v1`:

- `current-owner-binding-manifest-v1.js` — fixed owner inventory validation, canonical serialization, deterministic manifest SHA.
- `test-current-owner-binding-manifest-v1.js` — manifest and owner-confinement contract.
- `current-owner-binding-adapters-v1.js` — five fixed migration/steady-state consumer adapters only.
- `test-current-owner-binding-adapters-v1.js` — known-preimage, unknown-preimage, idempotency, Titan-sandbox and no-arbitrary-input contracts.
- `current-owner-binding-systemd-v1.js` — exact self-maint executor drop-in candidate and effective-confinement verification.
- `test-current-owner-binding-systemd-v1.js` — exact path/hardening/conflict/restart-scope contracts.
- `current-owner-binding-refresh-v1.js` — preflight, candidate materialization, transaction, atomic apply, verification orchestration and rollback.
- `test-current-owner-binding-refresh-v1.js` — transaction ordering, preimage persistence, injected-failure rollback and no-deploy contracts.
- `bootstrap-host-actions-v29-current-owner-binding-refresh.js` — SHA-bound installation/registration bootstrap for helper modules and Host Actions v2 surfaces.
- `test-v29-current-owner-binding-refresh.js` — registration/policy/MCP/executor/bootstrap transaction contract.
- `.github/workflows/host-actions-v29-current-owner-binding-refresh-ci.yml` — syntax, contracts, selftest and focused regressions.

Do not modify `bootstrap-host-actions-v19-agent-zdt-source-sha-refresh.js` or its test as the new source of truth. V19 remains a regression fixture showing the old single-SHA approach; the new subsystem migrates installed consumers away from that chaining model.

## Review Focus

Reviewers should pay special attention to these failure modes even where a happy-path task test passes:

1. A live owner path becoming a symlink, noncanonical path, or unexpectedly large file between inventory and apply.
2. An allowlisted consumer having an unknown preimage: the transaction must stop before any live target changes.
3. A partial systemd drop-in/service restart failure after file mutations: rollback must restore the drop-in and service state before reporting failure.
4. Verification accidentally mutating Titan or consuming an unrelated approval while checking registry/baseline/rolling-refresh readiness.
5. A new owner SHA after installation but before execution: the manifest may capture the current owner, but migration adapters must still require an enumerated or already-migrated consumer preimage and must never turn into generic source rewriting.

---

### Task 1: Create the Isolated Implementation Worktree and Freeze Live Evidence

**Files:**
- Create later in this task: `test-current-owner-binding-manifest-v1.js`
- Create later in this task: `current-owner-binding-manifest-v1.js`

**Interfaces:**
- Branch: `impl/current-owner-binding-refresh-v1`.
- Base: the exact approved documentation head containing this spec and plan.
- Consumes only read-only evidence from fixed PRHM Agent 3 surfaces before source constants are finalized.
- Produces a literal `OWNER_SPECS` allowlist and an `INITIAL_CONSUMER_PREIMAGES` allowlist in source; no placeholder/TODO hash may remain at commit.

- [ ] **Step 1: Create an isolated worktree using the repository's standard worktree workflow**

Use the superpowers `using-git-worktrees` workflow. Create `impl/current-owner-binding-refresh-v1` from the exact approved docs/plan head. Refuse to clean/reset the shared `/home/prhm/worktrees/prhm-host-actions` checkout.

- [ ] **Step 2: Record read-only current-owner evidence**

Use only fixed/read-only PRHM Agent 3 reads to capture canonical path, file type, byte size and SHA-256 for the live owners and current consumer targets required by the approved spec. At minimum cover:

- live Agent API owner (`/home/agent/ssh-agent-api/server.js`);
- the fixed MCP/self-maint registry bridge owner used by the action-specific registry path;
- installed existing-topology rolling-refresh action (`/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js`);
- the installed/current-baseline refresh owner/target used by `control_plane_typed_bootstrap_current_baseline_refresh_v1`;
- the fixed Titan handoff sandbox helper/owner used by `titan_host_actions_worktree_test_v1` and `titan_front_handoff_preflight_v2`;
- the control-plane registration files required for v29 installation: Base, Executor, Approval Policy and MCP Host Actions v2 plugin.

If a logical owner maps to a different live canonical path than historical notes suggest, use the verified live path and document it in the test fixture; do not guess or broaden the allowed root.

- [ ] **Step 3: Write the first RED manifest test**

`test-current-owner-binding-manifest-v1.js` must initially require the absent module and specify these behaviors:

- `OWNER_SPECS` is a frozen fixed list with unique logical IDs and absolute literal paths;
- no owner path contains wildcard/glob/user input;
- a regular canonical fixture is accepted;
- symlink, noncanonical realpath and oversize fixtures are rejected;
- canonical serialization is stable independent of object insertion order;
- manifest SHA is deterministic when `captured_at` and owner facts are fixed;
- manifest output contains no file contents, env values, tokens, approval fields or credentials.

- [ ] **Step 4: Run RED and verify the expected failure**

Run:

```bash
node --test test-current-owner-binding-manifest-v1.js
```

Expected: FAIL because `current-owner-binding-manifest-v1.js` does not yet exist.

- [ ] **Step 5: Implement the minimum manifest module**

Implement and export only the fixed primitives needed by the test:

```js
const SCHEMA='prhm.current-owner-binding-manifest.v1';
const OWNER_SPECS=Object.freeze([...]);
function validateFileOwner(spec,fsApi=fs) { ... }
function canonicalJson(value) { ... }
function buildManifest({capturedAt,owners,serviceFacts={}}) { ... }
```

`buildManifest` must sort by logical owner ID before hashing and return `manifest_sha256` calculated from the canonical form excluding the hash field itself.

- [ ] **Step 6: Run GREEN plus syntax**

```bash
node --check current-owner-binding-manifest-v1.js
node --test test-current-owner-binding-manifest-v1.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add current-owner-binding-manifest-v1.js test-current-owner-binding-manifest-v1.js
git commit -m "feat: add fixed current-owner manifest"
```

### Task 2: Implement Fixed Consumer Adapters Without Historical Anchor Chaining

**Files:**
- Create: `current-owner-binding-adapters-v1.js`
- Create: `test-current-owner-binding-adapters-v1.js`

**Interfaces:**
- Consumes: validated manifest plus exact live bytes/metadata for a fixed consumer ID.
- Produces: `{consumer_id,target_path,before_sha256,after_bytes,after_sha256,restart_units,state}`.
- Fixed consumer IDs only:
  - `registry_bridge`
  - `v19_binding`
  - `current_baseline_refresh`
  - `rolling_refresh`
  - `titan_handoff_sandbox`
- State is only `migration`, `already_migrated`, or a fail-closed error.

- [ ] **Step 1: Write RED adapter contracts**

Test that each adapter:

- accepts only its fixed target path;
- accepts an enumerated exact initial preimage or a verified already-migrated manifest-based preimage;
- rejects an unknown SHA before producing a candidate;
- does not accept path/command/service/content arguments from a request object;
- emits deterministic candidate bytes for a fixed manifest;
- embeds/reads manifest logical IDs instead of a historical sequence of OLD_SHA -> NEW_SHA text anchors;
- for `titan_handoff_sandbox`, removes the unsupported `RestrictSUIDSGID=true` assignment from the generated candidate while retaining the approved hardening properties;
- never references or calls `titan_front_handoff_deploy_v2`.

- [ ] **Step 2: Run RED**

```bash
node --test test-current-owner-binding-adapters-v1.js
```

Expected: FAIL because adapter implementation is absent.

- [ ] **Step 3: Implement a fixed adapter registry**

Export a frozen mapping such as:

```js
const ADAPTERS=Object.freeze({
  registry_bridge: buildRegistryBridgeCandidate,
  v19_binding: buildV19BindingCandidate,
  current_baseline_refresh: buildCurrentBaselineRefreshCandidate,
  rolling_refresh: buildRollingRefreshCandidate,
  titan_handoff_sandbox: buildTitanHandoffSandboxCandidate,
});
```

Each implementation must generate a complete known consumer candidate from a fixed template/structured transform whose authority is the manifest. Do not expose a generic `replace(path,from,to)` API.

- [ ] **Step 4: Add already-migrated idempotency checks**

An already-migrated target is accepted only when its embedded schema/manifest-binding contract is structurally valid and its fixed target identity matches. A malformed "looks migrated" target must fail closed.

- [ ] **Step 5: Run GREEN**

```bash
node --check current-owner-binding-adapters-v1.js
node --test test-current-owner-binding-adapters-v1.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add current-owner-binding-adapters-v1.js test-current-owner-binding-adapters-v1.js
git commit -m "feat: add fixed current-owner consumer adapters"
```

### Task 3: Implement the Exact Self-Maint Executor Systemd Confinement Change

**Files:**
- Create: `current-owner-binding-systemd-v1.js`
- Create: `test-current-owner-binding-systemd-v1.js`

**Interfaces:**
- Fixed service: `prhm-agent-selfmaint-exec.service`.
- Fixed drop-in: `/etc/systemd/system/prhm-agent-selfmaint-exec.service.d/current-baseline-backup-rw.conf`.
- Fixed backup root: `/var/backups/prhm-current-baseline-refresh-v1`.
- Exact drop-in content: `[Service]\nReadWritePaths=/var/backups/prhm-current-baseline-refresh-v1\n`.
- Produces candidate/verification metadata only; caller performs the transaction.

- [ ] **Step 1: Write RED confinement tests**

Cover:

- exact service/drop-in/backup-root constants;
- exact content adds only the one backup root;
- source contains no `ReadWritePaths=/var/backups` parent-wide grant;
- absent drop-in -> candidate `create`;
- exact existing drop-in -> `unchanged`;
- any differing existing drop-in -> fail `dropin_preimage_drift` rather than overwrite;
- effective verification requires `ActiveState=active`, nonzero `MainPID`, and exact backup root in `ReadWritePaths`;
- restart scope contains only `prhm-agent-selfmaint-exec.service`.

- [ ] **Step 2: Run RED**

```bash
node --test test-current-owner-binding-systemd-v1.js
```

Expected: FAIL because module is absent.

- [ ] **Step 3: Implement the minimal confinement module**

Export constants plus pure functions for candidate classification and effective-state validation. Keep `systemctl` execution in the transaction module so this module stays easily testable.

- [ ] **Step 4: Run GREEN**

```bash
node --check current-owner-binding-systemd-v1.js
node --test test-current-owner-binding-systemd-v1.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add current-owner-binding-systemd-v1.js test-current-owner-binding-systemd-v1.js
git commit -m "feat: define narrow selfmaint backup confinement"
```

### Task 4: Build the All-or-Nothing Refresh Transaction and Rollback

**Files:**
- Create: `current-owner-binding-refresh-v1.js`
- Create: `test-current-owner-binding-refresh-v1.js`
- Use: `current-owner-binding-manifest-v1.js`
- Use: `current-owner-binding-adapters-v1.js`
- Use: `current-owner-binding-systemd-v1.js`

**Interfaces:**
- `ACTION='control_plane_current_owner_binding_refresh_v1'`.
- State root: `/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1`.
- Manifest: `/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1/manifest.json`.
- Transaction root: `/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1/transactions`.
- Backup root: `/var/backups/prhm-current-owner-binding-refresh-v1`.
- CLI accepts only `--preflight-only` or `--apply`.
- Main functions: `preflight()`, `materializeCandidates()`, `apply()`, `rollback()`.

- [ ] **Step 1: Write RED transaction-order tests**

With injected filesystem/process dependencies, require:

- action-local exclusive lock before inventory;
- owner inventory and consumer preimages captured before candidate or live write;
- exact preimage bytes + SHA + uid/gid/mode persisted before first live replacement;
- backup-root writable probe during preflight creates/removes only inside the exact fixed directory;
- all candidates syntax/static validated before first live replacement;
- transaction record persisted before first live replacement;
- same-filesystem temporary write + atomic rename for regular files;
- systemd drop-in changed only when classification is `create`;
- `daemon-reload` and restart only selfmaint-exec when drop-in changed;
- verification failure after N mutations restores all N exact preimages in reverse order;
- rollback restores uid/gid/mode and drop-in preimage;
- successful result has `production_application_mutation:false`, `database_mutation:false`, `titan_cutover:false`;
- helper source has no deploy call or arbitrary shell (`bash -c`, `sh -c`, `exec`).

- [ ] **Step 2: Run RED**

```bash
node --test test-current-owner-binding-refresh-v1.js
```

Expected: FAIL because helper is absent.

- [ ] **Step 3: Implement preflight and candidate materialization only**

Implement lock, health hook, owner manifest, exact consumer snapshot, writable probes and candidate building. Run `--preflight-only` tests first; it must produce `production_mutation:false` and not touch consumer targets.

- [ ] **Step 4: Implement atomic apply and journal**

Persist a transaction JSON before first write containing only bounded non-secret metadata and backup paths. Apply in a fixed order documented in source; use atomic rename and post-write SHA verification after every target.

- [ ] **Step 5: Implement verification hooks in the approved order**

The helper must invoke only fixed verification hooks/surfaces for:

1. self-maint health;
2. V19 17/17 contract;
3. registry action-specific bootstrap readiness;
4. baseline-refresh real backup-before-write readiness;
5. rolling-refresh owner validation;
6. Titan contract;
7. Titan preflight.

A verification hook may call a fixed local helper/tool contract, but must not create/consume an unrelated approval or call Titan deploy.

- [ ] **Step 6: Implement exact rollback and injected-failure test points**

Provide test-only dependency injection, not a production request field, to fail after each mutation/verification stage. Assert byte-for-byte restoration and distinct `rollback_failed` evidence when rollback itself is injected to fail.

- [ ] **Step 7: Run GREEN and regression for all four new modules**

```bash
node --check current-owner-binding-refresh-v1.js
node --test \
  test-current-owner-binding-manifest-v1.js \
  test-current-owner-binding-adapters-v1.js \
  test-current-owner-binding-systemd-v1.js \
  test-current-owner-binding-refresh-v1.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add current-owner-binding-refresh-v1.js test-current-owner-binding-refresh-v1.js
git commit -m "feat: add transactional current-owner binding refresh"
```

### Task 5: Register and Install the Action as Host Actions v29

**Files:**
- Create: `bootstrap-host-actions-v29-current-owner-binding-refresh.js`
- Create: `test-v29-current-owner-binding-refresh.js`
- Embed/install the four new implementation modules from Tasks 1-4.

**Interfaces:**
- Fixed Base: `/opt/prhm-agent-selfmaint/server.js`.
- Fixed Executor: `/opt/prhm-agent-selfmaint-exec/server.js`.
- Fixed Approval Policy: `/opt/prhm-company-control-plane/config/approval-policy.json`.
- Fixed MCP Host Actions v2 plugin: `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`.
- Runtime action: `/opt/prhm-agent-selfmaint-exec/actions/control-plane-current-owner-binding-refresh-v1.js` plus a fixed private module directory under `/opt/prhm-agent-selfmaint-exec/actions/current-owner-binding-v1/`.
- Registration action is additive and fail-closed on unknown live preimage.

- [ ] **Step 1: Immediately re-read live registration SHA evidence**

Before coding bootstrap constants, obtain current exact SHA-256 for Base/Executor/Policy/MCP with the fixed read-only evidence path. Do not reuse old hashes from v28, historical summaries, or earlier sessions. Put exact hashes in constants and add a test that rejects placeholders.

- [ ] **Step 2: Write RED v29 registration/bootstrap tests**

Require:

- exact `ACTION` and `OPERATION`;
- exact current live Base/Executor/Policy/MCP SHA pins;
- Level-4, `risk:'critical'`, `requires_second_confirmation:true`, `one_time_use:true` policy entry;
- action is not added to a Level-3 action set;
- MCP request enum includes action once;
- executor dispatch takes no caller arguments and launches only the fixed action helper;
- executor systemd sandbox preserves `ProtectSystem=strict` and `ProtectHome=read-only`;
- writable paths are exact action/state/backup/consumer/drop-in paths, never `/var/backups` broadly;
- no `bash -c`, `sh -c`, generic command/path input;
- all embedded module SHA values match embedded bytes;
- bootstrap preflight makes no production application mutation;
- install transaction backs up all four registration files, validates JS/JSON and installed hashes, then restarts only required control-plane services;
- installation rollback restores all registration files on post-write failure.

- [ ] **Step 3: Run RED**

```bash
node --test test-v29-current-owner-binding-refresh.js
```

Expected: FAIL before bootstrap exists.

- [ ] **Step 4: Implement additive registration candidates**

Follow the established v28/selfmaint route patterns: patch action spec, executor fixed dispatch, MCP enum and approval policy with unique structural anchors. Preserve every existing action. Unknown/multiple anchors are blockers, never fallback string insertion.

- [ ] **Step 5: Implement the fixed executor runner**

Launch the action helper in a constrained transient unit. Give write access only to the exact fixed action state/backup targets, exact consumer targets/directories required by adapters, the exact selfmaint-exec drop-in directory, and `/var/backups/prhm-current-baseline-refresh-v1`. No caller-controlled `ReadWritePaths` are permitted.

- [ ] **Step 6: Implement bootstrap preflight/install/rollback and `--selftest-only`**

`--selftest-only` must validate embedded SHA integrity and pure registration builders without reading live production. Normal install first validates live preimage pins, makes backups, writes atomically, syntax/JSON-checks candidates, verifies post-hashes, restarts required control-plane services, and rolls back exact bytes on failure.

- [ ] **Step 7: Run GREEN**

```bash
node --check bootstrap-host-actions-v29-current-owner-binding-refresh.js
node --test test-v29-current-owner-binding-refresh.js
node bootstrap-host-actions-v29-current-owner-binding-refresh.js --selftest-only
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add bootstrap-host-actions-v29-current-owner-binding-refresh.js test-v29-current-owner-binding-refresh.js
git commit -m "feat: register current-owner binding refresh v29"
```

### Task 6: Add Focused CI and Run Existing Control-Plane Regressions

**Files:**
- Create: `.github/workflows/host-actions-v29-current-owner-binding-refresh-ci.yml`

**Interfaces:**
- PR path filter covers all new v29/current-owner files and the workflow itself.
- Push branch filter: `impl/current-owner-binding-refresh-v1`.
- `permissions: contents: read` only.

- [ ] **Step 1: Write CI workflow**

Run syntax for all five implementation/bootstrap JS files, the five new Node test files, bootstrap `--selftest-only`, and `git diff --check`.

- [ ] **Step 2: Add focused existing regressions**

At minimum run:

```bash
node --test test-v19-agent-zdt-source-sha-refresh.js
node --test test-selfmaint-exec-route-refresh-v1.js
node --test test-host-actions-control-plane-typed-bootstrap-transport-v1.js
```

Also run any repository-wide Node tests that are feasible without production-only fixtures. If an unrelated existing test fails, record it by name and prove it also fails on the branch base; do not silently omit it.

- [ ] **Step 3: Run the same CI commands locally/in the isolated worktree**

Expected: all task-owned tests GREEN; any unrelated pre-existing failure explicitly recorded.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/host-actions-v29-current-owner-binding-refresh-ci.yml
git commit -m "ci: validate current-owner binding refresh v29"
```

### Task 7: Review, Push and Install the Reviewed v29 Registration Through the Governed Path

**Files:**
- No new application files expected.
- Only reviewed control-plane installation after code review.

**Interfaces:**
- Consumes exact reviewed implementation branch HEAD.
- Produces live registration of `control_plane_current_owner_binding_refresh_v1`; does not execute the refresh yet.

- [ ] **Step 1: Run branch review before push**

Review exact diff for arbitrary command/path surfaces, over-broad systemd writable paths, secrets, unknown-preimage fallbacks, action loss, rollback completeness and any Titan deploy invocation.

- [ ] **Step 2: Run verification-before-completion**

Use the superpowers verification skill. Re-run task-owned tests, focused regressions, syntax, selftest and `git diff --check` from the exact branch head.

- [ ] **Step 3: Push without force and verify remote equality**

Push only `impl/current-owner-binding-refresh-v1`; verify local HEAD == remote branch HEAD. Open a Draft PR that includes the approved spec/plan plus implementation commits.

- [ ] **Step 4: Review CI and the exact final source SHA**

CI failure is a blocker. If any fix changes the branch head, repeat review and verification. The installation approval must bind to the final reviewed source, not an earlier commit.

- [ ] **Step 5: Install/register through an existing approved SHA-bound control-plane deployment path**

Do not manually SSH/copy-edit Base/Executor/Policy/MCP. If the installer path requires a Level-4 request, create a fresh request and stop for its exact required confirmation before applying it.

- [ ] **Step 6: Verify registration without executing the repair**

After install, require:

- `selfmaint_health` GREEN;
- live Host Actions list includes `control_plane_current_owner_binding_refresh_v1` exactly once;
- request schema exposes only the fixed action name, no arbitrary fields;
- all previously registered actions remain present;
- no Titan application/cutover mutation occurred.

### Task 8: Execute the Fresh Repair Request and Prove the Titan Deploy Gate Is Ready

**Files:**
- No repository changes expected unless verification finds an implementation defect; defects go back through Tasks 4-7 with a new reviewed head.

**Interfaces:**
- Consumes a fresh one-time request for `control_plane_current_owner_binding_refresh_v1` and the exact runtime-required confirmation.
- Produces one bounded evidence chain ending at Titan preflight GREEN or a rolled-back failure.

- [ ] **Step 1: Create a fresh action request**

Call the fixed Host Actions request surface for:

`control_plane_current_owner_binding_refresh_v1`

Read status immediately. Record only request ID, level/risk, expiry and non-secret binding metadata.

- [ ] **Step 2: Stop for the exact active confirmation literal**

Do not reuse `CONFIRM_LEVEL_3_PRODUCTION` or `CONFIRM_LEVEL_4_CRITICAL` from any earlier request. Ask the user for exactly the literal required by this fresh request.

- [ ] **Step 3: Apply only the fresh pending request**

After confirmation, apply once and read persisted status/evidence. On failure, require either `rollback_performed:true` or a distinct fail-closed rollback-failed state; do not proceed to Titan checks on a failed transaction.

- [ ] **Step 4: Verify post-repair health and contracts**

Require in order:

1. `selfmaint_health` GREEN.
2. Effective `prhm-agent-selfmaint-exec.service` `ReadWritePaths` contains `/var/backups/prhm-current-baseline-refresh-v1` while `ProtectSystem=strict` remains in force.
3. V19 contract 17/17 GREEN using the fixed V19 contract tool after migration.
4. Registry action-specific bootstrap no longer returns `registry_bridge_baseline_sha_mismatch`.
5. Current-baseline refresh can create its real backup before target replacement without EROFS. If executing the baseline refresh itself requires a separate fresh approval, create that request and obtain its own exact confirmation; never reuse the repair approval.
6. Existing-topology rolling refresh validates live owner SHA. If a rolling refresh is actually required to load the rebound owner, create a fresh rolling-refresh request and obtain its own required confirmation before applying.
7. Verify blue/green API and MCP slots are healthy and fingerprints match the intended owner state.
8. `titan_host_actions_worktree_test_v1({suite:'contract_v1'})` GREEN.
9. `titan_front_handoff_preflight_v2()` GREEN.

- [ ] **Step 5: Stop at the Titan deployment gate**

When and only when both Titan contract and preflight are GREEN, report the exact evidence and stop. Request fresh:

`CONFIRM_DEPLOY_PRODUCTION`

Do **not** call `titan_front_handoff_deploy_v2` inside this implementation plan.

## Final Acceptance Checklist

- [ ] Manifest is deterministic and contains only bounded non-secret owner metadata.
- [ ] All five consumer adapters are fixed, idempotent and reject unknown preimages.
- [ ] No historical OLD_SHA -> NEW_SHA chain is the steady-state source of truth.
- [ ] Self-maint executor has only the exact new backup-root write grant; `ProtectSystem=strict` remains enabled.
- [ ] Transaction persists exact preimages before mutation and injected rollback restores byte-identical state including metadata/drop-in.
- [ ] Host Action v29 is fixed no-input and approval-bound.
- [ ] New and focused regression tests pass; unrelated failures, if any, are explicitly documented.
- [ ] Registry/V19 stale-binding errors are gone.
- [ ] Baseline-refresh backup no longer fails EROFS.
- [ ] Titan handoff no longer fails on `RestrictSUIDSGID=true`.
- [ ] V19 contract is 17/17 GREEN.
- [ ] Titan contract GREEN.
- [ ] Titan preflight GREEN.
- [ ] `selfmaint_health` GREEN.
- [ ] `production_application_mutation:false`.
- [ ] `database_mutation:false`.
- [ ] `titan_cutover:false`.
- [ ] No unrelated repository state modified.
- [ ] Execution stops before Titan deployment and waits for fresh `CONFIRM_DEPLOY_PRODUCTION`.
