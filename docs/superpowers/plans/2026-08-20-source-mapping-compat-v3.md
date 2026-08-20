# Source Mapping Compat V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the two remaining fixed-scope Source Mapping diagnostics, load the patched MCP source into Blue without interrupting public traffic, validate V3 through the real connector, and only then permit finalize.

**Architecture:** Keep Green/8125 serving public traffic while patching only `agent_mcp/src/plugins/safeFiles.js` through the existing SHA-bound self-maintenance path. Then use a separate Blue reverse-slot bootstrap to restart only Blue/8124, health-check it, atomically move the router pointer to Blue, and preserve Green as rollback until external V3 validation passes.

**Tech Stack:** Node.js 20, MCP JavaScript plugins, node:test, systemd, DeployHQ config-file deployments, existing PRHM self-maintenance/approval path.

**Spec:** `docs/superpowers/specs/2026-08-20-source-mapping-compat-v3-design.md`

## Global Constraints

- Current `safeFiles.js` SHA must equal `87da44a939478786b9a48585c1cccacd862b683831dbba976d8b6a85869d2473` before source apply.
- Git remains fixed-root only; every Git call uses `-c safe.directory=<the same fixed canonical root>` and no HOME restoration.
- Remote output remains only `host` plus `owner_repo`; changed paths remain hidden.
- CF Park DB extraction adds only `common/config/base_env.php` to fixed candidates and returns only `database_name`.
- V2 sentinel remains supported; V3 sentinel is exact `__PRHM_SOURCE_MAPPING_COMPAT_V3__` with operation `source_mapping_compat_v3`.
- No arbitrary path/command surface, no DB mutation, no Agent API mutation, no Router restart/reload.
- Green/8125 remains the rollback backend until real connector V3 validation passes.
- Source patch apply, Blue refresh apply, rollback, and finalize each require separate fresh Level-4 confirmation.

---

### Task 1: V3 Source Candidate Contract

**Files:**
- Create: `test-source-mapping-compat-v3.js`
- Create: `fixtures/source-mapping-compat-v3/safeFiles-v2-current.js`
- Create: `build-source-mapping-compat-v3.js`

**Interfaces:**
- Consumes: exact V2 `safeFiles.js` source bytes with SHA `87da44...d2473`.
- Produces: `buildCandidate(source) -> { content, sha256, replacements }` and exact candidate bytes for self-maintenance.

- [ ] **Step 1: Write failing tests** asserting fixed-root `safe.directory`, no HOME restoration, sanitized remote contract, `common/config/base_env.php`, V2 preservation, and exact V3 sentinel/operation.
- [ ] **Step 2: Run** `node --test test-source-mapping-compat-v3.js` and require failure because `build-source-mapping-compat-v3.js` is absent.
- [ ] **Step 3: Implement minimal exact structural transformation** with replacement-count guards; reject unexpected source SHA or missing/duplicate anchors.
- [ ] **Step 4: Run** `node --check build-source-mapping-compat-v3.js && node --test test-source-mapping-compat-v3.js`; require PASS.
- [ ] **Step 5: Record candidate SHA/byte count** and commit test, fixture, builder, and generated candidate metadata.

### Task 2: Blue Reverse-Slot Refresh Contract

**Files:**
- Create: `test-agent-mcp-blue-refresh-v1.js`
- Create: `bootstrap-agent-mcp-blue-refresh-v1.js`

**Interfaces:**
- Consumes: Green active/public on 8125, Blue candidate slot 8124, pinned `server.js`, candidate `safeFiles.js`, and router SHAs.
- Produces: fixed modes `--preflight-only`, `--apply`, `--rollback`, `--finalize` with bounded redacted evidence.

- [ ] **Step 1: Write failing orchestration tests** with FakeAdapter for preflight mutation-free behavior, apply order, Green preservation, Router non-restart, rollback pointer-first behavior, and finalize enablement.
- [ ] **Step 2: Run** `node --test test-agent-mcp-blue-refresh-v1.js`; require RED because bootstrap is absent.
- [ ] **Step 3: Implement minimal bootstrap**: restart Blue only, require 8124 health, atomic fsync-backed pointer `8125 -> 8124`, require public 8123 health, auto-rollback on post-mutation failure.
- [ ] **Step 4: Run** syntax and full test suite; require PASS.
- [ ] **Step 5: Commit** tested bootstrap bytes and record SHA-256.

### Task 3: Source Patch Stage and Apply Gate

**Files:**
- Runtime target only after approval: `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js`

**Interfaces:**
- Consumes: Task 1 candidate bytes and exact current SHA.
- Produces: one SHA-bound `selfmaint_request` and post-apply source SHA evidence.

- [ ] **Step 1: Read current source SHA and self-maintenance health/inventory read-only.**
- [ ] **Step 2: Create SHA-bound self-maintenance request** with candidate bytes; do not apply.
- [ ] **Step 3: Verify request/status metadata and candidate SHA.**
- [ ] **Step 4: Stop at Level-4 gate** for source apply.
- [ ] **Step 5: After separate confirmation, apply and independently verify new source SHA; Green remains serving old loaded process.**

### Task 4: Blue Refresh Preflight and External V3 Gate

**Files:**
- DeployHQ config artifact: `bootstrap-agent-mcp-blue-refresh-v1.js`

**Interfaces:**
- Consumes: patched on-disk V3 source, tested Blue bootstrap.
- Produces: Blue process loaded with V3 and public router pointer on 8124, while Green remains active for rollback.

- [ ] **Step 1: Deploy exact reviewed bootstrap bytes as config-only artifact and run `--preflight-only`.**
- [ ] **Step 2: Restore temporary DeployHQ command to `true` before analysis and verify restore.**
- [ ] **Step 3: Stop at separate Level-4 gate for Blue refresh `--apply`.**
- [ ] **Step 4: After confirmation, apply and verify Blue/8124 health, public/8123 health, Green still active, Router not restarted.**
- [ ] **Step 5: Invoke real connector V3 sentinel and require all Park/Gisheh Git/remote/DB subchecks successful with credentials hidden.**
- [ ] **Step 6: If any check fails, do not finalize; keep Green rollback backend and diagnose read-only.**
- [ ] **Step 7: Only after full connector PASS, stop at separate Level-4 finalize gate.**

## Self-Review

- Spec coverage: both root causes, V3 sentinel, source delivery, Blue reverse refresh, rollback, external validation, and approval boundaries are mapped to explicit tasks.
- Placeholder scan: no TODO/TBD or deferred implementation language remains.
- Interface consistency: candidate source SHA flows Task 1 -> Task 3 -> Task 4; Blue bootstrap modes match the approved design.
