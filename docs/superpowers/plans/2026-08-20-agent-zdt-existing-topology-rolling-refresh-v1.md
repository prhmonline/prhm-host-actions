# Agent ZDT Existing-Topology Rolling Refresh V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fixed Level-4 Host Actions v2 rolling refresh that safely refreshes existing API and MCP Blue/Green topology without assuming candidate ports are free.

**Architecture:** Reuse the proven MCP Blue/Green rolling contract but make slot direction active-pointer aware and add an independent API lane. API applies first; MCP applies second only after API success. Each lane preserves its old backend as rollback capacity and uses pointer-first rollback.

**Tech Stack:** Node.js/CommonJS, `node:test`, systemd transient units, existing PRHM ZDT router/state files, Host Actions v2 approval architecture.

**Spec:** `docs/superpowers/specs/2026-08-20-agent-zdt-existing-topology-rolling-refresh-v1-design.md`

## Global Constraints

- Action name: `agent_zdt_existing_topology_rolling_refresh_v1`.
- No arbitrary path, command, service, port, SHA, token or environment input.
- API ports are fixed to public `8099`, Blue `8100`, Green `8102`, Legacy `8110`.
- MCP ports are fixed to public `8123`, Blue `8124`, Green `8125`, Legacy `8130`.
- Port `8101` is reserved and must never be touched.
- API and MCP pointer files are fixed to `/var/lib/prhm-agent-zdt/api-active` and `/var/lib/prhm-agent-zdt/mcp-active`.
- Router services must never be restarted/reloaded by this action.
- Legacy API/MCP services must never be stopped/restarted by this action.
- Database, site, SEO and application data mutation are prohibited.
- API lane runs before MCP lane; API failure prevents MCP mutation.
- Automatic rollback restores pointer first, then candidate pre-state.
- Old serving backend remains running through apply and finalize.
- Every Production mutation requires a fresh Level-4 approval request and explicit confirmation.

---

### Task 1: Define the active-aware lane contract with failing tests

**Files:**
- Create: `test-agent-zdt-existing-topology-rolling-refresh-v1.js`
- Future implementation: `agent-zdt-existing-topology-rolling-refresh-v1.js`

**Interfaces:**
- Consumes: fixed API/MCP topology constants from the approved spec.
- Produces: contract expectations for `laneFor()`, `candidateFor()`, `preflight()`, `runApply()`, `runRollback()`, `runFinalize()` and `parseMode()`.

- [ ] **Step 1: Write tests for fixed topology and CLI modes**

Require the implementation and assert:

```js
for (const mode of ['--preflight-only','--apply','--rollback','--finalize']) {
  assert.equal(parseMode([mode]), mode);
}
assert.deepEqual(PORTS.api, { public:8099, blue:8100, green:8102, legacy:8110 });
assert.deepEqual(PORTS.mcp, { public:8123, blue:8124, green:8125, legacy:8130 });
assert.equal(JSON.stringify(PORTS).includes('8101'), false);
```

- [ ] **Step 2: Write direction-selection tests**

Use a fake adapter and assert:

```js
assert.equal(candidateFor('api', 8100), 8102);
assert.equal(candidateFor('api', 8102), 8100);
assert.equal(candidateFor('mcp', 8124), 8125);
assert.equal(candidateFor('mcp', 8125), 8124);
assert.throws(() => candidateFor('api', 8110), /active_pointer_not_blue_green/);
```

- [ ] **Step 3: Write preflight fail-closed tests**

Cover malformed pointer, symlink pointer, source SHA drift, router inactive, public health/ready failure, active health/ready failure, missing legacy listener, unsafe candidate unit contract and any `8101` reference.

- [ ] **Step 4: Run RED test**

Run:

```bash
/usr/local/bin/prhm-node --test test-agent-zdt-existing-topology-rolling-refresh-v1.js
```

Expected: FAIL because `agent-zdt-existing-topology-rolling-refresh-v1.js` does not exist.

- [ ] **Step 5: Commit the RED contract**

```bash
git add test-agent-zdt-existing-topology-rolling-refresh-v1.js
git commit -m "test: define existing-topology ZDT rolling contract"
```

### Task 2: Implement read-only topology detection and preflight

**Files:**
- Create: `agent-zdt-existing-topology-rolling-refresh-v1.js`
- Test: `test-agent-zdt-existing-topology-rolling-refresh-v1.js`

**Interfaces:**
- Produces: `PORTS`, `PATHS`, `UNITS`, `candidateFor(kind, activePort)`, `preflight(adapter)`, `parseMode(argv)`.
- `preflight()` returns `{ok, action, preflight_only, production_mutation, api, mcp, reserved_8101_untouched, apply_ready}`.

- [ ] **Step 1: Implement fixed lane definitions**

Define immutable API and MCP topology plus fixed pointer, router and backup paths. Reject every pointer outside each lane's Blue/Green set.

- [ ] **Step 2: Implement safe pointer inspection**

Read pointer only when it is a regular non-symlink file. Preserve raw bytes and file metadata for later exact rollback.

- [ ] **Step 3: Implement source/unit topology inspection**

Pin reviewed SHA identities for router/helper/source files and verify router/Blue/Green unit `ExecStart`, load state and fixed port contracts. Do not inspect or emit environment values.

- [ ] **Step 4: Implement endpoint checks**

Require public and active backend `/health` and `/ready`. Record candidate active/enabled state without mutating it. Require legacy listener presence.

- [ ] **Step 5: Run tests**

```bash
/usr/local/bin/prhm-node --check agent-zdt-existing-topology-rolling-refresh-v1.js
/usr/local/bin/prhm-node --test test-agent-zdt-existing-topology-rolling-refresh-v1.js
```

Expected: PASS for preflight/direction tests and zero mutation calls in preflight.

- [ ] **Step 6: Commit**

```bash
git add agent-zdt-existing-topology-rolling-refresh-v1.js test-agent-zdt-existing-topology-rolling-refresh-v1.js
git commit -m "feat: add active-aware ZDT topology preflight"
```

### Task 3: Implement one-lane apply and pointer-first automatic rollback

**Files:**
- Modify: `agent-zdt-existing-topology-rolling-refresh-v1.js`
- Modify: `test-agent-zdt-existing-topology-rolling-refresh-v1.js`

**Interfaces:**
- Produces: `applyLane(kind, adapter, preflightState)` and `rollbackLane(kind, adapter, evidence)`.

- [ ] **Step 1: Add failing API Blue->Green and Green->Blue apply tests**

Expected call order:

```js
['captureLaneState','restartCandidate','candidateHealth','candidateReady','assertPointerUnchanged','switchPointer','publicHealth','publicReady','persistLaneApply']
```

Assert only candidate unit is restarted and old active unit remains running.

- [ ] **Step 2: Add failing rollback-order test**

Force public health failure after pointer switch and assert rollback order begins with:

```js
['restorePointer','publicHealth','publicReady','restoreCandidatePrestate']
```

- [ ] **Step 3: Implement exact pre-state capture**

Persist pointer bytes/mode/uid/gid, active/candidate ports, candidate active/enabled state, source SHA evidence and action timestamp before candidate mutation.

- [ ] **Step 4: Implement candidate refresh and atomic cutover**

Start/restart only the opposite slot; require `/health` and `/ready`; revalidate unchanged pointer; write candidate port atomically using fsync-backed temporary file and directory fsync.

- [ ] **Step 5: Implement automatic rollback**

On every post-mutation failure, restore saved pointer bytes first, require public health/ready, then restore candidate active/enabled pre-state and persist failure evidence.

- [ ] **Step 6: Run tests and commit**

```bash
/usr/local/bin/prhm-node --test test-agent-zdt-existing-topology-rolling-refresh-v1.js
git add agent-zdt-existing-topology-rolling-refresh-v1.js test-agent-zdt-existing-topology-rolling-refresh-v1.js
git commit -m "feat: add lane cutover and rollback"
```

### Task 4: Implement sequential API-then-MCP orchestration

**Files:**
- Modify: `agent-zdt-existing-topology-rolling-refresh-v1.js`
- Modify: `test-agent-zdt-existing-topology-rolling-refresh-v1.js`

**Interfaces:**
- Produces: `runApply(adapter)` with independent `api` and `mcp` lane evidence.

- [ ] **Step 1: Add failing sequencing tests**

Assert API completes before the first MCP mutation. Assert API failure produces zero MCP mutation calls.

- [ ] **Step 2: Add MCP-failure partial-success test**

Simulate successful API cutover and MCP post-cutover failure. Assert MCP rolls back while API remains applied, and result records:

```js
{
  api: { status:'applied' },
  mcp: { status:'rolled_back' },
  partial_success:true
}
```

- [ ] **Step 3: Implement orchestration**

Re-run lane preflight immediately before each lane. After API apply, re-check public API health/ready before starting MCP. Never automatically roll back a healthy applied API lane because MCP failed.

- [ ] **Step 4: Run tests and commit**

```bash
/usr/local/bin/prhm-node --test test-agent-zdt-existing-topology-rolling-refresh-v1.js
git add agent-zdt-existing-topology-rolling-refresh-v1.js test-agent-zdt-existing-topology-rolling-refresh-v1.js
git commit -m "feat: sequence API and MCP rolling refresh"
```

### Task 5: Implement explicit rollback and finalize

**Files:**
- Modify: `agent-zdt-existing-topology-rolling-refresh-v1.js`
- Modify: `test-agent-zdt-existing-topology-rolling-refresh-v1.js`

**Interfaces:**
- Produces: `runRollback(adapter)`, `runFinalize(adapter)`.

- [ ] **Step 1: Add evidence-validation tests**

Reject missing, finalized, already-rolled-back, source-drifted or pointer-drifted evidence.

- [ ] **Step 2: Implement explicit rollback**

For each applied non-finalized lane, restore pointer first, verify public endpoint, restore candidate pre-state, persist lane rollback. Support partial-success evidence safely.

- [ ] **Step 3: Implement finalize**

Require pointer still targets candidate and public/candidate health/ready pass. Enable new active slot, disable old slot from boot-time enablement, do not stop old slot, then persist finalized evidence.

- [ ] **Step 4: Add no-router/no-legacy mutation assertions**

Search the implementation/test contract and assert there is no `restart` or `stop` path for router or legacy units and no state mutation containing `8101`.

- [ ] **Step 5: Run tests and commit**

```bash
/usr/local/bin/prhm-node --check agent-zdt-existing-topology-rolling-refresh-v1.js
/usr/local/bin/prhm-node --test test-agent-zdt-existing-topology-rolling-refresh-v1.js
git add agent-zdt-existing-topology-rolling-refresh-v1.js test-agent-zdt-existing-topology-rolling-refresh-v1.js
git commit -m "feat: add ZDT rollback and finalize phases"
```

### Task 6: Add fixed Host Actions v2 installer integration

**Files:**
- Create: `bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js`
- Create: `test-bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js`

**Interfaces:**
- Consumes: fixed helper file and current reviewed live four-layer Control Plane SHA identities.
- Produces: installer that registers exactly `agent_zdt_existing_topology_rolling_refresh_v1` in MCP enum, Base spec, Executor spec/dispatcher and Approval Policy Level 4.

- [ ] **Step 1: Write RED installer contract test**

Assert the installer has fixed target paths, exact expected live SHA preconditions, fixed helper SHA, Level-4 policy registration and no arbitrary arguments.

- [ ] **Step 2: Run RED test**

```bash
/usr/local/bin/prhm-node --test test-bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js
```

Expected: FAIL because installer is absent.

- [ ] **Step 3: Implement installer**

Use exact-anchor, exact-count replacements with backups and atomic writes across:

- `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`
- `/opt/prhm-agent-selfmaint/server.js`
- `/opt/prhm-agent-selfmaint-exec/server.js`
- `/opt/prhm-company-control-plane/config/approval-policy.json`

Install the fixed helper under `/opt/prhm-agent-selfmaint-exec/actions/`. On any failure, restore all changed files and helper state exactly.

- [ ] **Step 4: Validate post-install identities**

Require syntax checks, expected new SHA identities, action presence exactly once per registry/policy location, Level-4 policy, healthy Base/Executor/MCP services, and secret-free result evidence.

- [ ] **Step 5: Run tests and commit**

```bash
/usr/local/bin/prhm-node --check bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js
/usr/local/bin/prhm-node --test test-bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js
git add bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js test-bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js
git commit -m "feat: add existing-topology ZDT Host Action installer"
```

### Task 7: Full branch verification

**Files:**
- Verify all files created by Tasks 1-6.

**Interfaces:**
- Produces: reviewable commit SHA and test evidence for Production preflight.

- [ ] **Step 1: Run syntax checks**

```bash
/usr/local/bin/prhm-node --check agent-zdt-existing-topology-rolling-refresh-v1.js
/usr/local/bin/prhm-node --check bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js
```

- [ ] **Step 2: Run focused tests**

```bash
/usr/local/bin/prhm-node --test test-agent-zdt-existing-topology-rolling-refresh-v1.js
/usr/local/bin/prhm-node --test test-bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js
```

Expected: all tests PASS.

- [ ] **Step 3: Scan forbidden behavior**

Verify no arbitrary command/path/port inputs, no router restart/reload, no legacy stop/restart, no `8101` candidate use, and no secret/env-value logging.

- [ ] **Step 4: Record branch HEAD and file SHA-256 values**

Record commit SHA plus helper/installer/test SHA-256 values for the Production preflight gate.

### Task 8: Production read-only preflight

**Files:**
- Deploy/execute commit-pinned reviewed helper in preflight-only mode through the approved read-only/staged execution mechanism.

**Interfaces:**
- Produces: live topology evidence; no Production mutation.

- [ ] **Step 1: Re-check live four-layer and helper source SHA identities**

If any baseline drift exists, stop and review the drift; do not automatically accept new hashes.

- [ ] **Step 2: Execute only `--preflight-only`**

Expected result includes:

```text
ok=true
preflight_only=true
production_mutation=false
reserved_8101_untouched=true
api.current_backend=<8100|8102>
api.candidate_backend=<opposite>
mcp.current_backend=<8124|8125>
mcp.candidate_backend=<opposite>
apply_ready=true
```

- [ ] **Step 3: Verify no mutation**

Confirm service start timestamps, pointer metadata/content, router state and application/database state are unchanged.

### Task 9: Install and expose the fixed Host Action

**Files:**
- Use the reviewed installer artifact only after its Production preflight passes.

**Interfaces:**
- Produces: exposed Host Actions v2 enum entry and Level-4 request path.

- [ ] **Step 1: Create a fresh installer Level-4 request**

Do not reuse an expired or consumed request.

- [ ] **Step 2: Apply only after explicit `CONFIRM_LEVEL_4_CRITICAL`**

Verify automatic rollback evidence on any failure.

- [ ] **Step 3: Re-discover MCP schema**

Require `agent_zdt_existing_topology_rolling_refresh_v1` to appear in the exposed `host_action_v2_request` enum before proceeding.

### Task 10: Execute rolling refresh through approval gates

**Files:**
- No repository changes; server-side fixed action only.

**Interfaces:**
- Produces: applied evidence, then a separately approved finalize/rollback decision.

- [ ] **Step 1: Create a fresh Level-4 request for the rolling action**

- [ ] **Step 2: Apply only after explicit user confirmation**

- [ ] **Step 3: Read persisted result and public health evidence**

Require both public endpoints healthy/ready and verify old backends remain available.

- [ ] **Step 4: Do not auto-finalize**

Present applied state and rollback window. Finalize or explicit rollback is a separate Level-4 decision.


## Plan Amendment — Phase-Specific Host Actions

Task 6 is amended so the installer registers three independent fixed Level-4 actions rather than one multi-mode action:

1. `agent_zdt_existing_topology_rolling_refresh_v1` → fixed helper mode `--apply`.
2. `agent_zdt_existing_topology_rolling_refresh_rollback_v1` → fixed helper mode `--rollback`.
3. `agent_zdt_existing_topology_rolling_refresh_finalize_v1` → fixed helper mode `--finalize`.

The shared helper remains `agent-zdt-existing-topology-rolling-refresh-v1.js`. The MCP enum, Base registry, Executor registry/dispatcher, approval-policy operations, and typed scopes must contain all three actions exactly once. No caller-controlled phase or mode is accepted. `--preflight-only` remains read-only and is executed separately before any Level-4 request.
