# Solo Multi-Site Public Smoke QA — Production acceptance

**Date:** 2026-11-03 (UTC+03:30, host time)  
**Host:** `prhm-production.prhm.ir`  
**Scope:** Honartik, iMotion, DrTarjomeh PUBLIC homepage/login entrypoints only  
**Deployed SHA:** `9b84332c74da72a1cbd36c7ffdb4bf67ba1d8b8f`  
**Result:** PASS: manual one-shot, duplicate suppression, STOP and enabled half-hourly timer.

## Evidence
- Five fixed target checks with exact expected status and redirect targets:
  - `honartik_front` HTTPS 200
  - `honartik_admin` HTTPS 302 to `https://dashboard.honartik.ir/login`
  - `imotion_front` HTTPS 301 to `https://imotion.ir/gym/`
  - `imotion_admin` HTTPS 302 to `https://admin.i-motion.ir/login`
  - `drtarjomeh_front` HTTPS 200
- Live authenticated server-proximate client requests were public HTTPS GET with fixed URLs, 7-second timeout, redirects not automatically followed. Results **5/5 PASS**, WorkOrder `qa-public-996478`, `severity:none`, 0 mutations.
- First manual `prhm-sites-smoke.service` returned `Result=success` and persisted one durable job with five sanitized findings.
- Re-run same 30-minute bucket returned `idle`. STOP file test returned `stopped`, with no new job. STOP removed.
- Timer `prhm-sites-smoke.timer` **active and enabled**, `OnCalendar=*:0/30`, `Persistent=false`, **first automatic trigger confirmed** at 2026-11-03 03:00:01 +03:30: WorkOrder `qa-public-996479`, status `succeeded`, five of five checks PASS, next timer 03:30:12 +03:30.
- Node tests **8/8 PASS** on the production host, GitHub CI green. Code deployed with fixed SHA and standalone StateDirectory. No credentials of any kind installed for this role.
- Adjacent `prhm-solo-qa-agent.timer` (CF Park), `prhm-solo-ops-auditor.timer`, Solo Runtime and MCP router remain active. CF Park's first automatic run at 03:00:10 +03:30 also returned `succeeded`, 10/10 checks PASS, 2 evidences.
- A ChatGPT condition-watch alert automation is enabled hourly for critical/warning/failed findings in **both** QA queues. Delivery was configured; first automated alert-delivery cycle has not yet been observed.

## Operate
- Timer status: `systemctl status prhm-sites-smoke.timer`
- Latest fixed findings: `SOLO_SMOKE_STATE_DIR=/var/lib/prhm-sites-smoke /usr/local/bin/prhm-node /opt/prhm-sites-smoke/smoke.mjs --status`
- Stop: `systemctl disable --now prhm-sites-smoke.timer; systemctl stop prhm-sites-smoke.service`. A protected `/var/lib/private/prhm-sites-smoke/STOP` file is the tested fail-closed gate.
- Journal: `journalctl -u prhm-sites-smoke.service`.

## Scope exclusions / next work
These are **public availability checks, not full business-flow QA**. They do not verify seat plans, payments, login credentials, UI screenshots, JS runtime console, API correctness, customer data, price reconciliation, or iMotion bookings. A deeper browser/staging QA and approved test accounts are separate steps. Never confuse success of 5 fixed origins with complete site correctness.
