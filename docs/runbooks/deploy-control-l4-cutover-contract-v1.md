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
