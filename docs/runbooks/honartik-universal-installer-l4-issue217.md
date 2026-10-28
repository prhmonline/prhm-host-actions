# Issue 217 — Exact Honartik Universal Installer L4 upgrade (source-only)

**State:** source contract and negative tests for review. **NOT installed, registered, approved or executable in Production.** Do not call this module directly with root privileges. Never use generic SSH/RDC execution or alter the installed Universal engine to bypass a rejected action.

## Exact immutable target
| Property | Bound value |
|---|---|
| Fixed action | `honartik_universal_installer_upgrade_v1` |
| Operation | `host_action.honartik_universal_installer_upgrade_v1` |
| Level | 4 / critical, independent one-time signed receipt |
| Central Installer | `/usr/local/libexec/deploy-control/universal` |
| Current bundle | `47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181` |
| Candidate bundle | `8680011e11ad8eae89707b74492e60354c4b7e56799b205d3da581e92806a552` |
| Backend SHA reference | `0cdfb3d03caf143f665b20b463971e3e4f9b51c9` |
| Registry SHA-256 | `5090ad2dce3d41f4c7bbb8c5b4d9879554474fb2e39a158a3b55d0da749620f8` |

This action would upgrade **only the already-existing central Installer**, not deploy the backend, switch Apache vhosts, run Yii migrations, touch the live database, or change the release intent.

## Architecture
The JS file is a no-CLI, **dependency-injected source coordinator**, not a trusted root implementation. It requires an externally installed trusted native Host Action binding supplying **only named, narrow capabilities**. It cannot authenticate, register itself, spawn commands, read production secrets or install anything without that separately reviewed adapter. The mock host in the tests has no authority and cannot be installed as such.

The root adapter MUST enforce independently:
1. The fixed contract is compiled/registered by a reviewed trusted action registry; callers cannot override the digest, path, target, command, project, interpreter or approval token.
2. Authenticated root-owner and mode check of each parent path, manifest, current symlink, wrapper and immutable source tree; verify current bundle **actual bytes** and `installation.json` field equality and candidate digest using the versioned `universal.install.bundle_digest` algorithm.
3. Verify independent signed artifact provenance for trusted Linux crash/rollback + negative tests of this **exact candidate SHA**; consumer booleans alone are **never** attestations. The prior simulated sandbox tests may inform design but do not satisfy this gate without signed runner evidence.
4. An atomic exclusive process lock and durable recoverable preimages (current pointer, manifest, wrapper). Journal must be fsync-verified **before** consuming L4, and recovery must remain possible even after commit/audit failure or process crash.
5. Enforce native verification of a real Ed25519 JWS with scope `host_action.honartik_universal_installer_upgrade_v1`, exact current+target digest, request identity, 180-second expiry, one-time **server-side consumption**. Neither typed second confirmation nor any JS `signed:true` flag substitutes for the cryptographic check.
6. Invoke only the existing Installer's pinned, locked `install_bundle` transaction, never generic shell or caller-chosen paths. Candidate closure and preimage must not drift between proof and commit.
7. Independently verify the installed `current` symlink, new/old manifest fields, bundle bytes, CLI `validate honartik_back production`, other project registries, and no change to Apache SHA-256, DB, or Yii migration execution. Journal/audit durable and rollback verified on any failure.
8. On **rollback unverified**, fail hard and retain recovery lock until human repair. This module makes no claim of crash recovery implementation; the native adapter/service must supply and test that.
9. *Only then* consider a separate independently approved backend release after fresh database/filesystem **restore**, protected `app/views/admin-reserve/_form.php` behavior review, public revision marker and live health/rollback checks.

## Source tests

`node --check honartik-universal-installer-l4-v1.cjs`

`node --test test-honartik-universal-installer-l4-v1.cjs`

Tests are synthetic capability-contract tests and cannot prove live root binding, authentic Approval Center consumption, filesystem crash durability, or a real MariaDB restore. These require an independent native root implementation and integration evidence. Keep GitHub PR **DRAFT / NO-GO** until then.

Related: [Host Actions #217](https://github.com/prhmonline/prhm-host-actions/issues/217), [Deploy Control #59](https://github.com/prhmonline/deploy-control/pull/59).
