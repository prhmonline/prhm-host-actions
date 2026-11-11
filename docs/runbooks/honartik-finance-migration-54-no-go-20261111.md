# FINANCE RELEASE NO-GO — actual Yii migration discovery (2026-11-11)

## Corrected inventory — authoritative for the current production source

**Do not use the earlier 21/26-file static-count reports to approve migration or finance deployment.** Their path-only scans excluded the Yii controller's inherited/default `migrationPath`. The actual `rabint\commands\MultiLocationMigrationsController::lookupMigrations()` implementation merges `migrationLookup` with `migrationPath`, then runs PHP `glob` for matching `mYYMMDD_HHMMSS_*.php` classes. It finds classes not directly listed in `console/config/web.php`.

Read-only on `prhm-production.prhm.ir` at backend HEAD `4ac602e874a128c3328f27f3dab473857512cdbf`:

| Source | Matching migration files |
| --- | ---: |
| Default/inherited `app/migrations/` | 28 |
| Explicit configured core `@rabint/migrations/db`, plus registered module roots | 26 |
| **Actual effective union (unique class names)** | **54** |

An independent in-server read-only reconstruction produced the count **54** (lookup digest `4f346745384822202b0002aab3ca0a6ac9f7d8a81535a5600e4dcf2bc3939b30` for sorted class names and relative file paths). This agrees with the independent prior U05 read-only execution of the Yii controller, reported on 2026-11-09. The previously published **23/26 structural matches and 3 seed unknowns refer ONLY to the 26-file subset** and are *not* a complete inventory. Do not infer 23/54, or assume the other 28 are safe.

## Verified current blockers from the complete 2026-11-11 backup

Snapshot `20261111T092019Z` of `honartik_db`: 69 SQL CREATE TABLE objects. Backup SHA256 `5adf9397c2cbc8045d29ef7b11bd34ab17ed26a4920106a79f036fa24e85de15` was matched to its root-owned snapshot manifest and the gzip stream was decompressed completely. In the snapshot:

- General Yii `system_db_migration` table exists but has **no INSERT statements** (no recorded migration rows). This does NOT prove any of the 54 classes were executed.
- `finance_transactions.paying_amount` **absent**.
- `sold_event`, `sold_event_schedule`, `sold_event_schedule_reserve` **absent**.
- `account_settlement` table **present**; its required current-model columns still need review. Do not assume the current PHP model can operate correctly against this schema.
- The app-specific `iticket_migration_history` is separate; it cannot be used to backfill general Yii migration history.

The existing U05 evidence includes an actual isolated-clone six-class Yii migration rehearsal for known schema gaps, 6/6 success, but no historical-ledger provenance and **zero production migration writes**. That rehearsal is NOT a production authorization. It must not be confused with the independent finance checkout/compensation release candidate.

The root-only finance recovery preflight ran an isolated MariaDB restore and **failed closed** with `pending_migrations_in_isolated_restore`; no finance release readiness report was issued. The routine root helper `honartik-backend-prepare` correctly rejects financial paths (`manual_review_required_for_path`), and a separately scoped finance release executor with tested app/media preimage and rollback is **not installed**.

## Correct next action (never a blind migrate/up)

1. Freeze the exact 54-class inventory and compare the *full* list, code hashes and changed target schema/indexes/constraints with the restored source+database. Do not omit the 28 legacy `app/migrations/` classes.
2. Determine whether each historical migration is already represented in the schema, genuinely pending, incompatible with current model, or a potentially dangerous seed/replay. Do **not** fabricate migration history, replay any seed, or run a mass migration.
3. Design and test on a fresh isolated clone **only** the exact missing forward schema changes with data invariants, foreign-key behavior, code hashes, reversible release preimage and stop/go gates. A prior successful test of six Yii classes on a clone is useful evidence, not permission for live use.
4. Implement and review a separately authorized, fixed-scope root finance release coordinator with fresh bound restore proof, tested rollback, explicit owner release approval and both payment flags OFF during first cutover. Until all checks are present, **finance publication remains NO-GO**.

## Evidence and references

- Read-only U05 source/DB migration analysis, earlier 54-file inventory: [deploy-control issue #78](https://github.com/prhmonline/deploy-control/issues/78).
- Prior isolated cloned Yii six-class test: same U05 issue #78.
- [Root finance recovery preflight](honartik-finance-recovery-preflight-20261111.md).
- [Earlier partial audit superseded by this correction](honartik-finance-yii-effective-migration-audit-20261111.md).
- Production backend `4ac602e874a128c3328f27f3dab473857512cdbf`; frontend `1d8f9c30bda4ab8aab8d87b00e978890aa60efe9`. Both finance flags absent/OFF at last read; `finance_release_authorized=false`.

**Status:** Migration-scope correction documented; production migration and financial release tasks OPEN/BLOCKED, not completed. No code deployment, wallet movement, migration-history changes, or live schema writes are authorized by this report.
