# PRHM Fast Delivery — per-release SHA-bound approval v2

## What this milestone solves

The previous RahKomak registration candidate pinned one application commit. Re-registering Agent 3 for every ordinary web change would defeat fast delivery.

This source-only module defines a fixed action identity `rahekomak_web_only_release_v2` and calculates the native Approval Center `arguments_sha256` from **the requested commit SHA**, project, immutable project root, expected branch, deployment scope and registered adapter commit.

Different commits produce different argument hashes while retaining the same registered action. This matches the current Approval Center server's canonical JSON SHA-256 convention.

## Security boundaries

- Only the allowlisted RahKomak web-only profile is supported by v2. All other projects fail closed until individually approved.
- CLI exposes only a read-only plan; it cannot deploy or create approval.
- User-supplied paths, commands, SQL and extra request fields are rejected.
- Future trusted native Agent 3 execution must obtain its signed Level-4 approval through the existing Approval Center, and call authenticated `/v1/consume` exactly once for the same action/arguments hash.
- The result checker validates project, action, approval level, SHA-bound arguments digest, request ID, expiration and native consumption proof.
- The result checker alone cannot verify signature authenticity. The trusted Approval Center server MUST verify Ed25519 signature, token replay and one-time consumption. The `consumeNative` callback must be injected only by trusted server code; it MUST NOT be user-controlled or exposed through a generic executor.
- The shared coordinator still enforces Git cleanliness, branch/HEAD SHA, isolated test/build, durable pre-deploy receipt, deployed SHA evidence, smoke health and verified rollback.
- Production per-target locking and fixed adapter execution sandbox are mandatory for the future real adapter.

## Actual findings

Agent 3 is available, but `rahekomak_web_only_release_v1`, `rahekomak_web_only_registry_install_v1` and the new v2 typed action are not registered. The existing `rahekomak_production_deploy_v1` action is broader than web-only and is NOT a permitted substitute.

The Approval Center already implements signed EdDSA tokens and one-time `/v1/consume`, but the current Host Action v2 request endpoint only accepts an `action` name and hashes `{action}`. It cannot yet bind `commit_sha` supplied for this new v2 request. Do not activate the current v1 fixed-SHA installer as a purported generic release service.

A separately reviewed trusted Bootstrap must register a typed SHA-bound request/apply action in the existing control plane. This source PR neither authorizes nor installs that privileged adapter.

## Evidence and command

- Unit/integration suite: 36 tests passed (real backend and network not invoked).
- Read-only candidate plan uses exact historical RahKomak SHA `c89241e415a093f9c07782ce156b51c7019368c5` and registered-adapter commit binding.
- No production mutation, approval consumption, registry modification or live cutover performed.

See the new script and tests in this commit.
