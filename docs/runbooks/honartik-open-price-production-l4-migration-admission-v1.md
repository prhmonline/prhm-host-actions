# Honartik open-price — signed production financial migration admission v1

**Status: SOURCE-ONLY ADMISSION SPECIFICATION. NOT REGISTERED, NOT APPROVED, NOT INSTALLED, NOT EXECUTED.**

This file is a reviewable plan for a *new, dedicated* production operation. It does **not** modify the approval policy, create a trusted registry entry, request/consume an Ed25519 token, register a Host Action, run database DDL or authorize publication. In particular, `honartik_open_price_yii_scratch_v1` is deliberately limited to restored-backup rehearsals and MUST NOT be reused to change live SQL.

## Unambiguous immutable bindings

| Binding | Value |
|---|---|
| Target host | `prhm-production` |
| Production checkout | `/home/honartik/domains/dashboard.honartik.ir/public_html` |
| Existing backend HEAD | `502376d0360a338f9522e4a2be5f9dccc91408d7` |
| Target production DB identity | `honartik_db`, Yii console's configured `db` connection |
| Yii migration history table | `system_db_migration` |
| Canonical migration directory | `app/migrations/db` |
| Exact migration A | `m261016_105000_open_price_money_capacity`, blob `453a4272d543cb622e041aa0248b7e3609d8650a` |
| Exact migration B | `m261016_110000_open_price_schedules`, blob `4601b591f18d99f7b1711ca089d9a6c24e780025` |
| Frozen source rehearsal revision | `4853dd39c43ca678b4bb29f00777c1b89c559757` |
| Pinned isolated Yii rehearsal shell blob | `83d30253d244e57320b3c539a8cde5f37c890ce4` |
| Latest complete backup at evidence time | `/var/backups/prhm-central/20261017T212022Z` |
| Backup dump SHA256 | `74777c7e559c55f8ed651bbbd53e93a4610a6c00804e006cbb40497b03e33fb6` |
| Backup MariaDB restored | `10.6.27-MariaDB-ubu2204` |
| Prior restored counts | `finance_transactions=37195;finance_wallet=50603;reserve=36777` |
| Financial digest before/after | `226ce1bedfc2480e3162002f4797afc65a774f2d5a98debf5db9d03b69784a50` |
| Approved backend application release | **NONE**; backend PR #23 remains draft |
| Producer excess allocation policy | **UNRESOLVED**; do not enable public free pricing |

The original pinned real-source Yii2 migration rehearsal used an operator-created **private temporary copy** with selectors changed for the new complete backup and dynamically measured row counts (minimums checked against earlier snapshot). Temporary script SHA256: `45712a91115b7b31d88bafa4639e660d67b23eb2595a6ef1196e2114f5c611aa`; it is **not** an approved on-host Production migration executable.

## Admission gates — all are required, in order

1. **Independent server-side trusted installer.** New action name and operation scope for **live financial DDL only**, separately signed Level-4, one-time token, source and owner-file preimages verified. Check policy allowlist and binding end-to-end; do not create an action by passing client-selected shell/SQL/paths to an existing Host Action. Do not issue a token unless the target trusted action is already registered and the candidate digest/rollback path are independently verified.
2. **Release window and quiescence.** Explicit approved maintenance interval; close or safely drain all writers affecting the finance/reserve/schedule tables while money columns are altered. Validate payment callbacks and pending settlements cannot write through an incompatible schema. Define a controlled resume and incident freeze condition.
3. **Live preimage read-only proof.** Immediately before DDL, verify exact live HEAD, expected two owner files untouched, `honartik_db` identity and the exact current schema (both `amount` INT, no `paying_amount`, 0/8 feature columns), and 0/2 exact migration history rows. Any partial or unexpected state is a HARD STOP; never treat a stale read-only proof as current.
4. **Fresh complete backup and restore evidence.** Recheck newest complete snapshot path, FULL `SHA256SUMS`, GZIP, freshness measured at time of window, and original DB restoration at MariaDB 10.6. Record same-window live row counts, aggregate totals and absolute totals to detect backups lagging live writes. A snapshot with lower counts is not automatically a valid recovery point. Test restored snapshot with the exact two `safeUp()` classes (source-only rehearsal already green for Oct-17 21:20Z snapshot).
5. **Hard locks + independent backup rollback checkpoint.** Capture on-host backup and migration schema before-images, rollback artifacts, access controls and recovery command. InnoDB/MySQL DDL may auto-commit; `ROLLBACK` cannot undo `ALTER TABLE`. Never run `safeDown()` or narrow `BIGINT` to `INT`; on failure require **halt/quarantine/manual recovery** with verified backup and accounting reconciliation.
6. **Execute ONLY migration A.** Explicit migration class `m261016_105000_open_price_money_capacity` and Git blob above, no broad `php yii migrate/up N` and no arbitrary SQL. Verify both amount columns became signed BIGINT and `paying_amount` nullable BIGINT, with before/after financial count, sum and absolute sum identical. Record an auditable checkpoint in canonical migration history **exactly once** when class success is proven.
7. **Execute ONLY migration B.** Exact class `m261016_110000_open_price_schedules` and pinned blob, and only after capacity checkpoint PASS. Ensure eight columns created and boolean defaults FALSE. Again prove every financial audit invariant and write canonical history **exactly once**; a duplicate attempt or partial schema requires STOP.
8. **Final release-specific receipt.** Durable append-only signed evidence: request ID, operation version, preimage SHA, source SHA, current timestamp, completion of both exact history rows, three money column types, eight feature columns/defaults, row count+financial digest equality, public flags OFF, backup restoration artifact and cleanup. All current owners and services must be verified healthy; no action may assert `productionDatabaseUntouched` after live DDL.
9. **Deploy is a SEPARATE authorization.** Exact backend SHA must pass reviewed contracts. The central `honartik_back` dispatcher is not sufficient proof that its on-host driver preserves existing dirty tracked `app/views/admin-reserve/_form.php` and untracked `honartik-28000-refresh-905d3af8f914b0e4.xlsx`. Protected bytes must be backed up and unchanged after deploying. Frontend SHA and SEP single-owner purchase/receipt/payout tests are later steps; keep feature OFF to all public users.
10. **No automatic notifications.** No email, text or customer communications in this migration workflow.

## Evidence and current blockers

Owner-supplied complete console stdout: actual `NEW_BACKUP_MIGRATION_REHEARSAL=PASS`, `ACTUAL_YII_CAPACITY=PASS`, `ACTUAL_YII_FEATURES=PASS`, `FINANCIAL_AGGREGATES_UNCHANGED=PASS`, `ISOLATED_CLEANUP=PASS`, `PRODUCTION_DATABASE_UNTOUCHED=YES`, `PRODUCTION_DEPLOYED=NO`. This is restored-data evidence, NOT proof that live Migration History has changed. The last observed live schema was `OPEN_PRICE_SCHEMA_STATE=PENDING`.

Independent Agent 3 health subsequently confirmed the installed registry contains no `honartik_open_price_yii_scratch_v1` (and no dedicated live-open-price DDL action). Central deploy-control Runner read the on-host dispatcher and verified syntax/sha, but its user is blocked from central backups; run [39078821804](https://github.com/prhmonline/deploy-control/actions/runs/39078821804) intentionally failed read-only at `BACKUP_ROOT_VISIBILITY=BLOCKED_BY_PERMISSIONS`. The server owner verified the backup as root and ran the real isolated restoration, so this visibility failure must not be hidden or treated as a successful Runner production deployment permission.

**Gate status:** `RESTORED_YII_SAFETY=PASS`; `SIGNED_PRODUCTION_L4_ACTION=ABSENT`; `DEPLOY_DRIVER_DIRTY_TREE_PROTECTION=UNVERIFIED`; `MIGRATION_PRODUCTION=HOLD`; `PRODUCTION_DEPLOY=HOLD`.


## 2026-10-18: Source-only signed production DDL coordinator implemented and tested

**Source file:** `honartik-open-price-live-ddl-coordinator-v1.cjs`, Git blob `f18b83a2266a38637e6b945ca4a75aee75f92145`.
**Contract test:** `test-honartik-open-price-live-ddl-coordinator-v1.cjs`, Git blob `0483d5015f2c31d8b895caf00372aecf043643a9`.
**CI:** [Honartik Level-4 source contract #39080371925](https://github.com/prhmonline/prhm-host-actions/actions/runs/39080371925) — Node 22 syntax PASS, **14/14** test cases PASS.

This new `honartik_open_price_live_migrations_v1` action candidate has an *independent* ID and approval scope `host_action.honartik_open_price_live_migrations_v1`. It binds the exact pre-deploy production SHA, database, history table, two canonical migration names and their Git blobs. A separately installed and audited trusted on-host adapter must supply these methods: `readOnlyPreflight`, `freezeWriters`, `verifyQuiescence`, `verifyBackupRestore`, `consumeSignedLevel4`, `holdMaintenance`, `recheckPreDDL`, `executeExactCapacity`, `verifyCapacityCheckpoint`, `executeExactFeatures`, `verifyFinalCheckpoint`, `writeDurableAudit`, `releaseMaintenanceOnSuccess`.

The coordinator intentionally imports no filesystem, shell, database, network, or approval issuer. No caller-provided script, SQL, user-supplied approval receipt, directory, path, or command is accepted. Mocked trusted adapter tests exercise correct phase sequencing and rejection of schema drift, changed backup/authorization scope, missing Level-4 consumed grant, inconsistent financial digest, broken capacity or feature checkpoint, replay, missing audit, public-flag accidental enable and immediate pre-DDL time-of-check drift. Any failure after DDL may require manual financial recovery; no automatic BIGINT downgrade or MySQL `ROLLBACK` claim is made.

**Required next implementation:** independent trusted root-owned adapter and installer reviewed against on-host current SHA fingerprints, Ed25519 signature verification and one-time issuer state, writer quiescence/maintenance, exact Class A/B Yii2 execution and history once-only, same-window new backup, durable audit, fail-safe stop and recovery rehearsals. This coordinator is a *contract only*, NOT a real installed Host Action. **Do not call `host_action_v2_request` for this action until the trusted registry and policy explicitly authorize it; the existing restored-backup-only `honartik_open_price_yii_scratch_v1` cannot be substituted.**

Evidence: `REGISTERED_NATIVE_ACTION=NO`, `PRODUCTION_DDL_EXECUTED=NO`, `PRODUCTION_DEPLOYED=NO`. The previous Oct-17 backup must be considered stale for any future financial maintenance window until a new backup is verified; its restored rehearsal remains valid technical evidence, not current-point-in-time financial recovery.


## 2026-10-18: independent registration security audit — INSTALL BLOCKED

**Do not register, install or request/consume Level-4 approval for the current production migration registration candidate.** An independent, executable **red gate** was added on the draft source branch:

- `test-honartik-open-price-live-registration-security-gate-v1.cjs`
- `.github/workflows/honartik-open-price-live-registration-security.yml`
- [actual CI run #39081174471](https://github.com/prhmonline/prhm-host-actions/actions/runs/39081174471): **2 PASS / 4 FAIL**, as expected for the insecure, uninstalled candidate. PHP, application database and server files were not touched.

Precise unresolved failures of `honartik-open-price-live-registration-v1.cjs`:

1. `receipt.oneTime===false` is the only explicit rejection; `undefined` or other values (e.g. `null`) are accepted. Require **strict positive proof** `oneTime===true`.
2. `receipt.liveDDLAuthorized===true` is the only explicit rejection; an omitted property is accepted. Require **strict explicit** `liveDDLAuthorized===false` for installation-only approval.
3. The installation **request** includes `ownerSha256` but the **returned signed issuer receipt** is not matched against exactly the four root owner SHA256 preimages.
4. The installation **request** includes `reviewedSourceBlobs` but the **returned signed issuer receipt** is not matched against exactly the two pinned coordinator and native adapter Git blobs.

The first two source-only test cases (no CLI; fixed source/root paths) passed. The four security tests must all pass after a separately approved change before trusted registration is contemplated. Do not weaken or skip the new tests to make CI green. The previous 14/14 source coordinator tests are separate and **do not attest the installation receipt**.

A write attempt to tighten these specific rules was rejected by a tool safety gate. Do not route around that refusal with a different executor or host action. Keep the current source branch Draft; no production mutation, root installation, signed approval, DDL, payment, notification or deploy is authorized by this audit.
