# Owner-controlled recovery key: off-Node1 generation and drill

**Scope:** One-shot encrypted host-data backup of Node1 to the explicitly approved **prhmonline@gmail.com** Google Drive via the existing rclone destination. This guide **does not** authorize or perform any upload or change production services.

## Required owner setup (on your OWN independent computer, not a server)

1. On a personal Windows, macOS, or Linux device physically independent of Node1, install a maintained Python 3 and GnuPG (on Windows, Gpg4win can supply \`gpg\`). Download the exact reviewed source file \`ops/node1-offsite-owner-key-v1.py\` from **this Git revision/PR** after it passes review. Do not download unknown copies. The utility deliberately refuses to generate a recovery key if its hostname identifies \`prhm-production\`, \`server1.prhm.ir\` or \`node1\`.
2. Open your local terminal **on that personal device**, not Remote Desktop Commander or an SSH shell on Node1. Run \`python node1-offsite-owner-key-v1.py create --directory "<a-new-private-local-directory>"\`. It writes \`node1-hostdata-gpg.passphrase\` with a cryptographically random 384-bit secret and an **initially unconfirmed** \`node1-hostdata-escrow.json\`. On Unix it uses mode 0600 inside a mode 0700 folder; on Windows additionally verify NTFS file/folder ACLs protect access. **The key is never printed or transmitted.**
3. Import the exact contents of \`node1-hostdata-gpg.passphrase\` privately into an **owner-controlled password manager or offline encrypted safe** that remains accessible if Node1, its VMs and its local disks are destroyed. Do not place the secret in Google Drive under the same login as the backup, GitHub, ChatGPT, email or a server log. Keep the password manager's account recovery method separately accessible.
4. On that device, **retrieve** the saved key again from the independent password manager/safe into a **different, access-restricted temporary file**. Run \`python node1-offsite-owner-key-v1.py attest --directory "<same-private-local-directory>" --recovered-file "<independently-retrieved-key-file>"\`. The program compares secret bytes in constant time and tests GnuPG AES-256 symmetric encryption of a random challenge using the original key and **actual decryption** using the separately recovered copy. A good result is \`OFF_SERVER_RECOVERED_KEY_GPG_TEST=PASS\`; it then updates the receipt to \`independent_physical_copy_confirmed=true\` and logs only the key's SHA-256 fingerprint. Never show or paste secret bytes in chat/tickets.
5. Remove the additional temporary recovery-copy file using your device's approved secure disposal procedure (ordinary deletion on SSD may not physically erase earlier blocks). Preserve the verified independent password-manager secret plus its recovery route. Keep \`node1-hostdata-gpg.passphrase\` and confirmed \`node1-hostdata-escrow.json\` locally encrypted until the separately approved, authenticated **root-only transfer** to production-central. **Do not move, upload or transmit them to central yourself through this chat.**

**This is an owner custody attestation, not an automatic way to prove a particular physical device.** The owner must truthfully have recovered the key from an independent failure domain. The tool uses a challenge and a real decrypt to verify the retrieved passphrase works, but cannot detect if both source and recovery files were manually copied from the same server.

## Acceptance when production upload is separately approved

- Repository and exact new SHA must match the eventual release, with root-only release receipt on central. Current production one-shot candidate remains unchanged and blocked.
- Parent cloud folder must be present and authorised. Live OAuth account ID must match \`prhmonline@gmail.com\`, and remote available quota must retain >1 GiB safety floor after writing one encrypted ~2 GiB snapshot.
- Store only a recovered-verified key and attestation on production-central, with directory 0700 and files 0600. No passphrase text in commands, issue bodies, CI logs or chat. Test the exact original Node1 SHA manifest and archived site/DB coverage first.
- Upload only the encrypted \`.tar.gpg\` object, download it again, decrypt it into isolated temporary storage, verify **entire SHA256SUMS**, database list and site coverage, then persist a root-only JSON proof with exact git SHA and result. A mere cloud file or successful copy is **not** a tested restore.
- No unattended daily uploads until provider-client authentication continuity is solved: the current shared rclone Google client ID warns it will retire during 2026. No live-VM QCOW2 image backup or isolated boot test is included.

## Known test scope

The owner utility is tested with **synthetic keys and data only** on the central test environment. It creates no real business recovery key on Node1 or production-central. Owner off-device setup remains **not done** until personally completed and attested.
