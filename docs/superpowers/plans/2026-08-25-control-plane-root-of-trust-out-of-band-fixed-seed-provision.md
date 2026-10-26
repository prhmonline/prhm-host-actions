# Control Plane Root of Trust Out-of-Band Fixed Seed Provision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a one-shot out-of-band fixed seed that installs only the already-tested native verifier install action into the live Control Plane trust chain.

**Architecture:** The seed is a zero-input, SHA-bound recovery primitive outside the Host Actions registry it repairs. It validates four live control-plane baselines, writes only the exact fixed registration deltas plus the exact bound helper artifact, performs transactional rollback on any failure, reloads only fixed services, verifies the new action through a real request probe, then marks itself consumed.

**Tech Stack:** Node.js 20, `node:test`, SHA-256 via `crypto`, JSON policy fixtures, fixed control-plane filesystem paths, systemd service health checks, GitHub immutable commit binding.

**Spec:** `docs/superpowers/specs/2026-08-25-control-plane-root-of-trust-out-of-band-fixed-seed-provision-design.md`

## Global Constraints

- Seed accepts zero runtime inputs.
- It installs only `control_plane_typed_bootstrap_fixed_verifier_native_install_v1`.
- Installer implementation SHA256: `eeeccf448d9792ea69df4313864374945684e7cbb1ae6b0eedfa37b84d51f369`.
- Installer test SHA256: `7fb9e74d823dafc967928b65ef16bff74489d108aa2642399c027da660708a8c`.
- Installer manifest SHA256: `a75182d3a5160b38e27e396765e0a7fd9d1aed5e556e2f6b566c5dcdcca29d99`.
- Verifier implementation SHA256: `f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a`.
- No Park Bazar production mutation.
- No generic shell/write carrier or unrelated installer reuse.

---

### Task 1: Capture fresh live baselines and define RED contract

**Files:**
- Create: `test-v1-control-plane-root-of-trust-out-of-band-fixed-seed.js`
- Create later: `control-plane-root-of-trust-out-of-band-fixed-seed-v1.js`

**Interfaces:**
- Produces constants `SEED_ACTION`, `TARGET_ACTION`, `EXPECTED_BASELINES`, `BOUND_ARTIFACTS`, `EXECUTION_CONTRACT`.

- [ ] Read the four live SHA256 baselines immediately before coding and store them in the test fixture.
- [ ] Write a failing test that imports the nonexistent seed implementation and asserts zero-input, one-shot, Park-mutation=false, and exact target/artifact bindings.
- [ ] Run `node --test test-v1-control-plane-root-of-trust-out-of-band-fixed-seed.js`; expected failure is `MODULE_NOT_FOUND`.
- [ ] Commit RED-only test as `test: define out-of-band fixed seed contract`.

### Task 2: Implement fail-closed preflight and artifact binding

**Files:**
- Create: `control-plane-root-of-trust-out-of-band-fixed-seed-v1.js`
- Modify: test file.

**Interfaces:**
- `verifySeedPreflight({base,executor,mcp,policy,artifacts}) -> {ok:true}` or throws stable error code.

- [ ] Add negative tests for drift in each of the four baselines.
- [ ] Add negative tests for installer implementation/test/manifest/verifier SHA mismatch.
- [ ] Implement exact SHA checks and reject unknown fields or alternate targets.
- [ ] Run focused tests and require PASS.
- [ ] Commit `feat: add fixed seed preflight binding`.

### Task 3: Build deterministic registration patches

**Files:**
- Modify implementation and tests.

**Interfaces:**
- `planSeedPromotion({baseSource,executorSource,mcpSource,policy}) -> {changed,files,invariants}`.

- [ ] Add failing tests using real-schema fixtures for missing anchor, ambiguous anchor, conflicting pre-registration and exact already-installed state.
- [ ] Implement deterministic insertion for only the fixed native installer action in base registry, executor dispatcher/spec, MCP enum/registration surface and Level-4 approval policy.
- [ ] Require exact already-installed state to return `changed=false`; conflicting state remains fail-closed.
- [ ] Run tests and require PASS.
- [ ] Commit `feat: plan fixed seed promotion`.

### Task 4: Add transactional write/rollback model

**Files:**
- Modify implementation and tests.

**Interfaces:**
- `simulateSeedTransaction(state,failurePoint) -> {ok,rollbackPerformed,state,consumed}` for deterministic TDD only.

- [ ] Add failing tests for failure after base, executor, MCP, policy, helper materialization and service-reload preparation.
- [ ] Implement before-image journal and reverse-order rollback restoring exact original bytes.
- [ ] Add success test requiring `rollbackPerformed=false`.
- [ ] Add second-run test requiring either `already_consumed` or exact no-op; never reapply writes.
- [ ] Run complete suite and require PASS.
- [ ] Commit `feat: add fixed seed rollback and consumption`.

### Task 5: Enforce zero-input and forbidden surfaces

**Files:**
- Modify implementation and tests.

**Interfaces:**
- `validateSeedExecutionContract(contract) -> {ok:true}` or throws.

- [ ] Add tests rejecting command/path/repo/url/sql/host/service/artifact/payload/network selector fields.
- [ ] Add static source scan rejecting `sshpass`, self-SSH construction, `systemd-run`, generic shell execution, database mutation strings, `park_bazar_migrate_v1`, wildcard registry/policy widening and arbitrary environment passthrough.
- [ ] Require fixed service allowlist only.
- [ ] Run tests and require PASS.
- [ ] Commit `test: enforce fixed seed security boundary`.

### Task 6: Manifest and immutable repository binding

**Files:**
- Create: `control-plane-root-of-trust-out-of-band-fixed-seed-v1.manifest.json`
- Modify: test file.

**Interfaces:**
- Manifest binds schema version, seed action, target action, four baseline SHAs, bound artifact SHAs, implementation SHA, test SHA, `zero_input=true`, `one_shot=true`, `park_production_mutation=false`.

- [ ] Generate implementation/test SHA256 from the tested bytes.
- [ ] Add failing manifest test before creating the manifest.
- [ ] Create manifest and require recomputation match.
- [ ] Run `node --check` on implementation and tests.
- [ ] Run complete `node --test` suite.
- [ ] Run forbidden-surface scan across implementation/test/manifest.
- [ ] Commit `build: bind out-of-band fixed seed manifest`.
- [ ] Read all three artifacts back from immutable GitHub commit and recompute SHA256; require byte-identical match.

### Task 7: Provision through the approved out-of-band operator surface

**Files:** No repository edits expected.

**Interfaces:**
- Consumes the immutable manifest and exact tested seed artifact.
- Produces one persisted, single-use provisioning result.

- [ ] Re-read four live baselines immediately before provisioning; abort on drift.
- [ ] Verify backup destinations and fixed service allowlist before first mutation.
- [ ] Execute only the fixed seed through the authorized out-of-band/root operator surface; do not substitute generic `ops_execute`, upload, shell, self-SSH or temporary systemd units.
- [ ] Verify result evidence shows exact changed paths, helper SHA, rollback=false and consumed=true.
- [ ] Verify all fixed services are active/healthy.
- [ ] Create a real `host_action_v2_request` for `control_plane_typed_bootstrap_fixed_verifier_native_install_v1`; success is mandatory.

### Task 8: No-mutation and handoff verification

**Files:** None.

**Interfaces:**
- Produces final Gate verdict and next Gate only.

- [ ] Run `park_bazar_delivery_audit_v1` and require Park entrypoint SHAs unchanged from pre-seed evidence.
- [ ] Verify no Park DB mutation occurred.
- [ ] Verify seed cannot be reused after consumption.
- [ ] Report PASS only with fresh request-surface evidence and no-mutation audit.
- [ ] If PASS, hand off to `CONTROL_PLANE_TYPED_BOOTSTRAP_FIXED_VERIFIER_NATIVE_INSTALL_CHANNEL_REGISTRATION_AND_LEVEL4_APPLY_V1`.

## Self-Review

- Spec coverage: zero-input, exact artifact binding, four-baseline binding, transactional rollback, fixed service reload, real request probe, one-shot consumption and no-Park-mutation each have explicit tasks.
- Placeholder scan: no TODO/TBD/implement-later steps.
- Type consistency: `verifySeedPreflight`, `planSeedPromotion`, `simulateSeedTransaction`, and `validateSeedExecutionContract` are defined once and used consistently.
