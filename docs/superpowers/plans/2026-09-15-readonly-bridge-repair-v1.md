# readonly_bridge_repair_v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed, approval-bound Host Action that safely moves only the read-only bridge from conflicting port 8140 to 8141 with preimage backup, health verification, and automatic rollback.

**Architecture:** A no-input repair helper contains all mutation logic and exports pure parsing/validation helpers for TDD. A separate bootstrap installer SHA-binds that helper and minimally registers one Host Action in the existing server-side executor and approval policy. Production installation/execution remains gated by typed one-time approval; no arbitrary root shell or generalized file patching is introduced.

**Tech Stack:** Node.js (`node:test`, `assert`, `fs`, `crypto`, `child_process`, `http`), systemd, existing PRHM Host Action v2 control-plane.

**Spec:** `docs/superpowers/specs/2026-09-15-readonly-bridge-repair-v1-design.md`

## Global Constraints

- Action name is exactly `readonly_bridge_repair_v1`.
- Fixed action only; no arbitrary path, command, service, host, or port input.
- Only `/etc/prhm-readonly-http.env`, `prhm-readonly-http.service` runtime state, and action-owned backup/result directories may be mutated.
- `prhm-recovery-agent.service` and `/etc/prhm-recovery-agent.env` must never be mutated.
- No database, firewall, DNS, Agent API config, or MCP config mutation.
- Never emit environment values or credentials.
- Apply must be bound to the exact preflight SHA-256 of `/etc/prhm-readonly-http.env`.
- Automatic rollback is mandatory for every failure after mutation.
- Production control-plane installation stops at Level-4 if current policy requires it; production action execution requires exact Level-3 confirmation `CONFIRM_LEVEL_3_PRODUCTION`.

---

### Task 1: Pure env transformation and fail-closed parser

**Files:**
- Create: `readonly-bridge-repair-v1.test.js`
- Create later after RED: `readonly-bridge-repair-v1.js`

**Interfaces:**
- Produces: `parseBridgeEnv(text) -> { key, port, lineIndex }`
- Produces: `rewriteBridgeEnv(text, expectedPort=8140, replacementPort=8141) -> string`
- Produces: `diffAllowed(before, after) -> boolean`

- [ ] **Step 1: Write failing tests** covering exactly-one numeric listen-port assignment, rejection of zero/multiple assignments, rejection when current port is not 8140, preservation of unrelated bytes, and exactly-one allowed change.
- [ ] **Step 2: Run** `node --test readonly-bridge-repair-v1.test.js` and confirm RED because module/functions do not exist.
- [ ] **Step 3: Implement minimal pure helpers** in `readonly-bridge-repair-v1.js` without any filesystem/systemd side effects.
- [ ] **Step 4: Run test** and confirm parser/transform tests PASS.
- [ ] **Step 5: Commit** `test/feat: define fail-closed readonly bridge env transform`.

### Task 2: Preflight model and secret-safe result shape

**Files:**
- Modify: `readonly-bridge-repair-v1.test.js`
- Modify: `readonly-bridge-repair-v1.js`

**Interfaces:**
- Produces: `validateEnvMetadata(stat) -> true|throws`
- Produces: `sanitizeResult(result) -> object`
- Produces: `buildPreflightReport(fields) -> secret-safe object`

- [ ] **Step 1: Add failing tests** for root ownership, exact mode 0600, regular non-symlink requirement, no raw env text/value in reports, and accepted metadata fields only.
- [ ] **Step 2: Run RED** and confirm failures are due to missing validation/report helpers.
- [ ] **Step 3: Implement minimum validation and sanitization**; no production calls yet.
- [ ] **Step 4: Run GREEN** with all tests.
- [ ] **Step 5: Commit** `feat: add readonly bridge preflight guards`.

### Task 3: Fixed runtime probes and health identity checks

**Files:**
- Modify: `readonly-bridge-repair-v1.test.js`
- Modify: `readonly-bridge-repair-v1.js`

**Interfaces:**
- Produces: `expectedEndpoints` constant fixed to Recovery `10.71.0.118:8140`, bridge candidate `8141`, Agent API `127.0.0.1:8099`, MCP `127.0.0.1:8123/8124/8125`.
- Produces: `identityOk(kind, healthJson) -> boolean`.

- [ ] **Step 1: Add failing tests** proving Recovery identity is accepted only for Recovery and rejected for bridge; bridge identity must be `prhm-readonly-http`; Agent API and MCP require `ok=true` and expected service identities.
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Implement fixed constants and identity validators** with no user inputs.
- [ ] **Step 4: Run GREEN**.
- [ ] **Step 5: Commit** `feat: bind readonly bridge repair health identities`.

### Task 4: Transaction, atomic write, backup, verify, rollback

**Files:**
- Modify: `readonly-bridge-repair-v1.test.js`
- Modify: `readonly-bridge-repair-v1.js`

**Interfaces:**
- Produces: `preflight(deps?)`
- Produces: `apply(deps?)`
- CLI accepts exactly one of `--preflight-only` or `--apply`.

- [ ] **Step 1: Add failing tests** using injected filesystem/systemctl/health dependencies to prove: preflight SHA binding; backup before mutation; only bridge service restart; Recovery never restarted; apply aborts on SHA drift; any failed post-check restores exact preimage; rollback restart is bridge-only; result flags database/DNS/firewall/Recovery mutations false.
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Implement transaction** using same-directory temp file + fsync + atomic rename, preserving uid/gid/mode and storing backup under `/var/backups/prhm-readonly-bridge-repair-v1/`.
- [ ] **Step 4: Implement production probes** only after testable orchestration passes: systemd unit contract check, Recovery health, 8141-free checks, Agent API/MCP health, bridge post-health, NRestarts 5-second stability sample.
- [ ] **Step 5: Run GREEN** and `node --check readonly-bridge-repair-v1.js`.
- [ ] **Step 6: Commit** `feat: implement rollback-safe readonly bridge repair`.

### Task 5: SHA-bound installer and typed Host Action registration

**Files:**
- Create: `bootstrap-host-actions-readonly-bridge-repair-v1.js`
- Create: `bootstrap-host-actions-readonly-bridge-repair-v1.test.js`

**Interfaces:**
- Installer fixed target helper path: `/opt/prhm-agent-selfmaint-exec/actions/readonly-bridge-repair-v1.js`.
- Installer must embed expected SHA-256 of repository helper bytes.
- Adds one action spec: `readonly_bridge_repair_v1` -> `host_action.readonly_bridge_repair_v1`.
- Adds one typed scope: tool `host_action_v2_apply`, project `control_plane`, environment `production`, action `readonly_bridge_repair_v1`, risk `high`, principal `mohammad`, role `mcp-operator`.

- [ ] **Step 1: Write failing installer tests** that fixture existing executor/policy source and assert exact-once anchors, helper SHA enforcement, Level 3/high policy, no generalized paths, no unrelated policy changes, rollback on partial install.
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Implement fixed installer** following existing atomic backup/replace patterns and rejecting baseline drift by exact SHA anchors.
- [ ] **Step 4: Run GREEN** and syntax checks for helper and installer.
- [ ] **Step 5: Commit** `feat: register readonly bridge repair host action`.

### Task 6: CI and repository review gate

**Files:**
- Create: `.github/workflows/readonly-bridge-repair-v1-ci.yml`

**Interfaces:**
- CI is read-only and must not target self-hosted production runners.

- [ ] **Step 1: Add workflow** using a GitHub-hosted Linux runner to execute `node --test readonly-bridge-repair-v1.test.js bootstrap-host-actions-readonly-bridge-repair-v1.test.js` and `node --check` for both production JS files.
- [ ] **Step 2: Verify workflow content contains no secrets, SSH, curl-to-production, systemctl, or deployment step.**
- [ ] **Step 3: Open a draft PR** from `feature/readonly-bridge-repair-v1` to `main` with explicit production non-mutation statement.
- [ ] **Step 4: Review PR diff** and ensure only spec/plan/helper/tests/installer/CI are changed.

### Task 7: Production preflight gate

**Files:** none in repo unless installer review requires corrections.

- [ ] **Step 1: Determine current control-plane installation policy level** for adding the new fixed action.
- [ ] **Step 2: If installation is Level 4, stop and request exact `CONFIRM_LEVEL_4_CRITICAL`; do not install.**
- [ ] **Step 3: If installation is Level 3 and covered by explicit current confirmation, create one-time typed request bound to installer SHA and exact action only.**
- [ ] **Step 4: After installation, run helper `--preflight-only` through fixed executor and record only redacted health/SHA metadata.**
- [ ] **Step 5: Stop before `--apply` unless a fresh, unexpired Level-3 typed request is bound to the exact helper/preflight hash.**

### Task 8: Production apply and closure

**Files:** no source changes expected.

- [ ] **Step 1: Execute only `readonly_bridge_repair_v1` using exact `CONFIRM_LEVEL_3_PRODUCTION` and one-time approval.**
- [ ] **Step 2: Verify bridge is active on 8141, Recovery stays healthy on 8140, Agent API/MCP health remains green, and NRestarts is stable.**
- [ ] **Step 3: Confirm backup path exists root-only and rollback was not performed on success.**
- [ ] **Step 4: Run final verification-before-completion checklist and report exact evidence; never call GREEN without all gates passing.**
