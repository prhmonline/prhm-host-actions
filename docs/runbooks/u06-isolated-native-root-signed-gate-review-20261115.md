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
