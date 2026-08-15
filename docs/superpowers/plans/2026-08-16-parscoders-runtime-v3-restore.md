# ParsCoders Runtime-v3 Restore Implementation Plan

> **Execution rule:** implement through a fixed Level-4 Host Action; no direct Production mutation before bootstrap preflight, registration, fresh request, and one-time confirmation.

**Goal:** Complete the previously intended ParsCoders runtime-v3 migration so discovery runs hourly under `drtarjomeh`, uses direct localhost PostgreSQL through a dedicated least-privilege role, and keeps every P0/external-send gate disabled.

**Design:** Keep the existing runtime-v3 collector/scorer business logic state-bound by exact SHA. The helper derives canonical `collector`, `scorer`, and `rules-v3-parscoders.sql` from those exact sources, generates a one-time DB password only on the host, creates `leadops_parscoders` with minimal grants, installs systemd override drop-ins pointing to canonical runtime-v3 paths, validates through a non-committing controlled run, then enables the existing hourly timer. Legacy `/usr/local/sbin` and `/root` scripts remain on disk but are no longer authoritative.

**Safety invariants:** no Docker-group grant; no external bid/proposal/message send; no P0 live/decision enable; no published-outbox/bid-submitted/telegram-send delta; plaintext DB secret never appears in Git, Host Action result, or logs.

## Task 1 — Contract tests (RED)
- [ ] Add `test-v12-parscoders-runtime-v3-restore.js`.
- [ ] Require exact source SHAs, canonical runtime paths, dedicated role, direct `psql`, systemd `User/Group=drtarjomeh`, hourly timer, rollback, and send-safety assertions.
- [ ] Require helper not to grant Docker membership and not to use `leadops_admin`, `leadops_app`, `leadops_p0_shadow`, or `leadops_ro` for runtime execution.
- [ ] Run tests and confirm failure because v12 artifacts do not yet exist.

## Task 2 — Fixed restore helper (GREEN)
- [ ] Add `leadops-parscoders-runtime-v3-restore-v1.js`.
- [ ] Verify exact v3 source SHAs and the current disabled/root-run systemd baseline.
- [ ] Derive canonical collector/scorer/rules without changing filtering/scoring SQL semantics.
- [ ] Generate host-only random DB credential and install `.env` as `0640 root:drtarjomeh`.
- [ ] Create `leadops_parscoders` with only CONNECT/TEMP, schema USAGE, and the exact table grants required.
- [ ] Install canonical files/modes and `40-runtime-v3-canonical.conf` drop-ins.
- [ ] Validate syntax, identity, DB privileges, direct PostgreSQL connectivity, Tor reachability, and a rollback-only SQL exercise.
- [ ] Enable/start the existing hourly timer only after validation.
- [ ] On any failure: disable timer, remove new drop-ins/runtime files, drop dedicated role/grants, restore runtime directory metadata, daemon-reload.

## Task 3 — Host Action v12 registration
- [ ] Add `bootstrap-host-actions-v12-parscoders-runtime-v3-restore.js`.
- [ ] Register `leadops_parscoders_runtime_v3_restore_v1` in Base, executor, MCP enum, Level-4 policy, and fixed dispatch.
- [ ] Update executor version to `1.12.0-host-actions-v2-parscoders-runtime-v3-restore`.
- [ ] Bind bootstrap to exact current control-plane SHAs and helper SHA.
- [ ] Bootstrap preflight must remain `production_mutation=false` and `database_mutation=false`.

## Task 4 — Regression and review
- [ ] Run v12 tests plus all existing Host Action/Company OS tests.
- [ ] Commit only plan/helper/bootstrap/tests to the feature branch.
- [ ] Open PR, verify changed-file scope and mergeability, then merge with head SHA gate.

## Task 5 — Production gated rollout
- [ ] Deploy bootstrap preflight only and independently verify no mutation.
- [ ] Install/register v12 bootstrap; verify control-plane health and protected SHAs.
- [ ] Create a **fresh** Level-4 request via `/v2/host-actions/request`; verify `pending` with `host_action_v2_status`.
- [ ] Require `CONFIRM_LEVEL_4_CRITICAL` exactly once, then apply.
- [ ] Verify timer enabled/active, canonical effective ExecStart/User/Group, dedicated role privileges, source collection freshness, and all send/live invariants.
- [ ] Retire temporary DeployHQ commands to no-op.
