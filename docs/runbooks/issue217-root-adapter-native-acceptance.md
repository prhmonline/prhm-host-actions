# Issue 217 — Native Root Adapter implementation and acceptance contract

**Status:** implementation specification only; not installed, not a security approval, not production executable. Keep PR #218 in Draft until all gates below are proven.

## Trust boundaries
- Only an independently reviewed root-owned Host Actions registry may expose `honartik_universal_installer_upgrade_v1`. The caller supplies no shell, path, SHA, project, receipt or recovery override.
- The registry pins the immutable candidate digest `8680011e11ad8eae89707b74492e60354c4b7e56799b205d3da581e92806a552`, previous digest `47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181`, and exact operation `host_action.honartik_universal_installer_upgrade_v1`.
- Independently attest the current manifest, bundle tree, root ownership, registry and Apache configuration preimages. Fail closed on any drift.
- Load issuer public key from root-owned trust anchor, not request data. Check JWS Ed25519 signature and exact policy SHA, scope, argument hash, issuer, expiry and principal. Verify **atomically consumed once** receipt against the authoritative Approval Center ledger. Caller booleans such as `signed:true` are not evidence.

## Transaction states (durable before effects)
`LOCKED -> PREIMAGE_ATTESTED -> CANDIDATE_ATTESTED -> RECOVERY_DURABLE -> APPROVAL_CONSUMED -> INSTALLING -> POSTIMAGE_VERIFIED -> COMMITTED`

- Root-owned exclusive lock and durable write-ahead journal must include preimage hashes, original manifest bytes, candidate digest, recovery operation identifier, and explicit state.
- Fsync journal and parent directory before switching current bundle. Rename only into pinned Installer directories; no generic interpreter, shell or caller-controlled filesystem access.
- Under interruption in any pre-commit state, recovery must restore the **byte-identical** original manifest and previous current target; then independently hash the restored bundle and validate unaffected registry/vhosts.
- Ambiguous commit or failed rollback **retains lock and journal** for trusted recovery; it must never report success or unlock.
- Commit and recovery state transitions need monotonic, crash-safe handling. No rollback after a verified committed transition.
- Audit approval ID, pinned source SHA, before/after digest and recovery outcome without logging approval secrets.

## Required independent Linux integration evidence
1. Clean install with exactly pinned immutable bundles, expected release pointer, manifest and audit; no Apache/DB/Yii/application changes.
2. Crash injection after every durable boundary (journal write, pointer switch, manifest write, postimage and commit); reboot/restart recovery and exact-byte restoration checks.
3. Refuse modified candidate, missing root ownership, symlinks, configuration drift, journal corruption, concurrent execution, stale/non-matching/replayed approval and missing authoritative ledger consumption.
4. Fail-closed on injected failed fsync, rename, audit, commit and recovery; prove no false success, and lock retention when rollback is unverified.
5. Independent reviewer validates exact source SHA and signed test evidence; no reuse of fixture-only tests as production authorization.

## Gate to release
- PR #218 contains and passes native adapter integration; an independent review covers the **new** implementation, not only the prior source-only coordinator.
- Policy PR #15 reconciles exact installed policy preimage and its `deployment_integrity` difference without changing unrelated permissions.
- A trusted Root-of-Trust registrar binds the reviewed native action, then an **explicitly authorized** one-time L4 approval is requested and consumed for that precise source and operation.
- Only then upgrade the existing central Universal Installer. Honartik backend/Yii/iTicket deployment remains a **separate** release with its own gates.

This document does not grant authority to use general SSH/RDC/exec access to install or register a privileged action.
