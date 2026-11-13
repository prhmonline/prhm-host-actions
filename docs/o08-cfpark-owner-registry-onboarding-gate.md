# O08 — CFPark fixed owner attestor: registration gate (source only)

Date: 2026-11-13. Tracking: [Issue #289](https://github.com/prhmonline/prhm-host-actions/issues/289).

**Status:** BLOCKED. This review artifact does not authorize, install or
activate a Host Action or Universal profile. Do not apply it with a root shell.

## Independently observed current production facts

The four existing Host Actions v2 registry owner files were inspected
**read-only** on prhm-production on 2026-11-13. They are root-owned and
their exact SHA-256 preimages are pinned in
`o08-cfpark-owner-registry-admission-candidate-v1.cjs`:

| Owner | Path | SHA-256 |
|---|---|---|
| base | `/opt/prhm-agent-selfmaint/server.js` | `57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530` |
| executor | `/opt/prhm-agent-selfmaint-exec/server.js` | `4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169` |
| policy | `/opt/prhm-company-control-plane/config/approval-policy.json` | `26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5` |
| MCP | `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js` | `0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef` |

These four live owner files **lack** both `prhm_action_registry_install_v1`
(shared catalog registrar) and `cfpark_front_readonly_attest`. Host Actions
request for CFPark returned `host_action_v2_not_allowed`.
The fixed CFPark helper is **not installed** and the Universal profile
`cfpark_front.production` is **absent**: native validate fails
`invalid configuration file`. Neither permission is currently in the
Runner sudo allowlist.

Existing verified live CFPark site: SHA
`55edc23883fb08622029611db55173885bf1f41b`, clean branch
`main`, `cfpark-frontend.service` active, HTTP 200. Fixed reviewed
helper source is at `prhmonline/deploy-control` commit
`232e090124657f4637fd9583ea60634f9554b930`,
Git blob `caceb90cf20b760efa465d1e880d71a837931235`
([PR #91](https://github.com/prhmonline/deploy-control/pull/91)).

## Execution boundary — all gates mandatory

1. Independently review/bootstrap the **existing** shared signed
   `prhm_action_registry_install_v1` mechanism before issuing new
   registrations. Its
   `prhm-action-registry-gateway-v1.cjs` currently exists as SOURCE ONLY.
   The registered Host Actions request accepts only a fixed action name,
   not the generic signed project/source/manifest binding.
2. Build the actual four-owner root patch and bounded
   CFPark-native handler in Git with exact SHA-256 **before/after** for
   each owner. Verify that the signed Approval Center binds action,
   project, source_commit, manifest_commit and manifest_sha256, with
   180-second, single-use Ed25519 authorization. Do not reuse expired or
   consumed receipts.
3. Use the mandatory **two-commit** order: review/commit executable
   candidate source first, and *then* commit the exact manifest referring
   to that source commit. Never embed a commit SHA in its own commit.
4. On production, re-attest all four preimage SHAs immediately before
   an approved root-owned atomic transaction. Prepare byte-preserving
   owner backups and verified rollback before requesting a **fresh**
   Level-4 owner approval. Run only the pre-existing authorized
   installer/Approval Center path, not direct sudoers edits, a shell
   backdoor, generic `git` sudo, or a parallel deploy service.
5. Register helper path
   `/usr/local/libexec/deploy-control/cfpark-front-readonly-attestor-v1.sh`
   as root:root mode 0755, executable only under owner `cfpark`,
   **zero arguments**, only a single exact sudo allowlisted command.
   Confirm attestor's bytes and SHA match the reviewed Git blob. Do not
   broaden `/home/cfpark` ACLs.
6. Separately register the native Universal
   `cfpark_front.production` profile with exact domain/root/repo,
   owner, service, backup, isolated restore rehearsal, health and rollback
   contracts. A read-only attestation PASS is **not** release approval.
7. Run manual trusted-main Runner verification of owner attestation,
   Universal profile, fail-closed negative cases, API tenant, and
   `PRODUCTION_DEPLOY_EXECUTED=NO`. Only subsequently wire a
   fail-closed gate before the real, approved exact-SHA release driver.
   No production deployment until independent backup/restore and runtime
   health PASS.

## Current CI scope

The source-only `o08-cfpark-owner-registry-admission-candidate-v1.cjs`
checks an offline observation of owner SHA preimages and intended fixed
asset; even a purported installed state returns `BLOCKED`. Its
negative tests deliberately **cannot** issue authority or install
anything. The observation object is never a cryptographic signature or
an authorization token. Actual installer must independently collect
bytes and use the signed trust boundary.

**O08 remains BLOCKED until the live restricted registration, native
profile, real Runner probe, restore rehearsal and release gate all PASS.**
