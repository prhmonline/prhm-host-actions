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

## 2026-10-17 — typed shared-registry onboarding contract

**New source-only module:** \`ops/agent3-universal-backup/registration-contract.cjs\`

The only intended supported registration route is the existing reviewed shared-registry design:
\`prhm-action-registry-gateway-v1.cjs\` + \`prhm-action-registry-host-actions-v2-bridge-v1.cjs\`.
Neither is an installed Agent 3 capability merely because its source is in Git.

Approved source revision for the five-field enrollment request:
\`f71759aa3d91ddca1e36f629175354cde8baef58\`
(34/34 backup CI PASS, immutable code SHA256 hashes in release lock).
The dedicated onboarding contract passed 38/38 CI:
https://github.com/prhmonline/prhm-host-actions/actions/runs/38969608525

Exact registration envelope (not yet submitted, not an authorization):
- action: \`prhm_action_registry_install_v1\`
- project: \`agent3\`
- source_commit: \`f71759aa3d91ddca1e36f629175354cde8baef58\`
- manifest_commit: **must come from a separately reviewed future commit**
- manifest_sha256: **must be calculated from that exact immutable manifest**
- install target: \`agent3_universal_backup_engine_install_v1\`
- approval: independent authenticated Ed25519 once-only Level-4, ≤180s, signed binding to *all five fields*, followed by a consumed ledger entry.

### Required trusted work still pending
1. Collect the four **current live** Control Plane owner SHAs via an authorized read-only auditor and prove service health. No historical fingerprints or generated fixtures are valid substitutes.
2. Use the existing reviewed shared-registry bootstrap to register the five-field request/approve/consume/execute route with atomic four-owner rollback. The live Agent currently has no such documented installed route.
3. Compute four immutable patched owner outputs, reviewed asset SHAs, and an immutable manifest referencing source_commit. Commit manifest separately and attest both Git blobs and on-host staged assets against those SHA values.
4. Submit that exact five-field request through the trusted route; perform independent Level-4 approval and consumption; register action, verify tool discovery and rollback.
5. Provision least-privilege service account, key and destination via approved operator action; conduct separate installation, health and 28/28 encrypted iMotion backup plus isolated restore.

The two read-only preflight tools for historical installer refresh work reported PASS but are not evidence that the shared registrar is installed. Never re-purpose their signed registration bindings.

**No Production change, no Level-4 approval used, no e-mail, no actual 28-file backup.**

## Operator SHA verification and live registration gate — 2026-10-17

- Operator executed on `prhm-production`: `sha256sum` of exactly four owner files and `systemctl is-active` of exactly four services. **4/4 reported SHA values match the pinned preimages and 4/4 services report active.** No need to ask the operator to repeat this initial check; production installer must independently re-attest at execution time to prevent drift.
- Evidence is intentionally classified as **operator-reported**, not an independent machine-signed or once-only Level-4 approval. Source: `ops/agent3-universal-backup/operator-owner-sha-observation.json`.
- `ops/agent3-universal-backup/production-registration-contract.json` now acknowledges match but retains `registration_can_apply=false` until signed trusted registrar / rollback / manifest checks pass.
- CI validates reported values versus four fixed SHA pins, rejects tampering and forbids upgrading this observation into approval: https://github.com/prhmonline/prhm-host-actions/actions/runs/38971790326 — **53/53 PASS**.
- Read-only Primary health remains OK, with both `prhm_action_registry_install_v1` and `agent3_universal_backup_engine_install_v1` absent. Official `host_action_v2_request` calls for both were rejected `host_action_v2_not_allowed`.
- **No active registration, no issued/consumed Level-4 request, no production install, no real encrypted iMotion backup, and no isolated Production restore**. Next dependency is proper onboarding of the signed five-field shared registrar into the existing trusted Approval Center / Host Actions v2 runtime. Do not use an unrelated approved installer or an unapproved Runner as bypass.
