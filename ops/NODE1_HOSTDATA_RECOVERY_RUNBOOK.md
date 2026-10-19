# Node1 host-data coverage: next safe release candidate

**Status: Git-only candidate. NOT installed or enabled on production.** No new paid service.

## Verified environment — 2026-10-10

Node1 is the KVM hypervisor for `prhm-production`, so any repository on Node1 and its guest shares the **same physical failure domain**. Treat its existing encrypted central guest-to-Node1 Restic replication as a useful local replica, **not independent offsite**.

Node1's newest local own-backup is `20260828T195706Z`, 1028 hours old at audit time; it contains a valid compressed full MariaDB dump and intact manifest. However the old `home.tar.zst` has **no regular-file payload under `home/imotion/domains`** despite more than 4.29 GB of live website content. It also has no proven VM recovery image. Old integrity PASS does not mean coverage PASS.

On Node1 the required source folders `/home/imotion/domains`, `/home/admin/domains`, `/home/parham/domains`, `/usr/local/directadmin/data` and `/etc` exist. MariaDB dump, gzip, tar, zstd, sha256sum, flock and Python 3 are installed; ~428 GiB is free. VM `prhm-production` is **running**; no live raw `qcow2` copy is authorized.

## Prepared fixed Git components

- `ops/prhm-node1-hostdata-backup-v1.sh` — exclusive flock, required scope checks, new-only root-owned 0700 snapshot in `/var/backups/prhm-node1-hostdata-v1`, consistent InnoDB-style MariaDB logical dump, compression test, full data-site tar/zstd archive, SHA256 checks, atomic COMPLETE manifest. Preserves all previous snapshots; no retention deletion. Does **not** backup live VM disks.
- `ops/node1-host-archive-check-v1.py` — streaming inspection of the **actual decompressed tar**, rejects unsafe paths and directory-only/insufficient iMotion site payload, requires minimum 95% of source file logical bytes.
- `ops/test-node1-host-archive-check-v1.py` — archive content, missing payload, traversal and script operation-mode guards. Integrated Zstd synthetic test skips when no Zstd binary is installed in the *test host*, but the validator was **run on Node1** against the actual old archive and correctly returned nonzero with `archived_site_logical_bytes=0`.
- Existing `node1-backup-coverage-audit-v1.py` and failure-domain guard preserve separate status for VM disk backup, isolated SQL replay and independent offsite.

## Required before Production run

1. An **explicit fresh Level-4 authorization** and a pinned **exact Git commit SHA** for installing these scripts and creating the new snapshot root. The previous Level-4 approval was consumed by the separate central→Node1 deployment.
2. Keep original SSHD configuration and existing central guest→Node1 backup untouched.
3. Independently confirm source-site file count/byte count and MariaDB permissions; check for nontransactional engines if strict database consistency is needed.
4. Install only SHA-verified scripts to `/usr/local/sbin/prhm-node1-hostdata-backup` and `/usr/local/libexec/prhm-node1-host-archive-check-v1.py`, using atomic staging. Do **not** create or enable a timer until manual backup integrity and isolated restore have been verified.
5. Make a new snapshot, verify `SHA256SUMS` and extracted site file payload and SQL archive; then conduct **isolated SQL replay** and file restore. Mark restored only on objective evidence.
6. Find or connect **separate physical** non-paying storage (e.g. an authorized user-controlled computer/external disk not attached to Node1), transfer encrypted copy, prove independent restore, then enable automation. None is currently confirmed. Existing Google Drive access may remain best-effort but is rate-limited; do not rely on it or pursue paid OAuth per owner request.
7. For the *running* KVM guest, use a libvirt-consistent guest-agent backup strategy and independent boot-restore proof; do not `cp` live QCOW2. VM geometry and 245+ GiB allocated size make naive guest VM copies unsafe.

**Limitations:** host-data snapshot is not a full-VM backup or independent offsite. MariaDB `--single-transaction` guarantees a transactional view only for supported transactional tables, and live website files are not globally atomic. Retention, credential escrow, VM restore and offsite independence remain open.
