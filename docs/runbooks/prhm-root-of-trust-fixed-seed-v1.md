# PRHM Root-of-Trust Fixed Seed V1 — Provider Console Runbook

Artifact commit: `2486de0eb11a5dbde5b4a07bf0f7c8d7058eb5e2`

Artifact SHA-256: `93c10ad47c28bc0894b283d0251b96d7a6e00ca9cd46157438116829f240469a`

## Trust boundary

Run this only from the provider/VM console as root. Do not run it through Agent API, MCP, self-maintenance, Host Actions, DeployHQ, GitHub Actions, or an SSH deployment credential.

## Stop conditions

Stop immediately if artifact SHA verification fails, the seed reports baseline mismatch, transport-helper mismatch, symlink rejection, candidate syntax failure, service-health failure, or `FAILED_ROLLBACK_INCOMPLETE`. The transport action itself is not executed in this Gate.

```bash
set -euo pipefail
install -d -m 0700 /root/prhm-root-seed-v1
cd /root/prhm-root-seed-v1
curl --fail --silent --show-error --location "https://raw.githubusercontent.com/prhmonline/prhm-host-actions/2486de0eb11a5dbde5b4a07bf0f7c8d7058eb5e2/bootstrap-prhm-root-of-trust-fixed-seed-v1.js" -o seed.js
printf '%s  %s\n' '93c10ad47c28bc0894b283d0251b96d7a6e00ca9cd46157438116829f240469a' 'seed.js' | sha256sum -c -
/usr/local/bin/prhm-node --check seed.js
/usr/local/bin/prhm-node seed.js

# Read-only post-install evidence
sha256sum /opt/prhm-agent-selfmaint/server.js
sha256sum /opt/prhm-agent-selfmaint-exec/server.js
sha256sum /opt/prhm-company-control-plane/config/approval-policy.json
systemctl is-active prhm-agent-selfmaint.service
systemctl is-active prhm-agent-selfmaint-exec.service
```
