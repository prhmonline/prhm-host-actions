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
