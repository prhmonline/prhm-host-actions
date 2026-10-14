# Deploy Control Level-4 Cutover — Source-Only Review Contract V1

**Issue:** [prhm-host-actions#206](https://github.com/prhmonline/prhm-host-actions/issues/206)  
**Parent security gate:** [deploy-control#21](https://github.com/prhmonline/deploy-control/issues/21)  
**Status:** Draft source-contract only. **Not an installer, registered Host Action, permission to deploy, or runtime attestation.**

## Deliverable

- `deploy-control-cutover-contract-v1.cjs` exports **pure review-only** validators.
- `test-deploy-control-cutover-contract-v1.cjs` exercises invalid runtime arguments, stale issuer versions, changed policy SHA/preimage, missing external permission evidence and exact three deploy scopes.
- There is **no** exported installer, action dispatch, approval creation/consumption, root filesystem write, sudo call, network request, service restart or rollback execution.
- The declared future action is `deploy_control_cutover_install_v1`, risk `critical`, Level **4**; it is **not yet registered or executable**. Do not invoke it through a generic Host Action interface.

## Exact pinned source review identities

| Repo | Reviewed candidate SHA |
|---|---|
| prhmonline/deploy-control | `e9d4b435a8bb73a507b2a7dd4affc4caa455d524` |
| prhmonline/prhm-company-control-plane | `018f5da4d2781e4131bac4ae78904cecc3a91d9f` |
| prhmonline/aranob | `0454dd4bfb74e3064da36955006dd38426b12b82` |
| prhmonline/Honar-front-new | `5a13a594fc0081dd202583df3f3d04b06aa34b4f` |
| prhmonline/honar-back-new | `c3a4b93035698315e1358a298316538bd2d2ce4b` |

Policy preimage: version `2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1`, raw-file SHA256 `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174`, issuer JSON policy hash `c141ce7d56bf1de9c11a6e98b0abd6d20da9a349a6cbe1735c5bb659e3a70fea`.

Candidate policy version `2026-10-14.1-deploy-control-exact-sha-scopes-v1`, issuer JSON policy hash `7db7303d1da799347448f98062eae2f0e6599909bde016eaad9bde4b30c8ab5e`.

## Read-only regression reproduction

Ordinary local tests (no privileged runner):

```sh
node --check deploy-control-cutover-contract-v1.cjs
node --check test-deploy-control-cutover-contract-v1.cjs
node --test test-deploy-control-cutover-contract-v1.cjs
```

For the full policy-transition tests, an **isolated CI sandbox only** may use these read-only, authenticated provenance-verified fixtures:

```sh
PRHM_CUTOVER_LIVE_POLICY_FIXTURE=/isolated/live-policy.json \
PRHM_CUTOVER_CANDIDATE_POLICY_FIXTURE=/isolated/candidate-policy.json \
  node --test test-deploy-control-cutover-contract-v1.cjs
```

The live policy fixture must be read from the **live, read-only control-plane** after independently checking SHA256 `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174`; the candidate fixture must be read from the exact GitHub commit `018f5da4d2781e4131bac4ae78904cecc3a91d9f` with verified Git blob SHA. Never place private Approval Center tokens, Ed25519 keys, or live credentials in fixtures or Git. This entire file is non-secret policy content.

**Observed isolated evidence (14 Oct 2026):** Authenticated source and test files matched the GitHub blob SHAs; live fixture raw SHA matched; candidate fixture matched the Git blob SHA; isolated Node.js 20 test run **12/12 PASS, 0 skipped**. Without the two fixtures, the built-in source tests showed **9 PASS, 1 SKIP**—the skipped fixture test is not falsely represented as full CI success.

## Non-negotiable next security gates

1. A **trusted, explicitly reviewed installer implementation** and fixed typed registry integration must still be built and tested on disposable filesystem fixtures. This source-only contract neither performs the cutover nor authorizes it. Any attempt to use this contract as a privileged apply route is a design error.
2. Independent Level-4 approval must be **real, signed, current, one-time, and exact reviewed SHA-bound**. Human confirmation is separate from ordinary Level-3 project release approval. No request/token exists as a result of this PR.
3. Host preflight must independently attest effective `sudo -l -U deploy-runner`, groups/aliases, all external delivery triggers (DeployHQ has read-only API `403` without plan upgrade), root-owned parent directories, source blob SHAs, root-only issuer credential and durable audit.
4. Privileged security cutover must first capture immutable live runtime/sudoers/policy preimages and validated recovery. Exactly the two known **Production** NOPASSWD grants must be revoked with installation of the new root-owned dispatcher; existing root-owned **staging-only** no-argument SHA-pinned dry-run exception may remain. Run `visudo -cf` for the complete effective tree and negative privilege checks. Stop on unknown authority.
5. Wire and test exact *active* issuer policy **version + hash** attestation into the privileged dispatcher **before any irreversible approval consumption**. The helper exists in central Draft PR, but invoking it from the root entrypoint was blocked by tool safety checks. It is **NOT wired or in Production**.
6. Activate the 5 Draft source PRs only after the independent host trust boundary is validated. A Production canary needs its **own explicit authorization**, exact source SHA, site health, durable audit and rollback.
7. Never amend deployed source files directly, replace secrets from Git, reset Git history, reuse consumed approval IDs, or claim CI is official GitHub Actions (hosted runner is blocked by GitHub account billing).

### Acceptance definitions

**Source contract DONE:** SHA-pinned non-executable contract and tests pass in an isolated test environment.  
**Installer NOT DONE:** purpose-built Host Action implementation, authenticated registration, sandbox rollback tests and runtime binding unimplemented.  
**Production NOT DONE:** policy/sudoers/issuer cutover, operator authorization, coordinated PR merges and exact-SHA canary unexecuted.

If any candidate SHA or expected live preimage differs, revise and re-review the *contract source in Git*, then rerun the isolated test suite before seeking any Level-4 authorization.


## In-memory transactional rollback rehearsal (added on 2026-10-14)

The source-only PR now also includes:
- `deploy-control-cutover-fixture-v1.cjs`: **only** a cloned `Map<string, Buffer>` transactional simulator. No filesystem, shell, HTTP, signing-token, status-polling or Production process capabilities. All changes are to a cloned in-memory fixture; outputs declare `fixture_only=true`, `installed_on_host=false`, `execution_authorized=false`.
- `test-deploy-control-cutover-fixture-v1.cjs`: negative tests including malformed inputs, unknown grants, stale issuer, privileged wildcard, not-wired dispatcher, and five post-mutation synthetic rollback checkpoints.
- In an isolated Node v20 sandbox, both source and test files, plus the actual old dispatcher, core and new sudoers candidate, were fetched from exact pinned GitHub Git blob SHAs. The nonsecret live Approval Center policy was read via Agent 3 **read-only** and matched raw SHA256; candidate policy matched the GitHub blob SHA.
- Combined suite: **27 PASS, 0 FAIL, 0 SKIP** with five fixture inputs; this comprises original 12 policy-contract cases plus 15 fixture/rollback cases.
- Current **real** central dispatcher intentionally **FAILS** `issuer_attestation_not_wired` because it does not yet call `verifyIssuerPolicy` before `consumeApprovedRelease`. This is the intended hard gate. Only a synthetic *test-only* in-memory dispatcher alteration is used for the successful fixture pathway; **that altered source is neither committed as a Production artifact nor permitted for cutover**.
- For five failure injections (`policy_written`, `helper_written`, `core_written`, `sudoers_swapped`, `health_check`), the simulator restores byte-for-byte the original in-memory policy and sudo grants, while leaving its caller-owned Map untouched. **No operating-system atomicity, actual file backup, root sudoers update, running issuer reload or live rollback has been tested**.
- This fixture tests the *proposed ordering and rollback specification only*. A real purpose-built, reviewed, registered root installer with trusted approval consumption and durable rollback remains **NOT DONE**.

To reproduce in an isolated checkout after verifying the files' Git blob SHAs:

```sh
PRHM_CUTOVER_LIVE_POLICY_FIXTURE=/isolated/live.json \
PRHM_CUTOVER_CANDIDATE_POLICY_FIXTURE=/isolated/candidate.json \
PRHM_CUTOVER_DISPATCHER_FIXTURE=/isolated/dispatcher.mjs \
PRHM_CUTOVER_CORE_FIXTURE=/isolated/production-approval-core.mjs \
PRHM_CUTOVER_SUDOERS_FIXTURE=/isolated/deploy-control-gated.sudoers \
node --test test-deploy-control-cutover-contract-v1.cjs test-deploy-control-cutover-fixture-v1.cjs
```


## Disk-backed temp-filesystem transaction rehearsal (2026-10-15)

Two files extend **Draft PR #207**, without creating any callable Production action:

- `deploy-control-cutover-temp-installer-v1.cjs` is a **temporary-filesystem-only** transactional test harness. The only allowed root is a `prhm-cutover-fixture-*` directory created directly below the system temp directory, owned by the current nonprivileged process and mode 0700. It rejects arbitrary roots and runtime argument extension. It exposes only `run`, `PATHS` and `CHECKPOINTS`, not a Host Action apply/approval/registration API.
- `test-deploy-control-cutover-temp-installer-v1.cjs` validates fixture path confinement, existing file/preimage checks, symlinked inputs/parents rejection, exclusive lock, real on-disk backup and fsync/rename-based candidate writes, candidate file verification, and **five separate disk rollback fault injections**.

Authenticated fixture inputs: original non-secret Approval Center policy **read-only** via Agent 3 Primary and verified against raw SHA256 `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174`; proposed policy and dispatcher/core/sudoers read from exact reviewed GitHub commits and verified by per-file Git blob SHA. Test scripts were also checked against their Git blob SHAs before execution.

**Executed in separate, disposable Composio sandbox with Node v20:** combined
`test-deploy-control-cutover-contract-v1.cjs`,
`test-deploy-control-cutover-fixture-v1.cjs`, and
`test-deploy-control-cutover-temp-installer-v1.cjs`:
**42 tests PASS / 0 FAIL / 0 SKIPPED**. The suite verifies the *actual unwired* central dispatcher is rejected **before modifying any disk fixture**. Only a synthetic **test-only in-memory rewrite** of its source is used to test the five successful rollback paths. No such rewrite is committed or installed to Production.

Every fault point `policy_written`, `helper_written`, `core_written`, `sudoers_swapped` and `health_check` verified restoration from the **real on-disk backup**, including removal of newly created candidate assets and restoration of old legacy grants, all within the disposable temp directory. Test also rejects wildcard grants, symlink traversal, stale policy, changed source digests, and concurrent fixture lock collisions. The fixture journal excludes secrets and records success/rollback separately.

**Security limitations:** This is *not* an operating-system transactional / crash-consistent root installer; no live issuer restart, real `visudo`, systemd or full effective sudo policy, external hook check, signed approval verification/consumption or Production rollout has happened. A true independently authorized, trusted Host Action implementation must separately implement reliable on-host backups, service restart, failure detection and validated rollback under Level-4 security review. The central privileged dispatcher wiring remains a distinct **safety-blocked** change and must not be circumvented. GitHub-hosted CI remains account/billing blocked. Source sandbox PASS must not be represented as hosted CI or Production PASS.

To reproduce in an isolated checkout with verified fixture provenance:

```sh
PRHM_CUTOVER_LIVE_POLICY_FIXTURE=/isolated/live.json \
PRHM_CUTOVER_CANDIDATE_POLICY_FIXTURE=/isolated/candidate.json \
PRHM_CUTOVER_DISPATCHER_FIXTURE=/isolated/dispatcher.mjs \
PRHM_CUTOVER_CORE_FIXTURE=/isolated/core.mjs \
PRHM_CUTOVER_SUDOERS_FIXTURE=/isolated/sudoers.txt \
node --test \
  test-deploy-control-cutover-contract-v1.cjs \
  test-deploy-control-cutover-fixture-v1.cjs \
  test-deploy-control-cutover-temp-installer-v1.cjs
```

## Additional binding blocker discovered from the real active policy and Agent 3 registry

**Read-only observation:** the current `prhm-company-approval` policy has **75 operations** and **52 typed scopes**; the reviewed candidate PR #13 has **75 operations** and **55 typed scopes**. Neither declares `host_action.deploy_control_cutover_install_v1` or a corresponding critical `host_action_v2_apply` typed scope. Agent 3 Primary's `selfmaint_health` also does **not** list `deploy_control_cutover_install_v1`.

Existing `host_action.host_action_v2_installer_v1` has **Level 3** policy, not the required independently reviewed, one-time **Level 4** cutover policy; do not substitute it or any unrelated registered action. The active Level-4 policy requires human approval by `mohammad`, secondary confirmation, and a 180-second max TTL.

New pure source-only gate `deploy-control-l4-registration-readiness-v1.cjs` evaluates a policy snapshot and the authoritative read-only Host Action registry response, requiring a dedicated exact action, critical Level-4 operation, explicit second confirmation, one-time use, named approver, and a single exact principal/tool/environment/scope binding. Its result is **never an authorization**, even with synthetic passing inputs: `approved=false`, `execution_authorized=false`, `may_install=false`. The companion `test-deploy-control-l4-registration-readiness-v1.cjs` tests missing, duplicate, malformed and wildcard scope/registration cases.

**Verified isolated tests (15 October 2026):** Git-blob-checked sources; authenticated read-only live policy checked against raw SHA256 `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174`; exact candidate policy Git blob; actual Agent 3 `selfmaint_health` registry snapshot. Source-only L4 registration test **10/10 PASS** and all four combined contract/fixture suites **52/52 PASS, zero skipped**. These do not attest to official GitHub Actions CI, real sudo privileges, or Production installation.

**Effective sudo expansion limitation:** the authorized Remote Desktop Commander connector returned `Command not allowed` for read-only `sudo -n -l -U deploy-runner`. User groups were read successfully (`uid=1015(deploy-runner)`, one direct group `deploy-runner`). This is not evidence that the entire sudo graph is safe; no sudo command was bypassed or rerouted.

**Unresolved bootstrap sequence (do not silently skip):** before a real install attempt, a separate properly authorized security-policy and Host Action registration process must make the specific Level-4 operation and exact typed scope active, and register its reviewed fixed installer with SHA-bound preimages/rollback. Any resulting policy SHA changes require a **full re-pin/review** of all earlier source hashes and contracts, rather than deploying a silently altered policy. Actual central dispatcher issuer attestation is still unwired and earlier privileged code edit blocked. No request or approval was issued or consumed.


## Current binding supersession: stacked critical-policy PR #14 (15 October 2026)

**This section supersedes the previously listed PR #13 *candidate* version/hash and PR #13 source SHA for future installer review; earlier sections remain historical evidence of the original 12/27/42/52-test runs.** The Production *preimage* remains unchanged.

- New stacked policy [prhm-company-control-plane PR #14](https://github.com/prhmonline/prhm-company-control-plane/pull/14), exact head `acffc7f9e02073f7aaf6ba92777f7acff6481f81`, stacked on the original PR #13 branch; **Draft, not merged or installed**.
- Candidate version `2026-10-15.1-deploy-control-l4-installer-enrollment-v1`.
- Candidate policy-object SHA256 `732c21b15a54b47dced724e1f5be1c70aa1bd6c41cc5f94c5d2f600e45c36acb`, raw file SHA256 `ed527c12ee330b8e1f5616fcb0c712eb89dddd9395197b2d855f00d3deea0678`. Raw hash and JSON-object hash are distinct.
- Exact additive Live (75/52) → New Candidate (76/56): all existing **75 operations** preserved, all **52 live scopes** preserved, exactly **3** fixed Level-3 application release scopes plus **1** strictly typed Level-4 installer operation and **1** critical Host Action scope. The `verifyPolicyTransition()` and source SHA pins in `deploy-control-cutover-contract-v1.cjs` were updated, as were associated tests and the L4 registration checks.
- The new critical scope is **source-only**. The live Approval Center still reports its original 2026-10-02 policy hash `c141ce7d56bf1de9c11a6e98b0abd6d20da9a349a6cbe1735c5bb659e3a70fea` and Agent 3 Primary registry **does not advertise** `deploy_control_cutover_install_v1`. Therefore the new policy registration is **not yet activated**, and no authentic approval can be requested for this action.
- Re-ran the source contract + memory fixture + temporary disk rollback + Level-4 registration check **52/52 PASS, 0 skipped**, with the *new* exact policy candidate verified by GitHub blob SHA, original policy fixture checked against its raw SHA, and source files verified by Git blob hashes. This remains **offline sandbox test evidence only**, not official GitHub-hosted Actions CI nor Production cutover attestation.
- The original restricted editing environment blocked the privileged root dispatcher code wiring. No circumvention occurred: the candidate dispatcher still lacks a runtime call to `verifyIssuerPolicy()` before consuming approvals, and the tests deliberately fail closed for that authentic source.
- Still required: independently authorized typed Host Action registration, trusted on-host installer implementation, actual expanded sudo and external deployment-hook audit, immutable root backups + rollback, full live issuer version/hash attestation, Level-4 human authorization and separately approved SHA-bound canary.

**Do not use either candidate hash as evidence that it is the *running* issuer policy.**


## 15 October: four-owner read-only preinstall gate — 59 offline tests

Added `deploy-control-l4-owner-preinstall-v1.cjs` and `test-deploy-control-l4-owner-preinstall-v1.cjs` to the still-Draft [PR #207](https://github.com/prhmonline/prhm-host-actions/pull/207). The module is a **pure, source-only review**: injected read-only snapshots only, with no host I/O, privileged calls, approval issuance, registry mutation or operational install function.

The authenticated read-only Agent 3 `sha256sum` check confirmed these **actual live owner preimages**:
- `/opt/prhm-agent-selfmaint/server.js` — `4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406`
- `/opt/prhm-agent-selfmaint-exec/server.js` — `410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0`
- `/opt/prhm-company-control-plane/config/approval-policy.json` — `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174`
- `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js` — `bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166`

The proposal remains the **stacked, Draft PR #14** `acffc7f9e02073f7aaf6ba92777f7acff6481f81`, proposed policy Git blob `702fbed1d0a9936e6fc0e42694f3e1ce6941f4bc`, raw SHA256 `ed527c12ee330b8e1f5616fcb0c712eb89dddd9395197b2d855f00d3deea0678`, JSON-object SHA256 `732c21b15a54b47dced724e1f5be1c70aa1bd6c41cc5f94c5d2f600e45c36acb`.

The live Approval Center `/health` still attests **old 2026-10-02 policy**, Ed25519, one-time use, and its old object hash; Agent 3 `selfmaint_health` still has **no** `deploy_control_cutover_install_v1` among its 35 advertised V2 actions. The new preinstall phase specifically expects that absence; incorrectly demanding the target to be registered *before* authorized registration creates a circular dependency. It returns `authorized:false`, `host_registered:false`, `can_install:false` and `can_consume_approval:false`, even when all read-only source checks pass.

Verified GitHub blob identities of new test/source files and candidate policy, plus authenticated read-only Agent 3 live owner hashes, issuer and registry metadata. In a disposable Node 20 sandbox, **new suite 7/7 PASS**, and all five combined source/simulation/disk/registration/preinstall test suites **59/59 PASS, 0 FAIL, 0 SKIP**. These are independent *offline* tests, not GitHub-hosted CI (billing-blocked).

**Real installation remains blocked** until an independently authorized fixed L4 Action registration and execution route exists, all effective sudo and external-trigger capabilities are reviewed, and the central root dispatcher integrates the policy version/hash gate under a permitted review path. Previous tool restrictions on its privileged entrypoint have **not** been bypassed. Do not create or consume a Level-4 approval for an as-yet-unregistered action.


## Two-commit, **non-executable** source handoff (15 October 2026)

The [PRHM Action Registry onboarding standard](../../PRHM-ACTION-REGISTRY-ONBOARDING-STANDARD.md) requires a distinct reviewed `source_commit` and later `manifest_commit`; however, the **actual live shared registration gateway is NOT installed**. Its executable release schema additionally requires four reviewed *after-install owner hashes*, staged executable action assets, a trusted typed bootstrap, signed one-time Level-4 authorization and real rollback. None may be fabricated or inferred from sandbox success.

Created the following **review-evidence-only** handoff on the existing Draft PR #207:
- Source commit (five immutable audited sources and checker/test code): `e63045b04c796d3178737b61dbe67758a7809a53`.
- Manifest commit (a distinct later commit): `51a630445731e9c4ebd97758fbcf73285f74d051`.
- Manifest: `manifests/deploy-control-l4-source-handoff-20261015.json`.
- Manifest Git blob SHA-1: `92f2e64ad767db70595fc25243b744b33130c295`.
- Manifest raw SHA-256: `5e1540ac447136177f9a9c783150023f062ccf2bb7f7caa29eed7f06683fd1a4`.
- Standalone validator: `deploy-control-source-handoff-v1.cjs`; test: `test-deploy-control-source-handoff-v1.cjs`.

The manifest pins exact Git blob SHA-1 **and SHA-256** for five source files at the earlier immutable `source_commit`, the four currently observed read-only owner preimage digests, the policy PR #14 SHA/blob/raw/object hashes, and the authentic, still-**unwired** deploy-control dispatcher PR #22 SHA. It explicitly declares `production_executable=false`, `registered=false`, `approved=false`, `gateway_manifest_compatible=false`. The verifier rejects forged source bytes, manifest-to-commit mismatches, extra fields or authority claims, changed owner bytes, silent policy escalations, and absence of verified dual-commit identity. Its return value always says `can_register=false`, `can_install=false`, `can_request_level4=false`, `can_consume_level4=false`.

In a disposable Node 20 sandbox, fetched verified GitHub Git blob bytes at the *two exact commits*. New review-only tests: **8/8 PASS**. All six isolated contract/memory/disk/registry/preinstall/handoff suites together: **67/67 PASS, 0 FAIL, 0 SKIP**. This is **offline source-test evidence**, not hosted GitHub Actions CI and **not** a root installation test.

### Stop condition

**Source handoff: DONE. Privileged registration: NOT DONE / blocked.** The source-only `prhm_action_registry_install_v1` gateway is not a callable installed Host Action; its manifest schema must not be confused with this review-only manifest. The current root dispatcher does not wire issuer policy-version/hash attestation before approval consumption; an earlier attempt to change its privileged entrypoint was blocked by the editing safety boundary, which must not be circumvented. Full effective sudo and external deployment trigger review remains incomplete. Until a trusted independently authorized route can review/install the exact four postimage owner SHAs and action asset, do **not** create a fake production release manifest or issue a Level-4 request. No Production changes or consumed approvals.
