# iMotion Admin SHA-bound release gate — review-only design

**Status:** DRAFT — requires explicit security/release-owner approval. **No implementation or Production authorization is provided by this document.**

Related: [control-plane issue #169](https://github.com/prhmonline/prhm-host-actions/issues/169), [application issue #18](https://github.com/prhmonline/Imo-back/issues/18).

## Verified reason for a separate action

The existing `imotion_next_safe_deploy` route is explicitly scoped to `imotion_front_prod` in `bootstrap-imotion-safe-deploy-v1.js` (`patchPolicy`/`validatePolicy`) and dispatches to `/home/imotion/domains/i-motion.ir/public_html/scripts/safe-build-deploy.sh` (`remoteScriptSha`). It **does not** authorize or target the admin backend. It must not be used for admin release by changing a caller-side name, tool or parameters.

The user's previously supplied `CONFIRM_LEVEL_3_PRODUCTION` approval bound to the exact admin candidate did not overcome the execution-layer security block. A proposed future fixed action cannot reinterpret or bypass that denial. The owner must review the actual denial and explicitly authorize an appropriate route **before implementation or use**.

## Immutable intended release identity (design constraints, not active grants)

| Binding | Exact intended value |
|---|---|
| Repository | `prhmonline/Imo-back` |
| Target host | `imotion-prod-vm` |
| Target root | `/home/imotion/domains/admin.i-motion.ir/public_html` |
| Source ref | Local verified bare backup `refs/heads/release/imotion-github-integrated-20261010` |
| Approved candidate SHA | `d849d758fe31056caa28558271d159ba410cd4ca` |
| Candidate tree SHA | `a771c535add594b02716d7c873a3e6a191218ab6` |
| Expected preimage HEAD | `663627e38880db68c9fbe9488681773fbf605e2c` |
| Expected preimage branch | `main` |
| Expected dirty source files | 26, each hashed in the private capture manifest |
| Authorization operation | `deploy.production`, Level 3, project `imotion_admin_prod` |

These values must be fixed server-side. No runtime host, path, SHA, script, SQL, content or arbitrary command input is allowed. A different release, even a fast-forward, requires a newly reviewed immutable binding and new approval. The control plane must reject use of the existing frontend deployment scope.

## Existing Fast Delivery v1/v2 components — not an approved admin deployment route

**Verified against merged PRs #159 and #160 in this repository:** `prhm-fast-delivery-coordinator-v1.cjs` is a source-only reusable transaction coordinator with a read-only planning CLI; it has no registered production adapter registry, native approval consumer or privileged deploy entrypoint. `prhm-fast-delivery-typed-sha-v2.cjs` provides a SHA-digest binding and native consumption proof *only* for `rahekomak_web_only_release_v2` / project `rahekomak`; its implementation deliberately rejects other projects (`project_unregistered_for_typed_v2`). Its documentation explicitly says the trusted typed request/consume bridge and host-action registration are uninstalled, and an L4-controlled bootstrap is still required.

Consequently, **neither shared Fast Delivery source nor the frontend-specific `imotion_next_safe_deploy` is an authorized alternate execution method** for the blocked iMotion Admin cutover. A future admin backend adapter may reuse reviewed transaction/approval concepts but must have a **distinct trusted implementation, policy binding and execution-security decision**. The former user's L3 release confirmation is not authorization for installing a new privileged adapter, skipping native signature checks, or consuming a request on behalf of another tool.

The independent security owner must decide whether to (a) approve an existing deployment platform after proving its exact admin binding and resolving the previous tool safety denial, (b) accept a new admin-only fixed implementation via the separate authorized bootstrap process, or (c) reject deployment with a documented reason. This document makes no assertion that any of these decisions has already been made.

### Review handoff: required human decision

- **Security decision:** Why was the actual cutover tool invocation blocked? Is any release path explicitly permitted for this exact admin backend and SHA, without attempting to circumvent the block?
- **Architecture decision:** Use a separately registered fixed admin action or extend the existing reviewed coordinator only after its native trusted, approval-consumption and backend adapter contracts are implemented and independently validated.
- **Execution decision:** Require a separately authorized bootstrap/registration before enabling any Production mutation. This PR remains documentation-only and cannot grant that approval.

## Policy and implementation prerequisites

1. Security/release owner inspects and resolves the prior execution-tool denial in the platform-approved workflow. There is **no permission to use another executor as a workaround**.
2. Explicitly review and approve an **admin-only** deploy policy scope, distinct from `imotion_front_prod` and from the existing frontend's tool and approval. The old Level-3 confirmation alone is not a transferable security approval.
3. Define a no-arbitrary-input request/consume/status surface that binds host, repo, target path, exact SHA and tree and uses single-use, time-bound signed approval. If binding evidence or policy approval is absent, fail closed.
4. Keep the deliverable reviewed in a PR and offline tested. Do not bootstrap, install a key, register an action, enable a new endpoint, edit control-plane policy, or invoke a Production action from this design PR.

## Transactional preflight

- Acquire an exclusive deployment lock and record correlation ID; verify current identity, `main` head, remote source identity, approved SHA, exact tree, and the original 26 file SHA256/mode/path values.
- Verify backup repository contains exact immutable candidate SHA; ensure a clean isolated candidate and healthy app/DB containers. Validate the actual Yii database with application identity and the mounted Unix socket `/run/mysqld/mysqld.sock`; mandatory audit columns already independently verified.
- Confirm no deploy job/lock or filesystem mutation has occurred since preflight. Reject symlinks, unexpected paths, changed file content, mismatched mode, unknown untracked files or additional local commits.
- Before any production change, persist a separate recoverable backup of the entire dirty worktree and its metadata, *not just a volatile stash*. Verify restore from this backup in an isolated staging worktree.

## Fixed execution and rollback contract (subject to approval)

- Checkout exactly the reviewed commit via a Git-first, SHA-bound operation. Preserve previous `main` and both Git histories, and do **not** reset/revert/force-push any Git branch.
- Run PHP lint of affected files, the five confirmed finance/privacy/schema-guard regression tests, app/DB container health checks and HTTP smoke (`/login` 200, unauthenticated audit endpoints 302).
- Require an **authenticated** role-based acceptance check for admin/manager viewing and normal user rejection, without logging cookies or personal data; a successful guest redirect is not sufficient.
- On any failed/ambiguous gate, restore the previous Production commit, its 26 exact dirty files, modes and checksums, and verify login/health. Log rollback failure separately and fail closed.
- Log before/after repo/branch/full SHA/tree, destination, timestamp, test results, approval ID (not token), app/DB health, final state, and rollback evidence; make it auditable by both Issues #169 and #18.

## Explicit negative test cases before authorizing implementation

- A request for the existing *frontend* deploy action cannot deploy the admin root.
- A request with an alternate SHA, host, path, arbitrary command or project is denied before mutation.
- Missing, expired or replayed approval is denied; incomplete/mismatched source file list or changed preimage is denied.
- A simulated failure after candidate checkout triggers exact byte-for-byte restoration and keeps Git history intact.
- A simulated failed health check or audit manager-role check reports failure and rollback, never green success.
- Logs, request responses and errors do not reveal keys, database credentials or user audit payloads.

## DONE criteria

**Design-ready**: security/release owner signs off on the execution-policy resolution and fixed admin-only contract, with test evidence and approved rollout mechanism. **Deployment DONE**: separate explicitly authorized execution occurs, live SHA/tree and authenticated checks pass, logger evidence is stored, and [Imo-back #18](https://github.com/prhmonline/Imo-back/issues/18) is closed. This design PR alone completes neither condition.
