# Honartik Root Installer — isolated real-disk crash recovery evidence

**Date:** 2026-10-18  
**Scope:** Four-owner filesystem transaction rehearsal on scratch files created by the GitHub Actions Runner, **not the production control-plane owner files**.  
**Status:** `REAL_DISK_SCRATCH_TESTS_GREEN; LIVE_INSTALL_NOT_AUTHORIZED`

## Evidence

- [First on-disk test run: 15/15 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39073440420).
- [Hardened compare-and-swap on-disk test run: 19/19 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39073543699).
- Earlier fake adapter state-machine tests: [24/24 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39072923022).

## Source in draft PR #210

- `honartik-iticket-root-installer-disk-fixture-v1.cjs` is **scratch-only**: creates its own `prhm-iticket-tx-fixture-*` directory under the operating system temp root; checks directory ownership, refuses symlink owners, uses bounded keys and transaction IDs, and has no production owner paths or ability to restart services.
- The fixture adapter uses real file writes, file `fsync`, atomic rename and parent-directory `fsync` for candidate changes, backups and journal records.
- `test-honartik-iticket-root-installer-disk-fixture-v1.cjs` exercises **real** before/after rename failures for each of four files; committed SHA/metadata, rollback SHA/metadata and idempotent recovery; an actual child process exits immediately after its second file rename, leaving persistent disk journal and a stale scratch lock, and an independent follow-on recovery restores four original owner files.
- Later hardening asserts **compare-and-swap** on owner and staged candidate digest/UID/GID/mode immediately before rename, and current owner SHA immediately before rollback write. Any concurrent third-party drift blocks overwrites rather than ignoring it.

## Test results, not promises

| Case | Outcome |
| --- | --- |
| Disk-backed commit + SHA/UID/GID/mode | PASS |
| Failure before and after each of 4 renames | PASS |
| Hard process exit after second rename, recover in new process | PASS |
| Persistent journal and verified rollback | PASS |
| Corrupted saved backup | FAIL CLOSED |
| Unexpected third-party change before recovery | FAIL CLOSED |
| Concurrent changed owner between candidate staging and rename | FAIL CLOSED |
| Tampered candidate/stage permission changed | FAIL CLOSED / rollback |
| Concurrent modification just before restore | FAIL CLOSED |
| Path traversal/symlink protection in scratch tree | PASS |
| Actual production rollout/restore | NOT TESTED |
| Real outage/power-loss persistence across hardware storage caches | NOT PROVEN |
| Production root owner source anchor compatibility and patch semantics | NOT TESTED |
| Trusted signed Level-4 root adapter and rollback runbook | NOT INSTALLED |

## Important caveats

This adapter explicitly supports only a **self-created scratch tree**. Its stale PID lock handling is not adequate for a privileged production installer due to potential PID reuse and cross-process race; a genuine production adapter must use a trusted kernel lock, hardened symlink-resistant filesystem operations, crash-safe fsync and directory semantics on the actual target filesystem, and an authorized recovery service. Parent-directory fsync success in CI is not proof of durability during a power failure on the real server's storage stack.

The worktree helper action that triggered the original failed installer is `honartik_git_worktree_fixed_v1` and is explicitly `production_deploy:false`. Even a safe installation of that action does not deploy the latest iTicket payments functionality.

## Remaining deployment gates

1. Read-only **actual live four-owner source and patch-anchor** check against the supplied `host-action-v2-installer-v1.js` (real `base()`, `execPatch()`, `policy()`, `mcp()` transforms). The old anchor literals might not match the current control-plane code. Capture all postimage SHA, syntax and effective typed policy at this step.
2. Convert reviewed transaction logic into a separately signed, fixed-root adapter with genuine durable backup+journal and verified rollback, per-service graph and crash recovery; test with real filesystem/sandbox using reviewed live owner byte copies and negative injection cases. Do not reuse the scratch PID lock for privileged execution.
3. Obtain a **fresh one-time Level-4 critical signed authorization** binding exact installer source preimage, four live owners, postimage hashes, helper state version and new reviewed source SHA. Previous failed request `e49ab4f9-e5f2-42ab-9da1-581c1533c479` has consumed its approval; cannot retry it.
4. Register the correct SHA-bound iTicket dark deploy action separately, after this worktree helper action, and independently rehearse MariaDB 10.6 financial migrations before any bank/SAMFA checkout; no Honartik web Staging.

**Production mutation: NO. Payments or emails: NONE.**
