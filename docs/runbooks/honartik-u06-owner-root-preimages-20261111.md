# U06 — live four-owner SHA-bound registration baseline

Confirmed by the owner's root terminal on \`prhm-production.prhm.ir\`:

| Owner | SHA256 | UID:GID | Mode | Bytes |
|---|---|---|---|---|
| Agent API (\`/opt/prhm-agent-selfmaint/server.js\`) | \`57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530\` | 0:0 | 0644 | 34605 |
| Root executor (\`/opt/prhm-agent-selfmaint-exec/server.js\`) | \`4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169\` | 0:0 | 0755 | 115918 |
| Agent 3 MCP (\`/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js\`) | \`0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef\` | 0:0 | 0600 | 12321 |
| Approval policy (\`/opt/prhm-company-control-plane/config/approval-policy.json\`) | \`26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5\` | 0:0 | 0644 | 31167 |

The Universal adapter + production profile SHA are separately pinned, exact matches.
The root executor is active, but U06 remains **NOT registered** in the 36-action inventory. The backup-only credential is **missing**, offsite remains **false**.

This document and its contract are STATIC SOURCE ONLY. Source claims can be used
to **reject** drift but must never authenticate a request, authorize a deployment,
or install a root handler. A trusted root installer must independently read exact
source bytes and verify signed owner action, invariant anchoring, exclusive lock,
durable preimage journal and rollback.

## Only remaining evidence before design of the exact root patch

The immutable preimages are known, but the actual live API/Executor/MCP code
for those SHAs is not returned through the connected file-read API. Do not
blindly apply source transforms designed for earlier SHA versions.

Request only safe, bounded source routing excerpts (no credentials, keys,
secrets, tokens or complete source). Restrict scope to Host Actions v2 route
registry, Level-4 classification, one-use authorize-consume and fixed dispatch.
Then design a narrow fail-closed native Root U06 installer and add independent
SIGKILL/crash-recovery + native restore tests. Never substitute another
registered action nor bypass the existing L4 protection.

No Production write, no DB user/credential, no offsite profile change,
no Backend deploy is authorized by these files.
