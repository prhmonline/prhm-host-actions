# Honartik U06 — exact Level-4 native backup Host Action registration candidate

**2026-11-10 • Source-only / NO PROVIDER REGISTRATION / NO PRODUCTION APPLY.**

## Verified problem

- The current installed `honartik_back.production` has no private `/etc/deploy-control/secrets/honartik_back/mysql.cnf`; installed `credential_file()` raises `FileNotFoundError`.
- The root-owned profile has `backup.offsite_required=false`; its preimage SHA256 is `79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698`.
- Installed `universal/adapters/database.py` SHA256 is `d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3`.
- The full Honartik database was recovered directly from encrypted Node1 restic snapshot into `--network=none` MariaDB and passed `mysqlcheck`. Minimum-grant dump on the restored 69-table database passed with `SELECT, SHOW VIEW, TRIGGER, EVENT` scoped to `honartik_db.*`. The **installed** Universal `backup_database()` and `verify_database_restore()` were also invoked successfully on an isolated single-table fixture; this is not a native Production backup.
- Local Production source Git is untouched by these tests. This does **not** clear U03 PHP/Apache admission or U05 Yii historical migration admission.

## What this source branch provides

The file `honartik-u06-native-backup-registration-review-v1.cjs` is deliberately a pure zero-I/O source contract. It fixes action `honartik_u06_native_backup_register_v1`, `host_action.` scope, Level 4, exact root-only profile and credential paths, preimage hashes, database identity, minimum grants, rollback, remote recovery freshness, and signed-once approval conditions. It cannot execute a command, mint/consume an approval, install a file, create a MySQL account or register itself. Even a perfectly green set of claimed booleans **cannot** authorize Production. Tests and GitHub CI are source-only.

## Required trustworthy registration (a separate action, not achieved by merge)

The installed Host Actions v2 request API accepts **only fixed staged actions** and currently has no `honartik_u06_native_backup_register_v1` binding. Do not call another registered action, use `selfmaint_request` as a generic root executor, modify the registry via SSH/RDC, or invent an approval token. The existing Honartik installer Issue #217 has its own **different** trust and release scope; it cannot authorize U06 backup secrets.

1. **Trusted provider enrollment:** The independent Root-of-Trust owner must review and pin a genuine Provider public key / signed manifest, and install the exact action's four owner bindings (API, Executor, Policy, MCP) through the existing atomic, rollback-safe registration framework. A GitHub merge or a synthetic fixture is *not* evidence of registration. No bootstrap signer is provided in this source.
2. **Two-commit source identity:** commit the handler contract, tests and CI first; place a review manifest in a second commit naming immutable `source_commit` and source Git blob hashes. A separately registered trust bridge must retrieve and verify *exact* bytes, hash the manifest, and bind both commits to Ed25519 one-time approval. Never use a self-referential SHA.
3. **Preflight:** Independently recheck on-host adapter SHA `d81223...`, profile SHA `797838...`, root ownership/modes, no symlinks, MariaDB server host and `honartik_db` identity, current central backup and recovered Node1 snapshot, independent financial aggregates and restart/rollback capacity. **STOP on drift.** The source reviewer cannot attest a live host.
4. **Fresh authorization:** Require a user-approved **Level-4** operation with signed Ed25519 token, exact action+preimages+manifest+source hashes, 180-second maximum validity, one-time consumption and durable root-side execution fence. A chat confirmation without cryptographic approval is not a substitute.
5. **Bounded root transaction:** The future trusted executor may create *only* `honartik_universal_backup`@`127.0.0.1` restricted to `honartik_db.*` with exactly `SELECT, SHOW VIEW, TRIGGER, EVENT`, no global/write/admin privilege. Generate a fresh secret entirely in the privileged executor (not CLI argv, shell history, logs, Git, chat, or PRs); store `[client]` options atomically at the exact path with root/private `0600` owner mode and `0700` parent. Preserve unrelated accounts and secrets.
6. **Native proof:** Run the actual installed `backup_database()` against the approved Production DB in *read-only dump mode*, never `yii migrate`. Run `verify_database_restore()` on a digest-pinned bounded networkless MariaDB clone; also independently run full `mysqlcheck` and compare table/FK, finance, wallets and reservation aggregates. Persist root-owned evidence only after real success and ensure all scratch containers are deleted.
7. **Offsite enforcement and persistence:** Through a separately reviewed profile transition set `backup.offsite_required=true`, bind current Node1 encrypted restic remote restore to the native backup manifest and enforce a fresh (max 30 hours) offsite recovery proof in the actual installed release admission. Verify restart persistence.
8. **Crash-safe recovery:** Before mutations, durable-journal preimage bytes/modes and any newly created user/file, `fsync` journal and lock, verify rollback under injected failure. If rollback cannot be fully proven, **STOP and retain recovery state**, never claim success. Avoid revoking an existing user or overwriting existing secrets on rollback.
9. **Separate production readiness:** Successful U06 permits only a separate signed U03/U05 release review. **Never auto-deploy Backend, switch Apache, or alter Yii migration history.**

## Current disposition

The candidate in this PR is **not registered, not installed, not authorized, not a live backup**, and does not modify Production. U06 Issue #75 remains **OPEN** until approved root enrollment, fresh one-use Level-4 approval, native backup and restore proof, and actual mandatory offsite policy are all verified.

Read-only evidence and latest test history: [U06 Issue #75](https://github.com/prhmonline/deploy-control/issues/75#issuecomment-6752864547), [U06 source/draft PR #80](https://github.com/prhmonline/deploy-control/pull/80). Related shared registry boundary: [PRHM-ACTION-REGISTRY-ONBOARDING-STANDARD.md](../../PRHM-ACTION-REGISTRY-ONBOARDING-STANDARD.md).
