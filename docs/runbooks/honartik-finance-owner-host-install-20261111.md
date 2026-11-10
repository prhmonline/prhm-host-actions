# Honartik finance owner — host identity verifier install boundary (2026-11-11)

This file documents an **operator-only, root-owned identity proof verifier**
for exact operation \`honartik_back.production.finance_release\`. It does
**not** grant finance release authority or deploy an application.

## Immutable source and review

- GitHub source repository: \`prhmonline/prhm-host-actions\`.
- Review and merge \`honartik-finance-owner-host-verifier-v1.cjs\`,
  \`test-honartik-finance-owner-host-verifier-v1.cjs\` and
  \`scripts/install-honartik-finance-owner-host-verifier-v1.sh\`.
- Pin the **complete merged main commit SHA**, verify it using GitHub and
  fetch a clean immutable checkout with that SHA. Never install from an
  unpinned branch, unreviewed local edits or an Actions PR checkout.
- Installation is a **separate existing-root operator action** on
  \`prhm-production.prhm.ir\`; GitHub Actions and the dedicated deployment
  runner have no sudo, root or deployment privileges added by this change.
- Source-only CI tests must pass before installation.

## Root-only install result

The installer creates:
- \`/opt/prhm-honartik-finance-owner/releases/<reviewed-source-SHA>/\` —
  root-owned immutable-version JS source, mode 0644.
- \`/etc/prhm-honartik-finance-owner/identity.json\` — root-owned, mode 0600,
  pinned to reviewed host workflow commit SHA and exact finance release
  operation/base/source SHAs.
- \`/var/lib/prhm-honartik-finance-owner/{pending,inbox,consumed}\` —
  owner root, mode 0700. Only a verified identity proof can create an
  O_EXCL + fsync one-use receipt in \`consumed\`; it cannot be replayed or
  deleted to retry an interrupted production operation.
- It does **not** create \`github-api-read.token\` or alter sudoers,
  systemd, MySQL, payment flags, deployment scripts, rollback helpers,
  permission policy, or the live checkout.

Operator invocation after pinning and source review:

\`\`\`bash
INSTALL_SOURCE_SHA="<reviewed FULL SHA>" \
  bash "<clean immutable repository checkout>/scripts/install-honartik-finance-owner-host-verifier-v1.sh"
\`\`\`

Private GitHub repository API run/environment verification requires a
read-only credential placed independently by an authorized operator as
\`/etc/prhm-honartik-finance-owner/github-api-read.token\`, mode 0600,
root:root. Never print it or commit it. Missing credential fails closed.

## Root operator verifier usage (NO DEPLOY)

1. Run \`node <installed-root-only release>/honartik-finance-owner-host-verifier-v1.cjs issue\`.
   This generates a fresh random SHA-bound 64-hex challenge and a host-held
   ephemeral X25519 key. **Only the public key and challenge** leave the host.
2. After the owner dispatches the exact finance OIDC workflow in the
   **configured protected environment**, securely transfer the one-day,
   host-encrypted artifact to the root-only inbox file named
   \`/var/lib/prhm-honartik-finance-owner/inbox/<challenge>.json\`,
   mode 0600, root:root.
3. Run \`node <installed-root-only release>/honartik-finance-owner-host-verifier-v1.cjs consume <challenge>\`.
   The verifier decrypts the JWT *only on the host*, verifies the GitHub
   JWKS signature, pinned actor/repo/workflow/sha, official run, exact
   environment and main-only policy, and creates one-use fsynced receipt.
   **No API secret or JWT is logged.** Verification never executes a
   backend deploy, wallet movement or migration.
4. The real financial release coordinator needs its **own separately
   reviewed and authorized host action** with fresh root-owned backup and
   isolated restore attestation, migration checks, double-credit safety,
   source SHA check, app preimage and reversible cutover. Identity proof
   alone cannot satisfy any of these.

## GitHub environment setting

\`prhmonline/prhm-host-actions\` → Settings → Environments →
\`honartik-finance-production\` must have:
- exact custom deployment branch allowlist \`main\`;
- \`Allow administrators to bypass configured protection rules\` **unchecked**.

As of source authoring the GitHub API reported
\`can_admins_bypass=true\`, and the connected GitHub environment tool does
not expose this edit. GitHub's standard REST create/update environment
endpoint also has no documented \`can_admins_bypass\` write field. **Do
not** replace this with a weaker rule or accept the owner JWT while this
flag remains true. GitHub authenticated Settings UI is required to change
it, followed by independent read-back verification.

## Final status contract

\`OWNER_IDENTITY_VERIFIER_INSTALLED\` is independent from
\`FINANCE_RELEASE_ALLOWED\`. Both an unconfigured GitHub environment and a
missing private-repository read-only token are intentional barriers.
Even when a genuine OIDC identity is consumed, the host module always
outputs \`finance_release_authorized:false\`. It cannot perform the PHP
production cutover. Do not claim completion before a separate trusted
finance deployment verifier is installed and tested.
