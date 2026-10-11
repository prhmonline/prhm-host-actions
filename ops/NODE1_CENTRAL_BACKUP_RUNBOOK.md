# PRHM central → Node1 encrypted SFTP backup (no new cloud subscription)

## Fixed architecture

- Source: newest complete directory matching `/var/backups/prhm-central/20YYYYMMDDTHHMMSSZ` on prhm-production.
- Encryption: Restic 0.19.1 encrypts at source; never put plaintext on Node1.
- Transport: SSH / SFTP, fixed alias `prhm-node1-backup`, Node1 host `185.191.76.138`.
- Target: SFTP chroot jail `/srv/prhm-sftp`, visible internal directory `/repo/central-production`.
- User: dedicated non-root `prhmbackup` with forced internal-sftp, disabled password and forwarding, no interactive shell, own restricted repo.
- Runtime: fixed Git-owned `ops/prhm-node1-central-offsite-v1.sh`. Existing local snapshots and Google Drive assets remain untouched. No prune or delete.
- Scheduler: service/timer candidates committed under `systemd/`; never enable timer before one full encrypted backup + independent restore PASS.

## Current readiness (Oct 10, 2026)

- Central → Node1 SSH read-only login: PASS using existing root diagnostic access. Not proposed as permanent backup transport.
- Node1 storage: 429 GiB free on current filesystem; this is existing capacity, not an additional subscription.
- Node1 dedicated SFTP identity, chroot, key, password, secure SSH config: NOT PROVISIONED.
- Central snapshot: `20261010T092103Z`, COMPLETE; source file coverage has a `drtarjomeh__drtarjomeh.ir.SKIPPED.txt` warning.
- Synthetic local encrypted Restic backup + full data check + restore: PASS. This is NOT a remote integration test.

## Production change controls — separate Level-4 authorization required

1. Record exact Git commit, current `/etc/ssh/sshd_config` SHA on Node1, existing SSHD health and active root session; preflight disk usage and snapshot source integrity.
2. Generate a dedicated Ed25519 key pair on central under `/etc/prhm-backup/node1`, permissions 0700/0600. Do not log or export private key. Pin the *verified* Node1 host key in `known_hosts`; do not use StrictHostKeyChecking=no.
3. On Node1, create a non-root `prhmbackup` account, a root-owned chroot directory mode 0755 and a dedicated user-owned `/repo` mode 0700 inside it. Place only the public key in a root-owned restricted authorized-keys file. Do not reuse central's root SSH credentials as the automatic transport.
4. Append a `Match User prhmbackup` block at the END of Node1's main sshd_config (not an early Included file), with `ChrootDirectory`, `ForceCommand internal-sftp`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitTTY no`, `AllowTcpForwarding no`, `X11Forwarding no`, `AllowAgentForwarding no`, and absolute fixed `AuthorizedKeysFile`. Save a SHA-bound preimage and test `sshd -t` and user-specific `sshd -T -C` before reload; automatically restore previous file and reload on any regression. Keep an independent existing root access session verified.
5. On central, create secure `ssh_config` for the fixed alias (identities-only, strict known_hosts), and a fresh random Restic repository password file protected mode 0600. Store independent recoverable copies of the password outside the backup server; recovery is impossible without it.
6. Provision the **empty**, dedicated SFTP Restic repo once. No automatic `restic init`, `forget`, `prune`, remote delete or overwrite is allowed in the daily runner.
7. Use only the pinned Git source SHA to deploy the fixed runner/service. Run a one-shot transfer, `restic check --read-data-subset=5%`, full remote restore to isolated temporary space and check all `SHA256SUMS` plus manifest; inspect structured `/var/lib/prhm-backup/node1-central/latest.json`.
8. Only on green health/restore, enable the timer candidate; observe its first unattended run. Record repo, branch, SHA, source/target, timestamp, status and rollback. Restore original SSHD config and stop the new service/timer if failures occur; never reset Git history automatically.

## Limits

The setup is free of a *new cloud subscription*, but existing server disk, transfer traffic and operational capacity still have costs. This is a different server, not an immutable offline backup. Protect against compromised central credentials and monitor Node1 usage; do not claim 3-2-1 coverage. Implement separate Node1 data backup and source scope coverage (DrTarjomeh skipped files) before declaring system-wide backup DONE.

## Source references

https://github.com/restic/restic/blob/master/doc/030_preparing_a_new_repo.rst
