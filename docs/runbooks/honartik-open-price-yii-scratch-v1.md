# Honartik open-price — real Yii on verified restored MariaDB 10.6

**Status: Git-only candidate. Not registered, not installed, not approved, not executed on the production-host snapshot, and not deployed.** This work does not grant generic shell execution or permission to access live customer records.

## Source and immutable scope

- Typed Host Action ID: `honartik_open_price_yii_scratch_v1`.
- Trusted authorization operation: `host_action.honartik_open_price_yii_scratch_v1` (Ed25519, single use, signed and consumed by the trusted Control Plane; never accepted from browser payload).
- Source repository: `prhmonline/honar-back-new`.
- Source commit: `f627c6e351c5b29c13261cfcbb54cf73cbd0b5f0`.
- Pinned script: `scripts/open-price-yii-isolated-restore-check.sh`, Git blob `d72c32be8db344fc91b45f487b3742b1e3d6770c`.
- Verified historical dump: `/var/backups/prhm-central/20261016T212759Z/db/prhm-mariadb/honartik_db.sql.gz`, checked against the immutable backup's SHA256SUMS.
- Database identity: `honartik_db`. Real backup expected counts from previous isolated restore: finance_transactions 37,156; finance_wallet 50,543; reserve 36,738.
- Pinned disposable image: `mariadb:10.6`, `--network none`; completely separate datadir, socket and root password. **No live MariaDB socket, credentials, network or data volume may be mounted.**
- Production backend exact preimage for this candidate: `502376d0360a338f9522e4a2be5f9dccc91408d7`. A drift is a hard stop, not a reason to overwrite.

## Trusted registration requirements

This repository contains a **typed source contract and mock contract tests**, not an installed native executor. Registration must be performed by an authorized owner through a separately reviewed, SHA-verified Host Actions v2 installer and one-time Level-4 signed approval. The trusted adapter must implement precisely these methods: `preflight`, `consumeApproval`, `executeRestoredYiiRehearsal`, `cleanup`, `audit`. It cannot accept caller-provided paths, SHA, SQL, shell commands, environment strings, machine identity, credentials, arbitrary arguments or a production deploy operation.

The trusted adapter—not this repository's Node model—must independently prove backup SHA256, exact Git blob/commit, old SHA and resources, mount confinement, no network and no source writes before invoking the fixed migration rehearsal script. Its evidence must be generated from real commands and actual restored DB state, never accepted from client JSON or test mocks. Only register the immutable action after source review and implementation of this adapter. Do not repurpose the privileged GitHub deploy-control runner to evade the host approval requirement.

## Acceptance

A registered operation is green only after the trusted Control Plane authorizes it and the native adapter independently returns all fixed-schema evidence. The actual Yii2 classes `m261016_105000_open_price_money_capacity` and `m261016_110000_open_price_schedules` must run on restored MariaDB **10.6** with the complete historical dataset. Verify source hashes, exact row counts, existing financial totals and absolute totals before/after, three widened money columns, all eight feature columns, safe capacity retry ordering, duplicate feature fail-closed and scratch cleanup. Never call `safeDown` or downgrade money fields, and never run database writes against the production container.

The existing synthetic integration was independently **PASS** against Yii2 2.0.55 / PHP 8.4 / synthetic MariaDB 11.8; that does **not** satisfy the restored MariaDB 10.6 acceptance.

## Subsequent release gates

The new host action is *rehearsal only*, not a release operator. After its real evidence is green, independently verify actual wallet/seller settlement and cancellation/refund accounting, complete app typecheck and preserved local edits, review/merge the two open Draft feature PRs and obtain a separately authorized SHA-pinned dark deploy. Keep `schedule.free_price_enabled=0` for all public sessions pending owner-run Saman SEP transaction/receipt/reconciliation UAT. No user email or SMS should be sent during rehearsal.

**Failure behavior:** never infer green from a mock, CI test or an absent error. On failed preflight, authorization, migration, data audit, cleanup or durable audit, emit failure with no approval reuse and no Production mutation. Preserve historical DB evidence and do not roll back schema by destructive down-migrations.
