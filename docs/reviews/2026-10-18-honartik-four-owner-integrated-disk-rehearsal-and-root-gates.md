# Honartik four-owner crash-recovery plus critical Level-4 policy integrated rehearsal

**Date:** 2026-10-18  
**Status:** Source-only and real scratch-disk integration **GREEN**; root production install **NOT AUTHORIZED**.  
**Scope:** Fixed four Control Plane owners, action `honartik_git_worktree_fixed_v1`. The action is NOT the iTicket payments deployment itself.

## Independent, verified on-host evidence

The production operator executed the SHA-verified read-only original owner inspector and then the separate MCP ESM + policy-scope syntax check. Results:

- Four old owner digests and helper state SHA match: **PASS**
- In-memory prospective Base/Exec/MCP SHA-256: Base `629212ae3052eab380ea1b3fc7c0b15395dfb23a251331762ebb781e1bbf1b2f`, Exec `9dade5d2a9a9722c1dd1283a3a1002325da02e134804aca1ea6d673cf2de3e87`, MCP `52d3c0c04cd3bb26815403e2c089f9a408047bd9d376536ae570df669a7fd2a3`.
- The original proposed policy digest `be738cf7be1555d717558b51d560c381e2d4ed6bab87dabb701d712b6c2d9980` was **SUPERSEDED** by the enhanced prospective critical policy `9a2c47db59211a638976ee181e8a5b246c79f082371d82a7396c6a07f646faa7` after on-host 12/12 static Level-4 checks.
- `MCP_ESM_SYNTAX=PASS`, `POLICY_STATIC_LEVEL4_SCOPE=PASS`, `EFFECTIVE_ISSUER_ENFORCEMENT=NOT_ATTESTED`, `INSTALL_AUTHORIZED=NO`.

These are digests of **in-memory** proposals, not deployed live owner digests.

## Integrated real scratch-disk rehearsal

Combined actual-current registry *shape fixtures* for Base/Exec/MCP, the separate *hardened* Level-4 policy contract, and the persistent fsync + rename + four-owner journaled rollback engine.

[Integrated disk run](https://github.com/prhmonline/prhm-host-actions/actions/runs/39080279674): **14/14 PASS**. Repeated after the receipt/metadata hardening: [run #39080329025](https://github.com/prhmonline/prhm-host-actions/actions/runs/39080329025): **GREEN**.

Coverage:

1. All four proposed candidates are committed in a dedicated OS temporary scratch directory with SHA and uid/gid/mode checks. The Level-4 policy candidate has `risk:'critical'`, single-use, 180-second expiry, human/second confirmation and rollback reference; existing installer remains level 3.
2. New worktree dispatcher remains **INERT** and existing dispatcher function still operates.
3. Injected failure **before and after each of the four actual disk renames** restores owners from fsynced backup and verifies persistent rollback journal.
4. Real subprocess exits immediately after the second rename; a fresh process recovers original owner bytes and metadata using saved disk journal.
5. Third-party concurrent change blocks rollback rather than overwriting unrelated bytes.
6. Global policy without Level-4 second confirmation is rejected before a candidate is produced.

## Transaction-engine hardening

Previous recovered `ROLLED_BACK` receipt was wrongly trusted without checking owners. Added a SHA/uid/gid/mode verification for every owner and a runtime-health recheck before claiming already-recovered. Also verified all four owner metadata at the end of every rollback, even for initially untouched owners; **an external chmod is a rollback failure**, not a recovered state.

- [Transaction test suite after hardening — 28/28 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39080340805).
- [Real-disk fixture rerun after code hardening](https://github.com/prhmonline/prhm-host-actions/actions/runs/39080328719).

## Production gates — DO NOT BYPASS

1. **Current functional candidate is not the production installer.** Transaction engine is `isolated-fixture` only; disk adapter accepts only owned scratch paths. No trusted signed root adapter with proper advisory/kernel locking and safe multi-file recovery exists here.
2. New safe installation must enforce real initial/final live SHA digests and canonical policy, owner UID/GID/mode, trusted filesystem boundaries, durable backups and intent journal with file+directory `fsync`, power-loss recovery, exact action-specific L4 approval, signed mediator, and bounded service restart/posthealth. PID-file locking is insufficient for privileged production.
3. Approval Center **effective runtime** action-specific critical policy/Ed25519 replay/expiry/second-confirmation enforcement is NOT attested. Static policy checks are necessary but insufficient. Never reuse the failed consumed installer request.
4. Signed activation of the intentionally inert `honartik_git_worktree_fixed_v1` route requires separate helper semantics review and exact SHA-bound registered implementation; the old installer has a known unsafe partial-write rollback and four obsolete anchors.
5. Even successfully registering a worktree helper does NOT deploy iTicket checkout, MariaDB 10.6 migrations, bank Saman/SEP payment, seller wallet settlement or SAMFA ticket issuance; each has independent acceptance gates.

**No Production mutation, no new Level-4 token consumed, no email, no bank checkout or business transaction.**
