# Solo Universal v2 — signed release gate and exact production handoff

**Status: SOURCE_ONLY / NO-GO for production mutation.** This release is strictly for *read-only registration and observation* of an already-running stateful Solo Runtime. It does not transfer authority to deploy, stop, restart, migrate, roll back, expose, or modify the service or `/var/lib/private/prhm-solo-company`.

## Pin and operation

| Invariant | Expected |
| --- | --- |
| Operation | `universal.existing_stateful_service_observe_adoption_v2` |
| Role | One-use critical Level-4 signed owner (or separately designed Provider) authorization |
| Owner issuer | `prhm-owner-root-of-trust` (**not** Provider) |
| Owner SPKI SHA256 | `d161f17f3d3446185e9b106b459b693eb3f453653d8221fc7d8e3f6b987f477b` |
| Immutable source anchor | `prhmonline/deploy-control@9df0cab4d4d75a81fb4ba1e5982915584fc8a727` |
| Installed v1 bundle | `08889c18a570cc2bff408dfbe78b7e5f4f8da24f465b4fdd445640cd7f89d17d` |
| Installed `installation.json` SHA256 | `b11c7f601307b702f3c7380485851ecf9a23e15fd91c93b7796373f817a2a2a3` |
| Candidate v2 bundle | `20d8a4f5a972fcfb33812c67e935b38a65d9b71be8a4c7cf21d9f7b4999b929a` |
| New v2 profile digest | `f767738f3059650e22c137c22e9b4c93f6f28db14ebe8ee3d20eb9c99e7a6df4` |
| Existing Solo release | `0eb43d72aab3f10db22172c8be4c0411cf22d074` |
| Profile to create after permit only | `/etc/deploy-control/projects/solo_company.production.json` |

The owner signature from `host_action.solo_company_runtime_registration_v1` is a **different operation** and must never be accepted. The prior Owner review waiver binds a different source commit; no reuse. A future acceptance receipt must include this PR's **frozen, reviewed final Git commit SHA**, together with the exact pinned fields above, a unique request ID/JTI, Ed25519 signature, and expiry within 180 seconds.

## Evidence and new code

- `solo-universal-v2-signed-release-contract-v1.cjs`: source-only EdDSA compact JWS verifier, strict canonical header and claims, owner key pin and Level-4 scope, fail-closed transaction coordinator requiring a **separately verified and durably consumed** grant.
- `solo-universal-v2-live-readonly-preflight-v1.cjs`: local read-only fixed-path witness; checks real on-disk installed Python bundle digest, manifest SHA, exact versioned symlink, default v1 registry validation (six entries), private loopback listener, Solo unit hardening, status, and root-owned pinned owner public key.
- Offline GitHub-hosted tests use *synthetic* Ed25519 fixture keys; never production key material. All mutations are simulated with a fake root capability interface. Green CI does not establish a production root adapter.
- 2026-11-09 latest **direct server** read-only witness result: `LIVE_V2_RELEASE_PREIMAGE_PASS_NO_PERMIT`; current v1 bundle and manifest both exact, all six registry profiles valid, Solo private loopback and owner public key verified, `l4_release_receipt_present=false`, `signed_release_permit_validated=false`, `source_bundle_installed=false`, `production_modified=false`. Only disposable `/var/tmp` review sources were used and cleaned up.

## Critical remaining root implementation and acceptance gates

1. Root installer maintainers independently review the frozen source in `prhmonline/deploy-control#70` and this gate PR. The release driver must be built as a **new pinned and separately authorized** operation. Do not add the owner key to Provider trust anchors.
2. Build/root-own the exact v2 staged candidate from the reviewed source closure and independently attest its bytes. The existing server Git/SSH remote did **not** reliably expose the source anchor in the recent check. Do not select moving branch names or silently fetch a substitute. An independent source-provenance fix or exactly pinned bundle artifact is needed.
3. Implement a trusted native root adapter, not caller-supplied capability booleans: verify current host preimage and the fixed owner public key; create, fsync and prove a durable recovery snapshot covering the *current symlink*, `deploy-project` wrapper, `installation.json` and absent Solo profile. Signed permit must be verified against final reviewed driver SHA and durably consumed once **before** activating v2. A crash-recovery command must work after interrupted pointer/profile writes.
4. Roll out v2 using the root-owned versioned `install_bundle()` contract with exact expected old bundle+manifest preimages. Create the pinned v2 profile only after candidate installation; strictly verify `observe-existing solo_company production`, all existing v1 profiles, unchanged runtime PID/state dir, and read-only-only authorization. On any error, restore exact binary symlink, wrapper, manifest and previous absent profile with verified, durable rollback; do not rollback the existing Solo runtime.
5. Only after frozen source and real-root rollback exercise succeed may the owner generate a **NEW** short-lived Ed25519 signed Level-4 receipt for *this* operation. Private key stays on the owner-controlled signing device. Never mint it on the server, ask user to paste private key into chat, or reuse a test key/receipt.
6. Independently verify the signed transaction journal, live registry and existing project validation before setting the task to complete. A v2 observation entry still does **not** mean the Solo application is managed for deployment.

## Current status

`SOURCE_GATE=PASS`, `LIVE_READ_ONLY_PREFLIGHT=PASS`, `TRUSTED_NATIVE_ROOT_ADAPTER=NOT_INSTALLED`, `FRESH_SIGNED_V2_LEVEL4=NOT_ISSUED`, `PRODUCTION_UNIVERSAL_V2=NOT_INSTALLED`, `SOLO_PROFILE_REGISTERED=FALSE`.

**No production mutation permitted until the distinct signed release, reviewed root driver and crash recovery are ready.**
