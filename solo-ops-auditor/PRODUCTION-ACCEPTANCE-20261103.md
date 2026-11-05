# Solo Operations Auditor — Production acceptance

**Host:** prhm-production.prhm.ir  
**Date:** 2026-11-03  
**Operational verdict:** PASS — **read-only** recurring monitoring only.  
**Deployed immutable source SHA:** `8ebc54abff5692ff6fc232b66b85c61c5169a006`.

## Acceptance evidence

- `prhm-solo-ops-auditor.service`: dedicated oneshot with DynamicUser, ProtectSystem=strict, NoNewPrivileges, 0700 StateDirectory, 0400 ephemeral credential and read-only `selfmaint_health` capability only. No mutation tools enabled.
- `prhm-solo-ops-auditor.timer`: enabled/active, OnCalendar `*:0/15`, Persistent=false, RandomizedDelaySec=20s. Confirmed actual automatic trigger at **2026-11-03 02:30:18 +03:30**, ending **02:30:29** with `succeeded`.
- First manual WorkOrder `ops-health-1992955`: succeeded, 1 attempt, 2 verification evidences. Re-run in same bucket: `idle`, no duplicate.
- STOP gate test at 02:28:26 local: `stopped` and executed=false, queue unchanged. STOP removed before enabling the recurring timer.
- Actual timer-triggered WorkOrder `ops-health-1992956`: succeeded, 1 attempt, 2 verification evidences.
- `/var/lib/private/prhm-solo-auditor/queue.json`: owner dynamic service UID, mode 0600, directory mode 0700. No credentials or raw secrets persisted.
- Queue crash recovery, lease expiration, bounded retries, idempotency and corrupt-state denial verified. 8/8 Node tests PASS on host, CI green.
- Long-term retention: when recent queue reaches 1024 records, 512 oldest terminal records are fsynced as separate immutable files under `archive/` before compaction; tested 512/512 archival records.
- Installed code root-owned, mode 0644. Source SHA pinned on disk at `/opt/prhm-solo-auditor/.source-sha`.
- Pre-archive source snapshot retained at `/var/backups/prhm-solo-auditor-20261103/queue.mjs.before-archive`.
- Existing `prhm-solo-company-runtime.service`, Agent2 MCP and Executor remain active; Solo health HTTP 200.

## Operator checks

- Timer: `systemctl status prhm-solo-ops-auditor.timer`
- Last tasks: `SOLO_AUDITOR_STATE_DIR=/var/lib/prhm-solo-auditor /usr/local/bin/prhm-node /opt/prhm-solo-auditor/auditor.mjs --status`
- Live journal: `journalctl -u prhm-solo-ops-auditor.service --since today`
- Suspend immediately: `systemctl disable --now prhm-solo-ops-auditor.timer`; `systemctl stop prhm-solo-ops-auditor.service`; create `/var/lib/private/prhm-solo-auditor/STOP` when persistent fail-closed shutdown is needed. Does not require restarting Solo.

## Remaining product capabilities

**Not yet implemented:** Telegram/email alerts, customer/business-site checks, automatic code changes, deploy permissions, LLM agent planning, and QA/Developer/Release agents. This release monitors only the fixed Agent2 self-maintenance executor. A health failure becomes a durable `failed` record; no notification is sent. Do not represent this single-role read-only auditor as a fully autonomous engineering organization.

**Separate infrastructure issue:** Formal Solo integration with the Universal Installer / signed Root-of-Trust remains open in PR #232; it is not required for the independent, read-only monitoring sidecar.
