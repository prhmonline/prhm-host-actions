# CF Park QA Agent — Production acceptance

**Date:** 2026-11-03 (server local time UTC+03:30)  
**Host:** prhm-production.prhm.ir  
**Product scope:** one fixed project (CF Park), **READ-ONLY**  
**Deployed source SHA:** `7a64cd99e0573bb9f7dd585bae5fe81bbccb50dc`  
**Verdict:** **Manual operational QA = PASS**; 30-minute timer **ENABLED/ACTIVE**; first scheduled trigger still pending at acceptance time.

## Live verified acceptance
- Authenticated Agent2 read-only MCP tools: `cfpark_readonly_audit` and `source_mapping_git_status_readonly` (pinned target `cfpark_front_prod`), both verified `readOnlyHint=true`.
- Fixed unauthenticated smoke tests: CF Park frontend and dashboard over HTTPS. Redirects deliberately not followed; check is 2xx/3xx with max 8s.
- Initial root-runner pilot: `qa-cfpark-996478`, status `succeeded`, 10/10 fixed checks PASS, 2 evidence records, severity `none`, 0 mutations.
- Exact source deployed in isolated `/opt/prhm-solo-qa`; root-owned files, Git SHA recorded at `.source-sha`.
- Manual `prhm-solo-qa-agent.service`: `Result=success`, `ExecMainStatus=0`, 10/10 checks PASS, stored persistent queue result.
- Same time bucket repeat: `idle`, no duplicate.
- STOP file in /var/lib/private/prhm-solo-qa: test returned `stopped`, no new job, previous report retained. STOP removed before enabling timer.
- State is protected via systemd DynamicUser 0700 StateDirectory and 0600 queue. Sandbox `ProtectSystem=strict`, `NoNewPrivileges=yes`, private temporary credential.
- Timer `prhm-solo-qa-agent.timer`: `enabled/active`, OnCalendar `*:0/30`, `Persistent=false`; initial next fire at **2026-11-03 03:00:11 +03:30**. This is not yet evidence of an actual automated run.
- Source unit compatibility checked with server systemd; legacy unrelated service warnings have not been modified.
- 7/7 source contract tests succeeded on production server and GitHub CI green for fixed deployed source.
- Companion systems `prhm-solo-company-runtime`, MCP router, Operations Auditor timer and Executor remained active; Solo health HTTP 200.

## Safeguards and operational status
- No database writes, logins, customer orders, Selenium/Playwright browser activity, JS console checks, arbitrary HTTP targets, shell mutations, AI-generated changes or deployments.
- QA findings are only fixed identifiers with pass/warn/fail and overall severity; no tokens, raw response bodies, addresses, or customer data in queue.
- QA issues currently appear in `queue.json` / journald, **not** Telegram/email; no automatic remediation.
- A failure in a future time slot is persisted; fixed timer continues on its next 30-minute slot.
- Pause: `systemctl disable --now prhm-solo-qa-agent.timer`; `systemctl stop prhm-solo-qa-agent.service`; create `/var/lib/private/prhm-solo-qa/STOP` if fail-closed STOP is required.
- Full status: `SOLO_QA_STATE_DIR=/var/lib/prhm-solo-qa /usr/local/bin/prhm-node /opt/prhm-solo-qa/qa.mjs --status`.

## Next expansions
1. Verify actual first timer-driven WorkOrder and capture evidence.
2. Add issue alerts/digest, calibrated false-positive rules and an operator dashboard.
3. Extend through separately scoped, annotated read-only APIs to Honartik, iMotion, DrTarjomeh and other websites.
4. Fixed `tarjomeh_uat_readonly` currently fails with 403 (registered command policy); resolve it in a reviewed isolated change, do not bypass guard.
5. Automated browser flows and authenticated tests require staging identities with explicit non-production data and separate security approval.

**Separate issue:** formal Universal Installer Root-of-Trust registration remains open; QA sidecar does not alter its status.
