# iMotion Target Registration V16 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a fail-closed Host Action v2 that registers the static iMotion front and WordPress sale targets and fixes pending status/namespace execution defects.

**Architecture:** A SHA-bound V16 bootstrap patches Base, Executor, Approval Policy, MCP source and ZDT manifest, and installs a fixed no-input V2 helper. The V2 helper validates both production roots read-only, patches only Agent/MCP control-plane source, and leaves runtime refresh to a separate rolling gate.

**Tech Stack:** Node.js, systemd-run sandboxing, Host Actions v2, MCP/Zod schemas, GitHub/DeployHQ.

**Spec:** `docs/superpowers/specs/2026-08-20-imotion-target-registration-v16-design.md`

## Global Constraints
- No iMotion production-root writes.
- No WordPress DB/content/plugin mutation.
- No Git clean/reset/stash.
- Preserve Level-4 one-time confirmation and action-local rollback.
- Do not restart MCP runtime during V16 installation; refresh it in a later rolling gate.

---

### Task 1: Two-target helper
- [ ] Write tests for static and WordPress target validation.
- [ ] Implement `imotion-marketing-targets-register-v2.js`.
- [ ] Run `node --check` and V16 tests.

### Task 2: V16 installer and Host Actions status fix
- [ ] Test registry/schema insertion, pending status behavior, and namespace backup precreation.
- [ ] Implement `bootstrap-host-actions-v16-imotion-marketing-targets-register.js` against pinned live SHA baselines.
- [ ] Verify ZDT expected-hash updates and rollback paths.

### Task 3: Repository review gate
- [ ] Commit V16 files on isolated branch.
- [ ] Open draft PR against `main`.
- [ ] Re-read changed files and confirm no production-site mutation primitives.

### Task 4: Live preflight and installation gates
- [ ] Deploy bootstrap for `--preflight-only`; require baseline and candidate checks PASS.
- [ ] Obtain fresh `CONFIRM_LEVEL_4_CRITICAL`.
- [ ] Apply V16 installer, verify rollback=false and no site mutation.
- [ ] Create/apply fresh V2 target-registration request and verify both targets.
- [ ] Perform a separate rolling MCP refresh and verify schemas/targets before SEO work.
