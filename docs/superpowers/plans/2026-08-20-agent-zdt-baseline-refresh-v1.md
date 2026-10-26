# Agent ZDT Baseline Refresh Host Action V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed Level-4 Host Actions v2 action that safely refreshes exactly five stale SHA bindings in the installed Agent ZDT bootstrap, then make that action available through the existing approval pipeline.

**Architecture:** A deterministic helper performs the one-file baseline refresh. A separate fixed installer registers that helper across Base, Executor, Approval Policy and MCP schema. Installation and execution are separate approval gates; neither path accepts arbitrary commands, paths or replacement values.

**Tech Stack:** Node.js CommonJS, `node:test`, systemd-run, existing PRHM Host Actions v2 and Approval Center.

**Spec:** `docs/superpowers/specs/2026-08-20-agent-zdt-baseline-refresh-v1-design.md`

## Global Constraints

- Production baseline refresh target is only `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js`.
- Exactly five SHA replacements are permitted.
- All nine live source hashes must match before and after the mutation.
- `agent_zdt_baseline_refresh_v1` is Level-4, one-time approval flow through `host_action_v2_apply`.
- Installer and helper expose no arbitrary path, command, SQL or SHA arguments.
- Any baseline drift, anchor mismatch, syntax failure, post-write mismatch or service failure must fail closed and roll back.
- The installer never executes the baseline refresh action.
- The baseline refresh action never executes the ZDT bootstrap.

---

### Task 1: Define failing contracts

**Files:**
- Create: `test-agent-zdt-baseline-refresh-host-action-v1.js`
- Create: `test-bootstrap-host-actions-v14-agent-zdt-baseline-refresh.js`

**Interfaces:**
- Consumes: approved design constants and current live hashes.
- Produces: regression contracts for helper and installer source.

- [x] Write tests requiring the helper and installer files and the exact action/paths/hash constants.
- [x] Run `node --test test-agent-zdt-baseline-refresh-host-action-v1.js test-bootstrap-host-actions-v14-agent-zdt-baseline-refresh.js`.
- [x] Confirm RED because the implementation files are absent.

### Task 2: Implement deterministic baseline refresh helper

**Files:**
- Create: `agent-zdt-baseline-refresh-v1.js`
- Test: `test-agent-zdt-baseline-refresh-host-action-v1.js`

**Interfaces:**
- Produces: zero-argument executable helper and result schema `prhm.host-action-result.v1`.

- [x] Pin target-before SHA and all nine current source SHAs.
- [x] Encode the exact five old/new replacement pairs.
- [x] Derive candidate in memory; syntax-check before write.
- [x] Backup and atomic-write target only.
- [x] Verify candidate SHA, replacement counts, source hashes and syntax after write.
- [x] Add automatic rollback after any post-mutation failure.
- [x] Run `node --check agent-zdt-baseline-refresh-v1.js`.

### Task 3: Implement fixed Host Actions v2 installer

**Files:**
- Create: `bootstrap-host-actions-v14-agent-zdt-baseline-refresh.js`
- Test: `test-bootstrap-host-actions-v14-agent-zdt-baseline-refresh.js`

**Interfaces:**
- Consumes: current four control-plane SHA baselines and helper bytes.
- Produces: `--preflight-only` and `--apply` installer modes.

- [x] Pin Base/Executor/Policy/MCP pre-install SHA values.
- [x] Add exact anchor patches for Base spec, Executor spec+dispatcher, Policy Level-4 scope and MCP enum.
- [x] Embed and hash-pin the helper bytes.
- [x] Validate all JS candidates with `node --check` and Policy with `JSON.parse` before write.
- [x] Backup four control-plane files; install helper; restart only approval/selfmaint/executor/MCP.
- [x] Verify exact post-install hashes and active services; rollback all five paths on failure.
- [x] Run `node --check bootstrap-host-actions-v14-agent-zdt-baseline-refresh.js`.

### Task 4: Verify branch implementation

**Files:**
- Verify: helper, installer and both test files.

- [x] Run syntax checks for helper and installer.
- [x] Run both `node:test` files.
- [x] Confirm 4 tests, 4 pass, 0 fail.
- [ ] Commit reviewed artifacts to `design/agent-zdt-baseline-refresh-v1`.
- [ ] Re-read committed files and confirm commit SHA/paths.
- [ ] Inspect GitHub check runs for the new commit.

### Task 5: Production installer preflight

**Files:**
- Deploy reviewed installer artifact only after repository verification.

- [ ] Confirm live four-file SHA baseline still equals the installer pins.
- [ ] Run installer with `--preflight-only` only.
- [ ] Require `preflight_only=true`, `production_mutation=false`, `baseline_match=true`.
- [ ] Do not apply if any preflight field fails.

### Task 6: Install action and execute separate approval gates

- [ ] Apply installer through the approved root deployment path.
- [ ] Verify four services active and MCP schema exposes `agent_zdt_baseline_refresh_v1`.
- [ ] Create a new Level-4 request for `agent_zdt_baseline_refresh_v1`.
- [ ] After explicit confirmation, execute once and verify 9/9 source hashes, 5 replacements, 0 unexpected changes, no rollback.
- [ ] Create a new Level-4 request for `agent_zero_downtime_bootstrap_v1`.
- [ ] After explicit confirmation, execute ZDT bootstrap and verify stable API/MCP public health.
