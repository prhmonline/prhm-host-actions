# Control Plane Root Trust Anchor Typed Bootstrap Successor Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dependence on unproven legacy recovery-v1 artifacts with a TDD-verified adoption path for the installed typed-bootstrap successor trust chain, without modifying Park Bazar production.

**Architecture:** Treat the installed root-scripts-stage mediator as the authoritative source of the two embedded typed-bootstrap artifacts. Build a fail-closed verifier/adoption module in `prhm-host-actions` that validates embedded payload provenance and models the minimal registry/policy adoption required for `control_plane_root_scripts_stage_transport_v1`; actual server-side registration/apply remains a later Gate.

**Tech Stack:** Node.js, `node:test`, SHA-256 via `crypto`, Brotli via `zlib`, JSON policy fixtures, GitHub branch `fix/park-bazar-production-finalize-v17`.

**Spec:** `docs/superpowers/specs/2026-08-25-control-plane-root-trust-anchor-typed-bootstrap-successor-adoption-design.md`

## Global Constraints

- Canonical transport SHA256: `049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335`, bytes: `72854`.
- Canonical bootstrap SHA256: `d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e`, bytes: `109634`.
- Canonical operation: `host_action.control_plane_root_scripts_stage_transport_v1`.
- Canonical action: `control_plane_root_scripts_stage_transport_v1`.
- Level-4 approval remains mandatory.
- No legacy recovery-v1 byte reconstruction or fallback.
- No arbitrary command/path/repo/SQL/service/network input.
- No Park Bazar production mutation in this plan.

---

### Task 1: Establish RED contract for successor adoption

**Files:**
- Create: `test-v1-control-plane-root-trust-anchor-typed-bootstrap-successor-adoption.js`
- Create later: `control-plane-root-trust-anchor-typed-bootstrap-successor-adoption-v1.js`

**Interfaces:**
- Consumes: canonical action/operation and two expected artifact SHA/byte pairs from Global Constraints.
- Produces: `verifyEmbeddedArtifacts(input)` and `planSuccessorAdoption(input)` contracts.

- [ ] **Step 1: Write failing tests** that import the not-yet-existing implementation and assert the exact action, operation, artifact SHA/byte constants, `level4Required=true`, `legacyFallback=false`, and `parkProductionMutation=false`.
- [ ] **Step 2: Run** `node --test test-v1-control-plane-root-trust-anchor-typed-bootstrap-successor-adoption.js`.
  Expected: FAIL with `MODULE_NOT_FOUND` for `control-plane-root-trust-anchor-typed-bootstrap-successor-adoption-v1.js`.
- [ ] **Step 3: Commit RED-only test** with message `test: define typed bootstrap successor adoption contract`.

### Task 2: Verify embedded artifact provenance

**Files:**
- Create/Modify: `control-plane-root-trust-anchor-typed-bootstrap-successor-adoption-v1.js`
- Modify: `test-v1-control-plane-root-trust-anchor-typed-bootstrap-successor-adoption.js`

**Interfaces:**
- `verifyEmbeddedArtifacts({transportCompressedBase64, bootstrapCompressedBase64}) -> {ok, transportSha256, transportBytes, bootstrapSha256, bootstrapBytes}`.

- [ ] **Step 1: Add tests** that Brotli-decompress fixture payloads and require exact SHA and byte counts; add negative tests for malformed Base64, Brotli failure, byte-count mismatch and SHA mismatch.
- [ ] **Step 2: Run focused tests** and confirm they fail before implementation.
- [ ] **Step 3: Implement minimal verifier** using `Buffer.from(..., 'base64')`, `zlib.brotliDecompressSync`, and `crypto.createHash('sha256')`; reject any mismatch before returning bytes.
- [ ] **Step 4: Run focused tests** and require all provenance tests PASS.
- [ ] **Step 5: Commit** `feat: verify typed bootstrap successor provenance`.

### Task 3: Model exact registry and approval-policy adoption

**Files:**
- Modify: `control-plane-root-trust-anchor-typed-bootstrap-successor-adoption-v1.js`
- Modify: `test-v1-control-plane-root-trust-anchor-typed-bootstrap-successor-adoption.js`

**Interfaces:**
- `planSuccessorAdoption({baseSource, approvalPolicy}) -> {baseSource, approvalPolicy, changed, invariants}`.

- [ ] **Step 1: Add failing fixture tests** for: action absent, operation already present, duplicate action, malformed registry anchor, malformed policy, and idempotent second run.
- [ ] **Step 2: Require exact registry insertion** for `control_plane_root_scripts_stage_transport_v1` only; reject zero/multiple anchors and any existing conflicting registration.
- [ ] **Step 3: Require exact policy operation** `host_action.control_plane_root_scripts_stage_transport_v1` with Level-4 semantics; never broaden another action or wildcard scope.
- [ ] **Step 4: Implement minimal deterministic patch planner** returning new bytes but performing no filesystem write.
- [ ] **Step 5: Run tests** and require all registry/policy tests PASS.
- [ ] **Step 6: Commit** `feat: plan fixed typed bootstrap successor registration`.

### Task 4: Enforce fail-closed approval and forbidden surfaces

**Files:**
- Modify: implementation and test files above.

**Interfaces:**
- `validateExecutionContract(contract) -> {ok:true}` or throws a stable fail-closed error.

- [ ] **Step 1: Add negative tests** for missing Level-4 requirement, arbitrary `command`, `path`, `repo`, `sql`, `service`, `host`, `url`, `artifact`, or generic argument fields; add a test that any `legacyRecoveryFallback=true` is rejected.
- [ ] **Step 2: Implement exact-key contract validation**; unknown execution-input keys fail closed.
- [ ] **Step 3: Add static source scan assertions** rejecting `sshpass`, self-SSH, `systemd-run`, `DROP DATABASE`, `CREATE DATABASE`, `park_bazar_migrate_v1`, and generic shell execution primitives.
- [ ] **Step 4: Run tests** and require PASS.
- [ ] **Step 5: Commit** `test: enforce typed bootstrap successor security boundary`.

### Task 5: Add transactional rollback model

**Files:**
- Modify: implementation and test files above.

**Interfaces:**
- `simulateTransactionalAdoption(state, failurePoint) -> {ok, rollbackPerformed, state}` for deterministic tests only.

- [ ] **Step 1: Add failing tests** for failure after registry patch, after policy patch, and after first artifact stage; each must restore the exact original fixture bytes.
- [ ] **Step 2: Implement invocation-local journal model** with before-images and reverse-order rollback.
- [ ] **Step 3: Add success/idempotency tests** requiring `rollbackPerformed=false` on clean success and `changed=false` on second identical adoption.
- [ ] **Step 4: Run the complete suite** and require all tests PASS.
- [ ] **Step 5: Commit** `feat: add successor adoption rollback model`.

### Task 6: Bind a reviewable manifest and verify repository bytes

**Files:**
- Create: `control-plane-root-trust-anchor-typed-bootstrap-successor-adoption-v1.manifest.json`
- Modify: test file.

**Interfaces:**
- Manifest contains schema version, action, operation, artifact SHA/bytes, implementation SHA, test SHA, `legacy_fallback=false`, `production_application_mutation=false`, and `level4_required=true`.

- [ ] **Step 1: Generate manifest from the tested files**; do not hand-enter implementation/test SHA values before calculating them.
- [ ] **Step 2: Add tests** that recompute implementation/test SHA and compare with manifest.
- [ ] **Step 3: Run `node --check`** on implementation and test files.
- [ ] **Step 4: Run complete `node --test` suite** for this feature.
- [ ] **Step 5: Run forbidden-string scan** over implementation/test/manifest and require zero forbidden execution surfaces.
- [ ] **Step 6: Commit** `build: bind typed bootstrap successor adoption manifest`.
- [ ] **Step 7: Read files back from GitHub** on the branch and recompute SHA-256; require byte-identical match with the tested artifacts.

### Task 7: Verify no production mutation and hand off to registration Gate

**Files:** None.

**Interfaces:**
- Consumes: current control-plane SHA evidence and `park_bazar_delivery_audit_v1`.
- Produces: final TDD/build verdict only; no server apply.

- [ ] **Step 1: Re-read current base/executor/MCP/policy SHA-256 values** and compare with pre-plan values.
- [ ] **Step 2: Run `park_bazar_delivery_audit_v1`** and require the Park application SHA values to remain unchanged.
- [ ] **Step 3: Confirm no Host Action apply/self-maintenance apply was executed during this plan.**
- [ ] **Step 4: Report `PASS — TYPED BOOTSTRAP SUCCESSOR ADOPTION TDD/BUILD COMPLETE` only if Tasks 1–6 and no-mutation checks pass; otherwise report the exact blocker.**
- [ ] **Step 5: If PASS, hand off to a separate `...REGISTRATION_AND_APPLY...` Gate.**

## Self-Review

- Spec coverage: provenance, exact registration/policy binding, Level-4 fail-closed behavior, rollback, idempotency, forbidden surfaces, legacy fallback prohibition, and no Park mutation are each mapped to explicit tasks.
- Placeholder scan: no TBD/TODO/implement-later steps are present.
- Type consistency: `verifyEmbeddedArtifacts`, `planSuccessorAdoption`, `validateExecutionContract`, and `simulateTransactionalAdoption` have one definition and stable signatures throughout the plan.
