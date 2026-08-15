# Company OS Persian Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing read-only Company OS dashboard so all operational decisions/reasons/statuses are presented in Persian, every opportunity exposes its stored original project URL, exact outbound communication evidence is visible with sent/draft distinction, and source coverage for ParsCoders/Karlancer/Divar is visible.

**Architecture:** Keep internal LeadOps/P0 codes and database semantics unchanged. Extend only the read-only snapshot collector with additive fields derived from persisted data, then localize and render those fields in the static dashboard UI. Missing URL/message/collector evidence must render explicitly as unavailable rather than being inferred.

**Tech Stack:** Node.js 20 built-ins, PostgreSQL read-only queries through the existing collector, static HTML/CSS/JavaScript, node:test.

## Global Constraints

- Dashboard remains GET-only and loopback-bound.
- No Engine, DB schema, send gate, P0 flag, Approval semantics, or outbound transport change.
- No guessed URLs and no inferred “sent” state from `SEND_NOW`.
- Exact sent text is shown only when persisted sent evidence exists.
- Unknown internal codes render as Persian `نامشخص`; raw code remains available only in technical detail.
- Source states are evidence-based: no source is marked active solely because old workflow files exist.

---

### Task 1: Add RED contract tests for Persian localization and opportunity details

**Files:**
- Create: `test-company-os-dashboard-persian.js`
- Test: `test-company-os-dashboard-persian.js`

**Interfaces:**
- Consumes: existing `company-os-dashboard/collector.js` and `company-os-dashboard/public/app.js`.
- Produces: contract for Persian maps, source link rendering, communication states, and source coverage.

- [ ] Write tests covering all eight P0 decision codes, known reason mappings, safe unknown fallback, real URL rendering, sent/draft/none labels, and source cards.
- [ ] Run `node --test test-company-os-dashboard-persian.js` and verify failure is caused by missing v11 behavior.
- [ ] Commit plan + RED test on `feature/company-os-persian-dashboard-v11`.

### Task 2: Extend read-only snapshot collector

**Files:**
- Modify: `company-os-dashboard/collector.js`
- Test: `test-company-os-dashboard-persian.js`, `test-company-os-dashboard-backend.js`

**Interfaces:**
- Produces opportunity fields `original_url`, `description`, `drafts`, `communications`; top-level `sources`.

- [ ] Extract original URL only from persisted opportunity/evaluation JSON fields using `to_jsonb(...)` key lookup so missing columns do not break the query.
- [ ] Extract persisted upstream proposal drafts from the latest evaluation input snapshot.
- [ ] Extract sent communication evidence only from persisted submitted bid/outbox/telegram rows; never infer from decision.
- [ ] Build source coverage entries for `parscoders`, `karlancer`, `divar`, marking missing integrations `not_connected` and otherwise using only explicit runtime evidence; preserve `unknown` when heartbeat evidence is absent.
- [ ] Run backend and Persian tests until green.

### Task 3: Localize and add opportunity detail UI

**Files:**
- Modify: `company-os-dashboard/public/index.html`
- Modify: `company-os-dashboard/public/app.js`
- Modify: `company-os-dashboard/public/styles.css`
- Test: `test-company-os-dashboard-ui.js`, `test-company-os-dashboard-persian.js`

**Interfaces:**
- Consumes additive snapshot fields from Task 2.
- Produces Persian operational UI and detail drawer/modal.

- [ ] Add centralized Persian maps for decisions, reasons, statuses, service categories, source names, host action statuses, and source states.
- [ ] Make opportunity titles clickable only when `original_url` is valid; add `مشاهده آگهی اصلی` action and explicit missing-link text.
- [ ] Add an opportunity-details drawer showing metadata, decision/reason, economics, exact sent messages, unsent drafts, and collapsed technical trace.
- [ ] Add source coverage panel with ParsCoders/Karlancer/Divar, state, last check/activity evidence, discoveries today, and last error when present.
- [ ] Run UI and Persian tests until green.

### Task 4: Regression, review and deployment artifact preparation

**Files:**
- Modify installer/bootstrap only if required to package updated static/collector artifact bytes.
- Test all existing Company OS v9/v10 tests plus new v11 tests.

- [ ] Run Node syntax checks for collector/server/app and all Company OS test suites.
- [ ] Verify no POST/PUT/PATCH/DELETE route was introduced and no send/P0 flag code changed.
- [ ] Open PR from isolated feature branch and inspect exact changed files.
- [ ] Merge only with expected head SHA after checks/regression pass.
- [ ] Build a fixed SHA-bound dashboard-update Host Action, preflight live state, execute with a fresh Level-4 approval, verify snapshot/UI/service/timer, and preserve all no-send flags.
