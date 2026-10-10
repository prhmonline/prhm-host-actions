# Shared Fast Delivery - RahKomak live-source pilot v1

## Tested boundary

- The first real candidate is rahekomak from the 22-profile inventory.
- Single exact commit SHA required on a clean main branch.
- Verified existing fixed web-only-release-v1.cjs helper SHA-256 before calling its read-only --preflight.
- Compiled and tested the exact commit in a detached, ephemeral Git worktree, never in the Apache DocumentRoot.
- Verified five public-help numbers in candidate static bundle; compared SHA-256 of live out/index.html before/after.
- Removed ephemeral worktree after success/failure.
- Explicitly denies --apply and rejects caller-provided approval variables or arbitrary command/path input.
- No database, API, Apache, admin, runtime host-action registry or production static output is changed.

## Evidence from live read-only pilot

Commit: c89241e415a093f9c07782ce156b51c7019368c5

Existing helper SHA-256: bf901961635986ff917bade164610ecc80cd3e9ebb549ef79ecc9efecce41320

Live index SHA-256 before/after: cde1fe23eea7d3ce01fb0f22d64836ec9445c38dd6f3ef709062122318f8bcf3

All four stages passed: test, typecheck, lint, build. Five numbers 121, 122, 194, 124 and 195 present in resulting bundle. Ephemeral stage cleaned up.

Native Agent 3 Host Action rahekomak_web_only_release_v1 is not yet registered in the live Host Actions list; the old rahekomak_production_deploy_v1 has a broader API/database/Apache scope and must not be substituted. This pilot is a source/build verification adapter, not a registered production-deploy adapter.

## Next native binding requirement

Register a trusted, immutable SHA-bound web-only Host Action (with independently authorized L4 bootstrap). Connect it to the existing native Approval Center signed, expiring, single-use request/apply flow. Reuse the Git-first coordinator's durable receipt and rollback proofs, enforce per-target locking, and retain its fail-closed state when any proof is unavailable. This step is not accomplished by the pilot and is not authorized by a successful read-only verification.

Avoid turning this verifier into an arbitrary root shell or a general deploy executor. Other stacks (Yii, WordPress, Next, Laravel, external VM) need fixed allowlisted adapter implementations; the shared coordinator must remain one engine.
