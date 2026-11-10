# U06 next security boundary — independent signed Level-4 consumed receipt

**2026-11-11 — reviewed code in Git only; U06 NOT installed.**

The previous U06 owner OIDC verification confirms the *identity* of the
direct GitHub requester but **does not grant Root privilege**. The actual
installed Host Actions v2 approval path must independently require a
fresh, one-use, **Ed25519-signed Level 4** receipt after the exact
\`honartik_u06_native_backup_register_v1\` operation is registered.

This module implements U06-specific cryptographic checks for:
- official Ed25519 \`PRHM-COMPANY-APPROVAL\` compact JWS signature;
- fixed \`host_action.honartik_u06_native_backup_register_v1\` with
  project \`control_plane\`, environment \`production\`, action,
  principal \`mohammad\`, Level 4 critical and exact one-field arguments
  digest (\`{action:'honartik_u06_native_backup_register_v1'}\`);
- an independently source-pinned Approval Center policy SHA, default deny,
  Level 4 operation, unique typed scope, exact rollback reference;
- 180-second maximum receipt lifetime and full expiry check;
- an immutable, previously **consumed** ledger matching signed approval
  and request IDs, operation, request SHA, trusted consumer, timestamp,
  and canonical consumption hash.

The test creates a *synthetic Ed25519 signing key and policy only in GitHub
CI*, signs realistic Level 4 claims, and validates fail-closed negative
paths. Synthetic proofs return \`root_owned_sources_attested=false\`,
\`replay_fence_reserved=false\`, and
\`production_backup_authorized=false\`. **They do not confer privilege.**

## Required to activate on Root (not done)

Before installing U06, the trusted root installer must:
1. Review and source-pin the exact additive Level-4 policy postimage,
   keeping the existing 4 root owner SHA preimages and Rollback journal.
2. Independently read/verify Root-owned Approval Center signing key,
   policy and the consumed private ledger. A caller-supplied key/policy
   MUST NEVER be admitted as Root proof.
3. Atomically reserve the exact \`approval_id\` against replay in
   a root-owned \`0700\` directory with \`0600\` file plus fsync.
4. Bind the **same request and same in-process owner identity proof**
   to the 14-capability native backup transaction and its durable journal.
5. Only then permit purpose-limited MySQL role/credential, actual
   installed Universal adapter, independent full finance restore, fresh
   encrypted Node1 evidence and reversible mandatory offsite policy.
6. Publish no Backend and run no Yii migrations or Apache cutover.

\`TRUSTED_LIVE_POLICY_POSTIMAGE_SHA256=null\` and
\`verifyLiveRootU06()\` throws until reviewed live policy and
fixed trusted loader exist. This is a **deliberate security stop**,
not a successful Production authorization.
