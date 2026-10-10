# Node1 host-data supervised scheduling — deployment gates

**As of 2026-10-10 this is a Git-only candidate, NOT installed on Node1.**

The previously installed, SHA-pinned manual host-data backup stays intact:
- Node1 runner: `/usr/local/sbin/prhm-node1-hostdata-backup` SHA256 `d0230740e7e6fa1aa94407482ef9bd88a5f0a86ca68c4be931af4980bdf1687e`
- Coverage validator SHA256 `cc3e2cfe121ee08f4460bd02a5c5e869bf699cc6b48bfc11a88d6f8e4f18d819`
- Real verified manual snapshot `20261010T163143Z`: 6 schemas, 109,828 iMotion site files, 100% site logical payload; all 5 snapshot SHA256 checks, isolated file restore and isolated SQL replay passed

## Git-owned proposed units

- `prhm-node1-hostdata-backup.service`: sandboxed root oneshot calls `/usr/local/sbin/prhm-node1-hostdata-supervisor --run`. The supervisor verifies exact deployed runner/validator SHA, free space and host identity, performs one already-implemented full local snapshot, then rechecks its COMPLETE marker, MANIFEST, 6+ database names, real site-payload coverage and all SHA256SUMS. Writes individual structured 0600 evidence files and atomic `last.json` for *every* result, `latest.json` for last **successful** result.
- `prhm-node1-hostdata-backup.timer`: every day at **03:30 Asia/Tehran**, up to 15 minutes random jitter.
- `prhm-node1-hostdata-health.service`: read-only watchdog requires the *last* run to PASS, zero runner exit status, actual systemd unit result success, re-verifies SHA256 snapshot integrity and complete marker, requires fresh evidence **within 36 hours**.
- `prhm-node1-hostdata-health.timer`: every day **08:30 Asia/Tehran**.
- **Capacity guard**: hard failure under 64 GiB free; early warning under 96 GiB. No automated pruning or deleting snapshots.
- **Monitoring scope**: local machine journal/JSON and failed systemd service status only; no external email/SMS/push alert is yet connected. Do not claim that the owner will receive remote failure notifications.

## Deployment protocol (requires NEW explicit Level-4)

1. Verify clean exact Git worktree and pinned full 40-character commit SHA, remote branch origin SHA exact match. Confirm manually captured Site/DB snapshot and restore evidence, and Node1 root SSH still healthy. Re-run all unit tests on Node1 Python **3.6**, plus `systemd-analyze calendar` and static unit verification on staged unit copies.
2. Take read-only preimage checks; targets must **not exist**. Only install `/usr/local/sbin/prhm-node1-hostdata-supervisor` (root 0700) and the four exact `/etc/systemd/system/prhm-node1-hostdata-{backup,health}.{service,timer}` files (root 0644). Do not replace the existing live runner/validator.
3. First start the systemd backup **manually**; require `last.json.status=PASS`, snapshot SHA and full coverage verified. Then run the read-only health unit; require Result=success. Only after both green, enable both new timers. Check their enabled/active status and next invocation time. Restore original service/timer state on any failure; leave immutable successfully created snapshot untouched, never rewind Git automatically.
4. Log Git repo/branch/SHA, target host, previous target-file absence, SHA256 installed artifacts, execution/restore result, time and rollback to a 0600 JSON deployment record; retain journal evidence.
5. Observe the *first unattended timer execution* the following day; a successful manual service run **does not** prove unattended schedule execution. Keep entire disaster-recovery issue OPEN until this is confirmed.

## Security and protection boundaries

This backup covers Node1 host MariaDB + actual iMotion site/admin/DirectAdmin files. It **does not back up or boot-test the live `prhm-production` QCOW2 VM**; it **does not produce an off-physical-Node1 copy**. Node1 is the physical hypervisor of the central guest and also stores that guest's Restic SFTP replica, so a physical Node1 incident can remove both. No paid cloud provider or new Google Cloud OAuth is used.

Without approved independent physical storage and a safe libvirt VM restore proof, never report full system disaster recovery as DONE.
