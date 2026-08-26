# Selfmaint Approval HTTP One-Shot External Repair V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a zero-input, SHA-bound, one-shot external repair artifact that fixes only the self-maintenance approval HTTP transport by removing the registry network-namespace hop, without executing the production repair in this plan.

**Architecture:** The artifact operates outside selfmaint/Host Actions and knows exactly one target, one preimage SHA, one semantic patch, one service, and one acceptance request specification. It performs preflight-only checks, generates the postimage deterministically, validates syntax, creates an invocation-bound backup, atomically replaces the file, restarts only `prhm-agent-selfmaint.service`, verifies health/postimage, creates one request-only acceptance selfmaint request, persists retirement state, and rolls back on any failure after mutation.

**Tech Stack:** Node.js 20, built-in `fs`, `path`, `crypto`, `child_process`, systemd, SHA-256, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-26-selfmaint-approval-http-one-shot-external-repair-v1-design.md`

## Global Constraints

- Production target is exactly `/opt/prhm-agent-selfmaint/server.js`.
- Frozen preimage SHA-256 is `6c28dc9f2ac7dee674f4382de0a2da422c56198243e8a2790c5ad5e6bdabcddb`.
- Repair only `approvalHttp()`: executable changes from `nsenter` to `curl`, and the argv prefix `-t, registryPid(), -n, curl` is removed.
- Approval URL, tokens, request/decision/validate/consume flow, TTL, Level-4 confirmation, allowlists, Approval policy, Registry, Executor, and MCP semantics are unchanged.
- No runtime path, command, content, URL, host, port, SHA, service, action, repository, credential, or environment inputs.
- No production execution in this implementation plan.
- No generic `ops_execute` write, no `safe_file_upload` as root authority, no ZDT/Honartik/Host Actions repurpose.
- Acceptance is request-only; `selfmaint_apply` is never invoked by this artifact.
- Second successful execution must fail closed as already completed/retired.

---

### Task 1: Exact Repair Contract Renderer

**Files:**
- Create: `candidates/control-plane/selfmaint-approval-http-one-shot-external-repair-v1.js`
- Test: `test/selfmaint-approval-http-one-shot-external-repair-v1.test.mjs`

**Interfaces:**
- Consumes: full source bytes for the exact target preimage.
- Produces: `renderPostimage(sourceText) -> string`, fixed constants, and preflight validators.

- [ ] **Step 1: Write failing tests** for exact preimage eligibility, wrong SHA rejection, exact broken-anchor count, fixed-anchor absence, symlink/realpath guards through dependency injection, and deterministic postimage rendering.
- [ ] **Step 2: Run focused tests** and verify RED because the candidate module does not exist.
- [ ] **Step 3: Implement minimal renderer** with constants for target, preimage SHA, service, state path, and exact before/after transport anchors. No arbitrary inputs.
- [ ] **Step 4: Run focused tests** and verify GREEN.
- [ ] **Step 5: Run `node --check`** on candidate and test.

### Task 2: One-Shot Apply/Rollback State Machine

**Files:**
- Modify: `candidates/control-plane/selfmaint-approval-http-one-shot-external-repair-v1.js`
- Modify: `test/selfmaint-approval-http-one-shot-external-repair-v1.test.mjs`

**Interfaces:**
- Consumes: renderer from Task 1 and injected system adapters for tests.
- Produces: `preflight()`, `applyOnce()`, deterministic rollback/retirement behavior.

- [ ] **Step 1: Add failing tests** for zero-write preflight, candidate syntax check, invocation-bound backup, atomic replacement, restart only `prhm-agent-selfmaint.service`, postimage SHA verification, rollback on restart/health/SHA failure, rollback-failure critical evidence, and already-completed rejection.
- [ ] **Step 2: Run tests** and verify RED for missing state-machine behavior.
- [ ] **Step 3: Implement minimal state machine** using exact paths and fixed service only.
- [ ] **Step 4: Run tests** and verify GREEN.

### Task 3: Request-Only Acceptance Contract

**Files:**
- Modify: `candidates/control-plane/selfmaint-approval-http-one-shot-external-repair-v1.js`
- Modify: `test/selfmaint-approval-http-one-shot-external-repair-v1.test.mjs`

**Interfaces:**
- Consumes fixed embedded MCP acceptance candidate bytes.
- Produces a single request-only acceptance call specification.

- [ ] **Step 1: Add failing tests** asserting acceptance target `agent_mcp`, path `src/plugins/selfmaint.js`, expected SHA `0cc9fd75a064fdee5e4c2f161fa8bc0c4470e65cb3b079ce3abe67113b6676ab`, candidate SHA `59498a1de0b9607b73674e44c2aaa8e12652cff567e0927f508a57dcb764ffdb`, and prohibition of any apply call.
- [ ] **Step 2: Run tests** and verify RED.
- [ ] **Step 3: Implement immutable acceptance request construction** and success evidence capture of request ID only.
- [ ] **Step 4: Run tests** and verify GREEN.

### Task 4: Immutable Verification and Channel Discovery

**Files:**
- No production files.

**Interfaces:**
- Consumes committed artifact/test bytes.
- Produces final artifact SHA/bytes, expected postimage SHA, and an evidence-based answer on whether a sanctioned external execution channel already exists.

- [ ] **Step 1: Commit candidate/test/plan** on an implementation branch derived from the reviewed design branch.
- [ ] **Step 2: Re-fetch committed candidate/test by commit SHA** and rerun `node --check` and full focused tests.
- [ ] **Step 3: Compute committed bytes/SHA-256 and deterministic expected postimage SHA** from the frozen preimage fixture.
- [ ] **Step 4: Perform read-only tool/schema discovery** for a sanctioned out-of-band root/operator execution channel. Do not execute production repair.
- [ ] **Step 5: Report** PASS/blocked status, branch/commit, test evidence, artifact SHA/bytes, expected postimage SHA, and channel availability.
