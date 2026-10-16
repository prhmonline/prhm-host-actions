# Agent 3 General Execution Broker / Universal Backup — release gate

Date: 2026-10-16. Status: **CI candidate PASS; Production NOT INSTALLED.**
Do not confuse code and tests with service registration or real backup.

## Immutable candidate
- Source commit: `5c0cd23087fe15435102f2ea4bb4e563579e890f`
- Source hashes and required approval target: `ops/agent3-universal-backup/release-lock.json`
- CI last tested (after release-lock assertions): https://github.com/prhmonline/prhm-host-actions/actions/runs/38963639110
- Files: `lib/agent3-encrypted-bundle.candidate.js`, `lib/agent3-policy-broker.candidate.js`, `lib/agent3-confined-open.js`, `lib/universal-backup-policy.js`, `ops/agent3-universal-backup/install-candidate.js`

## What the candidate does
- AES-256-GCM encrypted files and encrypted manifest using HKDF-derived per-file keys; 32-byte master key must be separately delivered by systemd credential, never in Git.
- Streams encrypted file bytes to a private staging directory with file fsyncs; fsyncs the staged directory and publishes by one directory rename, then fsyncs the parent.
- Fail-closed exclusive destination and per-job lock. No automatic removal of other valid backups. Up to 30 published bundles per destination; minimum 512MiB free-space reserve in addition to estimated source bytes.
- Rejects path escapes, symlinks on descriptor-anchored reads, unknown projects and capabilities, replayed same-job publication, oversize and changed source data. Rechecks source digests before publish.
- Encrypted backup decrypt/isolated restore and SHA-256 comparison tested. SIGKILL during stage leaves no published bundle, although stale hidden stages and locks require separate approved recovery.
- Typed broker requires a trusted server-authentication adapter, configured capabilities, and fsynced audit; it has no arbitrary shell execution surface.
- Fixed-path installer prototype checks SHA256 of staging, requires an externally authenticated one-use Level-4 attestation bound to SHA/action/host, and requires both registry rollback and post-install health callbacks. No standalone apply mode.

## Production block discovered in live Agent 3
At the time of live check, `selfmaint_health` returned `ok:true` on Primary (1.12.5).
The new `agent3_universal_backup_engine_install_v1` action is absent from its Host Action registry.
Direct request through the official `host_action_v2_request` returned **`host_action_v2_not_allowed`**.
No Level-4 request/approval was issued or consumed. No Production patch, service installation or change to the 28 iMotion source files occurred.

## Remaining acceptance conditions (NOT complete)
1. Authenticated owner review of the installer, registered exact fixed action and pinned source/release hashes within Approval Center; safe offline bootstrap must itself use an approved existing Level-4 route. Never bypass the center or invoke another unrelated installer.
2. Provision dedicated service identity, protected key, read-only iMotion source access, approved destination/quota and durable audit path without opening broad root shell capabilities.
3. Complete security review and staging hostile tests (mount/namespace, file descriptor races, source-consistency guarantees, recovery of stale locks, key rotation, metadata/restore corruption, installer registration rollback).
4. Run an approved signed SHA-bound Level-4 transaction; independently validate service, capabilities, log/evidence, installation paths and rollback after the change.
5. Re-enumerate the actual 14 modified + 14 untracked iMotion files, capture pre-backup SHA-256, create encrypted bundle without modifying source, independently restore it in isolation, confirm 28/28 and rehash source.

Decision: no Production deployment until these are verified. Current result is a **build/tested development candidate**, not a completed rollout.

## Continuation verification — 2026-10-16 (current session)
- Encrypted restore now uses a private sibling staging directory and replaces an empty isolated restore destination only after all GCM authentication and SHA-256 checks succeed; corrupt ciphertext cannot publish partial plaintext.
- Negative regression: `test/agent3-restore-transaction.test.js` verifies tampering with the second ciphertext leaves restore target empty and removes transient plaintext staging files.
- Hardened source pin: `ops/agent3-universal-backup/release-lock.json` updated to candidate source commit `73b144496fafdafbbe0ac53013c46b0b99b45532`; encrypted module SHA-256 `30ef584c709f0652231c3c4481fe658fbb0f4bbc742dd7ec309007d4c6202eec`.
- CI evidence: https://github.com/prhmonline/prhm-host-actions/actions/runs/38966231608 — 34 tests PASS / 0 FAIL, source SHA lock test included.
- PRHM Agent 3 Primary still reports healthy version `1.12.5-host-actions-v2-honartik-iticket-dark-backend-batch1` with **no** `agent3_universal_backup_engine_install_v1` registered. A fresh request returned `host_action_v2_not_allowed`.
- Alternative Remote Desktop Commander device is online, but terminal commands are blocked by exhausted monthly connector usage; do not retry until reset. This is a tool availability problem, not authorization for fallback shell access.
- Dedicated GitHub `deploy-control` self-hosted deploy workflow permits only `aranob`, `honartik_front` and `honartik_back`; **control-plane/Agent 3 infrastructure is not allowlisted**, so treating this workflow as a generic infrastructure installer would bypass its controls.
- **No production deploy, Action registration, key provisioning, source-file backup, isolated Production restore or live 28/28 hash acceptance has occurred.**

**Remaining operational gate:** An authorized operator/control-plane maintainer must onboard the exact `agent3_universal_backup_engine_install_v1` fixed action through an approved SHA-bound Level-4 registration transaction before a valid install request can exist. The tested library candidate alone cannot expand the live registry or supply its own privileges.
