# Honartik U06 — independent security release gate for expired owner OIDC

Date: 2026-11-14. Status: PENDING independent security review; PRODUCTION NO-GO.
Linked work: prhmonline/deploy-control#75 and prhmonline/prhm-host-actions#294.

## Current live read-only facts (2026-11-14 13:07:50 UTC)

- Root Executor active.
- In the fixed U06 owner-oidc directory: challenge.json (root, 0600, 458 bytes) and host-private.pem (root, 0600, 119 bytes) are still present and expired.
- encrypted-gh-evidence.json and reconciliation.journal.json are absent.
- Native u06-exclusive.lease and u06-rollback.json are absent.
- Installed Root bridge SHA256: 35f1f79c397d66008b017014a3141d5518ff416f34fc18fbdaebc9087ecd449d, NOT the proposed PR replacement.
- GitHub owner OIDC run 43582883188 succeeded but its sealed proof was never verified/consumed by Root. It is NOT an L4 permit.
- U06 first-registration/bootstrap owner SSHSIG was consumed and committed on 2026-11-13. Never repeat that operation.

## Candidate provenance

- Branch: feature/u06-expired-owner-oidc-reconcile-20261114.
- Last code head: 1ee823fb4203a6b5409628715337b65f1e092fff (code SHA must be repinned if changed).
- Reconciliation module Git blob: 6f982dc5f6108b68a6fea07537937c96cf641e6e.
- Regression tests Git blob: dacf55c3e1ddf3449d0e5b55304db3258c8f2868.
- Existing challenge bridge proposed guard Git blob: 131fc75cc59d525fca207d118d584b660438b346.
- GitHub source-only CI run 43597545312: 12/12 PASS including SIGKILL and injected consumption/lease races.
- The candidate deliberately exposes no live Root action, privileged CLI, database operation, approval issuer, or production authorization.

## Blocking decisions for independent reviewer

1. **Shared lock**: repeated file and ledger checks do not solve time-of-check/time-of-use races. The future trusted Root adapter must hold a real exclusive, crash-safe lock respected by ALL challenge issuance, envelope staging, owner proof verification/consumption and U06 Native transaction paths. A reconciliation-only lock is insufficient.
2. **Exact independent authorization**: define a distinct, fixed typed operation for expired/unconsumed challenge reconciliation, with immutable SHA provenance, approved privileged handler and independently signed one-use permit. Do NOT reuse the consumed Root-bootstrap SSHSIG, the separate Native-backup L4 permit, unrelated Host Actions or a generic shell/root path.
3. **Durable recovery**: after signed approval, journal exact preimages and expiry, atomically claim one exclusive lock, fsync the journal/parent, archive nonsecret challenge metadata, retire the ephemeral private key only under lock and with a durable intent, record an immutable redacted tombstone, and release the claim. Deny ambiguous states. A failed/partial transaction must not silently erase the lease.
4. **Filesystem proof**: root:root controlled ancestry and private directories mode 0700, regular files 0600, hardlink/symlink/mount/race defenses with descriptor-based path pinning and ownership/inode checks; exact host, workflow reference, X25519 keypair and challenge expiry.
5. **One-use safety**: fail closed if an existing encrypted artifact, owner-proof ledger receipt, active Native lock/journal, prior reconciliation journal, unexpected file or policy/preimage drift is detected. No private PEM/JWT/JWS should be logged, committed, exported or included in the review artifact.
6. **Crash fault tests**: SIGKILL at each fsync, journal, rename, private-key retirement, and receipt boundary. Two concurrent reconciliation requests, concurrent owner-proof consumption/Native lease, stale/malformed signed approval and tampered inputs must never lead to multiple valid receipts or an unauthorized reset.

## Release acceptance checklist

- [ ] Named independent security owner reviews this exact source and decides GO/NO-GO in GitHub.
- [ ] Exact Git source, SHA preimages, manifest, signer and policy pinned and attested.
- [ ] Shared Root exclusive lock implemented and tested by all relevant readers/writers.
- [ ] Dedicated fixed handler and separate scoped signed approval registered through an authorized release route.
- [ ] 0700/0600 ownership, no-follow, durable journal, one-use consumption and refusal behavior independently tested.
- [ ] Unprivileged and isolated production-equivalent tests pass including real SIGKILL and race scenarios.
- [ ] Live read-only after-install confirms registered handler and expected SHA, without backend deploy or unauthorized restart.
- [ ] If any item fails, retain NO-GO and preserve the prior Root challenge for authorized recovery.

## Required sequence after a separate approved Root release

1. Run only the dedicated signed Root reconciliation operation once; obtain redacted durable retirement receipt.
2. Issue new random 8-minute challenge and new X25519 key; trigger fresh owner GitHub workflow from fixed actor; stage sealed artifact through a reviewed private transfer; validate official GitHub OIDC signature/run/actor/SHA/nonce in Root and durably consume once.
3. Independently obtain a separate short-lived, one-use official Level-4 grant for actual Native U06 backup.
4. Run installed Universal Native DB backup; independent networkless restore plus 69-table/49-FK and finance/wallet integrity; independently fetch and recover encrypted offsite snapshot. No U03/U05 deploy.

No Production change, secret handling, L4 grant, live challenge reset, or backup execution is authorized by this review document.


## Source-only five-actor integration CI (2026-11-14)

A dedicated source-only dispatcher, honartik-u06-shared-actor-integration-v1.cjs, now first obtains the shared lock, checks lease ownership, invokes exactly one of five fixture callbacks, rechecks lease, requires a typed terminal evidence shape and only then releases the fixture lock. Failures retain the blocking lock. Its constructor is strictly unprivileged and fixture-path-only. The callbacks and terminal evidence are **synthetic**; they do not carry owner identity, an L4 receipt or any privileged Root authority.

- actor owner_challenge_issuance: intended installed source honartik-u06-root-owner-proof-bridge-v1.cjs / prepareOwnerChallenge; NOT YET guarded on live Root
- actor owner_evidence_staging: intended encrypted GitHub artifact transfer into private 0600 envelope; no trusted installed, shared-locked staging handler reviewed yet
- actor owner_evidence_consumption: intended honartik-u06-root-owner-proof-bridge-v1.cjs / consumeStagedOwnerProof plus honartik-u06-owner-oidc-once-fence-v1.cjs / consumeVerifiedOwnerEvidence; NOT YET guarded on live Root
- actor expired_challenge_reconciliation: fixture-only honartik-u06-expired-owner-challenge-reconcile-v1.cjs; NO LIVE ROOT ENTRYPOINT
- actor native_backup_transaction: intended honartik-u06-native-root-lease-v1.cjs / createLiveRootLease and the trusted U06 coordinator; NOT YET guarded on live Root

GitHub CI: https://github.com/prhmonline/prhm-host-actions/actions/runs/43600763982 — 30/30 tests passed (including eight simultaneous independent fixture actor processes and fail-closed SIGKILL). Shared Agent 3 gate: https://github.com/prhmonline/prhm-host-actions/actions/runs/43600763942 — success.

**Go/no-go:** This is integration-contract verification of synthetic callbacks, not a test that existing Root code paths cannot bypass the lock. The real file writers, cryptographic verifier, replay fence and Native transaction must each be independently refactored or wrapped in one trusted, owner-authorized Root release using a shared exclusive lock, including explicit terminal-journal verification, and tested in an isolated production-equivalent environment. No current Production operation is disabled or protected by this draft alone. Keep PR DRAFT and Production NO-GO.
