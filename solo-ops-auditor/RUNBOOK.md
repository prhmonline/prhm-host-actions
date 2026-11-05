# PRHM Solo Operations Auditor — release and rollback

**Scope:** Independent, least-privilege **read-only** one-shot monitoring sidecar for the already-running Solo Runtime. It never patches Solo's release, Host Actions V2, Universal Installer or other projects.

## Behavior
- One fixed action: `selfmaint_health`, explicitly annotated `readOnlyHint=true` by Agent2, independently invoked twice.
- Every 15 minutes via `prhm-solo-ops-auditor.timer` (no catch-up at boot). One WorkOrder per UTC time bucket; duplicates ignored.
- Durable `/var/lib/prhm-solo-auditor/queue.json`: atomic temp+fsync+rename+directory-fsync; evidence count, attempts, bounded error codes, final status. Old terminal records are moved to root/private-state `archive/<workorder-id>.json` with `O_EXCL` + fsync before queue compaction at 1024 recent records; no report silently dropped. Never store bearer, request payloads, raw logs or business data.
- Claim leases expire after 2 minutes; a crashed run is retried at most once. Corrupt state fails closed.
- Kill switch: create an empty `/var/lib/private/prhm-solo-auditor/STOP` and stop/disable the timer to halt scheduling. A STOP before remote call prevents execution. `systemctl stop prhm-solo-ops-auditor.service` stops an active run.
- `DynamicUser=yes`, sandbox strict, existing credential copied only to a private ephemeral `RuntimeDirectory` with mode 0400; does not expose secrets via arguments, environment values or reports.
- Audit: `/var/lib/private/prhm-solo-auditor/queue.json` (root view), `journalctl -u prhm-solo-ops-auditor.service`. For a **read-only** latest-five report: service user or privileged operator can run `SOLO_AUDITOR_STATE_DIR=/var/lib/prhm-solo-auditor node /opt/prhm-solo-auditor/auditor.mjs --status`.

## Exact acceptance sequence
1. Review CI and SHA-pinned branch; check `systemd-analyze verify` and no preexisting `/opt/prhm-solo-auditor`, `/etc/systemd/system/prhm-solo-ops-auditor.{service,timer}`.
2. Copy the two reviewed MJS files to a *new* root-owned immutable `/opt/prhm-solo-auditor` using atomic promotion; 0755 dirs, 0644 files. Install the matching fixed service and timer, verify exact file SHA against Git.
3. `systemctl daemon-reload`, run **once** with `systemctl start prhm-solo-ops-auditor.service`, assert `Result=success`, queue status succeeded/evidence_count=2, Agent2 and Solo health preserved.
4. Test duplicate in same time bucket (run second time: should be idle), and STOP in place (must not invoke Agent2); remove STOP and assert state unchanged.
5. Only after gates PASS: `systemctl enable --now prhm-solo-ops-auditor.timer`; inspect next scheduled timer and report zero mutation permissions.
6. Record commit SHA, health, evidence and rollback path. Do not enable write capability or AI code generation in this release.

## Recovery
If a problem occurs: `systemctl disable --now prhm-solo-ops-auditor.timer`, `systemctl stop prhm-solo-ops-auditor.service`; leave queue and audit evidence intact. Do **not** restart or roll back the existing Solo Runtime—its service and state are independent. If needed remove only new auditor unit files after checking precise file SHAs; always retain immutable Git history and audit queue.

**Not included:** live alerts, autonomous code changes, schedules within the primary Solo Runtime, model-based planning, or deployment through Universal Installer. Those require separate reviewed releases and approval.
