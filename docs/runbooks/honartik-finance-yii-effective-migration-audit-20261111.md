# Honartik finance: actual Yii migrationLookup vs restored-schema reconciliation (read-only, 2026-11-11)

## Decision and trust boundary

**No migrations, no migration-history backfill, no production release.**
Root-only, read-only investigation of the existing application configuration, PHP migration sources, Composer PSR-4 module registrations, and the previously verified, COMPLETE backup. No use of the live database or client/payment credentials. Snapshot schema presence is **not** proof that a migration was executed.

Production backend HEAD: `4ac602e874a128c3328f27f3dab473857512cdbf`.
Frontend HEAD: `1d8f9c30bda4ab8aab8d87b00e978890aa60efe9`.
Proposed finance backend source: `d1a64e640c9c2cf4788d55566c17728be5813941`.
Both /etc/honartik/iticket-wallet.enabled and /etc/honartik/iticket-auto-compensation.enabled remain **absent/OFF**.

Backup snapshot: `/var/backups/prhm-central/20261111T092019Z/db/prhm-mariadb/honartik_db.sql.gz`,
SHA-256 `5adf9397c2cbc8045d29ef7b11bd34ab17ed26a4920106a79f036fa24e85de15`. Its manifest, digest and full gzip stream were verified in the prior root isolated restoration rehearsal. The archive contains **69 CREATE TABLE objects**. Read-only SQL dump inspection found a CREATE TABLE for `system_db_migration` but **zero INSERT statements** for it. This is authoritative for the snapshot only; it is not a current live-DB query.

## Correct Yii lookup resolution

The actual `console/config/web.php` configures `rabint\\commands\\MultiLocationMigrationsController`, `migrationTable={{%system_db_migration}}` and `migrationLookup` from:

1. `@rabint/migrations/db` resolves, via `common/config/bootstrap.php`, to `vendor/rabint/base/migrations/db` (**5 migration files**); `@app/migrations/db` exists but is empty. Confirmed by the exact `Yii::setAlias('@rabint', RABINT_BASE_DIR . '/vendor/rabint/base')` definition and Composer's `rabint\\` PSR-4 mapping.
2. `common/config/apps.php` registered application paths (`app/migrations/db`, empty).
3. `modulesPath('migrations/db')`, using **registered** module classes from `common/config/modules.php`, not every directory under `app/modules` or `vendor/rabint`. Composer PSR-4 was independently read for the relevant vendor modules.

The current registry contains 12 module classes; 11 resolve to an application or vendor module namespace relevant to path lookup, with **9 registered module roots containing 21 migration PHP files**. The separate core `@rabint` root adds **5** more, totaling **26 effective migration files**:

| Actual migrationLookup root | Effective files |
| --- | ---: |
| **@rabint → vendor/rabint/base/migrations/db** | **5** |
| app/modules/finance/migrations/db | 5 |
| app/modules/user/migrations/db | 8 |
| app/modules/page/migrations/db | 1 |
| vendor/rabint/attachment/migrations/db | 1 |
| vendor/rabint/contact/migrations/db | 1 |
| vendor/rabint/notify/migrations/db | 1 |
| vendor/rabint/option/migrations/db | 1 |
| vendor/rabint/pm/migrations/db | 1 |
| vendor/rabint/stats/migrations/db | 2 |
| **Total** | **26** |

The previously broad root-helper file scan counted **56 unique filenames**, including `app/migrations/*.php` (28 legacy files outside the configured lookup) and other unregistered vendor/module roots. In particular, `app/modules/logistic/migrations/db` is not present in the registered modules; its absent `lgst_price` tables **must not** be treated as a pending effective Yii migration without rechecking the registry. The existing helper conservatively fails closed; its strictness is not permission to rewrite migration history.

## Existing schema evidence (NOT a proof of applied migrations)

| Classification | Count | Backup schema evidence |
| --- | ---: | --- |
| createTable migration | 18 | Every expected table name exists (including four core Rabint tables: `session`, `system_city`, `system_log`, `system_change_log`) |
| addColumn migration | 4 | Every statically declared target column exists |
| inherited RBAC schema migration | 1 | All four configured custom RBAC tables exist |
| data/seed migration | 3 | Cannot be established from table/column presence |
| **Total effective** | **26** | **History remains unrecorded in snapshot** |

RBAC clarification: `app/modules/user/migrations/db/m140703_123813_rbac.php` extends Yii's `m140506_102106_rbac_init` (four CREATE TABLE operations). The active auth manager `common\\models\\base\\DbAuthManager` overrides the standard Yii table names with `user_rbac_auth_item`, `user_rbac_auth_item_child`, `user_rbac_auth_assignment`, and `user_rbac_auth_rule`. **All four of these custom tables exist in the verified backup**. The absent unprefixed `auth_item` and `auth_rule` tables are therefore not evidence of a missing RBAC migration.

Unverified data migrations requiring separate read-only per-row semantic analysis without printing credentials/PII:
- `vendor/rabint/base/migrations/db/m191104_151812_city_seed_data.php` — core city seed (`batchInsert`).
- `app/modules/user/migrations/db/m150725_192740_seed_data.php` — user/profile data insert.
- `app/modules/finance/migrations/db/m220803_171721_seed_create_account_user.php` — user data insert/update.

No schema migration is recorded in the snapshot's `system_db_migration` table; do **not** label the 23 structural cases as positively executed. Existing table names and column names support only `schema_present_history_absent`, not `migration_applied`. Indexes, constraints, seed contents, and actual production DB migration state require separate proof.

## Required decision for finance release readiness

1. Preserve the existing finance routine `RISK_PATH` fail-closed gate. Do not bypass it or use `migrate/up` against production.
2. Complete schema/index/constraint fingerprint comparison between each actual effective migration definition and the verified isolated database; independently verify **all three** seed migrations without exposing or changing customer data. Read-only probes only; do not generate a false PASS attestation.
3. Establish why `system_db_migration` has no rows even though 23 structural migration targets exist. A one-off signed, minimal, reversible reconciliation of historical state may be considered **only after** historical provenance and restore tests establish which migrations were really applied; history must never be fabricated.
4. Only after a new independently reviewed root-owned migration/restore gate can issue genuine exact-SHA evidence, implement a separate constrained finance release executor with tested app/media preimage and rollback. The already consumed owner OIDC identity receipt does **not** authorize backend deployment or wallet activation.

## Evidence status

Read-only migration scope reconciliation: **completed**.
Actual restored snapshot schema: **69 tables**, migration history absent, 23/26 structural schema targets present, 3 seed migrations unresolved.
Finance recovery acceptance: **BLOCKED** (`pending_migrations_in_isolated_restore`).
Protected release coordinator: **not installed**.
Live backend/frontend/payment feature flags: **unchanged/OFF**.

## Correction record

The initial count of 21 omitted the core Rabint alias. Source inspection found `Yii::setAlias('@rabint', RABINT_BASE_DIR . '/vendor/rabint/base')` in `common/config/bootstrap.php`; the corresponding core migration directory has five files. Their four `createTable` targets exist in the snapshot, and the fifth is a city-data seed. The verified effective lookup count is **26**, not 21. No production data or release authorization was modified during this correction.
