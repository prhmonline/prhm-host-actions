# Honartik iTicket — real kernel-advisory locking and crash recovery rehearsal

**Evidence date:** 2026-10-18  
**Status:** Verified on **GitHub Linux Runner scratch files**. This is **not** a signed Root/Production installer, production approval or payment release.

## Reproducible evidence

- [Original real-flock run 7/7 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39080939980).
- [Hardened kernel contention + forged unlocked-FD regression 8/8 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39081016724).
- Earlier [integrated four-owner registry + hardened Level4 + scratch-journal 14/14 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39080329025).
- Earlier [journal state-machine regression 28/28 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39080340805).

Source:
- `honartik-iticket-kernel-lock-scratch-runner-v1.cjs` (Git commit `088b4b6cf6ef1744e47d8254bf623bdbd936a844`)
- `test-honartik-iticket-kernel-lock-scratch-runner-v1.cjs` (Git commit `81f09858a6756287ec6061a74e90d4600a71766f`)
- `.github/workflows/honartik-iticket-kernel-lock-scratch-ci.yml` (Git commit `fffff1d90422f9f20c2684110295e3068548c3fc`)

## Behaviors actually tested

1. `/usr/bin/flock -F -n -x -E 73` acquires an **OS-managed exclusive lock** at a checked `/tmp/prhm-iticket-tx-fixture-*` pathname. Second independent process is rejected with exit 73 and cannot start the transaction.
2. The lock descriptor survives `flock --no-fork` exec into the Node worker and is verified against the expected lock-file inode. A second independent `flock` probe must see contention. Merely inheriting an open **unlocked** file descriptor is insufficient; a forged-FD negative test passes.
3. An unrelated process killed with `SIGKILL` releases the exclusive kernel lock, after which a new process can acquire it.
4. A four-owner scratch-disk commit under this lock uses the persisted fsynced intent journal, file+directory fsync, SHA comparison and uid/gid/mode verification from the existing isolated adapter.
5. The process explicitly exits with status 86 **after the second physical rename**. A fresh lock holder reloads the persisted intent and backups, rolls back the two changed files and verifies original hashes. Recovery is repeatable.
6. Unexpected third-party owner SHA blocks recovery (fail closed; no overwrite).
7. Invalid root, path/symlink and arbitrary operation command strings fail before protected actions.

## Critical limitations

- `flock` proves **mutual exclusion on the GitHub-hosted runner** in the configured filesystem, not a verified ownership or reachability contract for the actual Production root owners.
- The disk adapter remains locked to self-created OS temporary fixture paths; its PID-file fallback remains present **inside the fixture** and is not suitable as the trusted production transaction lock.
- The file-descriptor inode + contention check is an additional fixture diagnostic, not a replacement for a trusted supervising service with a lock held continuously across signed commit and recovery.
- Physical disk fsync and crash-on-process-exit tests **do not** prove durability through server power loss, filesystem corruption or hardware cache failure.
- Real Production owners and service graph were not modified or rebooted. The four prospective in-memory owner digests were previously attested on-host. The newer hardened policy digest `9a2c47db59211a638976ee181e8a5b246c79f082371d82a7396c6a07f646faa7` remains **prospective**.
- The proposed worktree registration dispatcher remains **inert**. Even an authorized worktree action does not itself deploy iTicket payments.

## Remaining gates for a legitimate privileged installation

A separate, narrowly scoped Root installation implementation must: accept only the four exact allowlisted live owner paths and verified current SHA preimages; use approved immutable source/candidate hashes; bind an actually verified Ed25519 one-time Level4 critical approval to the exact operation and rollback; hold an unambiguous kernel lock from before validation through recovery; persist backups, metadata, intent journals and their parent directories before each replacement; detect unexpected owner drift; validate effective Approval Center policy and service restart/health dependencies; and prove failure injection in a permission-equivalent disposable environment. It must **not** use the earlier sequential, partially recoverable `host-action-v2-installer-v1.js` (consumed earlier approval).

**No new approval token requested or consumed. No Production, database, bank, wallet, SAMFA or email mutations.**
