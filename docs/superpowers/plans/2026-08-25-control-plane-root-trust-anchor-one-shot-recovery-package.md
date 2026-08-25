# Control Plane Root Trust Anchor One-Shot Recovery Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a one-shot, SHA-bound recovery package that repairs only the missing `root_scripts_fixed_stage_v1` trust-anchor registration and its two fixed recovery artifacts, without mutating Park Production.

**Architecture:** Implement a standalone Node recovery module and test suite in the `prhm-host-actions` repository. The module operates only on dependency-injected fixture roots during TDD/build, then produces a fixed package whose production bindings are immutable constants. It verifies all baselines before writes, applies narrowly scoped registry/policy/artifact changes, validates the result, and restores every changed file on failure.

**Tech Stack:** Node.js, `node:test`, built-in `fs`, `path`, `crypto`, JSON parsing/serialization, existing `prhm-host-actions` testing conventions.

**Spec:** `docs/superpowers/specs/2026-08-25-control-plane-root-trust-anchor-one-shot-recovery-package-design.md`

## Global Constraints

- Base SHA: `e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd`
- Executor SHA: `1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd`
- MCP SHA: `44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71`
- Policy SHA: `c0cb39528b9658cc01d9c97f4011f9200efa9e0a862d202cf4ef82824594c9e0`
- Recovery shell SHA: `142383a58e5647a95bf2c7a4200772e7b7eb7cdde6783df991aec89d6f8151dd`
- Recovery JSON SHA: `b3918639f19a489373489e714c86c733f5b8c0a851727b2b65b3831b071cb1d2`
- No arbitrary command/path input, generic shell, SSH/self-SSH/sshpass, external network, database mutation, Park Production mutation, Project Registry widening, generic Host Action installer behavior, or `park_bazar_migrate_v1`.
- No production execution in this build gate.

---

### Task 1: Establish the recovery contract with a genuine RED test

**Files:**
- Create: `test-control-plane-root-trust-anchor-one-shot-recovery-v1.js`
- Create later in Task 2: `control-plane-root-trust-anchor-one-shot-recovery-v1.js`

**Interfaces:**
- Consumes: fixture paths and immutable expected SHA constants.
- Produces: `runRecovery(options)` returning the result contract from the approved spec.

- [ ] **Step 1: Write the failing contract test**

Create a `node:test` suite that requires `./control-plane-root-trust-anchor-one-shot-recovery-v1.js` and asserts that `runRecovery` exists, but do not create the module yet.

The first test name must be:

```js
test('repairs only the fixed root_scripts trust anchor and fixed recovery artifacts', async () => {
  // fixture setup follows after RED is demonstrated
});
```

- [ ] **Step 2: Run the test and record genuine RED**

Run:

```bash
node --test test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
```

Expected: FAIL with `MODULE_NOT_FOUND` for `control-plane-root-trust-anchor-one-shot-recovery-v1.js`.

- [ ] **Step 3: Commit the RED test only**

```bash
git add test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
git commit -m "test: define root trust anchor recovery contract"
```

---

### Task 2: Implement immutable production bindings and read-only preflight

**Files:**
- Create: `control-plane-root-trust-anchor-one-shot-recovery-v1.js`
- Modify: `test-control-plane-root-trust-anchor-one-shot-recovery-v1.js`

**Interfaces:**
- Produces constants `SPEC`, `EXPECTED`, `FIXED_PATHS`, and functions `sha256(bytes)`, `verifyBaselines(ctx)`, `verifyExecutorCapability(ctx)`.
- `verifyBaselines(ctx)` returns `{baseline_verified:true}` or throws before any write.

- [ ] **Step 1: Extend tests for exact constants and baseline drift**

Assert that the module contains all six approved SHA values and rejects a fixture where any one control-plane file hash differs.

- [ ] **Step 2: Run tests to verify RED**

Expected: FAIL because `verifyBaselines` and exact fixed bindings do not exist yet.

- [ ] **Step 3: Implement minimal immutable bindings**

Use `Object.freeze` for the action identity, schema version, four production paths, two artifact identities, fixed landing directory, and approved SHAs. Do not accept production path/action names from caller input.

- [ ] **Step 4: Implement baseline verification before mutation**

Read each fixed file, compute SHA-256, compare to exact expected value, and throw `baseline_sha_mismatch:<logical-name>` on drift. Add an in-memory/write-attempt counter in test fixtures and assert it remains zero after drift failure.

- [ ] **Step 5: Verify existing executor implementation**

Require the fixed executor fixture to contain both `root_scripts_fixed_stage_v1` and the fixed helper path `/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js`; otherwise throw `root_scripts_executor_implementation_missing`.

- [ ] **Step 6: Run tests GREEN and syntax check**

```bash
node --check control-plane-root-trust-anchor-one-shot-recovery-v1.js
node --test test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
```

- [ ] **Step 7: Commit**

```bash
git add control-plane-root-trust-anchor-one-shot-recovery-v1.js test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
git commit -m "feat: add fixed trust anchor recovery preflight"
```

---

### Task 3: Add deterministic base-registry and approval-policy repair

**Files:**
- Modify: `control-plane-root-trust-anchor-one-shot-recovery-v1.js`
- Modify: `test-control-plane-root-trust-anchor-one-shot-recovery-v1.js`

**Interfaces:**
- Produces `patchBaseRegistry(text)` and `patchApprovalPolicy(text)`.
- Both functions are deterministic and duplicate-safe; neither accepts arbitrary action names.

- [ ] **Step 1: Add failing tests for registry repair**

Cover exactly these states: action absent, action already present once, ambiguous duplicate anchor, and malformed base source. Expected output contains exactly one `root_scripts_fixed_stage_v1` registration and preserves unrelated entries byte-for-byte except the single insertion.

- [ ] **Step 2: Add failing tests for policy repair**

Use the existing fixed `honartik_iticket_dark_backend_batch2_v1` policy structure as the structural reference, but create a new fixed scope for `root_scripts_fixed_stage_v1`. Test absent, already-present, duplicate, and malformed policy states.

- [ ] **Step 3: Verify tests RED**

Expected: FAIL because patch functions are not implemented.

- [ ] **Step 4: Implement exact-anchor base patch**

Patch only the known Host Actions registry map. Fail if the expected insertion anchor occurs zero times or more than once. Do not rewrite unrelated code.

- [ ] **Step 5: Implement parsed-JSON policy patch**

Parse JSON, verify the expected reference scope exists, clone only the required fixed approval attributes into a new `root_scripts_fixed_stage_v1` entry, ensure operation is exactly `host_action.root_scripts_fixed_stage_v1`, then serialize deterministically according to repository convention.

- [ ] **Step 6: Run focused and full tests GREEN**

```bash
node --test test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
```

- [ ] **Step 7: Commit**

```bash
git add control-plane-root-trust-anchor-one-shot-recovery-v1.js test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
git commit -m "feat: repair root scripts registry and policy"
```

---

### Task 4: Materialize exactly two SHA-bound recovery artifacts

**Files:**
- Modify: `control-plane-root-trust-anchor-one-shot-recovery-v1.js`
- Modify: `test-control-plane-root-trust-anchor-one-shot-recovery-v1.js`
- Add fixed source artifacts only if they already exist in repository history/source of truth and their bytes hash exactly to the approved SHAs; otherwise fail build rather than inventing bytes.

**Interfaces:**
- Produces `materializeRecoveryArtifacts(ctx)`.
- Destination set is fixed and contains exactly two names.

- [ ] **Step 1: Add failing tests for artifact identity and SHA mismatch**

Test exact filename allowlist, exact destination directory, rejection of symlinks/non-regular files, source SHA mismatch, destination conflict, and idempotent identical destination.

- [ ] **Step 2: Verify RED**

Expected: FAIL because materialization is not implemented.

- [ ] **Step 3: Resolve canonical bytes from repository evidence**

Locate the previously approved recovery shell and JSON bytes in repository history or trusted fixed artifacts. Verify locally:

```bash
sha256sum <shell-artifact> <json-artifact>
```

Expected exact hashes are the two values in Global Constraints. If either cannot be proven, STOP this task with build failure; do not reconstruct or synthesize content.

- [ ] **Step 4: Implement atomic materialization**

For each artifact, verify source regular-file status and SHA, create the fixed landing directory if absent, write via exclusive temp file, `fsync`, chmod fixed mode, rename atomically, then re-hash destination. Existing identical destination returns unchanged; conflicting destination aborts.

- [ ] **Step 5: Run tests GREEN**

```bash
node --test test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
```

- [ ] **Step 6: Commit**

```bash
git add control-plane-root-trust-anchor-one-shot-recovery-v1.js test-control-plane-root-trust-anchor-one-shot-recovery-v1.js <verified-artifacts>
git commit -m "feat: add fixed recovery artifact materialization"
```

---

### Task 5: Add transactional backup, rollback, idempotency, and result contract

**Files:**
- Modify: `control-plane-root-trust-anchor-one-shot-recovery-v1.js`
- Modify: `test-control-plane-root-trust-anchor-one-shot-recovery-v1.js`

**Interfaces:**
- Produces `runRecovery(ctx)` and `rollbackRun(journal, ctx)`.
- Success schema: `prhm.root-trust-anchor-recovery-result.v1`.

- [ ] **Step 1: Add failure-after-first-write test**

Inject a deterministic failure after base-registry replacement but before policy/artifact completion. Assert every mutated fixture returns byte-for-byte to its pre-run state and `rollback_performed=true`.

- [ ] **Step 2: Add duplicate-safe second-run test**

Run recovery twice against the same fixture. The second run must create no duplicate registration/policy entries and must leave artifact bytes unchanged.

- [ ] **Step 3: Add result-contract assertions**

Require exact action/schema identity and all safety booleans from the approved spec. Assert `production_application_mutation=false`, `database_mutation=false`, `external_network=false`, `arbitrary_command=false`, and `arbitrary_path=false` in both success and failure result metadata.

- [ ] **Step 4: Verify RED**

Expected: FAIL because journal/rollback/result orchestration is incomplete.

- [ ] **Step 5: Implement minimal transaction journal**

Before the first write, capture byte snapshots and existence/mode metadata for every fixed destination the run may change. Record each successful mutation in order. On exception, restore in reverse order and verify restored SHA values.

- [ ] **Step 6: Implement idempotent orchestration**

`runRecovery(ctx)` order must be: baseline verify → executor capability verify → compute candidate patches → verify artifact sources → create backups/journal → write base → write policy → materialize artifacts → post-verify → return result. No service restart is performed in this build-only module; production wrapper execution is a later gate.

- [ ] **Step 7: Run tests GREEN**

```bash
node --test test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
```

- [ ] **Step 8: Commit**

```bash
git add control-plane-root-trust-anchor-one-shot-recovery-v1.js test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
git commit -m "feat: make trust anchor recovery transactional"
```

---

### Task 6: Build verification, forbidden-surface scan, and package manifest

**Files:**
- Create: `control-plane-root-trust-anchor-one-shot-recovery-v1.manifest.json`
- Modify: tests as needed only to verify manifest binding.

**Interfaces:**
- Manifest records implementation SHA, test SHA, artifact SHAs, and the four exact production baseline SHAs.

- [ ] **Step 1: Run complete syntax/tests**

```bash
node --check control-plane-root-trust-anchor-one-shot-recovery-v1.js
node --test test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
```

Expected: all PASS, zero skipped/failed tests.

- [ ] **Step 2: Run forbidden-surface scan**

Search implementation and manifest for forbidden capabilities. The test suite must fail if implementation contains executable paths for `sshpass`, self-SSH, `curl`, `wget`, database mutation, Park production roots, or `park_bazar_migrate_v1`. Descriptive test strings may name forbidden terms, but implementation code must not expose those execution paths.

- [ ] **Step 3: Compute immutable artifact hashes**

```bash
sha256sum control-plane-root-trust-anchor-one-shot-recovery-v1.js test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
```

- [ ] **Step 4: Create manifest**

Manifest must contain:

```json
{
  "schema_version": "prhm.root-trust-anchor-recovery-package-manifest.v1",
  "action": "control_plane_root_trust_anchor_one_shot_recovery_v1",
  "production_execution": false,
  "park_production_mutation": false,
  "database_mutation": false,
  "baseline_sha256": {
    "base": "e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd",
    "executor": "1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd",
    "mcp": "44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71",
    "policy": "c0cb39528b9658cc01d9c97f4011f9200efa9e0a862d202cf4ef82824594c9e0"
  },
  "recovery_artifact_sha256": {
    "shell": "142383a58e5647a95bf2c7a4200772e7b7eb7cdde6783df991aec89d6f8151dd",
    "json": "b3918639f19a489373489e714c86c733f5b8c0a851727b2b65b3831b071cb1d2"
  }
}
```

Add implementation/test SHA fields using the values computed in Step 3.

- [ ] **Step 5: Re-run tests with manifest binding**

Tests must assert manifest action/schema/baselines and computed implementation/test hashes match exactly.

- [ ] **Step 6: Commit final build metadata**

```bash
git add control-plane-root-trust-anchor-one-shot-recovery-v1.manifest.json test-control-plane-root-trust-anchor-one-shot-recovery-v1.js
git commit -m "build: bind root trust anchor recovery package"
```

---

### Task 7: Final no-mutation evidence and handoff to recovery execution gate

**Files:** none in Park Production.

**Interfaces:**
- Consumes final package manifest.
- Produces evidence required for a later operator/root execution gate.

- [ ] **Step 1: Re-read current control-plane production hashes**

Verify the four production SHAs are still exactly the approved baselines. If any drift occurred, mark the package stale and do not execute it; create a fresh rebase gate instead.

- [ ] **Step 2: Run Park Bazar delivery audit**

Confirm Park entrypoint SHAs and unresolved debug states remain unchanged from pre-build evidence, proving the build gate did not mutate Park Production.

- [ ] **Step 3: Record final build verdict**

Only report `PASS — ONE-SHOT RECOVERY PACKAGE TDD/BUILD COMPLETE` if RED evidence exists, all tests are GREEN, artifact bytes are provenance-verified, manifest hashes match, and both control-plane/Park no-mutation checks pass.

- [ ] **Step 4: Define next gate**

The next gate must execute the fixed package through an explicit operator/root trust path with Level-4 controls and post-rollback evidence. It must not be repackaged through generic upload/write/shell carriers.

## Self-Review

- Spec coverage: every approved invariant maps to Tasks 2–7.
- Placeholder scan: no `TBD`, `TODO`, or unspecified error-handling steps remain.
- Type/name consistency: action name is consistently `control_plane_root_trust_anchor_one_shot_recovery_v1`; result schema is consistently `prhm.root-trust-anchor-recovery-result.v1`.
- Safety boundary: package build does not install Park v18, mutate Park Production, mutate a database, or create a generic execution primitive.
