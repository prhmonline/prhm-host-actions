# U06 exact owner routing — operator supplied actual slices

**Date:** 2026-11-11. The user supplied read-only \`grep -n -C 2\`
from the four root-owned Host Action files on \`prhm-production.prhm.ir\`.
All source SHA256 values were independently confirmed in the previous root
terminal output and pinned in \`honartik-u06-owner-root-preimages-v1.cjs\`.

Actual currently-installed routing (line numbers from owner console):

- Agent API \`server.js\`: \`HOST_ACTION_V2_SPECS\` line 25; existing
  installer action anchor line 48; \`HOST_ACTION_V2_LEVEL3\` line 64;
  \`hostActionV2ApprovalMeta\` line 66; new U06 **must not** join Level 3.
- Executor \`server.js\`: \`HOST_ACTION_V2_SPECS\` line 30; installer anchor
  line 53; \`hostActionV2Spec\` line 440 rejects unknown actions;
  original dispatch line 698 and **final wrapped dispatch** line 931.
  A new action would require exact **final** dispatch wiring, not just a name.
- The sensitive execution route line 1060 confirms
  \`/v2/host-actions/confirm\` -> \`/v2/host-actions/authorize-consume\`
  -> \`applyHostActionV2(action)\` in that order.
  Owner GitHub OIDC is a separate signed identity proof and must not be
  misrepresented as this Approval Center's one-use L4 receipt.
- MCP plugin \`hostActionsV2.js\` line 11 enumerates actions.
- Approval Policy JSON shows existing installer
  \`host_action.host_action_v2_installer_v1\` is **Level 3** (line 226),
  unrelated to U06. It is not a permissible U06 installer.
  The policy shape of a new L4 operation is not in these excerpts, and the
  exact root-owned handler implementation does not yet exist.

The module \`honartik-u06-owner-root-routing-preview-v1.cjs\` is **source-only**
and validates SHA-bound read bytes and exact known anchors. It previews a
separate U06 registry name across API/executor/MCP, but the preview executor
entry **explicitly refuses execution**. It DOES NOT patch Approval Policy,
make writes, restart services, authorize root actions, or implement the
14 required native methods.

## GO/NO-GO

**NO-GO on installation.** Source snippets alone cannot safely authorize
root insertion. The next implementation deliverable is a separately reviewed
exact-scope native U06 root handler with real owner JWT verification, signed
Level-4 one-use receipt, pinned source provenance, durable journal/rollback,
purpose-limited MariaDB credential, actual Universal native backup/isolated
restore and full finance/offsite evidence. Only after that code and tests
exist should an authorized installation be considered.

No U03/U05 admission, Backend publication, migration or Apache changes are
granted by this review.
