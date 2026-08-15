# Company OS Daily Readiness v8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a provenance-backed positive Real-market Shadow UAT and a secure read-only graphical Company OS dashboard for daily use.

**Architecture:** Extend the fixed Host Actions chain with a new Level-4 verified-economics UAT helper and install a separate read-only dashboard package. A root collector produces a sanitized snapshot; an unprivileged loopback web server renders it under the existing `agent.prhm.ir/company-os/` edge path.

**Tech Stack:** Node.js 20, PostgreSQL 18/psql, systemd, Apache reverse proxy, vanilla semantic HTML/CSS/JS, existing Host Actions v2 Approval Center.

## Global Constraints
- Keep P0 Live, Proposal Send, Bid Send, Telegram write and outbox write disabled.
- No arbitrary SQL, shell, paths or action arguments are accepted by the new Host Action.
- All UAT Economic Facts are opportunity-scoped, provenance-bearing, temporary and removed in `finally`.
- Dashboard is read-only and exposes no business mutation methods.
- Reuse `agent.prhm.ir` TLS; do not create a new hostname or certificate.
- Dashboard UI is Persian RTL and responsive.
- Every production install/apply is SHA-bound, backed up, preflighted and rollback-capable.

---

### Task 1: Verified economics UAT helper

**Files:**
- Create: `real-market-verified-economics-uat-v1.js`
- Create: `test-v8-verified-economics-uat.js`

**Interfaces:**
- Consumes: existing `/opt/prhm-p0-shadow-worker/worker.js`, Engine and Migration 009 schema.
- Produces: fixed `real_market_verified_economics_uat_v1` result with `SEND_NOW`, economic values, provenance and cleanup evidence.

- [ ] Write tests asserting the fixed opportunity id/external id, nine required facts, `verified=true`, non-empty provenance and no arbitrary input surface.
- [ ] Run `node --test test-v8-verified-economics-uat.js` and verify RED because helper is absent.
- [ ] Implement helper with fixed evidence-derived values, temporary facts, isolated worker copy, unique decision version, no-send verification and `finally` cleanup.
- [ ] Run helper tests and `node --check`; require GREEN.
- [ ] Add regression assertions that `economic_input_facts` has no residue and send-path counters must be identical before/after.

### Task 2: Dashboard collector and sanitized schema

**Files:**
- Create: `company-os-dashboard/collector.js`
- Create: `company-os-dashboard/test-collector.js`

**Interfaces:**
- Produces: `prhm.company-os.snapshot.v1` JSON with `generated_at`, `summary`, `opportunities`, `economics`, `host_actions`, `health`, `reports`, `safety`.

- [ ] Write RED tests for sanitization, unavailable-vs-zero semantics, stale timestamps and absence of secret/token/private-key fields.
- [ ] Implement bounded read-only PostgreSQL queries using the existing shadow DB role and bounded Host Action job scanning.
- [ ] Implement atomic snapshot writing with last-good preservation on failure.
- [ ] Run collector tests and syntax checks; require GREEN.

### Task 3: Dashboard web server and RTL UI

**Files:**
- Create: `company-os-dashboard/server.js`
- Create: `company-os-dashboard/public/index.html`
- Create: `company-os-dashboard/public/app.css`
- Create: `company-os-dashboard/public/app.js`
- Create: `company-os-dashboard/test-server.js`

**Interfaces:**
- GET `/health` → service/version.
- GET `/api/snapshot` → authenticated sanitized snapshot.
- GET `/` and static assets → authenticated dashboard.
- All mutating HTTP methods → 405.

- [ ] Write RED tests for Basic Auth, 401 challenge, 405 mutation methods, snapshot serving and no-store security headers.
- [ ] Implement salted SHA-256 Basic Auth and in-memory failed-login throttling.
- [ ] Implement semantic RTL dashboard with six defined sections, responsive tables/cards, stale-data banner, auto-refresh and manual refresh.
- [ ] Run server tests, HTML static checks and syntax checks; require GREEN.

### Task 4: v8 SHA-bound installer / Host Action registration

**Files:**
- Create: `bootstrap-host-actions-v8-company-os-daily.js`
- Create: `test-v8-bootstrap-company-os-daily.js`

**Interfaces:**
- Registers fixed action `real_market_verified_economics_uat_v1` in base Approval, executor, MCP schema and policy.
- Installs dashboard files, collector/server units, timer, auth material and Apache path route.

- [ ] Write RED tests proving v7.4 lacks the new action/dashboard artifacts.
- [ ] Derive v8 from exact live v7.4 SHA baselines; patch only exact anchors.
- [ ] Add preflight that checks target opportunity/evaluation, current source data, Apache proxy modules/path strategy, port availability and all baseline SHAs without mutation.
- [ ] Add installation backup, `node --check`, Apache config test, systemd daemon-reload/start, local dashboard health, collector snapshot verification and full automatic rollback.
- [ ] Run full v5–v8 regression suite; require all GREEN.

### Task 5: Merge, immutable deploy and positive UAT

**Files:** merged artifacts from Tasks 1–4.

- [ ] Commit implementation on `feature/company-os-daily-dashboard-v8`, open PR and verify exact changed-file scope.
- [ ] Check CI for the PR head; if no external CI exists, record local full-suite evidence.
- [ ] Merge only the reviewed exact head SHA.
- [ ] Fetch bootstrap from the merge commit and verify its SHA matches the tested artifact.
- [ ] Run preflight-only deployment; verify `production_mutation=false` and target/evidence invariants.
- [ ] Install v8; independently verify service versions, file SHAs, dashboard health and no business mutation.
- [ ] Create a completely fresh Level-4 request for `real_market_verified_economics_uat_v1` and apply with `CONFIRM_LEVEL_4_CRITICAL`.
- [ ] Verify result `SEND_NOW`, `auto_send_allowed=false`, all send paths false, cleanup true, fact/decision residue zero and global send counters unchanged.

### Task 6: Daily-use acceptance

- [ ] Retrieve generated Company OS dashboard credential from the root-only bootstrap file and verify no plaintext credential exists in repo or dashboard assets.
- [ ] Verify unauthenticated public dashboard returns 401 and authenticated request returns 200 through `https://agent.prhm.ir/company-os/`.
- [ ] Verify snapshot refreshes via timer and stale handling works by test fixture.
- [ ] Verify desktop/mobile RTL structure, tables, status chips, error/empty states and all six information sections.
- [ ] Capture final service/DB/Host Action state and publish the operational report with dashboard URL, access method, Positive UAT result, safety flags and remaining gates before any P0 Live pilot.
