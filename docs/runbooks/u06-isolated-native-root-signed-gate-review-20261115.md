# U06 isolated Native Root path — security review handoff (2026-11-15)

## Decision

**NO-GO Production.** This PR tests *actual disk-backed modules in an unprivileged isolated fixture*, not a live Root Host Action. The tests do not read a Production credential, touch the PRHM database, perform a backup or prove recoverability of a remote snapshot. PR #295 must remain Draft; it cannot be merged or deployed on the basis of these tests.

## Exact source flow under review

1. `createUnprivilegedSignedLockFixture` uses an exact disposable `/tmp/u06-owner-shared-test-<12 hex>` tree, verifies Ed25519 signed one-time L4 Native scope and Approval Center consumed ledger, writes a **separate** fsynced shared admission fence, and exclusively holds the cross-actor lock.
2. `createDisposableFixtureLease` from **honartik-u06-native-root-lease-v1.cjs** acquires a second Native lease. Real `attestPreimage` validates signed fixture profile/adapter checksums and absence of credentials.
3. The same **real Native lease module** writes a fsynced `u06-rollback.json` with `state=PREPARED`, and the integrator verifies that actual state, not a supplied caller journal ID.
4. `createDisposableRootL4Fixture` from **honartik-u06-native-root-l4-admission-v1.cjs** rechecks authoritative Ed25519+consumed-approval policy using the **actual PREPARED journal**. Exactly **one** `reserveNativeLevel4ReplayFence` creates the official disk-backed O_EXCL replay fence; a second reservation is rejected with EEXIST.
5. The test executes no MySQL or Native backup. It uses real `verifyAndRecordRollback` to durably mark the original profile intact, and reopens that exact `ROLLED_BACK` journal to verify id, state, checksum and credential absence.
6. Only after the real Native lease is released, the fixture shared-lock receipt is completed with a checksum over the actual durable journal; the shared lock is released. Reuse of the same signed grant is still blocked by its separate admission fence.

## Tests and crash matrix

Dedicated source-only CI runs the module plus `test-honartik-u06-isolated-root-native-path-v1.cjs`.

- Successful rollback: exact shared admission → actual Native lease → actual PREPARED journal → one official L4 consumed fence → actual ROLLED_BACK journal → independent file read → Native release → shared release.
- Spawn separate OS child and send **actual SIGKILL** at: `shared_admitted`, `native_locked`, `prepared_journal`, `native_l4_consumed`, `rolled_back_journal`, and `native_unlocked`.
- After every crash, shared lock remains fail-closed and a second invocation cannot replay the approval. The official L4 fence is absent before `native_l4_consumed` and present thereafter; journal remains PREPARED until real rollback is completed.
- Cryptographically tampered signed L4 fails before Native lease/journal; a corrupted terminal journal blocks shared release. A successful transaction cannot reuse the signed approval.
- **All test outputs must retain `SOURCE_ONLY=PASS` and `PRODUCTION_DEPLOY_AUTHORIZED=FALSE`.**

## Required independent security review (not yet completed)

- [ ] Verify trusted Root fixed path preimages and exact SHA-256/Git blob closure on the **real** host; compare with live read-only state again before a release.
- [ ] Confirm the source-only candidate cannot be installed as-is: all live Root entrypoints are deliberately fail-closed without a separately signed, host-pinned Root gate.
- [ ] Verify Approval Center consumed receipt, no-replay fence and native real journal remain single-owner/one-time even after kill/restart; review file symlink, hardlink, inode replacement and post-fsync crash windows, especially lock/receipt unlink races.
- [ ] Build and independently test a **trusted privileged Root binding** to all five OIDC/Native actors, with no unguarded alternative transfer, worker or legacy entrypoint.
- [ ] Resolve whether owner-identity issuance/staging/consumption need separate authorized registration and scope beyond the two L4 operations currently admitted; preserve default-deny.
- [ ] Test full Native coordinator with authentic owner GitHub OIDC, exact host L4 policy and consumed ledger; fixture synthetic Ed25519 and isolated rollback **do not satisfy** this requirement.
- [ ] Test production-equivalent backup with isolated MariaDB restore, 69-table/49-FK finance/wallet consistency and encrypted offsite round-trip restore.
- [ ] Obtain independent reviewer acceptance and fresh scope-specific, signed one-use installation approval before any Production changes.

**Do not** retire the existing expired challenge, issue a replacement, replay a consumed bootstrap signature, register Root handlers, alter approval policy, or execute Native backup from this source-only work.

## 2026-11-15 code-security findings and remediation — internal review, NOT independent approval

### Finding U06-S1: unsound terminal-journal attestation (HIGH, source-only candidate)

The earlier `finishFixture(session, terminalRecord)` accepted any 64-hex `journal_sha256` and allowed Native shared-lock release without independently verifying a real Native terminal journal or absence of the Native lease. On a future privileged integration this would be an unsafe trust-boundary pattern.

**Fixed in source:** Native admission binds an exact canonical 0700 `/tmp/u06-root-lease-test-XXXXXX` fixture directory and persists that binding in its signed shared admission fence. `finishFixture` for Native now reopens the fixed 0600 `u06-rollback.json` with `O_NOFOLLOW`, checks ownership/inode, requires `state=ROLLED_BACK` and rollback/credential-absence fields, checks no Native lease remains, and verifies `SHA256(actual bytes) === supplied journal_sha256`. A synthetic but correctly formatted digest now fails.

Tests: `security review: 64-hex terminal receipt mismatching disk journal cannot unlock`; `security review: active Native lease after rollback blocks shared unlock`. Importantly, this is still **fixture-only**, not a Root terminal-authorization solution. A future live adapter must also tie the journal ID and source SHA to the trusted installed Native transaction and verify both COMMITTED and ROLLED_BACK outcomes appropriately.

### Finding U06-S2: dangling symlink interpreted as nonexistent (HIGH, source-only candidate)

Node.js `fs.existsSync` follows symbolic links and returns false for dangling links, which could misclassify a malicious Native lease or journal leaf as absent during preflight or common-lock release. A future Root implementation must not assume an unresolvable symlink is an absent object.

**Fixed in source:** The signed gate now uses `lstatSync`-based `absent()` checks that treat any existing leaf (including dangling symlink) as a blocker. Negative tests cover a dangling Native lease both at admission and after journal rollback before shared-lock release.

### Additional isolated UID0 check (not full privileged Root integration)

The source CI runs `sudo -n node` on disposable GitHub-hosted Ubuntu and asserts that `createUnprivilegedSignedLockFixture`, `Shared.assertSourceBoundLease`, and `createIsolatedNativeRootPath` **refuse UID0**. It prints `ISOLATED_CI_ROOT_UID_DENIED=PASS` and `LIVE_ROOT_RELEASE_TESTED=FALSE`; it never calls the installed PRHM Root Executor.

Latest source-only CI: [run 43710512875](https://github.com/prhmonline/prhm-host-actions/actions/runs/43710512875) — **90 tests PASS, 0 FAIL**; Agent3 registration gate also PASS. GitHub reviewers at this checkpoint: **none submitted**. The author is the only observed contributor in the repository's recent PR history and no CODEOWNERS file was found at the standard paths; an independent reviewer was not inferred or impersonated.

**Release status remains NO-GO:** An independent human security review and explicit approval are still required. Source-only checks with an isolated UID0 refusal test must NOT be represented as a real privileged Root end-to-end test or authorization to install.

## 2026-11-15 next review gate — Root sandbox and journal binding

The independent reviewer requirement remains unfulfilled: no GitHub review is recorded on Draft PR #295, and no specific authorized second reviewer is known. **No self-approval, fabricated reviewer or installation authorization is allowed.** An eligible human reviewer must approve the exact fixed commit SHA after analyzing the following findings and verifying the evidence.

### Finding U06-S3 (HIGH): terminal journal from another Native transaction

The fixture lock session was not tied to the ID of the actual Native `PREPARED` journal; a valid-looking terminal file (and matching digest supplied by the caller) could potentially be substituted during a later Root implementation. The signed gate now calls `attestPreparedNativeJournal(session,journal)`, reopens the actual owned 0600, `O_NOFOLLOW` journal, validates its id/state/original-profile hash and binds its id into a session-scoped WeakMap. Terminal release requires that same id/profile SHA in the actual `ROLLED_BACK` file, and still requires no live Native lease and an exact terminal journal SHA match.

### Finding U06-S4 (HIGH): change of PREPARED journal before L4 burn

A new injected tampering test found that after a first successful `PREPARED` attestation a subsequent change in journal ID could still allow the fixture path to record the official Native one-use fence before the Native lease detects journal mismatch. To prevent premature consumption, the integration performs a second on-disk `PREPARED` attestation **immediately before** official Native L4 receipt verification/reservation. If the journal has changed, it stops without burning the official fence and retains the common lock for reviewed recovery. This is a source-only mitigation, not a claim to eliminate all filesystem TOCTOU when integrating the future production Root adapter; code review must examine open descriptor/inode binding.

### UID0 positive / negative sandbox boundary

`test-honartik-u06-ephemeral-root-cryptographic-sandbox-v1.cjs` runs only on a disposable GitHub-hosted Linux runner as actual UID0. It creates *only* fresh root-owned private /tmp files, builds **synthetic** locally signed Ed25519 L4 claims and consumed ledger, runs the **actual U06 pure signed/consumed verifier**, and exercises root-owned 0700/0600 O_EXCL/fsynced locks and anti-replay. The production signing key is **not** involved. The test does not export or invoke live Root Host Action handlers, does not grant Production approval and does not perform a Native backup or restore. The preceding UID0 negative test still proves the live shared gate has **no Root constructor**.

### Independent security reviewer acceptance conditions

An eligible human reviewer, other than the PR author, must examine the exact SHA of this PR (including the newly added journal-ID binding and reattestation before consumption), record a review directly in GitHub, and confirm (1) challenge/OIDC actor closure, (2) Root file and approval trust ancestry, (3) post-fsync crash/rollback and one-use semantics, (4) possible symlink, TOCTOU, hardlink, and replaced inode cases, (5) end-to-end real Root Host Action admission and offsite recovery, and (6) no alternative unguarded privileged handler. **Until an authorized reviewer is identified and the signed production release separately approved, this is NO-GO.**

## 2026-11-15 12:28:38 UTC — independently remeasured Production source preimages (READ-ONLY)

The authorized Remote Desktop Commander session to `prhm-production.prhm.ir` performed **SHA256, stat, systemd status and bounded policy JSON metadata only**. It did not write files, issue credentials, execute Root actions, restart services, change DB/DNS, or read private key material.

| File / source owner | Observed SHA-256 | Matches reviewed preimage |
|---|---|---|
| Agent API `/opt/prhm-agent-selfmaint/server.js` | `649941e1a2f77a9a1515327e47fa7176a0ae8f4602042750d53847e568deed0e` | Yes |
| Root executor `/opt/prhm-agent-selfmaint-exec/server.js` | `34ce844008fbb7763250cdfa7859ca16360db1aa414fff77d107ffb0ccfa4121` | Yes |
| Agent3 `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js` | `01eb930e8e9177b8754ab5cf36a004cb69141d44b74e70b4d42dc3f0f33f1c56` | Yes |
| Approval policy `/opt/prhm-company-control-plane/config/approval-policy.json` | `aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934` | Yes |
| Installed owner bridge `/opt/prhm-agent-selfmaint-exec/actions/honartik-u06-root-owner-proof-bridge-v1.cjs` | `35f1f79c397d66008b017014a3141d5518ff416f34fc18fbdaebc9087ecd449d` | Yes |

Other bounded observed facts: Root service `prhm-agent-selfmaint-exec.service` **active**; native action `honartik_u06_native_backup_register_v1` present in installed policy and typed scopes and string-located in Root Executor and Agent3 sources; reconciliation action `honartik_u06_expired_owner_oidc_reconcile_v1` absent from those policy/source checks. Approval Center `/var/lib/private/prhm-company-approval` and its consumed directory are owned by UID/GID **65039** mode 0700; issuer public key UID/GID 65039 mode 0600. Native Root runtime and `owner-oidc` directories are UID/GID 0 mode 0700. The old owner challenge is root-owned 0600; its `expires_at_ms=1794650615085` corresponds to **2026-11-14 10:03:35.085Z**. No sealed evidence, reconciliation journal, native exclusive lease or native rollback journal was present at observation time.

### Release-readiness verdict

`honartik-u06-live-root-readonly-snapshot-v1.cjs` and its negative tests pin these measured baseline values. Its output is **NO-GO even when the exact snapshot matches**: a matching preimage only establishes a candidate *starting state* for future reviewed changes. Unexpected source SHA drift, identity/permission drift, unplanned registration, leftover evidence/journal/lease, unexpired/missing challenge or an observation older than 15 minutes fail closed. The test fixture is a **historical snapshot**; refreshing it does not remotely inspect Production and a future deploy must remeasure independently.

**Current decisive blockers:**
1. Recovery action is not registered on the installed Approval Center/Root/Agent3 sources; the expired challenge must not be silently overwritten or replayed.
2. The signed full Root shared lock is not installed; the fixture-only gate refuses UID0.
3. No independent GitHub security reviewer has approved PR #295, and no fresh per-scope owner-signed one-use L4 permit authorizes a specific installation.
4. No end-to-end Production-equivalent Native backup/isolated restore/independent offsite financial recovery has yet passed for this proposed integration.

**Release remains strictly NO-GO.** This source-only preflight does not issue or infer authorization, mutate the live approval policy, register a Host Action, install files, reset an owner challenge, or invoke a backup.

## 2026-11-15 13:00 UTC — immutable 25-asset review handoff, bootstrap circularity resolved (SOURCE ONLY)

A targeted **read-only** inspection of the installed Approval Center and Root Dispatcher showed:

- The installed policy contains **77 operation names** and the U06 Native critical L4 action `host_action.honartik_u06_native_backup_register_v1` with its typed scope, but no `host_action.honartik_u06_expired_owner_oidc_reconcile_v1` operation or scope.
- The installed Root Executor `applyHostActionV2` has an explicit fail-closed stub for Native: `throw new Error('u06_native_root_dispatch_not_installed')`. Policy/Agent3 recognition alone is therefore **not an installed Native backup executor**.
- The installed generic `host_action_v2_installer_v1` is **Level 3**; its Root helper verifies a fixed result target `honartik_git_worktree_fixed_v1`. That legacy installer is **not authorized as a general-purpose U06 Root/Approval-policy registrar**, and must not be reused to work around U06's Level-4 policy.
- An existing L4 operation for Native is scoped to Native only; it cannot be substituted as approval to register recovery.

**Two distinct security stages are necessary:**

**Stage A — registration/bootstrap**: Independently review a complete exact-SHA bundle of Root Executor, Agent API, Agent3 source, Approval Center policy postimage and all transitive Root shared-lock logic. Establish a separately authorized and independently signed **installation/registration operation** with an explicit, eligible bootstrap authority. **The recovery operation being introduced cannot authorize its own registration.** No such specific Stage-A authority was verified in the current live baseline.

**Stage B — expired-challenge reconciliation**: Only after Stage A is fully installed, verified and journaled, issue and consume **a new one-use critical Level-4 approval for the newly registered exact reconciliation operation**, verify source/policy/rollback, run with the same Root shared lock, and archive/retire the old expired challenge without replay. Fresh GitHub owner OIDC comes **after** successful reconciliation, and Native backup has an entirely separate L4 and recovery gate.

`honartik-u06-bootstrap-two-phase-review-v1.cjs` records the **25 original Git blobs from source commit `f2ec0e22f91ef5ef18e0e8606a9dec5c31d3434d`**, rejects any byte drift, changed source closure, extra source or mismatched host/commit, and returns **NO-GO regardless of caller-supplied approval booleans**. It is a *baseline review pack*, not a full registration patch: real Agent API, Root Executor, Agent3 and policy postimages remain unimplemented/uninstalled. The review pack and CI files themselves are newer than the pinned baseline commit and must be separately reviewed at the actual PR head.

**No signature issued, no Production installation, no Native dispatch enablement, and no challenge reset were performed.** The independent reviewer remains unassigned, and the PR is Draft/unmerged. The next legitimate release-planning milestone is a concrete **separately authorized Stage-A installer design and second-person review**, not activation using Level 3 or replay of the already consumed bootstrap.
