# Node1 encrypted Google Drive offsite — exact authenticated account gate

**Verification date: 2026-10-10. Status: BLOCKED. No production/cloud backup uploaded by this change.**

## Grounded finding

The existing root-only rclone remote `gdrive-backup:` on `prhm-production.prhm.ir` is OAuth-authenticated as **`prhmonline@gmail.com`**, verified via the Google Drive `about.user.emailAddress` API with the configured access token. The owner-approved destination for sensitive Node1 host-data archives is **`aytec.ir@gmail.com`**. These accounts are different. Similar drive quota, matching folder names or a successful read-only rclone `about` response **do not** authorize uploading to another account.

The previously approved production one-shot candidate has exact SHA `42eb31e0edf6fb7ae2efeb4189c8b9bec24d12ec` and is installed root-only; it currently stops at `MISSING_OFFHOST_ESCROW` before data transfer. It has NOT copied any business data to Drive. Its existing runtime remains untouched by this PR.

## Fix in this separate Git-only branch

The new guarded candidate reads the **existing** root-only rclone configuration on the same machine, lets rclone refresh an access token via read-only `about`, then checks the authenticated Google `user.emailAddress` against hard-coded `aytec.ir@gmail.com` via Google Drive API. Failure to authenticate or account mismatch exits nonzero **before key access, source-file read, encryption, remote write or any backup upload**. No token, client secret or refresh token is printed/logged or committed.

Test results on production-central checkout under exact Git SHA (read-only):
- Python 3.6 offline unit suite: **7/7 PASS**, including real synthetic OpenPGP AES-256 encrypt/decrypt + tamper rejection.
- Shell syntax: PASS.
- Actual `--inspect` negative integration against current existing rclone remote: `DESTINATION_ACCOUNT_MISMATCH`, `OFFSITE_BLOCKED:DESTINATION_ACCOUNT_NOT_VERIFIED`, **exit code 3**, and **zero data uploads**.

## Authorization boundaries and options

**No new production deployment is authorized for the amended SHA.** First, the owner must choose a permitted recipient account:

- **Original designated work account**: authenticate rclone with `aytec.ir@gmail.com` using an owner-controlled supported login (do not share OAuth tokens in chat). Read-only identity verification must return an exact match, then verify quota and folder ACLs.
- **Alternative existing PRHM account**: if the owner explicitly approves `prhmonline@gmail.com` as a destination for encrypted customer-containing archives, amend the hardcoded expected account **in Git**, test, and obtain new pinned Level-4 approval. Never silently reuse the original approval.

For either destination, the owner must securely retain a high-entropy recovery passphrase and prove access to it **from a different physical device/failure domain**, separate from Node1. Do not send passphrases, tokens or DB contents via Git, ChatGPT, email, logs, comments or unsecured browser forms.

After an exact Git-SHA release and owner escrow verification, run at most **one** bounded encrypted upload; require remote independent full download, decrypt and complete snapshot SHA256 verification before setting `offsite_verified=true`. No automatic pruning, no live QCOW2 copy and no VM boot recovery claim. The rclone shared Google OAuth client is scheduled for deprecation in 2026; longer-term unattended durability is still not proven.
