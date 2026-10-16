# Agent 3 universal backup — production readiness gate

## Current verified development scope (16 October 2026)

**DO NOT DEPLOY:** The prototype is not registered or installed on PRHM Agent 3 Primary.
A passing unit-test workflow is not production authorization.

The implementation in `feature/agent3-universal-backup-engine` now:
- Independently reads persisted backup artifacts and compares archive, manifest and completion-marker hashes instead of trusting caller-supplied success booleans. `verifyEvidence` always reports `production_ready:false`.
- Rejects unsafe/duplicate/oversized manifest members before Tar extraction, including a regression for recomputed markers.
- Uses Linux directory-FD-anchored opens for the read broker and source files, rejecting symlink traversal. This remains a prototype and requires openat2/mount-namespace security assessment.
- Streams source file copies and archive hashing, imposes 512 MiB per source file, 2 GiB per job, 1,000 files per job, and timeouts on Tar commands; policy/job state persistence and storage quotas are not yet implemented.
- Adds an exclusive per-job lock so concurrent processes cannot publish the same job; crashed/stale locks fail closed and require controlled recovery.
- Maintains a **read-only source inventory** for iMotion at `config/agent3-imotion-backup-28-source-inventory.json` (14 modified tracked, 14 untracked). No 28-file archive or per-file SHA manifest has been produced.

## Remaining hard blockers

1. **Crash-consistent publication and recovery:** Current archive, manifest and marker are separate destination files. `atomic_commit_ok:false` is correct. Implement tested atomic namespace commit, crash interruption/fault injection, orphan cleanup and a durable job journal. Never overwrite or delete existing verified backups.
2. **Encryption and key management:** Backups are still plaintext, metadata has only an unauthenticated hash marker, and no authenticated signature/AEAD policy, key rotation, secret distribution, secure permissions or tested decrypt/restore workflow exists.
3. **Resources and storage:** Enforce quotas, reserve capacity, per-user/job rate limits, bounded concurrent jobs across processes, protected destination mount identity, immutable retention policy and deletion authorization. Locks alone do not cover crash recovery.
4. **File correctness and isolation:** FD traversal reduces symlink races but does not guarantee an atomic multi-file source snapshot. Examine Linux openat2, bind-mount controls, permissions and adversarial Tar/PAX/hard-link handling.
5. **Execution broker:** Only read-only prototype is built. Identity must be server-authenticated, operations typed and allowlisted, auditing durable, privileges separated, and all writes signed/authorized per risk level. No general Shell.
6. **Installer / Production gate:** Build a fixed-SHA installer with verified input hashes, privileged-path allowlists, backup, rollback, sandboxed service, registered Host Action and approval verification. Agent 3 Primary has no Universal Backup or General Execution Broker registered or installed. No Level-4 approval was requested or consumed.
7. **iMotion snapshot:** Re-inventory the actual 28 files just before the write operation, record all SHA-256, perform an encrypted backup in the authorized destination, and verify isolated recovery byte-for-byte with no source changes. The frozen status inventory is not a backup.

## Acceptance criteria (all required)

- Current HEAD CI succeeds, including adversarial tests, simulated abrupt termination, integrity tampering and denial scenarios.
- An independent security assessment signs off on the executor and broker, storage, identity, audit, recovery and least-privilege constraints.
- Staging install + actual encrypted backup + isolated restore succeed with independent SHA-256 comparisons.
- Exact-Git-SHA production installer is registered and receives a valid operation-bound approval through Approval Center.
- Agent 3 Primary installation and post-install health/registry/audit/rollback checks succeed.
- iMotion 28-file manifest, encrypted archive, independent isolated restore and original source stability are demonstrated on the authorized host.

**Current verdict: development implementation and CI only; production gate NOT PASSED, no Agent 3 installation, no iMotion 28-file backup.**
