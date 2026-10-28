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

## Native candidate and Linux proof (2026-10-27)

**Source candidate implemented and CI tested; NOT installed or root-authorized.**

- `shared-registrar-native-filesystem-v1.cjs` now implements actual Linux
  temp-file fsync, same-directory atomic rename, exact four-file before-image
  journaling, no-symlink/mode/SHA checks, immediate rollback and interrupted
  `SIGKILL` recovery with dead-PID lock safety.
- `shared-registrar-native-root-adapter-v1.cjs` implements a fixed-root
  source-level integration candidate. It attests immutable Git manifest/source
  and exact owner candidate digests, calls the EXISTING
  `verifyLiveConsumedRegistrationApproval` Ed25519 + consumed-ledger checker,
  reserves a durable one-request-ID-only execution receipt before a write,
  and invokes the native transaction with mandatory post-install health and
  post-rollback service-health callbacks. No CLI, generic request route,
  signature issuer or bypass is exported.
- Linux CI ran actual disposable POSIX files and `SIGKILL` of a separate
  Node process; tests cover successful atomic install, injected failure after
  two renames, failed health rollback, preimage SHA drift, symlink rejection,
  SIGKILL crash recovery, active lock refusal, mismatched recovery targets,
  concurrent write fail-closed and the no-CLI/unauthenticated adapter boundary.
- GitHub Actions commit `016d8b7f5023863e48e52568f3d033b697f5692d`:
  Issue 221 Trusted Registrar Bootstrap Gate **success** and shared Agent 3
  registry gate **success**. This is source CI, **not independent security
  review, real production restart/recovery or an L4 approval**.

**Outstanding:** the provider-console bootstrap native dispatcher that wires
the reviewed source to the four live owner entrypoints and the installed
Approval Center five-field request route has NOT been implemented/installed.
The gate cannot bootstrap itself: absent the existing allowlist entry,
`host_action_v2_not_allowed` remains correct. The on-disk SHA pins are
historical and must be re-attested by that future trusted bootstrap. An
independent security reviewer must review the native binding and repeat
isolated crash/rollback testing before any production critical approval.

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
- `NATIVE_ROOT_ADAPTER_SOURCE=CI_PASS`: candidate only, not installed
- `ROOT_OF_TRUST_NATIVE_DISPATCHER=NOT_IMPLEMENTED`: blocking
- `FRESH_SIGNED_LEVEL4=NOT_ISSUED`: blocking
- `REGISTRAR_INSTALLED=NO`: blocking
- `PBCINEMA_DISCOVERY_INSTALLED=NO`: blocking

**STOP** if any live SHA differs from the recorded preimage, any backup is
missing, any policy scope changes unexpectedly, or rollback cannot be proven.

## Native five-field dispatcher integration contract (source candidate, 2026-10-28)

Live operator-provided root-console source inspection confirmed the installed
host only handles `{action}`: base request/confirm/authorize-consume and
executor request/execute use action-only argument SHA; the MCP tool currently
offers a fixed action enum. **Do not extend that old input schema to accept
arbitrary fields or reuse its one-field approval for the registrar.**

Candidate `shared-registrar-native-dispatcher-v1.cjs` encodes a separate,
fixed five-field registrar path. It is a source-only module, NOT wired into
the root-owned server; it exports no CLI, signer, URL server, bootstrap or
general shell. It requires a separately installed, root-owned host binding:

1. Base host must expose a **distinct fixed registrar** request endpoint
   with exactly `action`, `project`, `source_commit`,
   `manifest_commit`, `manifest_sha256`; request must use the existing
   Approval Center `/v1/requests` typed flow and preserve existing scopes.
2. New pending record must be written with an exclusive, fsynced, root-owned,
   mode-0600 store; no JWS, private key or token is saved or returned. Bind
   exactly `request_id`, full tuple, arguments SHA-256, active policy version
   and hash, and expiry. A duplicate/corrupt/expired record is a hard stop.
3. Root executor must accept only `request_id` and exact
   `CONFIRM_LEVEL_4_CRITICAL`, atomically CLAIM the exact pending record
   before issuer confirmation/consumption (compare-and-swap, never retry the
   same request). Its host-owned `confirmAndConsumeBoundApproval` must call
   the **actual installed** Approval Center with the same full signed tuple.
4. Before any installer call, verify the issuer's original Ed25519 JWS,
   installed policy hash `SHA256(JSON.stringify(parsedConfig))`, immutable
   five-field digest, expiry and consumed-once ledger **and the exact pending
   `request_id`**. The native root adapter independently re-verifies the
   token and consumed ledger before doing any filesystem write.
5. `nativeInstallerHooks` must be pre-bound privileged capability objects
   **inside the reviewed root executor**; never accept functions, paths,
   commands, signer URLs, credentials or hooks from user/MCP/HTTP input.
   Use the existing root owner's exact SHA-bound files, allowed asset paths,
   durable journal and full real service health plus rollback checks.
6. MCP must expose only the distinct fixed registrar request and
   status/apply methods. Never change the legacy action-only request/execute
   route to be generically five-field; all existing actions remain unchanged.
7. Crash after claimed request/consumption must remain fail-closed and require
   a **separately reviewed, trusted native recovery path** for the existing
   transaction journal; a caller must not be able to replay Level-4 or select
   arbitrary recovery targets. Independently exercise interrupted install,
   metadata drift, bad signature/hash, service-start failure and full rollback
   on disposable Linux before provider-console activation.

**Not yet delivered:** actual root-owned owner-file integration changes,
secure state store and CAS host callbacks, provider-console trusted bootstrap
binary, independently executed service/reboot rollback proof or APPROVED review.
The tested candidate is not enough to permit issuance or consumption of a
Production L4 receipt. The current live Approval Center policy still lacks
`host_action.prhm_action_registry_install_v1` and its typed scope.

## Native pending-state core and single-use claim (source-only, 2026-10-28)

`shared-registrar-pending-store-v1.cjs` is a **fixed-path, root-owned
state-store candidate** now bound directly by
`shared-registrar-native-dispatcher-v1.cjs`. It is NOT an installed state
directory, native host action, signer or bootstrap. The production constructor
requires effective UID 0 and the exact:
`/var/lib/prhm-agent-selfmaint-exec/registrar-pending-v1`.

The separately approved provider-console bootstrap must **provision**
`registrar-pending-v1/pending` and `registrar-pending-v1/claimed` with
root ownership, mode `0700`, a non-group/world-writable root-owned parent,
no symlink ancestors, and no generic user-writable ACL. The candidate does
not create or chmod these Production directories itself.

- Pending records are bound, strictly shaped, and written with
  `O_CREAT|O_EXCL|O_NOFOLLOW`, mode `0600`, file and directory `fsync`.
  No signed JWS, private key, credential, approval token or external command
  is persisted; an existing request ID cannot be overwritten.
- The executor loads the exact pending record, rejects a claimed ID, then
  uses an exclusive, durable `claimed/<request_id>.json` marker before
  contacting Approval Center. The marker persists in all failures.
  Approval consumption cannot proceed if the claim fails.
- The pending record is re-attested after claiming. Missing files, mutable
  contents, wrong owner/mode, symlinks, duplicate claims, corrupted state or
  out-of-window requests cause fail-closed errors. Restarting the process
  cannot turn a previously claimed request back into pending.
- Disposable Linux tests verify persistence, duplicate IDs, mutation,
  symlink rejection, unsafe directory metadata and `SIGKILL` after
  durable claim. The `openDisposableTestStore` factory is limited to
  isolated `/tmp/registrar-ci-*` fixtures and is NOT wired to Host Actions.
- The only remaining application integration authority is in the existing
  root-owned executor's verified callbacks for **real** Approval Center
  request/confirm/consume, approved Git owner-byte generation, service reload,
  health verification and journal recovery. No arbitrary user callback may
  reach these capabilities.

Independent review still must validate the complete original four owner-file
patch, root console provenance, actual auth/issuer/consumed-ledger semantics,
concurrent claim under the real systemd security settings, service health
and verified rollback. Source CI is not authority to deploy.
