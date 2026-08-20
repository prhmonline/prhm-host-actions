# Honartik iTicket Host Action V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed no-input Host Actions v2 action that safely writes and verifies Honartik iTicket Dark Backend Batch 1 only in the isolated backend worktree.

**Architecture:** Reuse the existing `prhm-host-actions` bootstrap model. A V14 installer patches the Base registry, Executor registry/dispatch, MCP enum, and approval policy as one rollback-capable control-plane installation and installs a SHA-bound helper. The helper has a fixed Honartik worktree scope, no network, no DB, no deploy, and no token input.

**Tech Stack:** Node.js CommonJS bootstrap/helper, `node:test`, systemd-run sandboxing, GitHub, DeployHQ, PHP CLI for server-side Batch 1 verification.

**Spec:** `docs/superpowers/specs/2026-08-20-honartik-iticket-host-action-design.md`

## Global Constraints

- Develop from GitHub `main` SHA `1ce3714fbc3c531f3d0a04153bdcccdf8599614f` on branch `design/honartik-iticket-host-action-v1`.
- Action name is exactly `honartik_iticket_dark_backend_batch1_v1`.
- No arbitrary command, path, SQL, URL, token, or file-content input.
- No DeployHQ deployment during implementation.
- No database mutation, Honartik production application-tree mutation, external iTicket request, or real token read.
- Front worktree remains clean at HEAD `ecd3bfce8790b5cb3d32afbfbf45bc39839dba62`.
- Back worktree starts clean at HEAD `54d8038a64ce64e78c84dfeaffbb4cca36446108`.
- Control-plane installation is SHA-bound to the baselines in the spec and rolls back all touched control-plane files on failure.

---

### Task 1: Fixed Batch 1 helper contract

**Files:**
- Create: `honartik-iticket-dark-backend-batch1-v1.js`
- Test: `test-v14-honartik-iticket-dark-backend-batch1.js`

**Interfaces:**
- Consumes: no user input; fixed production/worktree paths and SHAs from the spec.
- Produces: `/var/lib/prhm-agent-selfmaint-exec/honartik-iticket-dark-backend-batch1-v1/latest.json` using `prhm.host-action-result.v1`.

- [ ] **Step 1: Write the failing helper source-contract test**

```js
assert.match(helper, /honartik_iticket_dark_backend_batch1_v1/);
assert.match(helper, /ecd3bfce8790b5cb3d32afbfbf45bc39839dba62/);
assert.match(helper, /54d8038a64ce64e78c84dfeaffbb4cca36446108/);
assert.match(helper, /ITICKET_DARK_GATE_TEST=PASS/);
for (const token of ['database_mutation:false','deploy:false','external_network:false','token_read:false','git_metadata_mutation:false']) {
  assert.match(helper.replace(/\s+/g,''), new RegExp(token));
}
```

- [ ] **Step 2: Verify RED**

```bash
node --test test-v14-honartik-iticket-dark-backend-batch1.js
```

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Implement the minimal fixed helper**

Use fixed constants for both production roots, both isolated worktrees, branch `feature/iticket-dark-v1`, both fixed SHAs, and the three embedded PHP payloads. Implement fixed-argument Git reads, clean-state verification, atomic `wx` file creation, PHP lint, `DarkGateTest.php`, exact backend worktree diff verification, production overlay before/after verification, and rollback that removes only files written by the current invocation.

Successful result shape:

```js
{
  ok: true,
  schema_version: 'prhm.host-action-result.v1',
  action: 'honartik_iticket_dark_backend_batch1_v1',
  test_marker: 'ITICKET_DARK_GATE_TEST=PASS',
  production_application_tree_mutation: false,
  worktree_application_mutation: true,
  git_metadata_mutation: false,
  database_mutation: false,
  deploy: false,
  external_network: false,
  token_read: false
}
```

- [ ] **Step 4: Verify GREEN**

```bash
node --check honartik-iticket-dark-backend-batch1-v1.js
node --test test-v14-honartik-iticket-dark-backend-batch1.js
```

Expected: PASS.

### Task 2: V14 bootstrap registration and rollback

**Files:**
- Create: `bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js`
- Modify: `test-v14-honartik-iticket-dark-backend-batch1.js`

**Interfaces:**
- Consumes: helper bytes and exact live baseline SHA-256 values from the spec.
- Produces: a fixed installation in Base, Executor, MCP plugin, approval policy, and Executor actions directory.

- [ ] **Step 1: Add bootstrap RED assertions**

Assert the bootstrap contains all four baseline SHAs, the exact embedded helper hash, `--preflight-only`, a timestamped `/var/backups/prhm-host-actions-v14-honartik-iticket-...` backup, atomic writes, rollback verification, and exact bindings for Base operation, Executor kind, MCP enum, policy level 4, `host_action_v2_apply`, and principal `mohammad`/`mcp-operator`.

Run the test and expect FAIL because the bootstrap does not exist.

- [ ] **Step 2: Implement baseline preflight and backup**

Verify these exact live SHAs before mutation:

```text
Base     b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877
Executor 5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad
MCP      ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34
Policy   c56f3f7c35e6ac22735f0689371e8ca4a7de6f8c375436a456798f8df0b7596a
```

Before first write, copy all existing touched files to the V14 backup directory with mode `0600`, and record whether the helper existed.

- [ ] **Step 3: Implement deterministic patch functions**

```js
patchBase(source)
patchExecutor(source)
patchMcp(source)
patchPolicy(jsonText)
```

Each function fails if its anchor is missing or the action is in an unexpected partial state. `patchPolicy` sets version `2026-08-20.1-honartik-iticket-dark-backend-batch1-v1` and adds exactly one operation and one typed scope. `patchExecutor` sets health version `1.12.5-host-actions-v2-honartik-iticket-dark-backend-batch1`, registers the action, adds the fixed `systemd-run` apply function with `RestrictAddressFamilies=AF_UNIX`, and validates the result booleans.

- [ ] **Step 4: Implement atomic install, health verification, and rollback**

Install helper first, then Base/Executor/MCP/Policy using temporary-file rename. Validate Node syntax and policy JSON before service restart. Restart only:

```text
prhm-company-approval.service
prhm-agent-selfmaint.service
prhm-agent-selfmaint-exec.service
prhm-agent-mcp.service
```

After restart, verify health and action visibility. On any post-mutation exception, restore backups, remove a newly created helper when appropriate, restart services, and verify original SHAs.

- [ ] **Step 5: Verify bootstrap GREEN**

```bash
node --check bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js
node --check honartik-iticket-dark-backend-batch1-v1.js
node --test test-v14-honartik-iticket-dark-backend-batch1.js
```

Expected: PASS.

### Task 3: Preflight-only and side-effect regression coverage

**Files:**
- Modify: `test-v14-honartik-iticket-dark-backend-batch1.js`

**Interfaces:**
- Consumes: bootstrap/helper source.
- Produces: regression evidence that preflight is non-mutating and runtime scope stays dark.

- [ ] **Step 1: Assert preflight and mutation ordering**

```js
assert.match(bootstrap, /--preflight-only/);
assert.match(bootstrap, /rollback/i);
```

Also structurally assert backup is completed before production writes and `--preflight-only` exits before installation writes/restarts.

- [ ] **Step 2: Assert secret/network prohibition**

Assert helper/bootstrap accept no token argument, executor patch includes `RestrictAddressFamilies=AF_UNIX`, PHP payload expects `X-Api-Access-Token`, and PHP payload constructs no `Authorization` header.

- [ ] **Step 3: Run complete V14 verification**

```bash
node --check bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js
node --check honartik-iticket-dark-backend-batch1-v1.js
node --check test-v14-honartik-iticket-dark-backend-batch1.js
node --test test-v14-honartik-iticket-dark-backend-batch1.js
```

Expected: all PASS.

### Task 4: Review branch and draft PR

**Files:**
- GitHub branch only: `design/honartik-iticket-host-action-v1`.

**Interfaces:**
- Consumes: verified spec, plan, helper, bootstrap, tests.
- Produces: draft PR to `main`; no DeployHQ execution.

- [ ] **Step 1: Re-pin `main` and compare branch**

Verify branch ancestry against `1ce3714fbc3c531f3d0a04153bdcccdf8599614f`; if `main` advanced, review/rebase instead of force-overwriting unrelated changes.

- [ ] **Step 2: Run final verification**

Repeat the complete Task 3 command set and record branch tip SHA.

- [ ] **Step 3: Open draft PR**

Title: `feat: add fixed Honartik iTicket dark backend Host Action`

Body must state: no production deployment yet; Level-4 install remains a separate gate; Batch 1 writes only the isolated backend worktree; no DB/token/network mutation.

- [ ] **Step 4: Stop before DeployHQ**

Do not queue a DeployHQ deployment. Production installation begins only after code review and a separate explicit approval.
