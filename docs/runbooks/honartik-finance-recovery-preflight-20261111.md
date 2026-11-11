# Honartik finance recovery preflight — source-only, no production cutover

**Scope:** one exact finance candidate, app base `4ac602e874a128c3328f27f3dab473857512cdbf`, backend candidate `d1a64e640c9c2cf4788d55566c17728be5813941`, owner OIDC run already consumed and root-only, in environment `honartik-finance-production`. This root audit is **not the finance release executor** and never confers authority to deploy or enable money movement.

## Positive controls (root-only after CI and reviewed SHA)
- Validate exact live base SHA, tracked-clean application tree, disabled iTicket wallet/auto-compensation flags, and 15 approved net changed paths from the *existing* Honartik bare Git mirror.
- Authenticate the one-use finance owner receipt: trusted 0700 root ledger, exactly one 0600 root-owned receipt, exact operation/base/source and identity-workflow SHA. Do not re-use or delete that receipt to rerun releases.
- Select a complete **recent (45-minute)** root-owned central snapshot only. Verify the existing backup service manifest's exact entry, full SHA-256 of `honartik_db.sql.gz`, and full gzip decompression. This step intentionally does NOT restart the expensive central backup service; if no fresh snapshot, fail closed and use the separately established root-operated backup service.
- Import the already installed root-owned restore helper **only if its complete SHA-256 matches**. Reuse its pinned `mariadb:10.11` image and `--network none`, all-capabilities-dropped MariaDB restore, 256 MB packet validation, import, table inventory and Yii `system_db_migration` checking. It must not call the helper's `main()`, copy its routine release report, or mutate live app/DB.
- During the isolated database's read-only probe, verify four finance tables; count restored wallet/checkout records; check compensated checkout has exactly one matching primary wallet credit; reject duplicate iTicket wallet debit/house markers; reject completed/compensated checkout transaction amount/owner mismatch. Do not call a supplier or bank.
- Write only `/var/lib/prhm-honartik-finance-recovery/honartik-finance-recovery-<snapshot>.json` as root 0600, O_EXCL+fsync, never overwrite. Every report says `finance_release_authorized:false`, `production_mutated:false`, `rollback_preimage_verified:false`, `bounded_finance_release_executor_installed:false`.

## Host execution (AFTER source review + green CI)
1. Independently verify PR merge SHA equals official GitHub main and clone the **exact immutable SHA** into a clean root-owned audit directory. Check `git status --porcelain` empty.
2. Verify helper file SHA: `bb6d94b1db5babef628876a41c66178b046f1e983e4a0612700cea55dadb1b61`. Confirm source SHA, parent container isolation and the target app/base before execution.
3. Create only the new dedicated audit directory: `install -d -o root -g root -m 0700 /var/lib/prhm-honartik-finance-recovery`. No sudoers, payments, services, app or database changes.
4. On this production host the default `/usr/bin/python3` is **Python 3.6.8**; the reviewed script requires the already-installed **`/usr/bin/python3.11` (3.11.13)**. Use `PYTHONDONTWRITEBYTECODE=1 REVIEWED_SOURCE_SHA=<merged 40-character main SHA> /usr/bin/python3.11 -B scripts/honartik-finance-recovery-preflight-v1.py preflight` from the pinned clean checkout. It has no `apply`/deploy verb. Never use `py_compile` on this clean Git checkout because it creates untracked `__pycache__` files.
5. Validate successful evidence and unchanged app/frontend/payment flags. If the snapshot is too old, do not fabricate freshness; the separate existing backup service must be run and checked again.

## Non-claims / pending for real release
- **No application preimage or tested rollback** is created by this preflight; untracked customer media must be separately archived safely.
- No conditional release executor is installed, no protected recovery attestation authorizes deploy, no production migration or live payment test is performed. The routine risky-path gate remains fail-closed.
- A future bounded release coordinator must have an independently reviewed restricted root action and revalidate this fresh evidence, exact owner consent, source SHA, tested preimage, idempotency checks and post-deployment health. It must not treat a successful source CI or this preflight as production approval.

## Actual production dry-run and blocked migration history (2026-11-11)

- GitHub reviewed source [PR #271](https://github.com/prhmonline/prhm-host-actions/pull/271), merged SHA `aa85da4b923fd85acb13377220d2ba97d481e76e`. Source-only security CI passed. Error classification hotfix [PR #273](https://github.com/prhmonline/prhm-host-actions/pull/273), merged SHA `02236c60d49af41cd37a8e583bb529303cac1b48`, also passed security CI. Host Python 3.11 unit tests passed: **8/8**.
- Root-owned central snapshot `20261111T092019Z`, `honartik_db.sql.gz` SHA-256 `5adf9397c2cbc8045d29ef7b11bd34ab17ed26a4920106a79f036fa24e85de15`. Manifest digest and complete gzip decompression succeeded: **450,614,682** uncompressed bytes.
- Rehearsal MariaDB (fixed 10.11 image) started in a Docker container with network disabled, and the effective isolated packet limit was **268,435,456 bytes**. Restore/migration audit then **failed closed** with `pending_migrations_in_isolated_restore`. The root-only temporary restore containers were removed automatically. **No PASS attestation was issued.**
- Read-only inspection of the snapshot's SQL showed that table `system_db_migration` exists but contains **zero INSERT statements** in the full dump; the source probe identifies **56 distinct migration filenames** in all its scanned roots. Those include `app/migrations/`, whereas the console's configured `migrationLookup` refers to `@app/migrations/db` plus Rabint and module migration roots. The helper's root inventory may therefore be broader than the actual Yii lookup. Even with that distinction, an empty official general migration table cannot be asserted to have `none_pending` migrations.
- The separate `iticket_migration_history` appears in the backup and has data, but it is **not** equivalent to the general Yii `system_db_migration` ledger.
- After both failed rehearsals: backend stayed `4ac602e874a128c3328f27f3dab473857512cdbf`; frontend stayed `1d8f9c30bda4ab8aab8d87b00e978890aa60efe9`; both finance feature flags remained **OFF**; zero finance-recovery report JSON files and zero temporary restore containers remained.

### Required next resolution (NO database writes)

Build a separate read-only **migration inventory reconciliation** using Yii's actual effective `migrationLookup` and a network-disconnected restored schema. Determine which migrations represent already-existing schema, which belong to unconfigured legacy folders, and which truly require a change. Review any baseline repair or migration operation separately, with its own scoped owner authorization, safety analysis and rollback. **Do not backfill migration history or run `migrate/up` against production** merely to clear this gate. Continue to forbid finance deployment and wallet activation.

## Effective migrationLookup reconciliation (read-only audit, 2026-11-11)

See [Honartik actual Yii effective-migration audit](honartik-finance-yii-effective-migration-audit-20261111.md).
The previously reported 56 filenames came from a broad static scan; the
**registered Yii module lookup** resolves to only 21 active migration PHP files.
For 19 structural migrations, the target tables/columns (including four
custom-prefixed RBAC tables) exist in the verified backup. Two data/seed
migrations remain unverifiable from schema alone. The official
\`system_db_migration\` table has no data in the backup.

This is evidence of a historical migration-state discrepancy; it is **not**
proof that all active migrations executed. The finance restore issuer remains
fail-closed. Neither alter the production migration history nor run migrations
to satisfy this report.
