# Solo owner-governed registration admission — 2026-11-08

## Governance decision and trust separation

Project owner waived an **independent third-party code review** and accepted that risk.
This is not a Provider approval, a direct root shell action, or a signed critical Level-4 receipt.
A distinct issuer `prhm-owner-root-of-trust` is introduced explicitly. The existing
`prhm-provider-root-of-trust` verifier remains separate, rejecting the owner's issuer.
Only a future reviewed-and-pinned **owner-controlled root dispatcher** may turn an
owner-specific verified receipt into authorization, after durable consumption. Never
relabel owner as Provider or copy the owner public key into the Provider anchor.

Owner public key SPKI SHA-256 (independently reported verified on server):
`d161f17f3d3446185e9b106b459b693eb3f453653d8221fc7d8e3f6b987f477b`.
Windows private Ed25519 key stays offline on the owner's workstation; not in Git,
on the Linux host, in this runbook, or in a log.

Original owner-signed waiver:
`PR232_SHA=788353cb2a4420693c8364af3282b3c662398381`,
`SSHAGENT_PR60_SHA=02966549a751c16b582ce17d15a1e2cf8a22f0fb`,
waiver SHA-256
`2d1337a0463c47b87159deb5d09f6f0f3f6c229b7275459c168be142be75f5e0`.
Real signed bytes are a public test fixture. New source changes invalidate this
old signed waiver; a fresh owner signature is mandatory **after code freeze**.

## Source completed (no production action)

- `solo-company-runtime-provider-signed-receipt-v1.js`: distinct
  `verifyOwnerReceipt` / `verifyAndConsumeOwner`, canonical JWS EdDSA
  scope, plan and source pin, 180-second maximum, replay-resistant consumed ledger.
- `solo-company-runtime-owner-root-admission-v1.cjs`: exact public key pin,
  strict owner waiver text+signature, **final PR HEAD** binding, and real owner
  Level-4 token verifier; no CLI, installer, token issuer, key generation or
  privileged action.
- `solo-company-runtime-owner-plan-readonly-v1.cjs`: **read-only** six-file
  plan hash computed from exact production preimages, pinned source Git blobs,
  local clean checkout and actual metadata. Prints plan hash to be signed only
  after sources are frozen. No approval issue, service restart or file mutation.
- Native registrar bridge applies exact core SHA/0644 and absent worker/0700
  pins, and JWS hash now includes uid:gid/mode for every registered file.

## Remaining conditions — fail-closed

1. Inventory the exact installed Approval, Executor, MCP router and health
   check service units before implementing production reload/rollback callbacks.
   Do not guess service names or use the installer-refresh mediator.
2. Build a **root-owned, source/commit-pinned privileged dispatcher** using
   `verifyOwnerReceipt`, verified final-SHA owner waiver, durable `wx`/fsync
   receipt consumption, and the native six-file journal transaction. Never
   accept caller-injected keys, health callbacks, destination paths or booleans.
3. Rehearse under actual disposable systemd units: commit, failed restart,
   rollback, SIGKILL/interrupted recovery. Require four control-plane health
   signals and clean retained Solo runtime state.
4. Only when code is final: owner signs a NEW review-waiver message binding
   exact final PR #232 HEAD and a separate short-lived, operation-scoped
   `host_action.solo_company_runtime_registration_v1` receipt tied to the
   **live plan SHA256** and pinned Git worker/core source commits.
5. Install with exact before/post SHA, root metadata and durable rollback,
   then verify production service and loaded Host Action identity. Installing
   or restarting the already-running Solo Runtime is NOT required.
6. Universal Installer stateful existing-service adoption remains a
   separately reviewed/protected change; it is not achieved by the Host Action.

## Current status

`OWNER_WAIVER_HISTORICAL_SIGNATURE=VALID`;
`OWNER_VERIFIER=SOURCE_ONLY_CI_PASS`;
`REAL_SIGNED_L4=NOT_ISSUED`;
`PRODUCTION_ROOT_DISPATCHER=NOT_INSTALLED`;
`LIVE_SIXFILE_REGISTRATION=NOT_EXECUTED`;
`UNIVERSAL_ADOPTION=NOT_EXECUTED`.
