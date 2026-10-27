# Issue 221: trusted registrar bootstrap — owner review gate

## Scope and current readiness

This review-only artifact is **not a native root adapter or runnable installer**.
It cannot create, approve or consume Level-4 receipts. It does not install
the shared registrar or either PBCinema alias.

- PBCinema discovery PR #220 was approved and merged at
  `70a51f7ddc00136863904873ab2a146b6227b7c2`.
- Reviewed source-only helpers:
  `prhm-action-registry-gateway-v1.cjs` and
  `prhm-action-registry-host-actions-v2-bridge-v1.cjs`.
- Live root-owned Host Actions v2 still returns
  `host_action_v2_not_allowed` for
  `prhm_action_registry_install_v1`.
- This source gate fixes the **known 2026-10-27 preimage SHAs**
  and checks a policy proposal without mutating any owner file.
- The pre-existing, byte-verified backup is
  `/var/backups/prhm-host-actions-registration/preinstall.EHclsBk3`.
  It is not a crash-safe journal or an installation authorization.

## Mandatory native Root-of-Trust implementation before any production activation

**Infrastructure owner** must build and independently review an exact
current-owner preimage bootstrap **from the provider/VM console Root-of-Trust**.
Do not run a substitute root SSH script or bypass the existing self-maintenance
authorization policy. Never reuse another action's approval.

The native adapter MUST:

1. Pin immutable source and manifest Git commits separately, and compare
   complete raw Git file bytes and asset digests. The PBCinema source merge
   SHA is *not* the future registrar bootstrap SHA; do not mix identities.
2. Re-read exact SHA-256, UID/GID/mode and no-symlink evidence for the live
   four owner files and every staged asset immediately before mutation.
3. Preserve all prior actions, restrictions, typed scopes, production-only
   policy data, ZDT state and live worktree changes. Derive a candidate from
   **verified live bytes**, never replace with Git-main policy wholesale.
4. Extend only the existing Host Actions v2 request, executor dispatch, MCP
   adapter and Approval Center typed scope for fixed action
   `prhm_action_registry_install_v1`.
5. Bind the exact canonical tuple
   `{action,project,source_commit,manifest_commit,manifest_sha256}` to the
   original Approval Center Ed25519 signing and consumption pipeline,
   180-second expiry, critical level 4, one-time ledger; reject missing
   signatures, fabricated approvals and stale/replayed requests.
6. Enforce fixed allowlisted owners/assets, no external arbitrary command,
   SQL, filesystem target, URL or generic root executor. Verify root trust
   anchor and protected ledger from the trusted host, not user-supplied input.
7. Use the **existing central installer transaction** with a durable,
   fsync-safe before-image journal and byte-preserving backups including
   owners/modes and any created asset; lock and recheck every preimage before
   first write; verify each postimage; rollback all partially modified owners
   and staged assets after failure, then re-check API and MCP health.
8. Prove reboot/crash recovery, a forced failure mid-install, a failed
   service start, concurrent owner drift, and an unverified rollback all
   fail closed in independently executed Linux integration tests.
9. Obtain an independent security review for **this bootstrap**. A merged
   metadata-only PR #220 does not authorize the trust-boundary change.
10. Only then obtain a **fresh signed critical Level-4 request for the
    exact reviewed bootstrap** through a supported Root-of-Trust/Approval
    Center flow, and let the existing native executor perform the install.
    The legacy action-only request route cannot approve five-field inputs.

## Follow-on PBCinema enrollment: separate transaction

Once the registrar is live, its own distinct signed five-field Level-4 request
must install the PBCinema **GET /projects metadata overlay only**. Re-attest
the current `127.0.0.1:8081` listener's process CWD, Apache ProxyPass
and dashboard DocumentRoot before install; historical observations are not
runtime authorization.

Expected aliases:
- `pbcinema_front_prod`, shared Next.js CWD
  `/home/cfpark/domains/park.prhm.ir/public_html`.
- `pbcinema_admin_prod`, application root
  `/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app`,
  web DocumentRoot `.../app/web`.

They must NOT join executable PROJECTS, Safe Files, DB, deploy,
write/exec, or other capability allowlists. Verify both entries in
`list_projects`, all negative access tests, and all existing projects'
unchanged responses. Neither source-only helper nor this gate executes
registration.

## Status contract

- `SHA_PREFLIGHT=PASS`: historical user-executed source and backup verification
- `SOURCE_REVIEW_GATE=READY_FOR_CI`: this package, no production changes
- `NATIVE_ROOT_ADAPTER=NOT_IMPLEMENTED`: blocking
- `FRESH_SIGNED_LEVEL4=NOT_ISSUED`: blocking
- `REGISTRAR_INSTALLED=NO`: blocking
- `PBCINEMA_DISCOVERY_INSTALLED=NO`: blocking

**STOP** if any live SHA differs from the recorded preimage, any backup is
missing, any policy scope changes unexpectedly, or rollback cannot be proven.
