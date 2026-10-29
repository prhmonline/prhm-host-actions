# Honartik Config Center: approved Host Action handoff

This branch is a **fixed-scope transaction contract and offline tests**, NOT an installed Agent 3 tool. It does not register an MCP tool, modify Production, or generate credentials.

## Fixed bindings

- Action ID: honartik_config_center_readonly_enroll_v1
- Policy operation: host_action.honartik_config_center_readonly_enroll_v1
- Signed, expiring, one-time authorization: Level 4, CONFIRM_LEVEL_4_CRITICAL
- Tenant: honartik; config revision: 1; scope: config:read only
- Backend SHA: 7ae8b99677ec13b3498b4a5425267a49fc87806e
- Config Center release: git-9b41e4534382
- Reviewed enrollment source commit (prhmonline/prhm-host-actions): a9da4735445dcd0833cd1ef5435c77884cb74e64
- Reviewed enrollment source SHA256: 9ccbcbdba457691e1d140d6e32ad379cbe6d98d5448c13970220c72ba2e8278c (Git blob 97de1aab42d2a7f67aeef66ead4a8a2bc1da9f1f)
- Secure private token file: /home/honartik/.config/prhm/config-center/readonly-machine-token, owner honartik, mode 0600
- Consumer validation: php yii config-center/check, run as OS user honartik

## Integration gate (NOT DONE)

The actual Agent 3 tool, its fixed allowlist entry, Approval Center policy and Host Actions executor adapter have NOT been deployed. The live Control Plane worktree has two preexisting uncommitted modifications (approval-policy.json and root-scripts-stage mediator); these changes must be preserved, not overwritten. The attempt to generate a direct runtime registration candidate was blocked by the execution safety gate, so registration remains unimplemented. These must first be Git-committed, protected by immutable preimage SHAs and separately authorized.

The trusted executor adapter must implement all eight REQUIRED_ADAPTER methods:

1. An exclusive lock covering enrollment, verification and rollback.
2. Read-only preflight that independently attests actual SHA/clean state, tenant, revision, private path and zero active credentials.
3. Independently attest an already-consumed, signed Level-4 approval with the exact action, request ID and source SHA. The trusted Agent 3 Host Actions executor consumes the one-time approval **before dispatching the handler**; the adapter must never consume it again.
4. Invocation of only the fixed PHP enrollment script without a shell interpolation interface or plaintext credentials in outputs.
5. Independent postcondition proof: one active config:read-only credential, correct private file owner/mode, config API 200, secrets API 403.
6. Exact CLI validation: CONFIG_CENTER_READONLY_PASS tenant=honartik revision=1 source=remote.
7. Owner-bound rollback using only the pinned PHP rollback operation; independently prove credential revocation and private file removal without deleting unrelated data.
8. Bounded metadata-only audit: timestamp, action, request reference, source SHA, tenant, result and rollback. No token, hashes, authorization headers or HTTP response bodies.

All failed/unverified rollbacks must block further attempts pending investigation. No booking, payments, SMS or seat routing changes are in this action's scope.

## Verification

The offline Node test suite contains 16 synthetic tests covering approval failure, wrong SHA, credential preexistence, dirty source, invalid input schema, privilege escalation, bad file mode, secret endpoint access, failed CLI check, audit failure and rollback failure. It does not perform any production mutation or create secrets.

Go-live is only complete after a separately approved adapter/policy registration and real server-side test. Do not claim this PR alone activates the Agent 3 action.

## Git-first implementation update (2026-10-13)

- Live read-only SHA checks against the actual Control Plane: all four pinned base/executor/policy/MCP preimages match the registration candidate.
- `honartik-config-center-registration-candidate-v1.cjs`: exact-preimage, additive base/executor/MCP/policy source generation. This code **does not install** any of these candidates.
- `honartik-config-center-trusted-adapter-v1.cjs`: fixed, typed bridge for the eight adapter methods; it projects out secret-bearing output fields, forbids arbitrary action names, and never consumes signed approval. It depends on a **separately trusted and installed server-side host implementation**. It is NOT a complete privileged credential provisioning backend.
- Registration's executor dispatch is intentionally **fail-closed**, even if the runner path exists: it raises `honartik_enrollment_dispatch_not_yet_approved`. Before installation, replace this guard only through reviewed, SHA-pinned Git with a fully implemented trusted runner that binds the fixed PHP issuance/revoke script and independently verifies postconditions. Never simply delete the guard or fabricate an environment variable.
- Node contract tests cover registration anchors, duplicate/drift and policy, plus the adapter happy path, denied approval, rollback and audit redaction. CI run 38404062122 on `1977d877ab0d971b1acdd117db405bb9e2368d26` passed.
- Honartik production backend verified at `7ae8b99677ec13b3498b4a5425267a49fc87806e`, but the live read-only check still returns `CONFIG_CENTER_READONLY_FAIL`. The read-only consumer is opt-in diagnostic only.
- **Remaining before approved install:** implement actual fixed privileged host IO and reviewed runner, prove exact script and Config Center release identity, add atomic protected installation/restart/rollback for registration, reconcile any dirty production worktrees without deleting untracked business data, then request a new signed Level-4 authorization. Do not consume an old approval request. After authorized install, execute real postconditions and audit.
- **Current state:** PR remains draft; Source/CI PASS, runtime registration NOT installed, credential NOT issued, live enrollment NO-GO, no changes to application payments/SMS/reservations.

## 2026-10-13 source provenance discrepancy — HARD BLOCK

The prior historical local commit `740827bc445d028bca285e20b13b8765c4d75f28` contains `infra/honartik-config-center-prod-enroll-20261012.php`, but that file is **absent from the current Config Center Git HEAD** `74aef2992969d5c3f3755b3898b2c3107a0b62a3`. The historical bytes have been preserved verbatim as `scripts/honartik-config-center-prod-enroll-20261012.php` on this PR branch, with identical 11,192-character content verified via an independent GitHub read.

**CI run 38404821529:** all 29 synthetic Node tests PASS; PHP lint PASS; pinned script integrity FAIL:
- Actual SHA256 of archived historical source: `98babd140de45e4ea0c2bbedb4195d9248b6213a6d5ebed584ccc8b10ac15785`.
- Required SHA256 in existing enrollment contract: `b9978bd782282ee385b487cc7d4614edc2b6f4f3b8c513797c657b32f0d50903`.

Do **not** auto-rebind the contract to the recovered historical blob: the source of the earlier pinned SHA has not been independently located or verified. No enrollment, registration installation, user-facing rollout, Git merge or Level-4 approval should proceed until a trusted read-only audit recovers the exact source that produced the required SHA (or performs a new approved source review/rebind and updates all pins). The SHA gate intentionally stays RED. This is a genuine release blocker, not an optional CI check.

## 2026-10-13 replacement candidate and source-review resolution (Git only)

The previously pinned digest `b9978bd782282ee385b487cc7d4614edc2b6f4f3b8c513797c657b32f0d50903` could not be matched to the historical local source. The local source history contains two commits: `d2a5726791af49ff8193ba5daa30ad9080c473eb` (initial credential-issuance file) and `740827bc445d028bca285e20b13b8765c4d75f28` (foreign-token removal safeguard). The historical latter file digest is `98babd140de45e4ea0c2bbedb4195d9248b6213a6d5ebed584ccc8b10ac15785`.

Security review identified an additional issue: the historical rollback revoked *all* active credentials sharing the enrollment name, regardless of exact token identity. In the **new Git-only candidate**, `revokeBoundToken` instead selects by tenant, credential name, and `sha256(token)` while holding a row lock, and rollback refuses a missing-token-file state when an active named credential exists. `removeSecretOwned` already validates equality before removal. Exception cleanup also uses exact-token revocation. Six additional source-regression tests and PHP lint were added, alongside the original 29 Node contract tests.

The reviewed replacement source is immutable in `prhmonline/prhm-host-actions` commit `a9da4735445dcd0833cd1ef5435c77884cb74e64`, file `scripts/honartik-config-center-prod-enroll-20261012.php`, Git blob `97de1aab42d2a7f67aeef66ead4a8a2bc1da9f1f`, SHA256 `9ccbcbdba457691e1d140d6e32ad379cbe6d98d5448c13970220c72ba2e8278c`. Contract and CI are intentionally repinned to this **new reviewed replacement source**, not misrepresenting the original unmatched digest as valid. CI verifies commit object, file blob, SHA256, PHP syntax and Node contracts. The old mismatch evidence remains preserved above for audit; new source is not yet installed.

**Important:** Passing offline tests does **not** establish live DB correctness of issuance/revocation. Before any Production install, complete isolated DB-backed rollback/race tests and a concrete trusted-runner adapter, exact-source release/rollback installer, and signed single-use L4 approval. The candidate executor still intentionally throws `honartik_enrollment_dispatch_not_yet_approved`. Merge/deploy are explicitly NO-GO until all are satisfied.

## Reviewed source gate — GREEN (2026-10-13)

The reviewed replacement source is pinned to commit `a9da4735445dcd0833cd1ef5435c77884cb74e64`, Git blob `97de1aab42d2a7f67aeef66ead4a8a2bc1da9f1f` and SHA256 `9ccbcbdba457691e1d140d6e32ad379cbe6d98d5448c13970220c72ba2e8278c`; the contract, policy-building candidate and CI all now use the updated explicit source identity. The checkout was configured for full history to actually resolve and verify the pinned ancestor blob.

[GitHub Actions run 38408937156](https://github.com/prhmonline/prhm-host-actions/actions/runs/38408937156): **SUCCESS**. 35/35 offline Node tests pass, PHP syntax passes, and the file SHA256 plus pinned Git source commit/blob checks pass.

This resolves ONLY the previous source-integrity/CI blocker. Remaining **NO-GO** gates: full trusted privileged runner and server-side IO implementation, isolated DB-backed issuance/revocation validation, atomic registry/policy install with verified rollback, fresh explicit signed single-use Level-4 approval, and `CONFIG_CENTER_READONLY_PASS tenant=honartik revision=1 source=remote` observed on Honartik Production. No prior permission replay. Preserve dirty worktrees and untracked user business files.

## 2026-10-13: privileged runner and post-consumption dispatch candidate — OFFLINE PASS

**Implemented in Git, not installed**:
- `honartik-config-center-privileged-runner-v1.cjs`: fixed command allowlist, root/owner checks, exact SHA verification for enrollment and status PHP, backend Git HEAD and tracked cleanliness check (untracked user exports preserved), exclusive lock, signed L4 one-time receipt context *only from trusted executor*, fixed PHP issuance/revoke invocations, exact consumer CLI, and metadata-only fsynced audit.
- `scripts/honartik-config-center-readonly-status-v1.php`: separate read-only Laravel DB and credential-file verification with owner/mode, token-hash binding and HTTP 200 config / 403 secrets, no secret values or API bodies returned.
- `honartik-config-center-registration-candidate-v1.cjs`: updated exact-SHA-pinned executor patch, passing `{action,operation,level,approvalConsumed,requestId,scriptGitSha}` only from the internal Host Actions v2 code *after* `authorize-consume`, plus checked module hashes before loading the runner.
- `honartik-config-center-install-manifest-v1.json`: all five runtime artifacts pinned by SHA256 alongside the four exact current Control Plane file preimages and L4/rollback and live health gates. This is a source manifest, **not an installer that writes files**.

Latest [GitHub Actions run 38413410123](https://github.com/prhmonline/prhm-host-actions/actions/runs/38413410123) **SUCCESS: 45/45 offline Node tests, 2/2 PHP lint PASS and source hashes checked**. This establishes source and synthetic contract readiness only. No live DB-backed issuance/revocation test has been performed, no atomic installer deployed, no fresh Level-4 grant issued or consumed, and no Production file changed.

**Authoritative live state (13 October):** Agent 3 Host Actions registry does **not** list `honartik_config_center_readonly_enroll_v1`; Honartik `php console/yii config-center/check` still returns exit 1 `CONFIG_CENTER_READONLY_FAIL`. PR #190 remains Draft/unmerged. **NO-GO** for production enrollment or MoeinShow rollout.

**Only remaining install-critical gate:** build/install the fixed source-to-target atomic registration bootstrap in a pre-authorized trust channel, run DB-backed rollback and race tests against an isolated real schema, secure separate explicit Level-4 approval, then execute read-only health and auditable rollback verification. Do not treat the mere presence of a synthetic approval-receipt-shaped JavaScript object as a fresh authorization; only the existing trusted server-side `authorize-consume` path is authoritative.

## 2026-10-13 — Atomic source-only registration bootstrap candidate (57/57 PASS)

Source:
- `honartik-config-center-atomic-registration-installer-v1.cjs`: a **source-only** nine-target registration candidate. It constructs an exact plan from the already pinned four live file SHA256 preimages and five root-owned staged assets. The production entrypoint derives this plan internally, not from caller-provided paths or a caller-controlled filesystem.
- `test-honartik-config-center-atomic-registration-installer-v1.cjs`: an in-memory simulated filesystem exercises success, early rejection, foreign preexisting asset, a failure *after* a rename, partial registration, service-health failure, unsafe backup directory, failed preimage backup and intentionally unverifiable rollback.

Transaction contract:
1. A **separately trusted** bootstrap mediator must verify a fresh, signed, single-use Level-4 approval scoped to `honartik_config_center_registration_install_v1` and the reviewed manifest/source Git SHA before it calls the installer. Boolean proof fields are only an internal post-mediation assertion, **not** a replacement for signature verification.
2. The source staging path is fixed to `/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1`, and backup root is fixed to `/var/backups/prhm-honartik-config-center-registration-v1`. Stage must be independently prepared with matching source SHA and root ownership; the private backup root must preexist, root-owned and non-group-readable. **Neither prerequisite has been installed by this PR.**
3. Every file preimage is SHA-checked immediately before mutation; backups are checked and fsynced before changing the first live file. Every target replacement is atomic per file, with a post-write SHA/owner/mode check. Only the specified five action assets and four Control Plane owners may change.
4. Fixed services are restarted/health-checked after installation; any failure triggers reverse restoration and service recovery checks. An unverified rollback is a hard failure, not a success. This is a **compensating transaction across files**, not a globally atomic simultaneous cutover.
5. There is **no standalone apply CLI** or registered MCP endpoint. This PR never issues a credential. A legitimate separate registration bootstrap must be implemented and authorized before the actual Honartik enrollment action becomes callable.

**CI evidence:** [GitHub Actions run 38418866629](https://github.com/prhmonline/prhm-host-actions/actions/runs/38418866629) completed **SUCCESS: 57/57 Node tests, both PHP lint checks PASS, fixed source SHA checks PASS**. Synthetic tests do not count as a real Laravel DB-backed rollback/race test or an approved installation.

**Still open:** real isolated DB-backed issuance/revocation/race tests; integration with a trustworthy signed L4 registration bootstrap and fixed independent install worker; staged source, backup-root and service restart preflights; new approval; real install plus `CONFIG_CENTER_READONLY_PASS tenant=honartik revision=1 source=remote`. Until then: **NO-GO Production, PR remains Draft**. No previous approval request may be replayed, and neither Honartik business data nor MoeinShow may be touched.

## 2026-10-13 — isolated SQLite and cryptographic signed-L4 gate

**Real isolated relational test (not a production database):**
- Added `tests/honartik_config_center_sqlite_contract_test.py`, using real temporary SQLite files and two independent connections, not mocks.
- Exercises tenant/revision constraints, one config:read credential only, hash-only token persistence, duplicate-issuance refusal, foreign-token preservation, exact-token revocation and idempotence, broader-scope revocation refusal, transactional audit failure rollback, and a concurrent connection lock conflict.
- Additional source-anchor checks correlate the SQLite SQL contract with the actual reviewed PHP source's `revokeBoundToken`, token hash, tenant and Site `lockForUpdate` operations.
- **Limit:** this verifies SQLite transactional predicates, not actual Laravel Eloquent + MariaDB/MySQL row-lock behavior. The original `php scripts/honartik-config-center-prod-enroll-20261012.php` was NOT invoked; doing so against Production would issue credentials.

**Cryptographic authorization gate (Git only, no approval requested):**
- Added `honartik-config-center-signed-registration-approval-v1.cjs` and Ed25519 test coverage. This follows the actual Approval Center `EdDSA` JWS header format, pinned issuer `prhm-company-approval`, signed action/operation, approved operator and role, exact SHA256 canonical registration arguments, Git source commit, unexpired Level-4, policy version, and a persisted typed-executor consumption ledger with its own recorded SHA256 integrity value.
- The **public production installation entrypoint** `executeAfterTrustedApproval` now rejects plain `{approved:true}` or fabricated proof objects and instead requires a cryptographically signed token plus *independently present* consumed-record proof, internally read from the fixed Approval Center public key/consumed-ledger paths; no caller-supplied path, clock, public key or policy is accepted.
- Future registration policy version `2026-10-13.2-honartik-config-center-registration-bootstrap-v1` is deliberately pinned and **not installed**. This gate is currently **NO-GO** until the independently reviewed trusted registration bootstrap creates that policy and server-side request, performs signed once-only authorization, and stages SHA-verified files.
- No production signature/private keys, tokens, credentials, customer or booking data were read or written in this development phase.

[GitHub Actions run 38420440553](https://github.com/prhmonline/prhm-host-actions/actions/runs/38420440553) completed SUCCESS at the source+consumption-integrity revision: **65/65 Node checks, 9/9 SQLite transactional checks, both PHP lint checks PASS**. Follow-on issuer/role hardening is separately tested on the newer PR head and must be verified GREEN before any further rollout.

**Remaining independent blockers:** actual Laravel/MariaDB isolated DB-backed integration; separate *installed*, signed Level-4 policy/registration bootstrap and source staging; health checks and success attestation on the actual Honartik production consumer. Neither the registration installer nor the enrollment action is installed. Do not merge or deploy this Draft PR as a shortcut.
