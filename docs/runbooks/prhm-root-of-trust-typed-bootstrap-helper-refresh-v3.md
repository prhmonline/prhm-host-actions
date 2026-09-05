# PRHM Root-of-Trust Typed-Bootstrap Helper Refresh V3 — Provider Console Runbook

Artifact commit: `557c35f784000df64aa305f6456efa772ef16659`  
Artifact SHA-256: `84f45393a77d55b915f65417146a7d26cbdd795adb63bf0f48e35cd689cc84ec`

## Purpose
Install the final readiness-fixed and current-production-baseline-bound helper at exactly:
`/opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js`

Fixed preimage SHA-256:
`d4330d3818c4a392ad62acf92b282f2d86fbd77a31dd0642dbc32aeab54d919c`

Fixed candidate SHA-256:
`3f0712fbadeb94d792911419fc71d220c5b135f82510b52b49e6d08ee6199885`

The candidate includes bounded adapter readiness retry and the production baseline snapshot re-verified immediately before generation on 2026-09-05. The seed is zero-input, preserves `0750 root:root`, backs up before mutation, atomically replaces exactly one file, performs SHA/syntax/executor-health/action-registration verification, requires no service restart, and automatically restores the exact preimage on any post-write failure.

## Trust boundary
Run only from the provider/VM console as root. Do **not** run through Agent API, MCP, SSH Agent, self-maintenance, Host Actions, DeployHQ, GitHub Actions, or a generic SSH credential.

## Execute
```bash
set -euo pipefail
install -d -m 0700 /root/prhm-root-seed-typed-bootstrap-v3
cd /root/prhm-root-seed-typed-bootstrap-v3
curl --fail --silent --show-error --location   "https://raw.githubusercontent.com/prhmonline/prhm-host-actions/557c35f784000df64aa305f6456efa772ef16659/bootstrap-prhm-root-of-trust-typed-bootstrap-helper-refresh-v3.js"   -o seed.js
printf '%s  %s
' '84f45393a77d55b915f65417146a7d26cbdd795adb63bf0f48e35cd689cc84ec' 'seed.js' | sha256sum -c -
/usr/local/bin/prhm-node --check seed.js
/usr/local/bin/prhm-node seed.js
```

Required seed result: `status: "APPLIED"` or idempotent `status: "ALREADY_APPLIED"`.

## Read-only verification
```bash
sha256sum /opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js
systemctl is-active prhm-agent-selfmaint-exec.service
```
Expected helper SHA: `3f0712fbadeb94d792911419fc71d220c5b135f82510b52b49e6d08ee6199885`

Do not continue to the Level-4 Host Action if the seed reports `FAILED_ROLLED_BACK`, `apply_failed_rollback_failed`, any SHA/metadata/syntax mismatch, or executor-health/action-registration failure.
