# Honartik owner-controlled finance release — OIDC identity boundary, 2026-11-11

## Source-delivered capability (no production mutation)

This change implements a **source-only, cryptographic OWNER IDENTITY
proof** for exactly one reviewed Honartik backend financial release. It is
not an installed privileged executor or an authorization to deploy.

- **Operation:** \`honartik_back.production.finance_release\`
- **Live backend base SHA:** \`4ac602e874a128c3328f27f3dab473857512cdbf\`
- **Reviewed backend GitHub SHA:** \`d1a64e640c9c2cf4788d55566c17728be5813941\`
- **Exact reviewed delta:** 15 files, as proven by
  \`prhmonline/deploy-control/scripts/honartik-finance-manual-source-gate-v1.py\`
  at main SHA \`6449f0025a77cd7ae6d152c85fc0ed5172ab9076\`
- **Initial state:** wallet payment and auto-compensation flags OFF, no schema
  migrations, no automatic owner-funded payment test.

## Intended owner identity flow

1. A *separately reviewed and registered trusted host verifier* creates a
   cryptographically random 64-character lowercase-hex challenge, generates a
   temporary host-held X25519 private key and shares only its DER/SPKI public
   key and the challenge. The verifier pins the exact workflow commit SHA,
   source SHA, live base SHA, finance intent digest and TTL **from immutable
   trusted configuration**, not from user/PR input.
2. The owner manually dispatches
   \`.github/workflows/honartik-finance-owner-approval-oidc-v1.yml\` on
   \`main\`. The workflow has an explicit owner actor-ID gate and is bound to
   environment \`honartik-finance-production\`. It requests GitHub-issued OIDC
   with audience \`urn:prhm:honartik:finance-owner:v1:<challenge>:<intent_digest>\`.
   It encrypts the JWT to the host public key and publishes only an
   encrypted artifact retained for 1 day; no JWT, root credential or private
   key is printed or uploaded.
3. The trusted host verifier decrypts evidence *locally*, verifies GitHub
   issuer JWKS signature, exact audience/nonce, actor and repository IDs,
   workflow path/ref/SHA, official run result and protected-environment
   branch policy. The configured GitHub environment must exist, be
   administrator-bypass-disabled and limit deployments to exactly \`main\`.
   **An unconfigured environment cannot supply valid host evidence.**
4. An individually reviewed host-side coordinator calls the one-use replay
   fence with an in-process cryptographically verified proof. The ledger must
   be **pre-created as a root-owned, mode 0700 directory**, and the receipt is
   created using O_EXCL + O_NOFOLLOW, file fsync and directory fsync. The
   receipt remains consumed even if a later step crashes; never auto-replay
   or delete it to retry a failed release.
5. **Only another authorized, bounded host operation** may later decide
   about installation/cutover. The identity module and replay fence never
   execute Git, Docker, SQL, root shell, migrations, app deployment or
   wallet activation. There is no root install action in these files.

## GitHub environment requirements

Create/review the environment \`honartik-finance-production\` with
\`can_admins_bypass=false\`, **custom deployment branch policy allowing only
\`main\`**, and explicit owner manual dispatch, before any real proof is
requested. These source files do not create that environment. The signed
owner actor is necessary, but this implementation does **not** attest an
independent environment reviewer; its proof explicitly sets
\`protected_environment_reviewer_approved:false\`. If a separate reviewer is
required by organizational release policy, it must be checked by an
additional registered host verifier and official GitHub approvals endpoint
before deployment can be authorized.

## What still blocks an actual backend finance release

- Owner source identity workflow **must be merged and pinned** by the host
  authority; it is not callable as an approval before host challenge
  generation and protected environment configuration.
- Independently reviewed privileged **host verifier and exact
  \`honartik_back.production.finance_release\` coordinator** must be
  installed under fixed root-owned policy. It must enforce the one-use
  receipt and exact source/base SHA, not merely accept client-supplied JSON
  or booleans. The source proof is not that coordinator.
- Fresh privileged backup/restore, 69-table MariaDB data/schema and Yii
  migration integrity, correct checkout/callback amount and idempotence,
  preimage archive, untracked media, health/rollback must pass and be bound
  to the actual live base SHA. The prior successful isolated restore is
  useful evidence but does not replace the signed current release report.
- Do not alter the existing backend routine root helper; it appropriately
  fails closed on controller/service/payment changes.
- A verified backend deployment must precede frontend SHA
  \`d1a2ac7e475c06a78e78d05a6a263e58c2f9f957\`. The wallet feature
  flags stay OFF through initial cutover. Real bank/payment/provider
  pilot needs separate explicit owner consent and remains outstanding.

## Security tests

GitHub-hosted only, no production runner:
\`\`\`bash
node --check honartik-finance-owner-oidc-identity-v1.cjs
node --check honartik-finance-owner-oidc-sealed-v1.cjs
node --check honartik-finance-owner-once-fence-v1.cjs
node --test test-honartik-finance-owner-oidc-v1.cjs
\`\`\`

Tests use ephemeral synthetic RSA signatures and X25519 keys; they do
**not** produce a valid real GitHub owner receipt. Negative cases cover
tampered JWT, wrong repo/actor/workflow/nonce, cross-purpose U06 proof,
workflow retry, wrong branch/environment, expiry, replay, fake JSON copies,
untrusted ledger mode/symlink and lack of deployment authority.

### Source references

- [Honartik Finance Manual Source Gate](https://github.com/prhmonline/deploy-control/blob/main/docs/honartik-finance-manual-release-boundary-20261111.md)
- [U06 owner identity policy](https://github.com/prhmonline/deploy-control/blob/main/docs/u06-owner-controlled-native-backup-route-20261110.md)
- [Honartik technical map](https://github.com/prhmonline/ticketing-core-back/blob/main/docs/HONARTIK_TECH_MAP.md)
