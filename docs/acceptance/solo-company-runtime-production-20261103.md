# Solo Company Runtime — Production acceptance report

**Date:** 2026-11-03  
**Host:** `prhm-production.prhm.ir`  
**Scope:** Owner-authorized, one-time emergency deployment, outside the formal Provider/Universal Installer Root-of-Trust pathway  
**Verdict:** **PASS for operational runtime acceptance**; **NO-GO for claiming formal Universal Installer/Host Actions V2 registration**.

## Immutable installation evidence

- Deployed release SHA: `0eb43d72aab3f10db22172c8be4c0411cf22d074`.
- Source Git commit (Solo core): `02966549a751c16b582ce17d15a1e2cf8a22f0fb`.
- Source SHA256: `a93abca70f158729e0e22d39717a6e10a4025b18c44bf60a774ce3bf63fa41dd`.
- Emergency installer tested source commit: `08972e874dac09b6905f57ec19d8ac41122a6f6f` (PR #233); 5/5 node tests PASS and GitHub CI success.
- Transient installer unit: `prhm-solo-operator-emergency-v5`, result `SUCCEEDED`. Signed Provider permit: **none**, authorization: explicit owner emergency exception in chat.
- Runtime: `prhm-solo-company-runtime.service`; `systemctl active`, `enabled`.
- 28/28 embedded release code asset SHA256 verified against the actual deployed `/opt/prhm-solo-company` tree.

## Live acceptance

| Gate | Evidence |
|---|---|
| /health | HTTP 200; `ok=true`; heartbeat fresh |
| /status | HTTP 200; `state=running`; `queue_depth=0` |
| Dark-mode | retrying=0, blocked=0, awaiting_approval=0, completed_total=0, failed_total=0, worker_busy=false |
| Isolation | `127.0.0.1:8782` and MCP `127.0.0.1:8123` LISTEN only |
| Sandbox | `DynamicUser=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=yes` |
| Credential | private original `/etc/prhm-solo-company/agent2.bearer` root 0600; runtime copy under `/run/prhm-solo-company` dynamic user 0400 |
| Service restart | MainPID changed and remained `active`, health 200, no automatic restarts |
| State directory retention | temporary, nonsensitive marker survived service restart, verified then deleted |
| File-store idempotency | `JsonFileStore` isolated write and new-instance read test PASS, production queue/data untouched |
| Surrounding services | MCP router, Self-maint Executor, Approval remained active |

## Disaster recovery snapshot

- Protected server path: `/var/backups/prhm-solo-company-acceptance/` mode 0700.
- Archive: `solo-runtime-release-0eb43d72-20261103.tar.gz` mode 0600.
- Archive SHA256: `87f25cb93e348e96375403d571cbdfe5624a8d9338a334e9dc852a388ad62131`.
- Archive size: 3,425,648 bytes.
- Restored **in isolated temporary filesystem**: archive SHA256 verified; 3,647 regular files matched the active installed tree; `systemd` unit content matched. Temporary restoration deleted afterward.
- Secret credential files were deliberately excluded; future disaster recovery must re-provision the credential securely rather than restoring it from this archive.
- Empty production state directory not archived. No live user workload or real production data was created.

## Limitations and outstanding separate work

1. **No full host reboot performed.** It would interrupt unrelated production services. Service restart + data directory persistence + enabled-unit configuration were verified.
2. **No destructive live uninstall/rollback performed on the healthy runtime.** Earlier failed attempts reported rollback; isolated filesystem rollback/fault tests passed. Full recovery from a server failure needs a separate controlled environment.
3. **No real customer/job/work-order persistence exercised** because runtime is in dark mode; isolated file-store persistence and runtime state-directory survival passed.
4. **Formal Universal Installer / signed Provider Root-of-Trust integration remains open.** It needs independent signed initial registration, a trusted dispatcher, review of PR #60 (sshagent) and PR #232 (prhm-host-actions), and its own scoped critical Level-4 receipt; existing Host Actions V2 registry does not have the Solo registration/install actions. The emergency exception does not close this gate.
5. Do not reuse the emergency unit as an unaudited, recurring deployment mechanism or patch active Host Action registries by copying JS files.

**Acceptance:** Runtime installation and operational QA are complete; formal Installer registration is NOT complete.
