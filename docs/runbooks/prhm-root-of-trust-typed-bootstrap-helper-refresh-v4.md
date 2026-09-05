# PRHM Root-of-Trust Typed-Bootstrap Helper Refresh V4 — Provider Console Runbook

Artifact commit: `1d556a4b40a63a57b2d4c823a58b9399f481d746`

Artifact SHA-256: `096c53f9da28e2dccef82da5200e9341e4fc2c67576259c95a0b7b0ee35d5584`

Target helper preimage SHA-256: `3f0712fbadeb94d792911419fc71d220c5b135f82510b52b49e6d08ee6199885`

Target helper final SHA-256: `1a789eb89edfdeb15ddf7c645dd34b33cbe8af35ec9469b015fba94635742f8e`

## Trust boundary
Run only from the provider/VM console as root. Do not run through Agent API, MCP, self-maintenance, Host Actions, DeployHQ, GitHub Actions, or an SSH deployment credential.

## Scope
This seed mutates exactly one file: `/opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js`. No service restart, policy, registry, database, iMotion, Honartik, or DrTarjomeh mutation is permitted.

## Execute
```bash
set -euo pipefail
install -d -m 0700 /root/prhm-root-seed-typed-bootstrap-v4
cd /root/prhm-root-seed-typed-bootstrap-v4
curl --fail --silent --show-error --location \
  "https://raw.githubusercontent.com/prhmonline/prhm-host-actions/1d556a4b40a63a57b2d4c823a58b9399f481d746/bootstrap-prhm-root-of-trust-typed-bootstrap-helper-refresh-v4.js" \
  -o seed.js
printf '%s  %s\n' '096c53f9da28e2dccef82da5200e9341e4fc2c67576259c95a0b7b0ee35d5584' 'seed.js' | sha256sum -c -
/usr/local/bin/prhm-node --check seed.js
/usr/local/bin/prhm-node seed.js
sha256sum /opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js
systemctl is-active prhm-agent-selfmaint-exec.service
```

Expected success is `APPLIED` or `ALREADY_APPLIED`, rollback false, final SHA exactly `1a789eb89edfdeb15ddf7c645dd34b33cbe8af35ec9469b015fba94635742f8e`, and executor service `active`.
