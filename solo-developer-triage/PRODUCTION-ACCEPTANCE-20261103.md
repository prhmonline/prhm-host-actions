# Developer Triage Agent — Production acceptance

**Verified:** 2026-11-03  
**Host:** `prhm-production.prhm.ir`  
**Source SHA pinned and deployed:** `4056ae2289d4b43043d9bb0ed80dfed78c0af2b6`  
**Stage:** 1 — QA incident intake, safe deterministic triage, **human-review-only suggestions**  
**Outcome:** **PASS for read-only QA triage**; **NOT** an autonomous code repair/PR publisher.

## Live status
- Dedicated `prhm-developer-triage.service` returns `Result=success`, `ExecMainStatus=0`.
- `prhm-developer-triage.timer` enabled and active. Hourly schedule, `Persistent=false`. First next scheduled run at **2026-11-03 14:00:59 +03:30** at acceptance time; this scheduled trigger had **not yet occurred**.
- Actual root-confined, network-isolated run: `qa_sources_checked=3`, `incident_count=0`, `status=idle`, `new_proposals=0`, `code_changes_made=false`, `pull_requests_created=false`, `production_mutations=0`. Second manual run was also `idle` (no repeated proposals).
- STOP sentinel at `/var/lib/private/prhm-developer-triage/STOP` tested: `stopped` without touching QA sources; removed before timer activation.
- Source QA directories remain owned by their separate service accounts and mode 0700; three queue files mode 0600. No changes made to them.
- Developer state root-owned, mode 0700 under `/var/lib/private/prhm-developer-triage`; all persistent proposals contain only whitelisted IDs, severity, fixed check codes and recommendation codes; no logs, PII, phone numbers, credentials or response bodies.
- Unit runs one fixed `pipeline.mjs --once` under a restricted root UID (necessary on this host because separate QA queue directories are private and dynamic-user prehook could not see them). Exact sandbox: `PrivateNetwork=yes`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `CapabilityBoundingSet=CAP_DAC_READ_SEARCH`, with **only** its own private state dir writable. No network or Git credentials available to this unit.
- A preliminary `DynamicUser` unit failed safely due to private QA visibility and then stale `StateDirectory` layout. It was replaced with the above tested root-confined unit. The exact dedicated state dir is protected; the former unit has no active timer. Earlier failing service logs remain as evidence, not an ongoing incident.
- Source tests **12/12 PASS** on this host. GitHub Actions CI green at deployed SHA.
- Existing QA timers (CF Park, public multi-site, Honartik guest-plan) plus Operations Auditor and Solo Runtime all remained active.

## What happens upon a new confirmed failure
1. Fixed root-confined collector reads only the three approved QA queue files (not arbitrary paths).
2. All source data except sanitized project identifier, QA WorkOrder ID, severity, 20 bounded check codes and timestamps is discarded.
3. An idempotent SHA-256 fingerprint avoids duplicates. Only new failed/warning/critical items from the previous 48 hours generate proposals.
4. A proposal is persisted with a deterministic action code and `status=awaiting_human_review`. `source_repository` and `source_commit` remain `null` until an independent Git source mapping is verified.
5. **No source code, PR, branch, deployment, DB or production service is modified.** A separate reviewed Git-only developer stage is required for branch/patch/CI/PR generation.

## Operator commands
- Status: `SOLO_DEVELOPER_STATE_DIR=/var/lib/prhm-developer-triage /usr/local/bin/prhm-node /opt/prhm-developer-triage/triage.mjs --status`
- Timer: `systemctl status prhm-developer-triage.timer`
- Journal: `journalctl -u prhm-developer-triage.service`
- Stop: `systemctl disable --now prhm-developer-triage.timer`; `systemctl stop prhm-developer-triage.service`. A protected `STOP` file provides an additional tested gate.
- Prior script/unit snapshots (for rollback): `/var/backups/prhm-developer-triage-20261103/`.
- Code: PR #239, deployed SHA above. No direct website or customer data mutations.

**Next release (separate approval):** verified repository mappings, bounded Git branch/patch/test creation and human-reviewed PR opening. Do not enable automated Merge or Production deployment in the developer agent.
