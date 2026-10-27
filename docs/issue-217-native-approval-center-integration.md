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
