# Node1 host-data encrypted independent-cloud copy — one-shot candidate

**Status: Git-only. Nothing has been installed, enabled, uploaded, deleted or restored on Google Drive by this proposal.** Node1 and its main VM share physical hardware; only independently recoverable copies on external storage reduce that failure domain. The previously verified local backup/timers are **not** changed.

## Live read-only evidence, 2026-10-10
- New latest proven manual/systemd snapshot: `20261010T180405Z`, about **2.0 GiB**, six MariaDB schemas, 109,828 actual iMotion regular files; checksum, site-coverage, isolated SQL replay and file restore all passed. Existing Node1 scheduled backups are enabled.
- Work Google Drive (`aytec.ir@gmail.com`) accessible via connected account: quota total `16,106,127,360` bytes; used `11,231,333,122` bytes; free `4,874,794,238` bytes (~4.54 GiB).
- Personal Drive free ~1.62 GiB; personal OneDrive ~0.80 GiB. Both too small for this ~2 GiB host-data backup.
- Existing root-only rclone runtime `/var/lib/prhm-central-gdrive-restic/rclone-1.75.0` and `/etc/prhm-rclone/rclone.conf` can read `gdrive-backup:`; its reported quota total 16 GiB, free ~5.17 GB and `PRHM-Backups/` is visible. Quota resembles the **work** Drive, but exact rclone account ownership has not been independently bound: **verify before uploading any company/client data**.
- Existing remote `PRHM-Backups/node1/20260922T211835Z/mariadb-all.sql.gz` has a plaintext-looking extension. Content encryption and permissions have **not** been established. Review separately without leaking or deleting archives.
- Existing previous Google Drive backup's latest local proof (Oct 10) returned `INDETERMINATE`, `remote_download`, exit 31 and zero verified files. Cloud object existence alone is not a verified restore.
- **Provider continuity warning:** rclone's shared `client_id` is being retired during 2026. This remote is useful for testing **now**, but a supported user-controlled OAuth client or other approved stable connection will be needed for reliable unattended backups. Don't subscribe to a paid cloud tier solely to resolve this.

## Git-only candidate implementation

`ops/node1-hostdata-gdrive-one-shot-v1.sh`:

1. `--inspect`: read-only status of existing provider connection and free quota, without uploading, manipulating snapshots or exposing OAuth secrets. It may trigger OAuth token refresh; use under an approved read-only diagnostic policy.
2. `--run <SNAPSHOT-UTC-ID>`: **NOT authorized by this PR**. Requires independently escrowed random high-entropy passphrase, root-only owner attestation and exact release Git SHA file, provisioned **after** explicit new Level-4 production approval. No key/token in Git, comments, chat, evidence, email or cloud metadata.
3. Reverify the exact Node1 snapshot `SHA256SUMS` via pinned SSH, only accept COMPLETE with matching timestamp pattern, confirm disk and remote quota (retain >1 GiB provider reserve plus >8 GiB staging reserve).
4. Encrypt the streamed full Node1 snapshot tar locally using OpenPGP AES-256 + SHA256 S2K; no plaintext staging file or plaintext upload. The tar encapsulates a gzip SQL dump, Zstd website/config archive, manifest/coverage proof/COMPLETE and SHA256SUMS.
5. Upload to **immutable, unique new path** `gdrive-backup:PRHM-Backups/node1-hostdata-offsite-v1/<SNAP>.snapshot.tar.gpg`. The target parent folder must be separately created/authorized (absent folder or unreadable remote inventory => FAIL). No delete/prune/overwrite.
6. Download the encrypted object **from Google Drive** into a distinct local file, compare full uploaded/downloaded bytes, decrypt into an isolated root-owned temporary directory, verify original snapshot `SHA256SUMS`, COMPLETE marker, six DB names and real site payload coverage >=95%.
7. Only after full success, write root-only Git-SHA-bound evidence `/var/log/prhm-backup-assurance/node1-hostdata-physical-offsite-v1/<SNAP>-cloud-verified.json`; remove sensitive temporary data in all cases. On upload succeeded but restore failed, leave the cloud object untouched/unverified for controlled investigation.

## Mandatory release gates (not yet passed)
- **Explicit fresh Level-4 authorization** for cloud transfer and storage of sensitive business/customer information on the verified designated Drive account. Do not use any other account just because a token works.
- **Secure independent key escrow**: owner stores the recovery passphrase outside all Node1 physical disks, e.g. hardware password manager/offsite encrypted paper vault; no sending keys via chat/Git. Verify a separate-device decryption rehearsal before calling it disaster-recoverable. Local attestation is not evidence of an actual externally recoverable key.
- Own cloud destination folder authorization and remote access inventory must be verified. Provision root-owned `/etc/prhm-backup/physical-offsite/`, strong random GPG passphrase, `node1-hostdata-escrow.json` attestation (schema `prhm.offsite-key-escrow.v1`, `confirmed_by=owner`, key SHA256, `independent_physical_copy_confirmed=true`), and `release-commit-sha`; permissions 0600. Never place passphrase text in PR, logs or shell history.
- Target account quota ~4.54 GiB currently supports **one** ~2 GiB encrypted snapshot. No automatic daily snapshots to this destination; provider quota and reserve check must hold. This would not cover the 246GiB running VM; no full VM recovery claim.
- Run test suite first, deliver exact Git commit and file SHA to controlled deploy. After production rollout, record repo/branch/SHA/host/UTC, install/destination, results, any rollback, actual cloud object SHA/download/decrypt/restore test in durable root-owned Logger.
- Future unattended renewals depend on rclone shared-client deprecation resolution and user-approved offsite retention/key management. **Do not turn on recurring uploads from this one-shot pilot.**

## Acceptance and unresolved risks
A remote file or 200 OK from Google Drive is NOT DONE. Accept **only** when independent cloud download, decryption, whole Snapshot SHA256 verification, site proof and database list all PASS, plus independently retrievable key escrow. A one-shot host-data cloud copy is also not a snapshot or isolated-boot restore of the running `prhm-production` KVM image.

All current production services and existing backup schedules remain untouched during this Git-only phase.
