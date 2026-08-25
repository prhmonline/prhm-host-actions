# PRHM Root-of-Trust Fixed Seed V1 — Provider Console Runbook

Artifact commit: `fddfb5b12fdcdab7661f1bb25537b77f8f1e1144`

Artifact SHA-256: `049dfc79f796fc47bcf156d3f1d44b09a35f6dc45e6538067ae9b5b2cd706805`

## Trust boundary

Run this only from the provider/VM console as root. Do not run it through Agent API, MCP, self-maintenance, Host Actions, DeployHQ, GitHub Actions, or an SSH deployment credential.

## Stop conditions

Stop immediately if artifact SHA verification fails, the seed reports baseline mismatch, transport-helper mismatch, symlink rejection, candidate syntax failure, service-health failure, or `FAILED_ROLLBACK_INCOMPLETE`. The transport action itself is not executed in this Gate.

```bash
set -euo pipefail
install -d -m 0700 /root/prhm-root-seed-v1
cd /root/prhm-root-seed-v1
curl --fail --silent --show-error --location "https://raw.githubusercontent.com/prhmonline/prhm-host-actions/fddfb5b12fdcdab7661f1bb25537b77f8f1e1144/bootstrap-prhm-root-of-trust-fixed-seed-v1.js" -o seed.js
printf '%s  %s\n' '049dfc79f796fc47bcf156d3f1d44b09a35f6dc45e6538067ae9b5b2cd706805' 'seed.js' | sha256sum -c -
/usr/local/bin/prhm-node --check seed.js
/usr/local/bin/prhm-node seed.js

# Read-only post-install evidence
sha256sum /opt/prhm-agent-selfmaint/server.js
sha256sum /opt/prhm-agent-selfmaint-exec/server.js
sha256sum /opt/prhm-company-control-plane/config/approval-policy.json
systemctl is-active prhm-agent-selfmaint.service
systemctl is-active prhm-agent-selfmaint-exec.service
```
