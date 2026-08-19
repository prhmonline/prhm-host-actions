# Titan Host Action V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fixed Level-4 `titan_staged_production_finalize_v1` action to the current PRHM Host Actions runtime without regressing any newer registered actions, then prove its fail-closed approval, rollback, TLS, and verification behavior.

**Architecture:** Implement a standalone Titan edge/TLS helper and register it additively in the current Host Actions v2 request/executor/plugin/policy surfaces. The bootstrap must fingerprint and patch the live current baseline rather than restoring a historical bundled runtime; the production helper snapshots Titan/edge state, mutates only Titan-specific TLS/vhost/renewal mappings, validates Nginx before reload, and automatically restores the pre-action state on failure.

**Tech Stack:** Node.js (`prhm-node`), systemd, Nginx, Certbot/Let's Encrypt webroot ACME, existing PRHM Host Actions v2 approval/control-plane.

**Spec:** `docs/superpowers/specs/2026-08-19-titan-host-action-design.md`

## Global Constraints

- Fixed action name: `titan_staged_production_finalize_v1`.
- Fixed hostnames only: `titanfitness-club.com`, `www.titanfitness-club.com`, `admin.titanfitness-club.com`.
- Fixed upstream only: `10.71.0.118:80`.
- Level-4 second confirmation remains exactly `CONFIRM_LEVEL_4_CRITICAL`.
- No arbitrary hostnames, commands, paths, services, IPs, certificate names, or mutation arguments.
- No PR merge, application deploy/build, DB migration, DNS mutation, real payment, or real SMS.
- Never log or persist certificate private keys, credentials, Authorization headers, API keys, or secrets.
- Every post-mutation failure triggers automatic rollback; rollback completeness is reported distinctly.
- Bootstrap refuses unknown live control-plane baselines; it never overwrites a newer runtime with an older historical bundle.

---

### Task 1: Capture and Pin the Current Control-Plane Baseline

**Files:**
- Create: `test-v13-titan-current-baseline.js`
- Create: `bootstrap-host-actions-v13-titan-staged-production-finalize.js`

**Interfaces:**
- Consumes: installed files `/opt/prhm-agent-selfmaint/server.js`, `/opt/prhm-agent-selfmaint-exec/server.js`, `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`, `/opt/prhm-company-control-plane/config/approval-policy.json`.
- Produces: exact SHA-256 baseline constants used by the bootstrap; a fail-closed `assertKnownBaseline()` gate.

- [ ] **Step 1: Write a baseline regression test**

Create a Node test that loads the bootstrap source and asserts it contains explicit SHA-256 constants for all four control-plane files, rejects placeholder hashes, and contains no historical full-runtime replacement payload.

```js
'use strict';
const fs = require('node:fs');
const assert = require('node:assert');
const src = fs.readFileSync('bootstrap-host-actions-v13-titan-staged-production-finalize.js', 'utf8');
for (const p of [
  '/opt/prhm-agent-selfmaint/server.js',
  '/opt/prhm-agent-selfmaint-exec/server.js',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  '/opt/prhm-company-control-plane/config/approval-policy.json',
]) assert(src.includes(p), `missing baseline path ${p}`);
assert(src.includes('assertKnownBaseline'));
assert(!src.includes('BASELINE_SHA_PLACEHOLDER'));
assert(!src.includes('FULL_RUNTIME_B64'));
console.log('TITAN_BASELINE_TEST=PASS');
```

- [ ] **Step 2: Run the test and verify it fails before bootstrap exists**

Run: `node test-v13-titan-current-baseline.js`
Expected: FAIL because the bootstrap file is absent.

- [ ] **Step 3: Read current runtime fingerprints through an approved read-only discovery path**

Use the existing server-side read-only/self-maintenance evidence or a fixed discovery addition that returns only SHA-256 fingerprints and action names; do not print file contents containing secrets. Record the exact current SHA-256 for the four files in the bootstrap.

- [ ] **Step 4: Implement `assertKnownBaseline()`**

The bootstrap must compute SHA-256 for each pinned path and throw `baseline_sha_mismatch:<path>` before any mutation if any live hash differs.

- [ ] **Step 5: Run baseline regression**

Run: `node test-v13-titan-current-baseline.js`
Expected: `TITAN_BASELINE_TEST=PASS`.

- [ ] **Step 6: Commit**

```bash
git add test-v13-titan-current-baseline.js bootstrap-host-actions-v13-titan-staged-production-finalize.js
git commit -m "test: pin Titan host action control-plane baseline"
```

### Task 2: Implement the Fixed Titan Edge/TLS Helper with Rollback

**Files:**
- Create: `titan-staged-production-finalize-v1.js`
- Create: `test-titan-staged-production-finalize-v1.js`

**Interfaces:**
- Consumes: no request arguments; fixed constants for hostnames, upstream, Nginx config, ACME webroot, certificate lineage, certificate install paths, deploy script, edge service.
- Produces: process exit 0 only on full success; sanitized JSON result with `status`, `nginx_test`, `tls_hosts`, `certificate_fingerprint_sha256`, `not_after`, `rollback_status`; automatic rollback on post-mutation failure.

- [ ] **Step 1: Write source-level safety tests**

Assert the helper contains exactly the three approved hostnames, fixed upstream `10.71.0.118:80`, fixed paths, lock acquisition, snapshot creation, `nginx -t`, HUP only after config validation, and rollback states `FAILED_ROLLED_BACK` / `FAILED_ROLLBACK_INCOMPLETE`. Assert it does not reference `child_process.exec`, `bash -c`, arbitrary CLI arguments, payment/SMS/database commands, or secret output.

- [ ] **Step 2: Run safety tests to verify failure**

Run: `node test-titan-staged-production-finalize-v1.js`
Expected: FAIL because helper is absent.

- [ ] **Step 3: Implement fixed constants and fail-closed preflight**

Use constants equivalent to:

```js
const ACTION='titan_staged_production_finalize_v1';
const HOSTS=Object.freeze([
  'titanfitness-club.com',
  'www.titanfitness-club.com',
  'admin.titanfitness-club.com',
]);
const UPSTREAM='10.71.0.118:80';
const NGINX_CONF='/etc/nginx/nginx.phase7b.conf';
const ACME_WEBROOT='/var/www/prhm-acme';
const CERT_LINEAGE='titanfitness-club.com-edge';
const CERT_DST='/etc/nginx/certs/titan/titanfitness-club.com.cert.combined';
const KEY_DST='/etc/nginx/certs/titan/titanfitness-club.com.key';
const EDGE_SERVICE='prhm-edge-nginx.service';
```

Validate service/config/HTTP Titan block/tooling/webroot and reject symlink/conflicting lineage states before mutation.

- [ ] **Step 4: Implement snapshot and mutation journal**

Before first mutation create a root-only timestamped snapshot directory under `/var/lib/prhm-agent-selfmaint-exec/titan-staged-production-finalize-v1/` and record which Titan files existed before. Copy only the Nginx config and Titan-specific certificate/renewal/deploy files required for exact rollback.

- [ ] **Step 5: Implement certificate issuance/reuse and SAN verification**

Use `/usr/local/sbin/prhm-certbot-ipv4 certonly --webroot -w /var/www/prhm-acme --cert-name titanfitness-club.com-edge -d titanfitness-club.com -d www.titanfitness-club.com -d admin.titanfitness-club.com --non-interactive --agree-tos` with the control-plane's existing registered ACME account; do not add an email or expose account data. If lineage exists, validate its SAN set before reuse/renewal.

- [ ] **Step 6: Implement exact certificate install and Nginx HTTPS block**

Copy fullchain/key with mode 0600 into `/etc/nginx/certs/titan/`; append one uniquely delimited Titan HTTPS server block only if absent, proxying to `http://10.71.0.118:80` and setting `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto`.

- [ ] **Step 7: Extend renewal deployment additively**

Patch `/usr/local/sbin/prhm-edge-cert-deploy` at one unique anchor to add:

```bash
copy_pair titanfitness-club.com-edge titan/titanfitness-club.com.cert.combined titan/titanfitness-club.com.key
```

Fail if the anchor is missing/non-unique; never rewrite the rest of the mapping list.

- [ ] **Step 8: Validate then reload**

Run `/usr/sbin/nginx -t -c /etc/nginx/nginx.phase7b.conf`; only on exit 0 call `systemctl kill -s HUP --kill-who=main prhm-edge-nginx.service` and verify service remains active.

- [ ] **Step 9: Verify local TLS and application routing**

For all three hostnames, connect to `127.0.0.1:8443` with SNI, verify hostname with OpenSSL, calculate public-certificate SHA-256 fingerprint, confirm exact SAN coverage, and make bounded HTTPS probes. Require frontend root and `/login` on admin to avoid the known default 47-byte webserver body.

- [ ] **Step 10: Implement rollback**

On any failure after mutation, restore snapshot files exactly; delete only Titan files created by this run; `nginx -t` restored config; HUP only if restored config validates; persist `FAILED_ROLLED_BACK` or `FAILED_ROLLBACK_INCOMPLETE`.

- [ ] **Step 11: Run helper safety tests**

Run: `node test-titan-staged-production-finalize-v1.js`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add titan-staged-production-finalize-v1.js test-titan-staged-production-finalize-v1.js
git commit -m "feat: add rollback-safe Titan edge TLS action"
```

### Task 3: Register Titan in Host Actions v2 Additively

**Files:**
- Modify through bootstrap patch: installed request server, executor server, MCP plugin, approval policy.
- Create: `test-v13-titan-host-action-registration.js`

**Interfaces:**
- Consumes: `ACTION='titan_staged_production_finalize_v1'`; helper path `/opt/prhm-agent-selfmaint-exec/actions/titan-staged-production-finalize-v1.js`.
- Produces: request enum entry, executor allowlist/dispatch entry, MCP schema entry, Level-4 approval policy entry using existing request/status/apply semantics.

- [ ] **Step 1: Write registration tests**

The test must inspect the bootstrap source and assert the action appears in the request enum patch, executor action map patch, MCP plugin schema patch, and approval-policy patch, and that no new apply endpoint or confirmation string is introduced.

- [ ] **Step 2: Run registration tests and verify failure**

Run: `node test-v13-titan-host-action-registration.js`
Expected: FAIL until registration patches exist.

- [ ] **Step 3: Add exact additive patches**

Use unique `replaceOnce` anchors against the pinned current baseline. Add only the Titan enum/map/policy entries and helper SHA. Preserve every pre-existing action including `agent_zero_downtime_bootstrap_v1`.

- [ ] **Step 4: Add approval policy binding**

Register the action at Level-4 with the same expiry, signature, one-time consumption, and replay controls used by current fixed Host Actions v2. Do not weaken policy defaults.

- [ ] **Step 5: Add MCP request schema value**

Expose only the zero-input fixed action name under `host_action_v2_request.action` enum. `host_action_v2_apply` remains unchanged and continues to require literal `CONFIRM_LEVEL_4_CRITICAL`.

- [ ] **Step 6: Run registration tests**

Run: `node test-v13-titan-host-action-registration.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add bootstrap-host-actions-v13-titan-staged-production-finalize.js test-v13-titan-host-action-registration.js
git commit -m "feat: register Titan finalize host action"
```

### Task 4: Bootstrap Verification and Safe Installation

**Files:**
- Modify: `bootstrap-host-actions-v13-titan-staged-production-finalize.js`
- Create: `test-v13-titan-bootstrap.js`

**Interfaces:**
- Consumes: pinned live baseline hashes, helper source/hash, exact additive patch anchors.
- Produces: installed helper and control-plane files only when all guards pass; automatic restoration of all mutated control-plane files if verification fails.

- [ ] **Step 1: Write bootstrap transaction tests**

Assert bootstrap creates a pre-mutation backup, tracks mutations before first write, installs helper mode 0750/root ownership as required by current executor convention, syntax-checks all changed JS, JSON-parses policy, compares installed hashes, restarts/reloads only the required Host Actions/MCP units, and rolls all changes back on any verification failure.

- [ ] **Step 2: Run bootstrap test and verify failure**

Run: `node test-v13-titan-bootstrap.js`
Expected: FAIL until transaction/verification logic is complete.

- [ ] **Step 3: Implement guarded installation transaction**

Sequence: baseline hash guard → backup → helper install → additive file patches → syntax/JSON validation → install → service reload/restart per current convention → schema/readiness verification → persisted sanitized result. Roll back every changed file and service state if any later step fails.

- [ ] **Step 4: Add installed-hash verification**

After write, compare SHA-256 of helper and patched files to the bootstrap's computed expected outputs before any success result.

- [ ] **Step 5: Run all static tests**

Run:

```bash
node test-v13-titan-current-baseline.js
node test-titan-staged-production-finalize-v1.js
node test-v13-titan-host-action-registration.js
node test-v13-titan-bootstrap.js
node --check titan-staged-production-finalize-v1.js
node --check bootstrap-host-actions-v13-titan-staged-production-finalize.js
```

Expected: all PASS / syntax clean.

- [ ] **Step 6: Commit**

```bash
git add bootstrap-host-actions-v13-titan-staged-production-finalize.js test-v13-titan-bootstrap.js
git commit -m "feat: bootstrap Titan host action safely"
```

### Task 5: Review, Deploy Bootstrap, and Verify Fresh Connector Schema

**Files:**
- No application repo changes.
- Control-plane installation only after review.

**Interfaces:**
- Consumes: reviewed exact commit SHA of Host Actions branch.
- Produces: live Connector schema containing `titan_staged_production_finalize_v1`; no Titan Production TLS mutation yet.

- [ ] **Step 1: Run final repository review**

Review exact diff for secret leakage, arbitrary-command surfaces, action loss/regression, rollback completeness, service scope, and fixed-hostname enforcement.

- [ ] **Step 2: Run complete test suite relevant to Host Actions v2**

Run the new Titan tests plus existing schema/approval/runtime registration regressions available in the repository. Any regression is a blocker.

- [ ] **Step 3: Install the bootstrap through the established SHA-bound deployment path**

Deploy only the reviewed exact bootstrap commit. Do not directly copy/edit live control-plane files manually.

- [ ] **Step 4: Verify persisted bootstrap status**

Require `COMPLETED`/equivalent with all installed-hash, syntax, policy, service, and schema checks PASS and rollback not invoked.

- [ ] **Step 5: Verify fresh MCP schema**

In a fresh connector session, inspect `host_action_v2_request.action` and require `titan_staged_production_finalize_v1` to be present while all previously registered actions remain present.

- [ ] **Step 6: Commit any review-only corrections**

If review finds defects, fix with focused commits, rerun all tests, redeploy exact reviewed head, and repeat schema verification.

### Task 6: Level-4 Request and Production Apply Gate

**Files:**
- No repo changes expected.

**Interfaces:**
- Consumes: live fixed action registration and explicit Level-4 confirmation at execution time.
- Produces: Titan TLS/vhost/renewal configuration plus sanitized verification evidence, or automatic rollback.

- [ ] **Step 1: Create the fixed request**

Call `host_action_v2_request({action:'titan_staged_production_finalize_v1'})` and record only the request UUID and non-secret approval metadata.

- [ ] **Step 2: Verify pre-apply state**

Read request status and require it to be pending/approved according to the existing policy. Confirm no Titan TLS files/config have changed yet.

- [ ] **Step 3: Apply with Level-4 confirmation**

Call `host_action_v2_apply` using the request UUID and literal `CONFIRM_LEVEL_4_CRITICAL`.

- [ ] **Step 4: Verify persisted result**

Require successful Nginx config test, active edge service, exact SAN coverage, hostname verification for all three names, certificate fingerprint/expiry evidence, application routing probes, and no rollback.

- [ ] **Step 5: Verify bounded unrelated-host regression**

Re-run the fixed edge SSL audit and require representative unrelated PRHM/Honartik/DrTarjomeh/CFPark hosts to remain healthy.

- [ ] **Step 6: Verify replay protection**

A second apply attempt with the consumed request must fail closed and must not mutate production.

- [ ] **Step 7: Advance release gate only after success**

Mark only `TITAN_TLS=PASS`. Keep application migration/UAT and both Titan PR merges on HOLD for the next release phase.
