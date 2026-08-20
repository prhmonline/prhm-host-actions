# Agent MCP Blue Rolling Refresh V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely load Source Mapping Compat V4.1 into the non-serving Blue MCP slot, cut public traffic from Green 8125 to Blue 8124 only after health/ready PASS, and preserve Green as rollback backend.

**Architecture:** Start from the proven Blue Refresh V1 role direction and Green Rolling Refresh V2 source-state/rollback contract. Preflight accepts exact V4 on-disk as prepatch and exact V4.1 as ready; apply refuses V4 before any mutation, restarts only Blue, then atomically switches the pointer.

**Tech Stack:** Node.js, systemd, fixed MCP Blue/Green ports, atomic pointer file, SHA-256 pinned source identities.

**Spec:** Source Mapping Compat V4.1 PR #38 and the approved rolling-slot safety contract already used by Agent MCP Green Rolling Refresh V2.

## Global Constraints
- Public router remains 8123; no Router restart/reload.
- Current serving backend must be Green 8125.
- Candidate backend is Blue 8124.
- Blue is the only backend allowed to restart during apply.
- Green must remain active as fallback.
- Apply requires exact V4.1 safeFiles SHA `2f4cedb73d58bff927e09e8d0b534a08cf49f08b3e5da54f47900f57d8a5f910`.
- Preflight may accept exact V4 SHA `22dfb51356b3a89d0b6150b6e67e10ebc5464fb66cb67c9e2a75cb6d2e521481` only as `v4_prepatch`, with `apply_ready=false`.
- No Agent API or database mutation.
- Rollback restores pointer first, then exact Blue pre-state.
- Finalize enables Blue and disables Green without stopping either backend.

---

### Task 1: TDD contract
**Files:** Create `test-agent-mcp-blue-rolling-refresh-v2.js`.
- [ ] Write tests for four modes, hard-bound identities, V4 prepatch, V4.1 ready, apply fail-closed, Blue-only restart, automatic rollback, explicit rollback, finalize, atomic state and redaction.
- [ ] Run `node --test test-agent-mcp-blue-rolling-refresh-v2.js`; expected RED because implementation is absent.
- [ ] Commit RED.

### Task 2: Minimal bootstrap
**Files:** Create `bootstrap-agent-mcp-blue-rolling-refresh-v2.js`.
- [ ] Implement V4/V4.1 source-state validation.
- [ ] Require current pointer Green and exact current topology.
- [ ] Apply: capture pre-state → restart Blue → Blue health/ready → atomic pointer 8125→8124 → Public health/ready.
- [ ] Automatic rollback: pointer-first restore, then exact Blue active/enabled pre-state.
- [ ] Finalize: enable Blue, disable Green, stop neither.
- [ ] Run syntax check and full tests; expected GREEN.
- [ ] Commit GREEN.

### Task 3: Verification and live preflight
- [ ] Re-fetch exact branch bytes from GitHub and rerun tests.
- [ ] Record SHA-256 and byte count of bootstrap.
- [ ] Open Draft PR.
- [ ] Run commit-pinned `--preflight-only` on Production without file transfer. Expected before V4.1 patch: `source_state=v4_prepatch`, `source_patch_required=true`, `apply_ready=false`, current_backend=8125, candidate_backend=8124.
- [ ] Restore reusable DeployHQ command exactly to `true`.
