# Honartik open-price — real Yii on verified restored MariaDB 10.6

**Status: Git-only candidate. Not registered, not installed, not approved, not executed on the production-host snapshot, and not deployed.** This work does not grant generic shell execution or permission to access live customer records.

## Source and immutable scope

- Typed Host Action ID: `honartik_open_price_yii_scratch_v1`.
- Trusted authorization operation: `host_action.honartik_open_price_yii_scratch_v1` (Ed25519, single use, signed and consumed by the trusted Control Plane; never accepted from browser payload).
- Source repository: `prhmonline/honar-back-new`.
- Source commit: `4853dd39c43ca678b4bb29f00777c1b89c559757`.
- Pinned script: `scripts/open-price-yii-isolated-restore-check.sh`, Git blob `83d30253d244e57320b3c539a8cde5f37c890ce4`.
- Verified historical dump: `/var/backups/prhm-central/20261016T212759Z/db/prhm-mariadb/honartik_db.sql.gz`, checked against the immutable backup's SHA256SUMS.
- Database identity: `honartik_db`. Real backup expected counts from previous isolated restore: finance_transactions 37,156; finance_wallet 50,543; reserve 36,738.
- Pinned disposable image: `mariadb:10.6`, `--network none`; completely separate datadir, socket and root password. **No live MariaDB socket, credentials, network or data volume may be mounted.**
- Production backend exact preimage for this candidate: `502376d0360a338f9522e4a2be5f9dccc91408d7`. A drift is a hard stop, not a reason to overwrite.

## Trusted registration requirements

This repository contains a **typed source contract, a source-only native adapter candidate and tests**, not an installed native executor. Registration must be performed by an authorized owner through a separately reviewed, SHA-verified Host Actions v2 installer and one-time Level-4 signed approval. The trusted adapter must implement precisely these methods: `preflight`, `consumeApproval`, `executeRestoredYiiRehearsal`, `cleanup`, `audit`. It cannot accept caller-provided paths, SHA, SQL, shell commands, environment strings, machine identity, credentials, arbitrary arguments or a production deploy operation.

The source-only `honartik-open-price-yii-native-adapter-v1.cjs` implements the fixed, non-shell native execution and evidence parsing **only when bound by a separately installed trusted registrar** providing `consumeBoundApproval`, `appendDurableAudit` and `registeredNativeAction`. The adapter validates the backup/manifest checksum, gzip integrity, exact Git blob and live HEAD, MariaDB image and resources; it requires the real Yii operator's post-restore JSON receipt (version, expected counts, three BIGINT columns, eight feature columns and identical financial SHA-256 digests) and exact completion/cleanup markers. It does **not** mint signed approvals or expose a standalone CLI. The trusted registration boundary must independently check the signer and bind callbacks; a caller-provided JSON `registeredNativeAction` value is not a grant. The trusted adapter—not this repository's mock test result—must prove real backup SHA256, old SHA and resources, mount confinement, no network and no source writes before invoking the fixed migration rehearsal script. Its evidence must be generated from real commands and actual restored DB state, never accepted from client JSON or test mocks. Only register the immutable action after source review and implementation of this adapter. Do not repurpose the privileged GitHub deploy-control runner to evade the host approval requirement.

## Acceptance

A registered operation is green only after the trusted Control Plane authorizes it and the native adapter independently returns all fixed-schema evidence. The actual Yii2 classes `m261016_105000_open_price_money_capacity` and `m261016_110000_open_price_schedules` must run on restored MariaDB **10.6** with the complete historical dataset. Verify source hashes, exact row counts, existing financial totals and absolute totals before/after, three widened money columns, all eight feature columns, safe capacity retry ordering, duplicate feature fail-closed and scratch cleanup. Never call `safeDown` or downgrade money fields, and never run database writes against the production container.

The official source-only contracts have **25/25 PASS** (16 coordinator plus 9 native parser tests), but do not execute the real backup. The existing synthetic integration was independently **PASS** against Yii2 2.0.55 / PHP 8.4 / synthetic MariaDB 11.8; that does **not** satisfy the restored MariaDB 10.6 acceptance.

## Subsequent release gates

The new host action is *rehearsal only*, not a release operator. After its real evidence is green, independently verify actual wallet/seller settlement and cancellation/refund accounting, complete app typecheck and preserved local edits, review/merge the two open Draft feature PRs and obtain a separately authorized SHA-pinned dark deploy. Keep `schedule.free_price_enabled=0` for all public sessions pending owner-run Saman SEP transaction/receipt/reconciliation UAT. No user email or SMS should be sent during rehearsal.

**Failure behavior:** never infer green from a mock, CI test or an absent error. On failed preflight, authorization, migration, data audit, cleanup or durable audit, emit failure with no approval reuse and no Production mutation. Preserve historical DB evidence and do not roll back schema by destructive down-migrations.

## 2026-10-17 forced-cleanup containment refinement

The restored-data operator now supports a private and tightly checked scratch parent `HONARTIK_YII_ACTION_SCRATCH_PARENT`, restricted to a pre-created root-owned mode-0700 `/var/tmp/prhm-yii-action-*` directory. The source-only Native adapter binds this path itself, starts the fixed Bash process in a dedicated process group and sends SIGTERM then SIGKILL on time limit. It then removes the precise disposable container and the scratch root and refuses success without cleanup and durable audit receipts. **Only source-level implementation and isolated tests; native Agent installation is still not authorized or performed.**


## 2026-10-18: SHA-bound registration transaction primitive — tested, not installed

The Git-only source now includes:
- `honartik-open-price-yii-registration-transaction-v1.cjs`: fixed action ID `honartik_open_price_yii_scratch_v1`, immutable native adapter/coordinator Git blobs, previously reported four-owner production SHA256 preimages, explicit owner permission modes, one-time consumed Level-4 approval binding, candidate-file SHA map, original-state checks, before-image snapshots, verification, durable audit and fail-closed rollback requirements. It has no CLI or direct write path.
- `test-honartik-open-price-yii-registration-transaction-v1.cjs`: deliberately rejects tampered owner candidates, missing action registrations, unpinned native blobs, missing trusted capabilities, mismatched owner preimages and direct CLI invocation. Verified isolated CI [run #39069985613](https://github.com/prhmonline/prhm-host-actions/actions/runs/39069985613): **12/12 PASS**, all actual job steps successful. Other source-only finance, approval and reversal checks on the same PR revision were GREEN.

This is a **transaction primitive and source contract, not an on-host installer**. The current trusted root host installer must independently supply `buildReviewedOwnerCandidate` and all privileged capabilities from previously approved, pinned owner bytes, including its real `assertConsumedLevel4` implementation. Those production-bound owner patches and trusted wiring have not been installed, and the previously recorded four-owner SHA preimages need fresh read-only confirmation. The root installer must verify the exact committed signed candidate, stage/restore all six files and ensure runtime discovery/health. A request for `honartik_open_price_yii_scratch_v1` through the current Agent 3 `host_action_v2_request` still fails with `host_action_v2_not_allowed`; all three Agent connections lacked this installed action. **No registration approval token was issued or consumed**.

Do not route this through a privileged deploy-control CI job, do not invent a consumed L4 token and do not run SQL on `honartik_db`. The unresolved executable gate is **trusted on-host L4 registrar binding + a freshly signed, narrowly scoped, SHA-bound approval**. Only after successful registered/verified installation may the full restored `mariadb:10.6` actual Yii migration rehearsal run. This Git-only update made no production or DB changes.


## 2026-10-18: later complete snapshot — real Yii2 scratch rehearsal passed

The server owner ran the pinned legacy operator from backend source commit `4853dd39c43ca678b4bb29f00777c1b89c559757`, operator Git blob `83d30253d244e57320b3c539a8cde5f37c890ce4`, after replacing only two literal data selectors in a temporary copy: removed snapshot `20261016T212759Z` → complete `20261017T152430Z`, and historical table counts → `finance_transactions=37179`, `finance_wallet=50582`, `reserve=36761`. The temporary script SHA256: `ee48a8828d0bed92d2f30b78cbbdbab769e80e3c0a591e8366aa56c8751bf23f`. New Honartik dump SHA256 `09171ccc36c6dd9e2d09000ae7338f687711aa979c6eabd38b0b309d0e5ede0c`, complete manifest/gzip integrity PASS.

**Actual result** (from full owner-supplied terminal output, not simulator): isolated `--network none` MariaDB `10.6.27`; authentic Yii2 `safeUp()` ran for both capacity and eight-feature migrations; capacity retry before features passed; illegal post-feature capacity retry and duplicate feature migration rejected; `YII_SCHEMA_READINESS=PASS`; all financial aggregates unchanged, before/after SHA256 `bad740348edebe49c904063c7ecccde942d48bcd4581fc39e06c7788a84fff05`; `ISOLATED_CLEANUP=PASS`; `PRODUCTION_DATABASE_UNTOUCHED=YES`. Thus **restored-snapshot migration rehearsal was completed successfully via the owner's separate, manually executed, isolated script**. Neither the live database nor the host's installed Agent registry were modified.

The legacy hard-coded `PINS.snapshot`/`expectedCounts` in the source-only action now refer to an absent historical backup. Do not report that action callable, migrate production on its behalf or copy an unsigned patched script into a privileged agent. Signed Level-4 Host Action registration / deployment is **still not installed**; the real restored Yii rehearsal and the future signed production deployment are distinct tasks. Seller settlement/refunds, feature-default-OFF deployment planning, live-schema preflight and actual bank pilot remain release gates.
