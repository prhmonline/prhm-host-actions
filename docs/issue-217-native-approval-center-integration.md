# Issue 217: native Approval Center L4 consumed-gate and replay fence

**Stage:** source-only, fail-closed, not registered and not executable in Production.

## New code in PR #223

- `honartik-universal-installer-native-approval-gate-v1.cjs`: root-owned fixed-path reads of Approval Center Ed25519 public key, exact signed token JWS, live policy and consumed single-use ledger; signed request/approval ID, policy hash, canonical `{action}` hash, TTL 180s, exact operation/typed scope/approver and consumer are checked. It does not issue or consume an L4.
- `honartik-universal-installer-native-l4-fence-v1.cjs`: reserve-once fixed root-only approval fence with O_EXCL, O_NOFOLLOW, file/directory fsync and 0600 ownership checks; never silently deletes or reissues a failed fence. A separate nonroot temporary fixture entrypoint exercises the same filesystem writer.
- Earlier native preflight pins existing active Installer bytes, manifest, registered Honartik config and exact owner file SHA values.

## Verified tests

- Ed25519 crypto and policy/ledger negative matrix: 12/12 PASS, isolated Linux Node 24, synthetic throwaway signing key and ledger (no actual Approval Center secrets).
- Durable single-use fence: 10/10 PASS, isolated Linux Node 22, UID nobody, no production files. Exact Git blob SHA of the fence and test source verified against GitHub.
- Native read-only root preflight: 9/9 PASS in separate isolated Linux sandbox and Windows workstation.
- All above are developer verification only. No independent signed Linux runner provenance and NO production journal/crash/recovery integration test. Security review still required for this new source.

## Remaining implementation and security requirements

1. Reviewer must assess source and tests of PR #223 independently; prior approvals on PR #218 / policy PR #15 do NOT approve new code.
2. Privileged maintainer must implement an actual root-owned, non-overridable Host Actions binding to the exact `honartik_universal_installer_upgrade_v1` name. Register the action in the installed Agent API, root executor and MCP facade through the already-trusted Root-of-Trust bootstrap, NOT generic SSH replacements.
3. Reconcile approved policy operation + typed scope with the actual live policy preimage hash. Enforce exact operation level 4, explicit human confirmation, 180s expiry, principal mohammad / role mcp-operator and one-use issuance. The draft policy version is pinned; if the eventual live policy version differs, REQUIRE re-review of the code and binding.
4. Bind receipt loading to the **existing trusted sealed Approval Center token source**, never an HTTP/caller-selected token or arbitrary JS boolean. The established `/v2/host-actions/confirm` + `/v2/host-actions/authorize-consume` flow must consume the token before the private `consumed/<approval_id>.json` ledger is used. The native gate is proof of consumption, not an issuer or consumer.
5. Complete root-owned installer execution module with exclusive lock, pre-verified immutable candidate source tree closure, authenticated *signed* Linux interrupted-rollback test evidence, durable original pointer/manifest/wrapper preimage journal, only pinned `universal.install.install_bundle`, postimage/other projects/Apache+DB invariants and crash recovery. No Yii migration and no backend deployment in this L4 action.
6. The native runner must reserve the local one-time L4 execution fence exactly once; a crash or partial write burns that approval ID until human investigation (no silent replay). Ensure journal is durable before any production install write and rollback verifies exact preimages and holds lock on failure.
7. Never merge/mark ready/activate until independent review and a signed native bootstrap permit it. Acceptance requires Agent 3 `host_actions_v2` enumerating the exact action, an official pending signed L4 request for the correct SHA only, and independently verified rollback. Manual symlink changes are not permitted.

## Fixed identifiers

- Existing Installer digest: `47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181`.
- New Installer digest: `8680011e11ad8eae89707b74492e60354c4b7e56799b205d3da581e92806a552`.
- Candidate backend Git SHA for later separate Honartik release: `0cdfb3d03caf143f665b20b463971e3e4f9b51c9`.
- Central Installer prefix: `/usr/local/libexec/deploy-control/universal`.
- Production current: **unchanged**. This PR only proposes new Git source.

## Transaction recovery development evidence (2026-10-27)

- Added `honartik-universal-installer-native-recovery-transaction-v1.cjs` and `test-honartik-universal-installer-native-recovery-transaction-v1.cjs`.
- Uses only non-root isolated `/tmp/prhm-honartik217-recovery-fixture-*` directories; no production root execution entrypoint exists.
- Records a durable preimage journal before fixture cutover; snapshots old `current`, Manifest and Wrapper bytes **and mode bits**. Uses O_EXCL lock, fsync file and containing directory, and atomic pointer/Manifest/Wrapper replacement.
- Tests inject both thrown faults and actual child-process `process.exit` after pointer, Manifest, and Wrapper writes; a fresh process can verify and restore exact preimage and modes.
- On altered old bundles, unexpected pointer destinations or unverified restoration, the exclusive lock is retained for manual intervention. Journal is preserved in ROLLED_BACK or COMMITTED state; repeated begin is refused.
- **14/14 PASS, Node v24 Linux UID1000 sandbox** after final mode-preservation fix; source check PASS. This is a **fixture-only native transaction simulation**, not an authenticated signed runner, not a real Python `install_bundle()` integration test and **NOT production rollback certification**.
- Full aggregate regression has not been verified in one clean run after this change because the sandbox provider intermittently returns HTTP 403; earlier isolated component tests passed. Do not claim aggregate PASS.
- Remaining: bind real Python fixed `install_bundle` in approved root-owned supervisor with real signed Approval Center receipt, validate root-owned transaction and test privileged crash recovery; safely stage and register the exact Host Action in Agent API, root executor and MCP facade. None of these are installed.

## Real Python Universal Installer integration preflight (2026-10-27)

- Read the **installed** `universal.install.install_bundle` implementation through authorized read-only server access. Observed exact live source SHA-256 pins: `install.py=4be5c770cc9c7075f11b06ea463a9bc65e399e19124beaaee01934f47b59433d`; `io.py=93be862ad6c03afb7e793a868e0701b96183e85c5108871afca34263c9bd8d86`; `locks.py=83f5403166cd537c67d65fcccdf6b5d8c8a08614220235f186f2bf21aac67d41`; `config.py=a2586c0825eadf0c9efa0bd9c9b53028d30c08bc8887e765189b35ff958db883`; `models.py=4b585ec21947bfaddd1f449cb49c85106d8c7f7d7e08cc6b688c4d4484832205`.
- Existing `install_bundle` verifies candidate SHA, syntax, installed preimage and destination bytes and updates `current`, `deploy-project`, and `installation.json`. It restores the pointer on wrapper-write exceptions, but after pointer+wrapper updates, `write_json` manifest failure or an abrupt process exit is **not generally rolled back by that function**. Native outer crash journal is mandatory.
- Added `test-honartik-universal-installer-real-python-fixture-v1.py`, which refuses UID0 and any engine fixture outside owner-controlled `/tmp/prhm-honartik217-engine-fixture-*`; verifies the exact live source bytes of five engine components before importing `universal.install`; invokes the exact Python `install_bundle` on throwaway fixtures and includes success, mismatched SHA, wrapper failure and manifest-write injection.
- **Completed:** copied the five exact live Python engine source files read-only from prhm-production to an authorized workstation, then staged their bytes in an isolated Linux sandbox (non-root UID 1000, Python 3.13.18). SHA-256 pin verification of all five passed before import. Ran the **actual installed `universal.install.install_bundle` source**, 7/7 PASS, including normal forward install, refusal of wrong candidate/current hashes, wrapper failure and manifest-write exception recovery in fixture, plus hard child-process exit immediately after the actual pointer switch and immediately after the actual manifest write followed by exact fixture restoration. No production target path was used. This is real source-byte-matched Python function **in a fixture**, not authenticated signed Linux runner provenance, not an operational root adapter or production recovery attestation.
- Fixed preflight policy to permit a valid first-install `installation.json.previous=null` (or pinned SHA-256), rather than falsely demanding a non-null prior release. Retested the updated non-root Linux preflight test suite **10/10 PASS**.
- Previous 14/14 durable fixture crash-recovery and 12/12 synthetic cryptographic tests remain separately verified; no new cumulative or signed runner attestation is claimed.


## Source-only real-Python outer-journal fixture (2026-10-27, not signed)

The additional test-only module
`honartik-universal-installer-python-outer-journal-fixture-v1.py`
and extensions to
`test-honartik-universal-installer-real-python-fixture-v1.py`
exercise an on-disk O_EXCL/fdatasync-style (fsync file and parent directory)
preimage journal around the **exact installed-source Python**
`universal.install.install_bundle`, once the five previously SHA-pinned
private engine files are supplied to a non-root sandbox. The module only
admits per-test, owner-controlled `/tmp/prhm-honartik217-python-install-fixture-*`
directories; it has no production path or privileged entrypoint.

New real-source-dependent regression cases: failure during manifest write,
abrupt exit immediately after pointer replacement, abrupt exit immediately
after manifest replacement, abrupt exit following durable COMMITTED marker,
forged lock symlink, redirected current pointer, and post-commit modified
candidate bundle. After a confirmed COMMITTED marker, recovery verifies
candidate bytes/manifest/wrapper and does not restore the preimage. A corrupt
or indeterminate state retains its recovery fence. Prior journal is never
silently discarded or reused.

**Validation boundary:** Syntax checking of both Python files is enrolled in
source-only CI. The existing Linux CI cannot run the real installer tests
because it does not possess the private byte-exact five-file installed-engine
fixture. The new real-source-dependent tests have **NOT yet been executed or
independently signed**. An isolated non-root local synthetic installer smoke
test exercised journal commit and pointer-crash restoration, but is not
evidence of real Python installation or privileged recovery. Do not add these
tests to a success count without actual runner output for this exact SHA.

**Still required:** trusted root executor/Host Actions registration,
authoritative single-use L4 receipt binding, locked native production installer
transaction, independently attested Linux fault-injection using real engine
bytes, signed reviewer provenance, and exact live policy reconciliation.
Production remains unchanged.


## Commit acknowledgement ambiguity — critical source fix (2026-10-27)

Coordinator `honartik-universal-installer-l4-v1.cjs` formerly attempted
`restoreExactJournal()` on **every** `commitJournal()` failure, including a
lost acknowledgement **after** a durable `COMMITTED` marker. Restoring the
old installer after durable commit can violate the atomic transaction
guarantee and create an unsafe mismatch between installer bytes, manifest,
audit and the one-use L4 approval. Fix reviewed in PR #223.

The trusted native root executor must implement the additional
`inspectDurableJournalState(CONTRACT,journal)` capability. It MUST read
a fixed root-owned, no-follow, exact-version journal path, verify its
ownership/permissions, schema, checksum, source/destination digests, approval
identity and fsynced durable state before yielding precisely `PREPARED`
or `COMMITTED`. It MUST never infer PREPARED from a failed API response,
untrusted in-memory booleans, a missing journal, or an empty file. Broken
journal or unknown state MUST throw/fail closed.

- When `commitJournal()` returns true, the source-only coordinator retains
  the existing nominal successful path; native root owner must ensure true
  corresponds to durable verified COMMITTED state.
- When commit throws, times out or returns false and exact root journal
  inspection proves it is still `PREPARED`, a normal exact-preimage rollback
  is allowed, subject to independent rollback verification.
- If the inspected journal state is `COMMITTED`, `ROLLED_BACK`,
  indeterminate, forged or unreadable, **do not call rollback**. Preserve
  the exclusive recovery lock and require trusted root reconciler/manual
  inspection; a cryptographically consumed one-time L4 approval MUST NOT be
  reused.
- The coordinator code intentionally does not itself act as an issuer,
  resolver for root-owned bytes, actual installer transaction or root
  registration. Any new native adapter version requires fresh independent
  review, installed owner hashes, exact policy reconciliation and signed
  L4 through Root-of-Trust, with production strictly NO-GO until then.

Exact source-only negative test command:
`node --test test-honartik-universal-installer-l4-v1.cjs`.
On the authorized Windows development workstation, Node v22.14.0:
**16 tests / 16 PASS**, including four new cases for lost acknowledgement
after COMMITTED, commit returning false after COMMITTED, inspection failure
or unknown state (all retain the fence), root inspector capability required,
and legitimate still-PREPARED rollback. This is NOT a signed independent
Linux native-root test or a Production adapter validation.


## Additional failure gate: journal prepare lost ACK (2026-10-27)
The coordinator previously released its exclusive installer lease if
`createDurableRecoveryJournal` threw before returning a journal handle.
This is unsafe when the root journal has already been fsynced but the
caller never received the handle. A second installer transaction must
not start while the root writer's durable outcome remains unknown.

The source-only coordinator now records `journalPrepareAttempted`
**before** invoking the trusted native writer. If it rejects or throws
without supplying a validated journal handle, the coordinator:
- retains the exclusive root-owned lease and all evidence;
- does **not** issue or consume Level-4 approval;
- does **not** call installer, rollback with an unknown handle, or
  release the recovery fence;
- returns `JOURNAL_PREPARE_OUTCOME_UNCERTAIN_manual_reconciliation_required`.

The native root executor must provide a separate trusted recovery
procedure to inspect the root-owned on-disk journal, determine whether
it is ABSENT/PREPARED/COMMITTED, safely finalize or revert only as
appropriate, and durably audit reconciliation **before** releasing
the lease or permitting another approval to be consumed. A caller's
unverified journal status or an absent response is never sufficient.

Current Windows Node v22.14.0 developer fixture:
`node --test test-honartik-universal-installer-l4-v1.cjs` yielded
**18/18 PASS**, 0 FAIL, including new before/after-fsync lost-ACK
negative tests. These are source-only simulated host capabilities;
the actual privileged executor has not been installed or tested,
and no independent Linux source-head attestation exists. Production
remains NO-GO.


## Source-only root journal disk inspector contract — 2026-10-27

Source: `honartik-universal-installer-native-journal-inspector-v1.cjs`;
tests: `test-honartik-universal-installer-native-journal-inspector-v1.cjs`.
This **does not install, register or implement the root-owned writer**, authorize
L4, run the installer, or resolve a previous crash.

The proposed future journal producer MUST atomically fsync one canonical
`prhm.honartik217.fixed-native-installer-journal.v1` record under the exact
fixed root-owned directory
`/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4`.
The inspector accepts no caller-supplied production directory, bundle digest,
policy version or arbitrary action. It checks:
- UID 0, non-symlink root-owned parent chain, owner-only directory (0700),
  regular journal (0600), exact fixed lock (0600), checked inode/owner/size,
  canonical JSON and a SHA256 checksum. SHA256 alone is not authentication:
  protection comes from **trusted root filesystem ownership** and pinned source.
- Exact action, operation, old/new bundle digests, canonical args SHA256,
  candidate policy SHA256, journal/lease UUIDs and preimage bytes/modes/hash.
  The installed Approval Center policy must already equal the exact reviewed
  candidate bytes. It is deliberately **NO-GO** while the live policy SHA
  remains unreconciled.
- For `PREPARED`, old bundle content is preserved and current pointer can be
  either the old or candidate digest (partial Python installer cutovers).
  This proves only which durable journal *state* was read, NOT authorization
  to perform arbitrary rollback.
- For `COMMITTED`, additionally verifies next pointer and actual installed
  candidate bundle, manifest and wrapper SHA256, modes and manifest old/new
  digest fields. A verified COMMITTED state **must never be rolled back**.
- For `ROLLED_BACK`, verifies old pointer plus exact original manifest,
  wrapper and file modes before confirming that state. It does not write.
- Missing/forged lock, tampered bundle, wrong parent ownership, symlinks,
  wrong journal identity or incomplete records fail closed.

The future root writer must use exactly this newly proposed schema; there
is currently no installed production journal producer. The root adapter must
**independently** reconcile an uncertain `createDurableRecoveryJournal`
return that supplied no handle, using the trusted fixed lock and on-disk record.
An inspector alone cannot grant replay/approval or safely release a lock.
Mandatory review must cover journal-creation atomicity, root-owned writer,
external one-time signed approval consumption, root registration, and the
post-install rollback/verifier with a separate signed Linux test attestation.

**Validation as of staging:** Authorized Windows workstation Node tests:
6 passed, 0 failed, 6 Linux-only file-system tests explicitly SKIPPED.
The Linux test suite is enrolled in the branch-scoped Ubuntu GitHub workflow,
but no confirmed latest-head Linux run is claimed here. Local Windows fixtures
are NOT native Linux/Root evidence. PR remains Draft and Production unchanged.


## Mandatory COMMITTED readback on the success path

The fixed source coordinator now invokes
`inspectDurableJournalState(CONTRACT,journal)` **after** a seemingly
successful `commitJournal()`. The coordinator cannot return
`installer_upgraded:true` until this second independent durable read
returns exactly `COMMITTED`. Any untrusted/absent/UNKNOWN readback
holds the exclusive root recovery fence and requires reconciliation.
A positively verified `PREPARED` result may be compensated by exact
preimage rollback, but is not success.

**Source-contract test result at code SHA
`3a2073c4ff964ef105653d83bc63d2e5f73eb42a`:**
authorized Windows Node v22.14.0 `node --test
test-honartik-universal-installer-l4-v1.cjs` 21/21 PASS,
0 fail, 0 skipped. It includes false COMMITTED readback after a
successful return and a false success where disk remained PREPARED.

This tests the coordinator's *simulated trusted-host capabilities*,
not actual root-only journal reading in the installed Host Actions service.
The separately added disk inspector is still source-only. Its six
filesystem tests are Linux-specific and must be run against the exact
latest PR SHA in an isolated nonroot environment or CI. An unsigned
developer run is not independent security review or cryptographic
approval for a production install. Root registration/policy remains NO-GO.


## Durable PREPARED journal producer / bound exclusive lease (2026-10-27)

Source-only module:
`honartik-universal-installer-native-journal-writer-v1.cjs`.
It supplies a **root-only, fixed-argument PREPARED writer**, plus a
separately named nonprivileged, disposable `/tmp` fixture producer.
It is **not installed or registered** in Host Actions; there is
no root COMMITTED writer, approval consumption, CLI, installer apply,
or actual privileged deployment path.

Production `prepareFixedRootJournal()` accepts **no runtime path, project,
token, operation or candidate arguments**. Before touching the on-disk
journal/lease, it requires UID0, the exact reviewed installed policy
bytes, exact root-owned read-only staged candidate archive SHA256,
the byte-verified current Installer bundle, exact manifest entrypoint,
and a root-owned exclusive fenced directory. With the **currently installed
live policy** (different SHA from PR #15 candidate), it MUST fail closed
without creating a lease. It is deliberately NOT production-callable via
any registered Host Action.

Journal creation protocol, proposed for future independently reviewed
root-owned native writer:
1. Validate immutable preimage and candidate integrity before acquiring
   the lease; refuse an existing journal without deleting it.
2. Atomically reserve one private `install-transaction.lock` (0600)
   via `O_EXCL|O_NOFOLLOW`; serialize/fdatasync equivalent (fsync)
   its newly generated random lease UUID; fsync parent.
3. Serialize canonical `prhm.honartik217.fixed-native-installer-journal.v1`
   with a separately random journal UUID, old/new digests, fixed action,
   exact proposed policy and canonical argument SHA, byte-hashed preimage
   manifest/wrapper and permissions; state `PREPARED`.
4. Stage with private `O_EXCL` temporary file, fsync it, install with
   an **atomic no-clobber hard link** (not rename-overwrite), fsync directory,
   remove temporary stage and fsync directory again. No journal or lock
   is removed on failed/uncertain writes.
5. Re-read using independent
   `inspectFixedNativeJournalState`/`inspectIsolatedJournalFixture`
   before acknowledging `PREPARED`. The inspector now requires **the
   lease UUID in the trusted on-disk lock to exactly match the journal**.
6. Abrupt exit between durable lease and journal leaves an orphaned
   lock, and exit after durable `PREPARED` leaves both, blocking any
   reattempt. Only a reviewed root reconciler may later finalize or
   repair, without approval replay.

Exact source-only tests now include `test-honartik-universal-installer-native-journal-writer-v1.cjs`
and updated inspector negative tests. Development Windows Node v22.14.0
checked the same GitHub blobs: **24 test cases, 9 PASS, 0 FAIL,
15 Linux-only SKIPPED**; no Linux acceptance or independently signed
review may be inferred from those figures. The branch-scoped Ubuntu
workflow includes both sets; a current-SHA run must be confirmed
before counting the 15 Linux cases as passed.

**Open gates:** root-owned COMMITTED/ROLLED_BACK state transition writer,
independent Linux fault injection on fixed source HEAD, trusted native
Host Actions binding/registry, exact installed policy reconciliation,
cryptographic consumed-once Level-4 receipt and independent code review.
Root production install remains NO-GO; Honartik Backend/iTicket unchanged.
