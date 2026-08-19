# Titan Staged Production Finalize Host Action V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed Level-4 Host Action `titan_staged_production_finalize_v1` that safely provisions Titan Edge TLS/HTTPS with snapshot-first rollback and bounded verification.

**Architecture:** Follow the existing Host Actions v2 bootstrap pattern: a repository helper contains the fixed Titan production operation and a bootstrap registers the action in Base, executor, MCP schema, policy and dispatch. The helper accepts no user-controlled host/path/command parameters, performs read-only preflight before mutation, snapshots every Titan-scoped mutable artifact, and rolls back on every post-mutation failure.

**Tech Stack:** Node.js, systemd, Nginx, Certbot/Let's Encrypt, OpenSSL/curl, existing PRHM Host Actions v2 control plane.

**Spec:** `docs/superpowers/specs/2026-08-19-titan-host-action-v1-design.md`

## Global Constraints

- Action name is exactly `titan_staged_production_finalize_v1`.
- Hostnames are exactly `titanfitness-club.com`, `www.titanfitness-club.com`, `admin.titanfitness-club.com`.
- No arbitrary hostname, path, command, service, credential, secret, DB migration, payment, SMS, PR merge, or application-secret rotation input.
- Level-4 request/apply flow and `CONFIRM_LEVEL_4_CRITICAL` remain mandatory.
- Nginx validation must PASS before HUP/reload.
- Any failure after first mutation invokes rollback and reports original failure and rollback outcome separately.
- Private key/secret material must never be emitted.

---

### Task 1: Contract tests

**Files:**
- Create: `test-v13-titan-staged-production-finalize.js`
- Test: `test-v13-titan-staged-production-finalize.js`

**Interfaces:**
- Consumes: design spec and repository source files.
- Produces: static contract proving fixed scope, rollback order, reload guard and control-plane registration requirements.

- [ ] **Step 1: Write failing tests** asserting the helper/bootstrap files exist and contain the exact action name, three hostnames, fixed Nginx/service/cert paths, snapshot-before-mutation markers, `nginx -t`, controlled HUP, rollback, SAN/public/local smoke gates, Level-4 policy, and no arbitrary-input surfaces.
- [ ] **Step 2: Run** `node --test test-v13-titan-staged-production-finalize.js` and verify RED because v13 helper/bootstrap do not exist yet.
- [ ] **Step 3: Keep the test independent of Production state**; it must inspect source contracts only.

### Task 2: Fixed Titan helper

**Files:**
- Create: `titan-staged-production-finalize-v1.js`
- Test: `test-v13-titan-staged-production-finalize.js`

**Interfaces:**
- Consumes: no user input; fixed Node1 paths/topology only.
- Produces: `--preflight-only` read-only result or approved mutation result with bounded PASS/FAIL evidence.

- [ ] **Step 1: Implement read-only preflight** for Node1 identity, `prhm-edge-nginx.service`, `/etc/nginx/nginx.phase7b.conf`, exact Titan HTTP block/proxy target, backend reachability, ACME webroot, DNS/HTTP challenge reachability, and existing Titan lineage state.
- [ ] **Step 2: Implement snapshot helpers** that record file presence/absence and copy only Titan-relevant mutable files plus the Nginx config and deploy-script mapping.
- [ ] **Step 3: Implement TLS provisioning** using fixed Certbot webroot and exact three SANs; reuse only the fixed Titan lineage when already valid.
- [ ] **Step 4: Install Titan certificate/key** to `/etc/nginx/certs/titan/titanfitness-club.com.cert.combined` and `.key` with restrictive modes without printing contents.
- [ ] **Step 5: Add the fixed HTTPS 8443 Titan server block** while preserving the existing HTTP block and unrelated config; reject ambiguous/multiple anchors.
- [ ] **Step 6: Validate** `/usr/sbin/nginx -t -c /etc/nginx/nginx.phase7b.conf`; only then HUP `prhm-edge-nginx.service`.
- [ ] **Step 7: Verify** local SNI, exact SAN coverage, public frontend root, public admin `/login`, HTTP/ACME behavior and one unrelated representative Edge host.
- [ ] **Step 8: Roll back** exact prior Titan-scoped state on every failure after mutation; validate and HUP after rollback when required.
- [ ] **Step 9: Emit bounded JSON evidence** with no private-key/secret values.
- [ ] **Step 10: Run contract tests and Node syntax check** until GREEN.

### Task 3: Host Actions v2 bootstrap registration

**Files:**
- Create: `bootstrap-host-actions-v13-titan-staged-production-finalize.js`
- Test: `test-v13-titan-staged-production-finalize.js`

**Interfaces:**
- Consumes: exact helper source SHA and current control-plane file state.
- Produces: registered fixed action available through existing v2 request/status/apply flow.

- [ ] **Step 1: Register action** in Base allowlist, executor dispatch, MCP `action` enum and Level-4 approval policy.
- [ ] **Step 2: Keep request schema no-input beyond `action`** and apply schema unchanged except normal request id/second confirmation.
- [ ] **Step 3: Install helper** at `/opt/prhm-agent-selfmaint-exec/actions/titan-staged-production-finalize-v1.js` with exact source SHA verification.
- [ ] **Step 4: Make bootstrap preflight read-only** (`production_mutation:false`) and fail closed on stale/ambiguous control-plane anchors.
- [ ] **Step 5: Add automatic rollback** for control-plane file changes if bootstrap verification fails.
- [ ] **Step 6: Verify post-bootstrap schema contains exactly the new enum value and existing actions remain present.
- [ ] **Step 7: Run contract tests and Node syntax checks** until GREEN.

### Task 4: Regression and PR review

**Files:**
- Modify: PR #31 branch only.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: reviewable Draft PR with implementation evidence and no Production mutation.

- [ ] **Step 1: Run** `node --test test-v13-titan-staged-production-finalize.js` plus existing `test-*.js` tests.
- [ ] **Step 2: Run** `node --check` on helper/bootstrap.
- [ ] **Step 3: Review diff** for unrelated project paths, secret-like literals, arbitrary command/path/hostname parameters, and missing rollback gates.
- [ ] **Step 4: Update PR #31 body** with exact test results and keep it Draft until bootstrap rollout is approved.

### Task 5: Gated rollout

**Files:** Production control plane only through approved bootstrap path.

**Interfaces:**
- Consumes: reviewed exact PR head.
- Produces: fresh MCP schema exposing `titan_staged_production_finalize_v1`; then a separate Level-4 request/apply for Titan TLS remediation.

- [ ] **Step 1: Run bootstrap preflight only** and verify no Production mutation.
- [ ] **Step 2: Roll out registration through the established control-plane bootstrap path.**
- [ ] **Step 3: Verify fresh ChatGPT/MCP schema contains the new enum.**
- [ ] **Step 4: Create a fresh Level-4 request for `titan_staged_production_finalize_v1`.**
- [ ] **Step 5: Apply only with `CONFIRM_LEVEL_4_CRITICAL`.**
- [ ] **Step 6: Require all TLS/vhost smoke gates PASS before moving to Titan migration/UAT/merge gates.**
