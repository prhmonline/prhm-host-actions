# Honartik root installer — crash recovery prototype and release gate

**Date:** 2026-10-18  
**Status:** `SOURCE-ONLY / FIXTURE-PASS / PRODUCTION INSTALL BLOCKED`  
**Affected installer:** `/opt/prhm-agent-selfmaint-exec/actions/host-action-v2-installer-v1.js`  
**Original SHA:** `0f76d3ad65ba267c045dd545d249e0b2083f4aedf8983a109d3ee6446686fa1d`  
**Operator-verified rebind candidate SHA:** `7849b1c458c71fce7a6aecc1696cead441a209cb515f191fc5d0fad61a53adcc` (four owner strings only, not installable)

## Changes committed in Git (not on Production)

- `honartik-iticket-root-installer-transaction-engine-v1.cjs`: fixture-only four-owner transaction lifecycle, checks preimage bytes/hash and UID/GID/mode, verifies backups, requires durable-intent journal confirmation before every rename, scans all four current owner SHA after a failure, rolls back altered files in reverse order and re-verifies restored metadata and runtime health.
- `test-honartik-iticket-root-installer-transaction-engine-v1.cjs`: test cases for failure immediately before/after each of four renames, staging failure, inode metadata drift, runtime health failure, false durability, journal errors, crash-after-rename replay, unknown third-party SHA, restore failure/retry, and cleanup warnings.
- `.github/workflows/honartik-iticket-root-installer-transaction-fixture-ci.yml`: independent Node 20 test on GitHub-hosted runner, **24/24 PASS**, [run #39072923022](https://github.com/prhmonline/prhm-host-actions/actions/runs/39072923022).

**Safety boundary:** this module has NO filesystem or process APIs and refuses every mode except `isolated-fixture`. It is not an alternative privileged runtime and cannot install, register, restart, or deploy to the production host. Its fake-adapter durable receipts do not prove actual disk `fsync`; tests cover state-machine behavior, not physical-power-loss guarantees. It is *not* a drop-in replacement for the 8.2 KB root-owned installer.

## Exactly what remains before any signed root install

1. **Read-only actual-source compatibility:** apply the existing installer `base()`, `execPatch()`, `policy()`, `mcp()` transformations to verified *current* four-owner texts in a sandboxed read-only preflight; check all exact patch anchors and postimage JS/JSON. This has not been done. Do not assume re-pinning four SHA literals guarantees that source patch anchors match.
2. **Verified current helper state:** read `control-plane-root-installer-v1/state.json` and the SHA of `honartik-git-worktree-fixed-v1.js` without exposing secrets; verify exact action identity, intended helper code and service topology. This action registers **Git worktree preparation**, not iTicket payment deployment.
3. **Implement trusted, authorized disk adapter:** restrict to the exact four owner paths, validate original UID/GID/mode and symlink-free paths, durable backups and manifest with `fsync` of file and parent directory, crash-safe journal recovery across service restart/reboot, exclusive lock, same-filesystem atomic rename and metadata preservation, rollback with SHA and health verification. Rehearse on temporary filesystem with real renames and injected failures (not just in-memory fakes).
4. **Review resulting owner postimages:** freeze all four expected postimage SHA digests, validate Approval Center policy schema (fresh single-use Level-4 critical, TTL and typed scope) and active systemd blue/green topology. No broad unreviewed four-service restart.
5. **Independent signoff:** stage installer in a fixed signed transport from reviewed source commit and immutable postimage SHA, obtain a *fresh* scoped Level-4 confirmation only after all gates pass. The earlier failed request `e49ab4f9-e5f2-42ab-9da1-581c1533c479` was consumed and must never be reused.
6. **Separate actual Honartik release:** a successful Git-worktree-action registration is NOT a payment fix. Register subsequent SHA-bound dark deploy independently. Before live checkout, complete MariaDB 10.6 isolated migration rehearsal and SEP/Saman, iTicket wallet/confirm/cancel, SAMFA and refund end-to-end checks. Do not use abandoned Honartik web Staging; do not email users.

## Operator-visible status

- Root incident `baseline_drift:base`: identified; all four old-vs-live SHA drifts confirmed.
- Root installer unmodified and previous Host Action failed / approval consumed.
- Transaction rollback **algorithm** exercised in fixtures: PASS (24/24), not yet verified on real production installer or durable disk.
- Agent 3 health: OK on 2026-10-18 read-only check; `honartik_git_worktree_fixed_v1` and new iTicket dark-deploy action absent from live action inventory.
- Production mutation, financial operation and email: **NONE**.

**Decision:** no privileged write, release or financial enable until gates 1–5 are evidenced and fresh signed approval is explicitly provided.
