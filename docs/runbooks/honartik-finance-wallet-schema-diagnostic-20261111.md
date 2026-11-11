# Honartik wallet/schema diagnostic — isolated, non-deploying

**2026-11-11 · Review-only.** This path is explicitly separate from the global Yii `none_pending` release attestation. It must **never** be submitted to the routine backend recovery issuer, reused as a migration state proof, or mistaken for the owner's authorization to publish financial code.

## Why this is the next meaningful safety boundary
The wallet/compensation candidate backend `d1a64e640c9c2cf4788d55566c17728be5813941` differs from production backend `4ac602e874a128c3328f27f3dab473857512cdbf` by **15 reviewed paths and no migration PHP files**. Therefore its **own** schema compatibility can be checked separately from the 54 historical migration classes and their missing history. The existing global migration gate remains **BLOCKED**, not waived.

The exact 54 migrations and six Yii/controller/config files are independently SHA256-frozen in `evidence/honartik/finance-wallet-frozen-yii54-20261111.json`; this source is based on U05's real Yii lookup evidence, [deploy-control Draft PR #79](https://github.com/prhmonline/deploy-control/pull/79). No developer may silently alter historical migration code or aliases to get a PASS.

## Fixed-scope root-only diagnostic
- Input source: reviewed, exact full Git SHA in `REVIEWED_SOURCE_SHA`; clean checkout, pinned backend/live frontend and exact 15-file source delta.
- Backup: completed central snapshot `20261111T092019Z`; exact `honartik_db.sql.gz` SHA256 `5adf9397c2cbc8045d29ef7b11bd34ab17ed26a4920106a79f036fa24e85de15`, verified via the root-only `SHA256SUMS` manifest and full gzip read. This **historical** backup is not a release-fresh snapshot, deliberately.
- Restoration: preexisting root helper with hardcoded SHA256 `bb6d94b1db5babef628876a41c66178b046f1e983e4a0612700cea55dadb1b61`; exact pinned MariaDB 10.11 Docker image, `--network none`, isolated temporary database and no production credentials. The diagnostic uses the helper's importer unchanged, but **replaces its global pending-migration probe in process memory for THIS isolated diagnostic only**. The installed release/helper script is never edited.
- Query scope: only SELECTs on `information_schema` plus the isolated `honartik_db`. Check wallet and checkout required column/index existence, compensated checkout exactly-one primary wallet credit, duplicate iTicket wallet markers and checkout transaction amount/owner mismatch. Run `mariadb-check` on the isolated database only.
- Output: a new root-owned 0600 O_EXCL report in `/var/lib/prhm-honartik-finance-recovery/`, with explicit `release_authorized=false`, `snapshot_fresh_for_release=false`, `production_modified=false`, `historical_yii_migration_replay_allowed=false`, `bounded_finance_release_executor_installed=false` and `historical_yii_migration_proven=false`. Does not stamp history or run a PHP migration. No automatic publication/activation.

Run on the trusted host with an exact reviewed merged main SHA (not `HEAD` or moving `main`) and `python3.11 -B` so no untracked bytecode is created:

```bash
PIN='<reviewed exact full merged SHA>'
REVIEWED_SOURCE_SHA="$PIN" PYTHONDONTWRITEBYTECODE=1 \
 /usr/bin/python3.11 -B scripts/honartik-finance-wallet-schema-diagnostic-v1.py
```

Precondition: clean, root-owned audit checkout of `prhmonline/prhm-host-actions` at `PIN`; pinned source code and config; production checkout unmodified and both iTicket financial flags OFF. If any diagnostic fails, no report is issued.

## What it **doesn't** authorize
**Production migration, schema changes, replay, history stamping, backend deployment, wallet payment, or automatic compensation.** The separate U05 54-version migration policy and actual U03 backend/PHP/Apache release coordinator, U06 native/offsite backup and restore, fresh bounded evidence, source-pinned rollback preimage, and owner release approval still require independent acceptance. The installed routine `RISK_PATH` guard is not modified. This script is designed to be informational, not a substitute root deploy lane.
