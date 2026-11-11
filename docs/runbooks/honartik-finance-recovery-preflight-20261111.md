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
4. Run `REVIEWED_SOURCE_SHA=<merged 40-character main SHA> /usr/bin/python3 scripts/honartik-finance-recovery-preflight-v1.py preflight` from the pinned clean checkout. It has no `apply`/deploy verb.
5. Validate successful evidence and unchanged app/frontend/payment flags. If the snapshot is too old, do not fabricate freshness; the separate existing backup service must be run and checked again.

## Non-claims / pending for real release
- **No application preimage or tested rollback** is created by this preflight; untracked customer media must be separately archived safely.
- No conditional release executor is installed, no protected recovery attestation authorizes deploy, no production migration or live payment test is performed. The routine risky-path gate remains fail-closed.
- A future bounded release coordinator must have an independently reviewed restricted root action and revalidate this fresh evidence, exact owner consent, source SHA, tested preimage, idempotency checks and post-deployment health. It must not treat a successful source CI or this preflight as production approval.
