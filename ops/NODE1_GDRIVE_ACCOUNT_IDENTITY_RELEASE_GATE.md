# Node1 encrypted Google Drive offsite — explicitly approved destination

**Date: 2026-10-10. Status: GIT-ONLY; no cloud upload and no new deployment.**

## Identity and owner decision

Google Drive API `about.user.emailAddress`, queried with the OAuth access token in the existing root-only rclone config on `prhm-production.prhm.ir`, authenticated `gdrive-backup:` as **`prhmonline@gmail.com`**. The previous design expected `aytec.ir@gmail.com`, so the first fail-closed identity check correctly returned `DESTINATION_ACCOUNT_MISMATCH` and exit 3.

**The owner subsequently explicitly approved using `prhmonline@gmail.com` instead.** Therefore the new Git candidate sets `EXPECTED_ACCOUNT='prhmonline@gmail.com'`, while preserving the exact OAuth identity gate. It must never silently send customer-containing archives to any other account.

## New Git-only gate

- Existing root-only rclone config and OAuth token are used only for a read-only authenticated Google Drive `about.user.emailAddress` comparison. Identity must exactly match the owner-approved destination; no token/secret is printed or committed.
- `--inspect` verifies identity and available quota read-only. It may refresh an OAuth access token; it does not upload, create, delete or move customer files.
- `--run` requires the identity check **before** any key access, source snapshot read or cloud upload, and also requires valid owner-attested independent off-Node1 key escrow and release SHA. The previously approved production script SHA `42eb31e0edf6fb7ae2efeb4189c8b9bec24d12ec` remains installed and is unchanged by this PR. New SHA needs a new scoped Level-4 release approval.
- The connected Drive previously reported about **5.17 GB free** and showed `PRHM-Backups/`. This is capacity/access evidence, **not** proof of upload permission to a yet-to-be-created one-shot folder, transfer success or independent recoverability.
- The remote uses rclone's shared Google client ID, which warned it is being retired during 2026. Long-term unattended reliability requires a separately reviewed renewal plan.

## Hard stop: out-of-Node1 recovery key

No owner-confirmed physical off-Node1 secret escrow currently exists. Until it is established and independently tested, **do not create/upload a real encrypted business backup**. The required owner-owned high-entropy passphrase must be retained on a different failure domain (for example a password manager accessible on a different device); never send it in this chat or Git. Check authentic ownership and access from another device before signing `node1-hostdata-escrow.json`.

After owner-held key recovery is evidenced and approved Git SHA deployed, only one encrypted snapshot may be transferred and it must be downloaded **back from Google Drive**, decrypted into isolated storage, and verified against the complete original Snapshot SHA256SUMS, 6 DB names, actual site coverage and COMPLETE marker before accepting `offsite_verified=true`. No automatic pruning, running-VM image copy or claim of full disaster recovery.

The current verified local backup timers remain active and unchanged. Existing live `prhm-production` VM disk still lacks a consistent boot-recoverable independent backup.
