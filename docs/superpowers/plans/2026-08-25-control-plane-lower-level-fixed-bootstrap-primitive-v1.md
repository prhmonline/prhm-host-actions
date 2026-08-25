# Control Plane Lower-Level Fixed Bootstrap Primitive V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a fixed contract package for the lower-level self-maintenance bootstrap, then render exact live Agent API/MCP candidates in a separate apply gate.

**Architecture:** Reuse existing `selfmaint_request/apply` without expanding target/path scope. This gate produces an immutable contract renderer and tests only; production replacements are generated from freshly re-read live sources immediately before their separately approved self-maintenance requests.

**Tech Stack:** Node.js 20, built-in `assert`, SHA-256.

**Spec:** `docs/superpowers/specs/2026-08-25-control-plane-lower-level-fixed-bootstrap-primitive-v1-design.md`

## Global Constraints
- Agent API baseline SHA: `45f22b6879add519c51a0dadaf9840a62b1be3d0301f562f70b92656a89fa8c4`.
- Agent MCP baseline SHA: `0cc9fd75a064fdee5e4c2f161fa8bc0c4470e65cb3b079ce3abe67113b6676ab`.
- Root Scripts request-surface candidate SHA: `d464e0aa0b8daa6c1e623f523917c27c5da065e388c1017b3fe7d9098433e60e`.
- No arbitrary runtime action/path/command/content/SHA/repository/URL/service/SQL/environment input.
- No production mutation in this plan's TDD gate.

---

### Task 1: Fixed contract renderer
**Files:**
- Create: `candidates/control-plane/lower-level-fixed-bootstrap-primitive-v1.mjs`
- Test: `test/control-plane/lower-level-fixed-bootstrap-primitive-v1.test.mjs`

**Interfaces:**
- Produces `FIXED`, `requestToolSchema()`, `applyToolSchema()`, `agentApiSelfmaintBinding()`, `agentMcpSelfmaintBinding()`, `validatePendingRequest()`.

- [ ] Write the test before the module exists and confirm `ERR_MODULE_NOT_FOUND`.
- [ ] Implement only the fixed constants, zero-input/request-id-only schemas, exact selfmaint bindings, and pending-request validation.
- [ ] Verify wrong action/hash/expiry/confirmation fail closed.
- [ ] Run Node syntax and focused test.

### Task 2: Persist immutable candidate evidence
**Files:** same candidate/test plus this plan/spec.

- [ ] Record candidate bytes and SHA-256.
- [ ] Commit spec, plan, candidate, and test on an isolated branch descended from the approved design lineage.
- [ ] Fetch the committed files back and rerun test + syntax from committed bytes.

### Task 3: Live apply gate boundary
- [ ] Re-read both live source files and SHAs immediately before rendering replacements.
- [ ] If either SHA differs, stop and compatibility-review/rebind; never disable SHA checks.
- [ ] Create/apply Agent API selfmaint request, verify, then create/apply MCP request with a fresh separate Level-4 confirmation.
- [ ] If platform safety blocks either apply, stop with no generic fallback.
