# U06 owner-confirmed four proposed SHA postimages + missing native L4 admission

Observed on 2026-11-11 from \`root@prhm-production\` using the exact
GitHub commit \`47ee1537e3e91d00483a56813105a435063defb0\`
and \`python3 3.6.8 --audit-all\`. Full SHA and count matrix:
\`manifests/honartik-u06-owner-confirmed-four-postimages-20261111.json\`.

*This is one read-only observer's report, not a cryptographically signed
Root installation transaction.* U06 is still absent from Production Agent 3,
and the preview Root Executor dispatch explicitly throws
\`u06_native_root_dispatch_not_installed\`. A future installer must
independently reread exact Root source bytes and compare SHA before using
any candidate. Do not silently edit or deploy this deny-only preview.

## Important discovery and corrective source change

The 14-callback U06 source coordinator used a GitHub owner-OIDC proof/fence
alone before calling the proposed MySQL account-creation callback. That
owner identity is not sufficient to authorize Production Level-4 privileged
mutation. The source contract now requires TWO additional native capabilities:
\`verifyNativeConsumedSignedLevel4\`, and
\`reserveNativeLevel4ReplayFence\`. Both must succeed after durable
journal creation and before the very first MySQL/credential operation.
The signed receipt is pinned to the owner-confirmed exact U06 L4 candidate
policy SHA \`aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934\`,
the dedicated \`host_action.honartik_u06_native_backup_register_v1\`,
and a single-use durable replay fence. GitHub OIDC still has a separate
one-use owner identity fence.

These are **source-only callbacks**. A fake local test callback claiming
\`signature_verified=true\` is NEVER trusted by a live Root action: the
future exact Root-only handler must independently read the Root-owned Ed25519
issuer key, exact reviewed and installed policy, authoritative consumed ledger,
and durably reserve an anti-replay fence before reporting success. This PR
does not implement or install that independent Root handler.

## Remaining implementation gates

- Real 16-capability Root adapter (14 prior callbacks + 2 L4 trust gates)
- Reviewer-approved exact 4-owner Root registration with rollback;
  **no generic Level-3 installer shortcut** and no unverified policy change
- Purpose-limited Production MariaDB account and private credential
- Installed Universal native backup, 69 table/49 FK/full finance validation
  and independently fetched/restored fresh encrypted offsite Node1 snapshot
- No Yii migrations, application deployment or Apache cutover in U06

Do not close U06 until live Root-bound evidence passes.
