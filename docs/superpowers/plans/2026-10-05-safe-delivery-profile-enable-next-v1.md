# Safe Delivery Profile Enable Next v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zero-input Level-4 Host Action that enables exactly the next Safe Delivery profile and rolls back exact state on failed verification.

**Architecture:** Follow the existing fixed Host Action pattern: a pure bootstrap/installer module builds policy, MCP enum, base/executor registration and a SHA-bound helper. The helper derives the next profile from canonical state, validates a contiguous-prefix invariant, performs the existing atomic profile enablement, verifies health/state, and restores exact preimage bytes on failure.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`, `fs`, `crypto`, `child_process`), PRHM Host Action v2 approval/control-plane runtime.

**Spec:** `docs/superpowers/specs/2026-10-05-safe-delivery-profile-enable-next-v1.md`

## Global Constraints
- Action is exactly `safe_delivery_profile_enable_next_v1`.
- Operation is exactly `host_action.safe_delivery_profile_enable_next_v1`.
- Canonical rollout is `drtarjomeh_prod -> rahkomak_prod -> cfpark_front_prod -> titan_front_prod -> imotion_front_prod`.
- No caller-supplied project, path, command, URL, service, credential, or payload.
- Level-4/critical, one-time, explicit second confirmation, requested approver `mohammad`.
- Mutation is limited to Safe Delivery profile-enablement state; no application/DB/DNS/TLS/Git mutation.
- Every production activation requires a fresh Level-4 request.

## Review Focus
- Non-contiguous enabled state must fail closed before mutation.
- Unknown/missing next project or delivery profile must fail closed.
- No remaining next project must return an idempotent terminal result without mutation.
- Post-enable state changing more than one profile must trigger rollback.
- Health failure after mutation must restore byte-for-byte preimage and verify SHA parity.

---

### Task 1: Contract and state-machine tests

**Files:**
- Create: `test-v30-safe-delivery-profile-enable-next.js`
- Create: `safe-delivery-profile-enable-next-v1.js`

**Interfaces:**
- Consumes: persisted Safe Delivery state object and fixed canonical rollout.
- Produces: `deriveNextProject(state)`, `validateTransition(before, after, target)`, and zero-input helper contract.

- [ ] **Step 1: Write failing tests** for fixed action/operation, rollout ordering, contiguous-prefix validation, terminal state, exactly-one transition, forbidden arbitrary inputs, rollback markers, and health verification.
- [ ] **Step 2: Run** `node --test test-v30-safe-delivery-profile-enable-next.js` and verify failure because implementation is absent.
- [ ] **Step 3: Implement minimal pure state-machine helpers** in `safe-delivery-profile-enable-next-v1.js`.
- [ ] **Step 4: Re-run test** and require all Task 1 tests PASS.
- [ ] **Step 5: Commit** `feat: add safe delivery enable-next state machine`.

### Task 2: Fixed Host Action bootstrap and installer

**Files:**
- Create: `bootstrap-host-actions-v30-safe-delivery-profile-enable-next.js`
- Modify: `test-v30-safe-delivery-profile-enable-next.js`

**Interfaces:**
- Consumes: helper source/SHAs and current control-plane baseline files.
- Produces: fixed policy candidate, MCP enum registration, base/executor registration, SHA-bound installer plan, preflight/install entry points.

- [ ] **Step 1: Extend tests** to assert Level-4 policy, no Level-3 registration, zero arbitrary inputs, fixed helper path, bounded sandbox, exact SHA binding, backup/rollback/restart behavior.
- [ ] **Step 2: Run tests** and verify new assertions FAIL.
- [ ] **Step 3: Implement bootstrap/installer** following the current Host Action v2 fixed-action pattern, using current baseline anchors only.
- [ ] **Step 4: Run** `node --test test-v30-safe-delivery-profile-enable-next.js` and require PASS.
- [ ] **Step 5: Commit** `feat: add safe delivery enable-next host action installer`.

### Task 3: CI and production preflight

**Files:**
- Create: `.github/workflows/host-actions-v30-safe-delivery-profile-enable-next-ci.yml`

**Interfaces:**
- Consumes: Task 1/2 files.
- Produces: branch CI evidence and a production-safe preflight artifact; no production mutation.

- [ ] **Step 1: Add CI** running syntax checks and `node --test test-v30-safe-delivery-profile-enable-next.js`.
- [ ] **Step 2: Verify branch CI** is green.
- [ ] **Step 3: Run read-only production preflight** against current Agent 3 baselines and require exact SHA/anchor/state/health readiness.
- [ ] **Step 4: If any baseline SHA or anchor differs, regenerate against current live baseline and re-run tests; do not weaken guards.**
- [ ] **Step 5: Commit** `ci: verify safe delivery enable-next host action`.

### Task 4: Register then activate CF Park

**Files:**
- No application source changes.

**Interfaces:**
- Consumes: GREEN SHA-bound installer from Task 3.
- Produces: registered Host Action followed by one fresh CF Park activation request.

- [ ] **Step 1: Create the fixed registration/install Level-4 request; do not apply without explicit `CONFIRM_LEVEL_4_CRITICAL`.**
- [ ] **Step 2: After confirmation, install/register atomically and verify Agent 3 schema exposes the fixed action.**
- [ ] **Step 3: Create a fresh Level-4 request for `safe_delivery_profile_enable_next_v1`; current state must derive `cfpark_front_prod`.**
- [ ] **Step 4: After a separate explicit `CONFIRM_LEVEL_4_CRITICAL`, apply and verify state + service + health.**
- [ ] **Step 5: Only after CF Park passes, repeat with fresh requests for Titan and then iMotion.**
