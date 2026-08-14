# Moeinshow SEO Host Action v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and safely execute fixed Level-4 Host Action `moeinshow_seo_repair_v1` that repairs Moeinshow SSR/API routing, creates canonical SEO files, removes the temporary Agent repair route, and verifies production health.

**Architecture:** Follow the existing Host Action v4 bootstrap pattern. A repository bootstrap patches the approval policy, base self-maintenance allowlist, executor/helper dispatch, MCP enum, and temporary Agent compatibility shim using exact SHA preconditions and unique anchors. The installed action runs a no-input helper under constrained `systemd-run`, performs site-local backup/rollback, and is invoked only after a fresh Level-4 request.

**Tech Stack:** Node.js via `/usr/local/bin/prhm-node`, systemd/systemd-run, PRHM Approval Center, Host Actions v2, MCP/Zod, DeployHQ, Next.js production frontend, curl/TLS vhost checks.

## Global Constraints

- Action: `moeinshow_seo_repair_v1`.
- Operation: `host_action.moeinshow_seo_repair_v1` at Level 4.
- No arbitrary command, path, hostname, SQL, credentials, or content input.
- Preserve every existing Host Action, especially `mcp_candidate_schema_compare_v1`; do not mix with draft PR #2 LeadOps Economics work.
- Keep `moeinshow_front_prod` registration and the LeadOps compatibility patch.
- Remove only temporary `/moeinshow/seo-repair` capability and its SSH helper.
- `--selftest-only` and `--preflight-only` must perform zero production mutation.
- No production install or action execution before fresh live baseline validation and fresh `CONFIRM_LEVEL_4_CRITICAL` for the exact request.
- `/home` must not appear in the sitemap.
- On helper failure restore `/etc/hosts`, `robots.txt`, and `sitemap.xml` to their exact prior state.

---

### Task 1: Freeze the authoritative live baseline

**Files:**
- Read only: `/opt/prhm-company-control-plane/config/approval-policy.json`
- Read only: `/opt/prhm-agent-selfmaint/server.js`
- Read only: `/opt/prhm-agent-selfmaint-exec/server.js`
- Read only: `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`
- Read only: `/home/agent/ssh-agent-api/fileBasicRoutes.js`

**Interfaces:**
- Consumes: one executable SSH Agent connector, preferring Agent 2.
- Produces: five exact SHA-256 values and authoritative Host Actions v2 health evidence.

- [ ] **Step 1: Run the read-only baseline probe**

Run exactly:
```bash
sha256sum \
 /opt/prhm-company-control-plane/config/approval-policy.json \
 /opt/prhm-agent-selfmaint/server.js \
 /opt/prhm-agent-selfmaint-exec/server.js \
 /home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js \
 /home/agent/ssh-agent-api/fileBasicRoutes.js
```

- [ ] **Step 2: Verify v4 is the authoritative installed prerequisite**

Read `/health` from `prhm-agent-selfmaint-exec` and require `host_actions_v2` to contain `mcp_candidate_schema_compare_v1`. If absent, stop; do not write a dual-snapshot bootstrap and do not guess from stale Agent state.

- [ ] **Step 3: Verify the temporary route still exists before removal**

Read `fileBasicRoutes.js` and require exactly one `/moeinshow/seo-repair` route plus exactly one `moeinshow_front_prod` registration. If counts differ, stop and re-investigate.

- [ ] **Step 4: Record the five fresh SHAs in implementation notes before any code commit**

The bootstrap `EXPECTED` object must use only the values returned by Step 1. No remembered SHA may substitute for a failed live read.

### Task 2: Implement the fixed helper and bootstrap self-test

**Files:**
- Create: `bootstrap-moeinshow-seo-repair-v1.js`

**Interfaces:**
- Produces helper action `moeinshow_seo_repair_v1`, `--selftest-only`, `--preflight-only`, and deterministic candidate hashes.
- Helper accepts zero runtime parameters.

- [ ] **Step 1: Add a failing `--selftest-only` path**

Self-test fixtures must assert all of the following before real patch logic exists: policy gains exactly one Level-4 operation/scope; base and executor each gain exactly one action; MCP enum gains exactly one action; candidate Agent shim has no `/moeinshow/seo-repair` but still contains `moeinshow_front_prod` and `leadops_false_positive_binding_patch_applied`.

Run:
```bash
/usr/local/bin/prhm-node bootstrap-moeinshow-seo-repair-v1.js --selftest-only
```
Expected before implementation: non-zero exit because required patch functions are not complete.

- [ ] **Step 2: Implement pure patch functions**

Implement exact functions:
```js
patchPolicy(input)
patchBase(input)
patchExec(input)
patchPlugin(input)
patchAgentShim(input)
```
Each must fail when its expected anchor count is not exactly one. `patchAgentShim` removes the temporary repair route/helper/import only; it must retain project registration and LeadOps compatibility behavior.

- [ ] **Step 3: Implement the embedded no-input helper**

The helper must use fixed constants:
```text
ROOT=/home/moeinshow/domains/moeinshow.com/public_html
HOSTS=/etc/hosts
DASHBOARD=dashboard.moeinshow.com
SITE=https://moeinshow.com
```
It must: preflight `dashboard.moeinshow.com:443` against `127.0.0.1`; reject conflicting `/etc/hosts` mappings; back up hosts/robots/sitemap; atomically add the loopback mapping if missing; atomically create robots and sitemap; verify local root, article 9/10/11, theater 1/3, robots and sitemap are HTTP 200; require the sitemap line in robots; require article 9 in sitemap; require `/home` absent; rollback all mutated site files on any failure.

- [ ] **Step 4: Constrain helper execution**

Executor dispatch must run the helper through `systemd-run --wait` with `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=full`, `ProtectHome=read-only`, and narrowly scoped `ReadWritePaths` for `/etc/hosts`, `/home/moeinshow/domains/moeinshow.com/public_html/public`, `/var/backups/prhm-moeinshow-seo`, and the Host Action result directory.

- [ ] **Step 5: Make self-test pass**

Run:
```bash
/usr/local/bin/prhm-node --check bootstrap-moeinshow-seo-repair-v1.js
/usr/local/bin/prhm-node bootstrap-moeinshow-seo-repair-v1.js --selftest-only
```
Expected: syntax exit 0 and JSON with `ok:true`, `action:"moeinshow_seo_repair_v1"`.

- [ ] **Step 6: Commit the implementation**

```bash
git add bootstrap-moeinshow-seo-repair-v1.js
git commit -m "feat: add fixed Moeinshow SEO host action bootstrap"
```

### Task 3: Implement zero-mutation preflight and rollback-safe install

**Files:**
- Modify: `bootstrap-moeinshow-seo-repair-v1.js`

**Interfaces:**
- `--preflight-only` returns current and candidate hashes without writes.
- Normal invocation installs all control-plane changes atomically or restores all backups.

- [ ] **Step 1: Make preflight reject a wrong SHA fixture**

Add self-test coverage proving one altered baseline SHA causes `sha_mismatch:<label>` before any write.

- [ ] **Step 2: Implement live SHA and unique-anchor checks**

Normal and preflight paths must verify all five Task 1 SHAs before constructing candidates. Candidate policy must remain valid JSON; base/executor/plugin/bootstrap helper candidates must pass Node syntax checks.

- [ ] **Step 3: Implement candidate invariants**

Require all pre-existing actions to remain present, require `moeinshow_seo_repair_v1` exactly once in policy/base/executor/plugin, require temporary Agent route absent in candidate, and require `moeinshow_front_prod` plus LeadOps compatibility markers present.

- [ ] **Step 4: Implement `--preflight-only`**

It prints `schema_version`, `ok`, `action`, five current hashes, candidate hashes, action-preservation evidence, temporary-route-removal evidence, and `production_mutation:false`, then exits 0 without creating backups, markers, helpers, or restarting services.

- [ ] **Step 5: Implement install with full rollback**

Back up every changed control-plane file under a new `/var/backups/prhm-host-actions-moeinshow-seo-*` directory. Write policy/base/executor/plugin/Agent shim/helper atomically, restart only required approval/selfmaint/executor/MCP/Agent API services, verify health and action visibility, and restore all originals plus remove the helper if any step fails.

- [ ] **Step 6: Re-run tests**

```bash
/usr/local/bin/prhm-node --check bootstrap-moeinshow-seo-repair-v1.js
/usr/local/bin/prhm-node bootstrap-moeinshow-seo-repair-v1.js --selftest-only
```
Expected: both pass.

- [ ] **Step 7: Commit preflight/install behavior**

```bash
git add bootstrap-moeinshow-seo-repair-v1.js
git commit -m "feat: add rollback-safe Moeinshow host action installer"
```

### Task 4: Repository review gate

**Files:**
- Modify: `README.md`
- Review: `bootstrap-moeinshow-seo-repair-v1.js`

- [ ] **Step 1: Document the new action**

Add one README bullet stating that `moeinshow_seo_repair_v1` is fixed/no-input, repairs internal SSR/API routing plus robots/sitemap, and has automatic rollback.

- [ ] **Step 2: Verify branch diff is isolated**

Require changed implementation paths to be only the bootstrap, README, design spec, and implementation plan. No LeadOps Economics files or PR #2 branch content may be included.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md
git commit -m "docs: document Moeinshow SEO host action"
```

- [ ] **Step 4: Open a draft PR against `main`**

Title: `Host Action: Moeinshow SEO repair v1`.
Body must state: no production mutation yet; fresh server-side preflight required; PR #2 unaffected; fresh Level-4 confirmation required before install/execution.

### Task 5: Server-side preflight and installation gate

**Files:**
- Execute repository bootstrap only after review; no source edit on server.

- [ ] **Step 1: Execute server-side `--preflight-only`**

Run the exact reviewed bootstrap from the candidate revision:
```bash
/usr/local/bin/prhm-node bootstrap-moeinshow-seo-repair-v1.js --preflight-only
```
Expected: `ok:true`, `production_mutation:false`, all five baseline hashes match, existing actions preserved, new action candidate visible, temporary route candidate absent.

- [ ] **Step 2: Stop on any drift**

If any SHA/anchor/health prerequisite differs, do not install. Refresh evidence and update/re-review the branch instead of weakening checks.

- [ ] **Step 3: Obtain a fresh Level-4 confirmation for installing the reviewed bootstrap**

Do not reuse any previous `CONFIRM_LEVEL_4_CRITICAL` or expired request.

- [ ] **Step 4: Install and verify control-plane health**

After the approved install, require Host Actions v2 health to include both `mcp_candidate_schema_compare_v1` and `moeinshow_seo_repair_v1`, Agent API health to pass, and `fileBasicRoutes.js` to contain no `/moeinshow/seo-repair` route while still registering `moeinshow_front_prod`.

### Task 6: Execute the fixed action and verify production

**Interfaces:**
- Consumes: installed action and fresh Level-4 request ID.
- Produces: site repair evidence suitable for Search Console validation.

- [ ] **Step 1: Create a fresh `host_action_v2_request` for `moeinshow_seo_repair_v1`**

Require a new request ID bound to `host_action.moeinshow_seo_repair_v1`.

- [ ] **Step 2: Apply only after fresh confirmation**

Execute only with `host_action_v2_apply(request_id, CONFIRM_LEVEL_4_CRITICAL)`.

- [ ] **Step 3: Read action status**

Require `status:succeeded`, `rollback_performed:false`, local dashboard preflight 200, and local page checks 200.

- [ ] **Step 4: Perform fresh public verification**

Require public HTTP 200 for `/`, `/article/9`, `/article/10`, `/article/11`, `/theater/1`, `/theater/3`, `/robots.txt`, `/sitemap.xml`. Verify robots references the sitemap; sitemap contains canonical target URLs and excludes `/home`.

- [ ] **Step 5: Verify bounded fresh logs**

Check only logs generated after action start. Require no new `ECONNREFUSED` to the public dashboard edge and no new article null-title crash/digest associated with the prior failure.

- [ ] **Step 6: Search Console handoff**

Only after all public and log checks pass, report that Validate Fix is ready. If the connected Search Console account remains unverified, state that the button must be clicked from a verified property account rather than claiming it was triggered.
