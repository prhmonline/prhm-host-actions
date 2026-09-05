# SUPERSEDED — DO NOT EXECUTE

This V2 seed is superseded because its candidate helper contains a stale production baseline binding. Do not execute V2. Use `prhm-root-of-trust-typed-bootstrap-helper-refresh-v3` only.

---

# PRHM Root-of-Trust Typed-Bootstrap Helper Refresh V2 â Provider Console Runbook

Artifact commit: `0c62ca67cb0625057fafd74a4bf5d5963e31d533`  
Artifact SHA-256: `b7ba8d4efd57a3e095d6e556328ad1d3e7d127281c0112d3845ee28cb63b54f0`

## Purpose
Refresh exactly one already-registered Control Plane helper:
`/opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js`

Fixed preimage SHA-256:
`d4330d3818c4a392ad62acf92b282f2d86fbd77a31dd0642dbc32aeab54d919c`

Fixed candidate SHA-256:
`f80273d9e273c5b35910b5d85575caf435bcff6aa4230f760380c82fb6e5a839`

The seed is zero-input. It preserves mode `0750`, owner `root:root`, creates a restrictive backup before replacement, performs an atomic rename, verifies Node syntax and executor health, requires `control_plane_typed_bootstrap_transport_v1` to remain registered, and automatically restores the exact preimage on post-write failure. It does not restart services and does not touch databases, iMotion, Honartik, DrTarjomeh, policy, MCP, or registry files.

## Trust boundary
Run only from the provider/VM console as root. Do **not** run through Agent API, MCP, SSH Agent, self-maintenance, Host Actions, DeployHQ, GitHub Actions, or a generic SSH credential.

## Execute
```bash
set -euo pipefail
install -d -m 0700 /root/prhm-root-seed-typed-bootstrap-v2
cd /root/prhm-root-seed-typed-bootstrap-v2
curl --fail --silent --show-error --location   "https://raw.githubusercontent.com/prhmonline/prhm-host-actions/0c62ca67cb0625057fafd74a4bf5d5963e31d533/bootstrap-prhm-root-of-trust-typed-bootstrap-helper-refresh-v2.js"   -o seed.js
printf '%s  %s
' 'b7ba8d4efd57a3e095d6e556328ad1d3e7d127281c0112d3845ee28cb63b54f0' 'seed.js' | sha256sum -c -
/usr/local/bin/prhm-node --check seed.js
/usr/local/bin/prhm-node seed.js
```

## Required success evidence
The seed must return `status: "APPLIED"` or idempotent `status: "ALREADY_APPLIED"`.

Then verify read-only:
```bash
sha256sum /opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js
systemctl is-active prhm-agent-selfmaint-exec.service
```

Expected helper SHA:
`f80273d9e273c5b35910b5d85575caf435bcff6aa4230f760380c82fb6e5a839`

Stop immediately and do not continue to the Level-4 action if the seed reports `FAILED_ROLLED_BACK`, `apply_failed_rollback_failed`, a SHA mismatch, metadata mismatch, syntax failure, or executor-health failure.
