# Honartik iTicket V14 Read-Only Preflight Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a fixed zero-input Agent/MCP adapter that invokes only the merged Bootstrap V14 `preflight()` logic and returns bounded read-only evidence without installing or registering the iTicket mutation action.

**Architecture:** A dedicated Agent API route module SHA-verifies and loads the exact merged V14 bootstrap under a restricted CommonJS capability facade, then calls only its exported `preflight()`. A V14.1 installer writes the pinned payload, route module, and a dedicated MCP plugin, patches the current Agent API wrapper and MCP core registry, and restarts only Agent API/MCP with rollback. `hostActionsV2.js` stays byte-for-byte unchanged because V14 preflight pins its SHA. The MCP tool has an empty input schema and calls only the fixed Agent API route.

**Tech Stack:** Node.js/CommonJS, Express-style Agent API routes, MCP plugin/Zod conventions, `node:test`, SHA-256 binding, systemd service health checks.

**Spec:** `docs/superpowers/specs/2026-08-20-honartik-iticket-v14-preflight-design.md`

## Global Constraints

> Baseline refresh 2026-08-20: live V14 control-plane SHAs now bind Base `85229ccd95e98523e9d87468df1fcaec4107c6834f5c4e0bc108b265a0a499cf`, Executor `6bd9c56b4d5889c1d70d8278bcd66f48cab9561f2429cd3489a5b42ab1bbc35f`, MCP `7efeeb17253bc52aeac1f362c377fd4121984f49f159fd9e72ae7e06897ded56`, and Approval Policy `0e0b0c3b605e7aeadfe0b7cb51bfeb2db4c60de34bce956bbce0053cb5ecd5a9`. Refreshed V14 payload SHA is `1cd8e33bdecaa2ebffc086c778e7938cb33b57b31e6abab21a183972259a0059`. This refresh changes bindings only, not behavior.

- Pinned merged V14 source commit: `1ecd932451d7464e354419b67f2c605d93135854`.
- Pinned V14 payload SHA-256: `1cd8e33bdecaa2ebffc086c778e7938cb33b57b31e6abab21a183972259a0059`.
- Live Agent API baseline SHA-256 at plan time: `70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c`.
- Live MCP `hostActionsV2.js` immutable V14 baseline SHA-256: `7efeeb17253bc52aeac1f362c377fd4121984f49f159fd9e72ae7e06897ded56`; the adapter must never modify this file.
- Live MCP registry `/home/agent/ssh-mcp-server/src/core/registry.js` baseline SHA-256 at plan correction time: `cf3681ca4d4632156df2f77886afe59c07da9a86dbcb68f4217577f811b22231`.
- New MCP tool name: `honartik_iticket_v14_preflight_readonly`.
- Agent API route: `POST /honartik/iticket/v14/preflight`.
- The public tool accepts zero arguments and the Agent route rejects any request-body key.
- Runtime preflight may read only the pinned V14 payload, the V14 control-plane baseline files/journal/backups required by `preflight()`, and the fixed Honartik production/worktree Git metadata required by V14.
- Runtime child process access is limited to `/usr/bin/git` with the exact V14 read commands: `rev-parse HEAD`, `branch --show-current`, and `status --porcelain=v1 --untracked-files=all` against the four pinned Honartik roots/targets.
- Runtime `execFileSync`, filesystem write methods, HTTP/network requests, arbitrary commands, arbitrary paths, caller-provided refs, environment reads, token reads, database access, deploys, and service control are denied.
- Adapter installation must not modify Host Actions Base, Executor, Approval Policy, or `src/plugins/hostActionsV2.js`, and must not register `honartik_iticket_dark_backend_batch1_v1`.
- The zero-input tool is registered by a dedicated ESM plugin `src/plugins/honartikIticketPreflight.js` imported and invoked by `src/core/registry.js`; the plugin calls Agent API with the existing `agent.callAgent()` pattern.
- Installation restarts only `prhm-agent-api.service` and `prhm-agent-mcp.service`; any failure rolls back both modified baseline files (Agent API server + MCP registry) and removes all three new files (Agent route + MCP plugin + V14 payload).
- No DeployHQ `preview` mode is used as a safety boundary.

---

### Task 1: Define the Zero-Input Runtime Contract and Restricted V14 Loader

**Files:**
- Create: `test-v14-1-honartik-iticket-v14-preflight-readonly.js`
- Create: `honartik-iticket-v14-preflight-readonly-routes.js`
- Create: `honartik-iticket-v14-preflight-mcp.js`

**Interfaces:**
- Produces: `registerHonartikIticketV14PreflightRoutes(app, { auth })`.
- Produces: `registerHonartikIticketPreflightPlugin(mcp, { agent })`, a zero-input MCP tool that calls only `agent.callAgent('/honartik/iticket/v14/preflight','POST',{})`.
- Produces: internal `runPinnedPreflight()` returning validated `prhm.host-action-install-preflight.v1` JSON.
- Consumes: exact payload path `/opt/prhm-agent-readonly-actions/honartik-iticket-v14-preflight.js` and SHA `1cd8e33bdecaa2ebffc086c778e7938cb33b57b31e6abab21a183972259a0059`.

- [ ] **Step 1: Write failing runtime contract tests**

The test must require the route module and assert:

```js
const route = require('./honartik-iticket-v14-preflight-readonly-routes.js');
assert.equal(typeof route.registerHonartikIticketV14PreflightRoutes, 'function');
assert.equal(route.TOOL, 'honartik_iticket_v14_preflight_readonly');
assert.equal(route.ROUTE, '/honartik/iticket/v14/preflight');
assert.equal(route.V14_SHA, '1cd8e33bdecaa2ebffc086c778e7938cb33b57b31e6abab21a183972259a0059');
```

Also assert from source/exports that the runtime has no generic command/path/ref argument, exports no mutation function, denies `node:http`/`node:https`/`node:net`, and the route rejects any body key before calling the runner.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test-v14-1-honartik-iticket-v14-preflight-readonly.js
```

Expected: FAIL because `honartik-iticket-v14-preflight-readonly-routes.js` does not exist.

- [ ] **Step 3: Implement the minimal route module**

Implement constants:

```js
const TOOL='honartik_iticket_v14_preflight_readonly';
const ROUTE='/honartik/iticket/v14/preflight';
const V14_PAYLOAD='/opt/prhm-agent-readonly-actions/honartik-iticket-v14-preflight.js';
const V14_SHA='1cd8e33bdecaa2ebffc086c778e7938cb33b57b31e6abab21a183972259a0059';
```

`runPinnedPreflight()` must SHA-check the payload before compilation, temporarily intercept `Module._load`, provide a read-only `fs` proxy, a Git-only `child_process.spawnSync`, deny network modules, compile the payload with `require.main !== module`, restore `Module._load`, require an exported `preflight` function, call it, and validate the result safety flags before returning it.

`registerHonartikIticketV14PreflightRoutes(app,{auth})` must register only:

```js
app.post('/honartik/iticket/v14/preflight', auth, async (req,res) => { ... });
```

and reject any request body whose key count is non-zero.

- [ ] **Step 4: Run GREEN for runtime contract**

Run:

```bash
node --check honartik-iticket-v14-preflight-readonly-routes.js
node --test test-v14-1-honartik-iticket-v14-preflight-readonly.js
```

Expected: runtime contract tests PASS while installer-specific tests remain absent/not yet asserted.

- [ ] **Step 5: Commit runtime module + tests**

```bash
git add honartik-iticket-v14-preflight-readonly-routes.js test-v14-1-honartik-iticket-v14-preflight-readonly.js
git commit -m "feat: add iTicket V14 read-only preflight runtime"
```

### Task 2: Build the SHA-Bound V14.1 Installer

**Files:**
- Create: `bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js`
- Modify: `test-v14-1-honartik-iticket-v14-preflight-readonly.js`
- Verify immutable: `src/plugins/hostActionsV2.js` remains SHA `7efeeb17253bc52aeac1f362c377fd4121984f49f159fd9e72ae7e06897ded56`

**Interfaces:**
- Produces: `patchAgentServer(source)`, `patchRegistry(source)`, `preflight()`, and `install()`.
- Installs exact MCP plugin bytes to `/home/agent/ssh-mcp-server/src/plugins/honartikIticketPreflight.js`.
- Installs exact route module bytes to `/home/agent/ssh-agent-api/honartikIticketV14PreflightRoutes.js`.
- Installs exact V14 bytes to `/opt/prhm-agent-readonly-actions/honartik-iticket-v14-preflight.js`.
- Modifies only `/home/agent/ssh-agent-api/server.js` and `/home/agent/ssh-mcp-server/src/core/registry.js`; `hostActionsV2.js` is verified but never written.

- [ ] **Step 1: Extend tests first for installer behavior**

Add failing assertions that:

```js
assert.equal(installer.EXPECTED.agentServer, '70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c');
assert.equal(installer.EXPECTED.registry, 'cf3681ca4d4632156df2f77886afe59c07da9a86dbcb68f4217577f811b22231');
assert.equal(installer.IMMUTABLE_HOST_ACTIONS_V2_SHA, '7efeeb17253bc52aeac1f362c377fd4121984f49f159fd9e72ae7e06897ded56');
assert.equal(installer.V14_SHA, '1cd8e33bdecaa2ebffc086c778e7938cb33b57b31e6abab21a183972259a0059');
```

Tests must prove `patchAgentServer()` injects the route import/register transformations exactly once into the current wrapper, `patchRegistry()` imports/registers only the dedicated read-only plugin exactly once, the dedicated plugin has an empty input schema and uses only `agent.callAgent()` for the fixed route, `hostActionsV2.js` remains immutable at its V14 SHA, and the installer does not reference Base/Executor/Approval Policy write paths.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test-v14-1-honartik-iticket-v14-preflight-readonly.js
```

Expected: FAIL because the V14.1 installer does not exist.

- [ ] **Step 3: Implement minimal installer**

`preflight()` must:

1. require hostname `prhm-production.prhm.ir`;
2. SHA-check Agent API and MCP registry baselines, and separately verify immutable `hostActionsV2.js` still matches the V14 baseline SHA;
3. require new target route/payload files to be absent unless a valid committed marker proves this exact version is already installed;
4. verify embedded V14 bytes SHA equals `V14_SHA`;
5. verify embedded route-module and dedicated MCP-plugin bytes equal their repository SHAs;
6. build patched Agent API/MCP-registry candidates;
7. run `node --check` on temporary candidate files;
8. prove the candidate registry does not modify/import `hostActionsV2.js` content and the mutation action is not introduced by the dedicated plugin;
9. return only bounded JSON with `preflight_only:true`, candidate hashes, and all mutation/network/token/database/deploy flags false.

`install()` must create atomic backups, write the three new files and two patched files, restart only Agent API/MCP, validate both health endpoints and the fixed tool schema, write a committed marker, and rollback all four files on any failure.

- [ ] **Step 4: Run GREEN**

Run:

```bash
node --check bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js
node --check honartik-iticket-v14-preflight-readonly-routes.js
node --check test-v14-1-honartik-iticket-v14-preflight-readonly.js
node --test test-v14-1-honartik-iticket-v14-preflight-readonly.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit installer**

```bash
git add bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js test-v14-1-honartik-iticket-v14-preflight-readonly.js
git commit -m "feat: add iTicket V14 preflight adapter installer"
```

### Task 3: Byte Binding, Regression Verification, and Review Gate

**Files:**
- Modify: `test-v14-1-honartik-iticket-v14-preflight-readonly.js`
- Verify: `bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js`
- Verify: `honartik-iticket-v14-preflight-readonly-routes.js`
- Verify: `bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js`

**Interfaces:**
- Guarantees exact merged V14 bytes are the installed preflight payload.
- Guarantees the MCP input schema is empty and no Host Action v2 mutation enum/policy entry is added.

- [ ] **Step 1: Add failing byte-binding regression assertions**

The test must read the merged V14 repo file and assert its SHA and bytes equal the installer-embedded payload. It must assert installer-embedded route bytes equal the standalone route module bytes and installer-embedded MCP-plugin bytes equal the standalone dedicated plugin bytes. It must also assert `hostActionsV2.js` is not an installer write target and its immutable SHA remains the V14 baseline.

- [ ] **Step 2: Run RED if any embedded payload drift exists**

Run:

```bash
node --test test-v14-1-honartik-iticket-v14-preflight-readonly.js
```

Expected: FAIL on any byte/hash drift; otherwise the newly added assertion must be shown to exercise real embedded bytes.

- [ ] **Step 3: Rebind embedded bytes if necessary, without changing behavior**

Generate the Base64 only from the pinned repository files and update the installer constants. Do not hand-edit embedded payloads.

- [ ] **Step 4: Full verification**

Run:

```bash
node --check bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js
node --check bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js
node --check honartik-iticket-v14-preflight-readonly-routes.js
node --check test-v14-1-honartik-iticket-v14-preflight-readonly.js
node --test test-v14-honartik-iticket-dark-backend-batch1.js
node --test test-v14-1-honartik-iticket-v14-preflight-readonly.js
```

Expected: V14 existing suite remains PASS and V14.1 suite is fully PASS.

- [ ] **Step 5: Independent review and GitHub-byte verification**

Review for capability escape, unsafe loader restoration, arbitrary path/command exposure, mutation action leakage, rollback gaps, stale SHA binding, and response leakage. Then re-fetch the committed branch files from GitHub and rerun syntax/tests from those exact bytes.

- [ ] **Step 6: Update Draft PR #40**

Keep PR #40 Draft until implementation review is PASS. Do not merge, do not stage DeployHQ config, and do not install the adapter during this plan.
