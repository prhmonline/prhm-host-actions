# Solo CF Park QA Agent — operational runbook

## Scope
One **fixed** read-only pilot: CF Park. No external project selection, arbitrary commands, API write methods, authenticated website login, database writes, AI-generated scripts, shell executor or production release permissions.

Every 30 minutes, the separate `prhm-solo-qa-agent.timer` runs a bounded one-shot WorkOrder:
- Agent2 `cfpark_readonly_audit` (backend document root verified, public venue API HTTP 200, venue record count)
- Agent2 `source_mapping_git_status_readonly` with **fixed** target `cfpark_front_prod` (valid Git SHA, `main` branch, clean working tree)
- Two fixed unauthenticated public HTTP smoke checks: `https://cfpark.ir/` and `https://dashboard.cfpark.ir/` with redirect disabled and an 8-second timeout
- Re-run fixed API audit for independent verification. All MCP tools must carry `readOnlyHint=true` and their input schema must match the fixed allowlist. No credentials sent to public websites.

## Finding severity
- `critical`: API/tool failure, backend root mismatch, invalid Git SHA, inaccessible site or failed independent verification. WorkOrder status `failed`; subsequent time bucket still retries once every 30 minutes.
- `warning`: site data missing, Git dirty or Git branch other than `main`, while basic health remains valid. WorkOrder can be `succeeded` with warning severity.
- `none`: all 10 checks PASS and verification succeeds.

All findings are persisted as **fixed codes only**, not raw response bodies, phone numbers, tokens or other personal data.

## Durable queue and fail-safe
State: `/var/lib/private/prhm-solo-qa/queue.json`, mode 0600 in DynamicUser StateDirectory 0700. One WorkOrder per 30-minute time bucket. Queue uses atomic rename+fsync and up to two attempts on an expired lease. Existing corrupted queue fails closed. Reports over capacity are fsynced to `archive/` before compaction; queue keeps 512 recent entries.

Kill switch:
`systemctl disable --now prhm-solo-qa-agent.timer`, `systemctl stop prhm-solo-qa-agent.service`, and create protected file `/var/lib/private/prhm-solo-qa/STOP` to prevent MCP requests. Test STOP before enabling timer.

## Acceptance
1. Git SHA-pinned source + CI tests pass.
2. Verify both unit files on this server's systemd and inspect no preexisting auditor target collision.
3. Atomically stage root-owned MJS files to `/opt/prhm-solo-qa`; install exact source-matching systemd unit and timer, `systemctl daemon-reload`. Do **not** alter the existing Solo runtime unit.
4. Manually run `prhm-solo-qa-agent.service`: require `Result=success`, one durable report, ten checks and independent evidence, zero mutation. Re-run: expect `idle` (no duplicate).
5. STOP test: require `stopped`, no new job. Remove STOP after test.
6. `systemctl enable --now prhm-solo-qa-agent.timer` only after successful gates.
7. Validate actual timer-triggered report, credential isolation, current Solo/Agent2 health; record production acceptance in PR.

Operator read-only status:
`SOLO_QA_STATE_DIR=/var/lib/prhm-solo-qa /usr/local/bin/prhm-node /opt/prhm-solo-qa/qa.mjs --status`

## Limits / remaining expansion
This initial QA does not inspect tickets, customer purchases, authenticated admin flows, browser rendering/screenshots, JS console errors, database reconciliation, or other sites. `tarjomeh_uat_readonly` currently returns a 403 due to fixed command policy; do not bypass that policy or include that test until the registered action is properly fixed. QA reports are available through queue/journal; no Telegram/email alert is enabled. This sidecar does not solve formal Universal Installer Root-of-Trust integration, and does not automatically fix anything.
