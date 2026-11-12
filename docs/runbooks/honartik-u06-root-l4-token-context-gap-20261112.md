# U06 Root Executor missing trusted L4 JWS transport — fixed-source review

2026-11-12, live prhm-production read-only proof:
- Root Executor real `/v2/host-actions/execute` first invokes official Approval Center
  `authorize-consume` with `{action, approval_token: token}`.
- It then calls `applyHostActionV2(action)` with **only** the action name.
- The dedicated U06 handler's independent Ed25519/consumed-ledger verifier requires
  the exact current request UUID and the **same root-sealed token**. The former
  implementation threw these values away before entering the native callback.
- This is an actual integration gap, not a SHA mismatch.

`honartik-u06-root-executor-sealed-token-bridge-review-v1.cjs` produces an
in-memory reviewed SHA-pinned owner-source candidate where only exact U06
is special-cased **after** successful authorize-consume, with the exact
`(requestId,token,authz)` passed **in process only** to a dedicated guard.
The old direct dispatcher retains its U06 hard DENY and all other actions
follow the identical original path. No JWS is logged, written or echoed.

**The reviewer guard deliberately still throws**
`u06_full_native_root_handler_not_installed`.
Do **not install it as a working native backup action** until the actual
16-capability Root handler and independently reviewed four-owner installer
have been source-pinned, tested for rollback/crashes, and a valid Root
approval/registration path has been established.

This PR neither installs a Root Handler nor changes policy, service, DB,
native live backup, offsite, or signer. The 69-table live dataset replica,
native Universal and Node1 *central* evidence were separately verified.
U06 issue #75 remains OPEN until actual native Production L4 execution.
