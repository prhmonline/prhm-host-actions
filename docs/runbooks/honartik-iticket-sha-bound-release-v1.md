# Honartik iTicket fixed release action V1 — source candidate

**Status:** Git/source + isolated contract tests only. NOT registered in live PRHM Agent 3, NOT deployed to Production, NO migration or financial operation run.

## Immutable application targets

| Component | Repository | Baseline Production | Candidate Git SHA |
| --- | --- | --- | --- |
| Backend (Yii2) | `prhmonline/honar-back-new` | `502376d0360a338f9522e4a2be5f9dccc91408d7` | `13064921115b857762bb2545c45c6d5340f46999` |
| Frontend (Next.js) | `prhmonline/Honar-front-new` | `87580ce105eff53d7142d0ca1d5267d0f4097bb2` | `faa9762cdca0ff189989f06da7a0c20ca9d7fa68` |

Pinned roots:
- `/home/honartik/domains/dashboard.honartik.ir/public_html`
- `/home/honartik/domains/honartik.ir/public_html`

Preserve untracked user files `honartik-28000-refresh-905d3af8f914b0e4.xlsx` and `public/chat-transfer-28000-905d3af8.xlsx`. No force reset, history rewrite, blind checkout, rm, or staging-to-Production copies.

## Security and registration boundary

Source coordinator: `honartik-iticket-sha-bound-release-v1.cjs`.
Contract tests: `test-honartik-iticket-sha-bound-release-v1.cjs`.

There is **no CLI production apply**. Direct invocation prints `registration_required` and exits 2. The coordinator receives a capabilities adapter ONLY from the existing root-owned, registered Host Actions v2 / Approval Center boundary. Its in-memory callback mocks in tests are **not** Production capabilities.

The live registered action inventory does NOT contain this action or the shared five-field `prhm_action_registry_install_v1` registrar. Deployment cannot be activated by adding Git code, changing the MCP enum, invoking another action's old token, using `ops_execute` as a generic shell, or calling a source-only installer directly.

Installation prerequisites:
1. Independently inspect four live registry owner SHA-256 values: Base, Executor, MCP plugin, Approval Center policy. Stop on missing or mismatching provenance. No cached August/October values may be substituted.
2. Complete a **separately reviewed, installed** five-field shared registration bootstrap described in `PRHM-ACTION-REGISTRY-ONBOARDING-STANDARD.md`. All registration operations require a fresh Ed25519 Level-4 request, 180s TTL, single-use consume, exact source/manifest commit and SHA digest. This is currently absent.
3. Use the fixed existing Honartik atomic registration installer; register separate action-only fixed operations for dark deploy, pilot enable, and public enable. Bind them to the **same** trusted coordinator source and immutable application SHAs. Do not expose runtime command, URL, path, token, SQL, SHA override, or file-content arguments.
4. Host adapter must implement the exact approved capabilities with pinned privileged paths and their own typed input validation, control-plane-only signed approvals, and persisted CAS `readState/writeState`. `readState` must return an exact bound backend/frontend SHA pair and valid phase; `writeState` must be atomic and durable across worker/process restarts.
5. Independently verify trusted live registration/tool discovery and agent health before even calling `preflight`. Do not claim readiness from Git or mocked adapter tests.

## Deployment states and mandatory controls

`new -> preflight -> dark -> pilot -> public`

- **Preflight** (read-only): exact Production baseline HEAD, tracked worktree clean, protected untracked files preserved, target Git commit objects and complete tree hashes available and independently verified, live DB engine `MariaDB`, version `10.6.x`, schema `honartik_db` and read-only database capability, all payment feature gates currently OFF, Host Action installed.
- **Dark deploy**: require independent contracts (backend >=83 PASS), frontend contracts, and **actual isolated MariaDB 10.6/Yii2 bank/issuer/idempotency regression AND the three exact iTicket migrations executed on an isolated restore of the authorized Honartik backup**, then consume fresh signed SHA-bound approval. Take verified full backups and rollback evidence, apply ONLY the three approved additive migrations, switch code from exactly the two Git commit SHAs, verify both SHA on live after deployment, restart/check public/backend health, and verify finance flags remain OFF. Migration history, backup identifier, target and timing must be logged. **Do not call migration `safeDown()` during an application rollback**; financial receipts/ledger must be preserved. If migration or health fails, restore application/service preimages and report if rollback proof is missing.
- **Pilot enable**: distinct signed approval, explicitly one authenticated buyer, one event/schedule, one seat and amount cap, while public checkout remains OFF. The private buyer test must establish actual SEP settlement, immutable bank receipt, single seller-wallet debit/confirm, reconciliation and issued Samfa ticket. **Never perform a real charge automatically merely to validate a release.**
- **Public enable**: requires independently attested verified live transaction + refund-channel reconciliation evidence and another fresh signed approval. Arm public gates via trusted server-owned settings, verify live runtime gate and status, and disarm immediately on activation failure.

Migrations (in the backend target commit):
- `m261014_123000_create_iticket_checkout_intent`
- `m261014_193000_create_iticket_bank_receipt`
- `m261014_201000_create_iticket_clearing_entry`

Review the migration scripts: they are currently labelled DRAFT / not authorized for Production. This design does **not** override that restriction; separate DB preflight and approved release are mandatory. No bank/provider wallet calls and no customer purchases until real end-to-end confirmation.

## Current evidence and next gates

Independent local `node --test test-honartik-iticket-sha-bound-release-v1.cjs` passed 18/18 including restoration, wrong SHA, missing control-plane authorization, durable worker restart, concurrency CAS, finance proof denial. These are simulated adapter tests, not a Production dry run.

Backend isolated offline tests previously 83 PASS, frontend checkout contract PASS; neither is live or MySQL8 real-sale proof. PRHM Agent 3 has earlier dark worktree actions, but neither can deploy these current SHA candidates. The legacy normal GitHub Actions runners have had provisioning failures, so run the isolated test suite independently if necessary.

Success must include signed consumed approval IDs, commit SHA and root for each app, migrations list and database backup ID, dark/pilot/public gates, 2xx public health, seller wallet and Samfa confirmation from trusted sources, and rollback evidence. Until then, tell the operator **DO NOT BUY**. No email is to be sent to any party without explicit individual authorization.

## 2026-10-17 — live database engine alignment (source-only fix)

The canonical Honartik technical map and actual operator database evidence identify the live `honartik_db` container as **MariaDB 10.6**, not MySQL 8. A release preflight asserting only `mysql8ConnectionVerified` is incompatible with Production and could not meaningfully attest its actual database. The fixed coordinator now requires `databaseEngine='MariaDB'`, a `10.6.x` version, exact `databaseSchemaName='honartik_db'` and independently verified `mariadb106ConnectionVerified=true`. Tests additionally require `mariadb106Yii2IntegrationPassed=true` and `iticketMigrationOnRestoredMariaDb106Passed=true` for all three exact iTicket DDL migrations on an independent restored authorized backup, before any dark deploy. Offline mock tests are **not** this evidence. Never set these trusted-attestation flags from caller JSON; obtain them only from the registered host adapter after read-only database introspection and isolated fixture/restore execution. No production DB connection or migration was performed by this source change. Release remains DRAFT / NOT INSTALLED / DO NOT BUY.

### 2026-10-17 — Yii migration lookup correction (Git-only)

The actual Yii2 `MultiLocationMigrationsController` lookup in `honar-back-new/console/config/web.php` includes `@app/migrations/db`, NOT `app/migrations` root. The three iTicket buyer-finance migrations were byte-identically moved to `app/migrations/db/m261014_*.php` in backend PR #21, and the original unregistered locations removed. All three original Git Blob IDs are retained: `fb17ded1c072802af4c45af23f3205755b7da2a6`, `531ebff7d9d55e5eda26dd7ab15d5932bd96ab7d`, `ff591156a5553af7c9898217972903ca70d807c3`. The isolated Yii2 runner, lint list, CI triggers and a fail-closed discovery guard are updated. Backend source head is pinned above. Its hosted CI fails **before executing test steps**; do NOT treat it as validated full app. Never run migration in Production until authorized restore/preflight.

### 2026-10-17 — release candidate retains production seat-row selection

The backed iTicket PR #21 candidate now contains the approved free-seat-only bulk row selector and keyboard accessibility, byte-identical to `honar-back-new/main` Git blob `6331ba181080979a488423ce9faaacc4d1eef70d`; additionally includes the same `AdminReserveRowSelection.test.cjs` and associated CI workflow plus `AGENTS.md` technical map policy (all verified against main at `8b0aafa7f872ae38f2f4c7d0da3aeb9b612e6e83`). Do not overwrite local Production row selection or remove protected XLSX exports. Source SHA pinned to `13064921115b857762bb2545c45c6d5340f46999`. Deployment remains unapproved while tracked working tree dirty and MariaDB restore/financial E2E incomplete.
