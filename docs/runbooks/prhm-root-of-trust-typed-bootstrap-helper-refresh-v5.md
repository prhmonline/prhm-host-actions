# PRHM Root-of-Trust Typed-Bootstrap Helper Refresh V5 — Provider Console Runbook

Artifact commit: `43484503a7164de95df642576d26a9e802f4a740`

Artifact SHA-256: `33fd550e4ee0907c84e8071e75c35b06805c0a0c209c102ca9e1ad5f67da7e6c`

Expected live preimage SHA-256: `1a789eb89edfdeb15ddf7c645dd34b33cbe8af35ec9469b015fba94635742f8e`

Expected installed helper SHA-256: `c29846353a4f6e1bdff04cdc213e4db062238e418da6db5a276fb56188939618`

## Trust boundary

Run this only from the provider/VM console as root. Do not run it through Agent API, MCP, self-maintenance, Host Actions, DeployHQ, GitHub Actions, or an SSH deployment credential.

## Stop conditions

Stop immediately on artifact SHA mismatch, target preimage mismatch, symlink/mode/owner mismatch, syntax failure, executor-health failure, or rollback verification failure.

```bash
set -euo pipefail
install -d -m 0700 /root/prhm-root-seed-typed-bootstrap-v5
cd /root/prhm-root-seed-typed-bootstrap-v5
curl --fail --silent --show-error --location "https://raw.githubusercontent.com/prhmonline/prhm-host-actions/43484503a7164de95df642576d26a9e802f4a740/bootstrap-prhm-root-of-trust-typed-bootstrap-helper-refresh-v5.js" -o seed.js
printf '%s  %s\n' '33fd550e4ee0907c84e8071e75c35b06805c0a0c209c102ca9e1ad5f67da7e6c' 'seed.js' | sha256sum -c -
/usr/local/bin/prhm-node --check seed.js
/usr/local/bin/prhm-node seed.js
sha256sum /opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js
systemctl is-active prhm-agent-selfmaint-exec.service
```

Success requires `APPLIED` or `ALREADY_APPLIED`, exact final helper SHA `c29846353a4f6e1bdff04cdc213e4db062238e418da6db5a276fb56188939618`, executor active, and rollback_performed=false for a fresh apply.
