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
