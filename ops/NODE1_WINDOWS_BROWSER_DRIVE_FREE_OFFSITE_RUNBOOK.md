# Node1 → owner Windows → normal Google Drive browser (no Google Cloud billing)

## Purpose
This is an **alternative to the failing shared rclone/Google API OAuth client**. It uses only the owner-accepted existing free Google Drive account `prhmonline@gmail.com`, the already encrypted SSH hop, and a personal Windows computer in a separate physical failure domain. It needs **no Google Cloud project, credit card, OAuth Client ID, R2 account, paid tier, or public-sharing URL**.

The user requested a non-paid alternative after HTTP 403 `RATE_LIMIT_EXCEEDED` on the legacy rclone shared client. Keep the failed cloud attempt separate from actual verified backups.

## Data handling
- The source is the immutable, previously SHA256-verified Node1 hostdata snapshot `20261010T180405Z` (about 2.04 GB, 6 DBs, 109,828 site files).
- From the owner's Windows PC, the script opens SSH using the **already approved Windows key fingerprint** `SHA256:WEd6aCEVqn+FE6Yx8sTWBUfmsbKwNxz70M+x+HZsr0Q`, jumps through Node1's approved SSH port `40222` to central `10.71.0.118`, and executes a **read-only streaming pipeline** on central.
- Central uses an authenticated internal SSH connection back to Node1 for a `tar -cf -` of the verified Snapshot and encrypts it immediately with **GnuPG AES-256** using the root-only passphrase file. **Neither the plaintext archive nor a temporary archive is written to central disk**, and only encrypted bytes are transferred to Windows over SSH.
- The Windows Python client writes binary data from subprocess stdout directly into a `.partial` file; never pipe binary archives through PowerShell string processing. On failure the partial file is removed. On success, local GnuPG decrypts the file as a **stream**, computes SHA256 for each tar member, checks the original Node1 SHA256SUMS, the six DB names, full site coverage, and the COMPLETE marker. It then atomically renames the ciphertext into `%USERPROFILE%\PRHM-Node1-Encrypted-Exports\20261010T180405Z.snapshot.tar.gpg` and writes a non-secret JSON proof next to it.
- No secrets, encrypted archives, SSH private keys, OAuth tokens, or plaintext database content are sent to ChatGPT, GitHub or the assistant's sandbox.

## Owner Windows steps
First download **exact Git release commit** of `ops/node1-owner-windows-encrypted-export-v1.py` from the repository and verify its SHA256 against the Git-pinned expected checksum returned in review. It may be run as:

```powershell
py -3 $tool fetch
```

This requires:
- Working Windows `py -3`, Gpg4win `gpg.exe`, OpenSSH client and already tested `-J root@185.191.76.138:40222 root@10.71.0.118` SSH route. The existing jump prompts for Node1 password if required; never send password in chat.
- The local owner-owned `%USERPROFILE%\PRHM-Node1-Recovery\node1-hostdata-gpg.passphrase` and `node1-hostdata-escrow.json`, with `independent_physical_copy_confirmed=true` and valid key fingerprint.
- At least 3 GiB of free Windows storage. No files with the same destination filename may exist (immutable no-overwrite).
- Completion prints `OWNER_OFFNODE_ENCRYPTED_BACKUP=PASS`, output archive path and **non-secret** encrypted SHA256. That is a verified copy on another physical device, **not yet a verified independent cloud copy**.

Then:
1. In a browser sign into **`prhmonline@gmail.com`** at https://drive.google.com/drive/my-drive.
2. Navigate to `PRHM-Backups/node1-hostdata-offsite-v1`, which the earlier approved release created in that account. Upload the **.tar.gpg** file only, through the web upload feature. NEVER upload the key, receipt, `.partial`, plaintext SQL or server environment files.
3. Once the upload is fully finished, **download the entire encrypted archive back from Google Drive** to a distinct path, preserving the original Windows encrypted copy.
4. Run the same tool in `verify` mode with `--file <downloaded path> --expected-sha256 <exact fingerprint printed by fetch>`. It decrypts and checks source SHA256SUMS and site/DB coverage, producing `DECRYPTED_ORIGINAL_SNAPSHOT_SHA256=PASS`. Only after that and the exact encrypted fingerprint match can an auditor mark the browser-Google-Drive copy manually restore-verified.

## Scope and risks
- Original live production components stay unchanged; the registered Node1 backup and health timers remain enabled.
- Browser uploads and downloads can fail or time out; merely clicking upload or seeing the cloud filename does **not** prove disaster recovery.
- The user's independent Windows local file must remain protected. The decryption key remains stored separately in owner controlled password manager. Never place the key on the same cloud account as the encrypted archive.
- This is **one host-data backup**, not an entire bootable 246GB guest KVM disk.
- Script/test verification was initially performed on central Linux using **synthetic data**; actual Windows/SSH GUI integration is pending the owner's run. Do not claim completed cloud transfer until the owner has supplied non-secret success evidence.
- Future unattended offsite automation would require a separate approved and sustainably authenticated solution; this is a no-charge, manual one-shot disaster-recovery safeguard.

## Source and approvals
All code is Git-first in branch `ops/node1-owner-windows-encrypted-export-v1`, stacked on earlier PR #171. It **never deploys or writes server production** so it does not alter previous SHA-pinned production release or cutover rules. Any future server-side install must be separately approved by exact SHA.