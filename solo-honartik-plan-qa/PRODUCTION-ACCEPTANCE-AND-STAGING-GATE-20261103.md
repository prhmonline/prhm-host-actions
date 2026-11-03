# Honartik Guest Seat Plan QA — Production Acceptance and Staging Gate

**Date:** 2026-11-03, server timezone UTC+03:30  
**Host:** `prhm-production.prhm.ir`  
**Deployed QA source SHA:** `258d78a41b9d342733350490df6c964254307064`  
**Operational verdict:** **PASS for read-only public HTML/SSR contract**; **NO-GO for real login/reservation/payment E2E**.

## Production acceptance — evidence

- Two live theater entrypoints tested through **unauthenticated HTTP GET only**:
  - `/theater/61` (Taxidermy), first public `/seat-selection/413`; seat arithmetic `206 = 196 free + 10 sold`.
  - `/theater/63` (Captain's Bride), first public `/seat-selection/422`; seat arithmetic `56 = 54 free + 2 sold`.
- Fixed 17 checks: login page and two sets of event page HTTP 200, event title, matching public schedule/seat link, plan HTTP 200, plan title, seat markup, total=free+sold arithmetic and plan-specific login return link.
- **17/17 PASS** on live read-only QA. Initial isolated UAT WorkOrder `qa-honartik-498249` succeeded; repeated same-bucket execution returned `idle`. No seat selected/held, no registration, no phone/OTP submission, no reservation/invoice/payment or database mutation. No browser JS was executed; therefore client-side behavior is **NOT** verified.
- Fixed source code and systemd oneshot deployed root-owned to `/opt/prhm-honartik-plan-qa`, `prhm-honartik-plan-qa.service`. Manual run `Result=success`; durable queue protected under `/var/lib/private/prhm-honartik-plan-qa/queue.json`.
- STOP sentinel tested: returned `stopped` with queue unchanged. Removed before enabling timer.
- `prhm-honartik-plan-qa.timer`: **enabled and active**, hourly (no catch-up). First next fire at **2026-11-03 13:00:28 +03:30**, not yet observed at initial acceptance.
- 9/9 Node regression tests PASS on server and GitHub CI green. Existing Solo, CF Park QA, multisite Smoke QA, Operations Auditor unaffected and active.
- Existing ChatGPT hourly conditional notification task updated to include the new QA queue (alerts only on new failed/warning/critical results, no routine success notifications).

## Staging hard block — repeatable observations

- `/srv/honartik_front_staging` **exists but is empty** (no app source/build). This is NOT a deployed frontend staging environment.
- Agent 3 fixed `honartik_settlement_engine_staging_test_v1` fails before running tests: `ENOENT lstat '/home/prhm/domains/honartik-api-staging.prhm.ir/honartik-back'`. Therefore backend staging source is absent at its pinned location.
- The separate fixed `honartik_staging_privilege_boundary_worktree_test_v1` returned 7/7 PASS. That only verifies a privilege-boundary **contract in a worktree**; it does NOT prove a running staging application, isolated database or usable payment fixture.
- No independent staging database, synthetic login identities, mock OTP/SMS, mock payment gateway, or reachable staging checkout were validated. **No production transaction was created to compensate.**

## Required staged checkout acceptance — exact order

1. Stage Git-pinned frontend and backend artifacts into separate reviewed root-owned deployments. Verify source SHA, valid systemd unit and isolated loopback ports; do not reuse production writable paths/credentials or expose a staging port to the public Internet.
2. Provision an independent **sanitized/synthetic** database with no live customer PII and no write route to the production DB. Verify staging app environment DB identity without displaying secrets.
3. Disable live SMS and payment/chargeback endpoints in staging. Replace them with deterministic mock providers; require a distinct staging signing/credential identity. Assert that no production money movement or SMS delivery can occur.
4. Create explicit synthetic test user, theater, hall, seats and schedule, with disposable capacity. Record pre-test seat reservations and invoices from staging only.
5. Run browser E2E on staging only: guest navigates event → schedule → plan (no login); selects test seat → reserve → login challenge → returns to correct context → invoice; verify seat lock, TTL, seat inventory, idempotency and duplicate-click protections.
6. Run mock successful and failed payment flows, cancellation, expiry and refund cases against fixture data. Verify financial ledger is internally consistent and no production row or payment transaction changed.
7. Test desktop/mobile RTL layout, screenshot diffs, JS console errors, network 4xx/5xx, accessibility focus and post-login redirect.
8. Validate rollback and cleanup of synthetic records/locks, store redacted evidence, and promote only after a reviewed test run and immutable Git SHA.

**Gate:** production guest-plan SSR QA may continue on an hourly timer. Full transactional checkout QA must remain **disabled** until steps 1–4 are verified and a dedicated Staging Host Action / safe runner is available.

## Operator notes

- Timer: `systemctl status prhm-honartik-plan-qa.timer`
- Last redacted checks: `SOLO_PLAN_QA_STATE_DIR=/var/lib/prhm-honartik-plan-qa /usr/local/bin/prhm-node /opt/prhm-honartik-plan-qa/plan-qa.mjs --status`
- Stop: `systemctl disable --now prhm-honartik-plan-qa.timer`, `systemctl stop prhm-honartik-plan-qa.service` and/or create `/var/lib/private/prhm-honartik-plan-qa/STOP`.
- This test monitors the two **specific** active theater events. When they are retired or replaced, a new Git-reviewed event allowlist must be released; do not silently treat an unrelated event as equivalent.
