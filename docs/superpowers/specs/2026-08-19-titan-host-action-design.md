# Titan Production Host Action Design

## Status
Approved by `SPEC_APPROVED_TITAN_HOST_ACTION_V1` on 2026-08-19.

## Goal
Add one fixed Level-4 control-plane action named `titan_staged_production_finalize_v1` that safely provisions Titan HTTPS on the existing PRHM edge without merging application PRs, running database migrations, sending real payments/SMS, or mutating unrelated projects.

## Production Scope
The action is hard-bound to these hostnames only:

- `titanfitness-club.com`
- `www.titanfitness-club.com`
- `admin.titanfitness-club.com`

The existing HTTP route to production VM `10.71.0.118:80` remains the upstream target. No arbitrary hostname, path, command, IP, service, certificate name, or user input is accepted.

## Preconditions
The action fails closed unless all of the following are true before mutation:

1. `prhm-edge-nginx.service` is active.
2. Nginx config is exactly `/etc/nginx/nginx.phase7b.conf`.
3. Existing Titan HTTP server block contains only the approved Titan hostnames and proxies to `10.71.0.118:80`.
4. ACME webroot `/var/www/prhm-acme` exists and is not a symlink.
5. `/usr/local/sbin/prhm-certbot-ipv4`, `/usr/bin/certbot`, `/usr/sbin/nginx`, and `systemctl` exist.
6. Existing edge config and certificate state can be snapshotted before first mutation.
7. No unexpected pre-existing Titan certificate lineage or certificate/key file exists unless it validates as the exact approved hostname set.

Any ambiguous or conflicting state returns a failed result without mutation.

## Mutation Sequence

1. Acquire an action-specific filesystem lock.
2. Capture a timestamped rollback snapshot of:
   - `/etc/nginx/nginx.phase7b.conf`
   - Titan certificate/key files if present
   - Titan Certbot renewal lineage if present
   - current edge service state metadata
3. Ensure HTTP ACME challenge routing for the three Titan hostnames remains reachable through `/var/www/prhm-acme/.well-known/acme-challenge/`.
4. Issue or reuse a Let's Encrypt certificate whose SAN set contains exactly the three approved Titan names.
5. Install certificate and key at:
   - `/etc/nginx/certs/titan/titanfitness-club.com.cert.combined`
   - `/etc/nginx/certs/titan/titanfitness-club.com.key`
6. Add one HTTPS Nginx server block on `8443 ssl http2` for the approved Titan names, proxying to `10.71.0.118:80` with normal forwarded headers.
7. Extend the PRHM certificate deployment/renewal path additively so Titan certificate renewal copies the renewed certificate/key into the same edge paths without changing other certificate mappings.
8. Run `/usr/sbin/nginx -t -c /etc/nginx/nginx.phase7b.conf`.
9. Only after a successful config test, send a HUP to the main process of `prhm-edge-nginx.service`.
10. Verify local edge TLS for all three hostnames, certificate hostname matching, issuer, SAN coverage, and upstream HTTP response.
11. Persist a sanitized result containing PASS/FAIL, certificate fingerprint, expiry, hostname verification, config verification, and rollback status. Never persist certificate private-key material.

## Rollback
Rollback is automatic after the first mutation if any later verification fails.

Rollback restores the exact pre-action Nginx config and prior Titan certificate/renewal files, removes only files that the action created when they did not exist before, runs `nginx -t`, and reloads the edge only if the restored config validates. The result must distinguish `FAILED_ROLLED_BACK` from `FAILED_ROLLBACK_INCOMPLETE`.

The action must not delete or alter any non-Titan certificate lineage or certificate mapping.

## Approval and Replay Protection

- The public MCP surface exposes the action only through `host_action_v2_request`.
- Execution requires the existing `host_action_v2_apply` flow and literal `CONFIRM_LEVEL_4_CRITICAL` second confirmation.
- Existing approval expiry, signature binding, one-time consumption, and replay protection remain unchanged.
- The action accepts no request arguments beyond its fixed enum value.

## Bootstrap Strategy
The bootstrap must be additive against the currently installed Host Actions runtime. It must first fingerprint the live base server, executor, MCP plugin, and approval policy and refuse to patch an unknown baseline.

Because the repository's historical bootstrap files can lag the live runtime, this change must not replace current runtime files with an older bundled version. The bootstrap may patch only the exact current baseline discovered and reviewed for this release.

## Verification Gates

### Static
- Node syntax checks pass for helper and bootstrap.
- Fixed hostname set appears exactly where expected.
- No arbitrary shell/command/hostname parameters are introduced.
- Action enum is present in request schema and executor allowlist.
- Approval policy marks the action Level-4.
- Secret scan finds no private keys, API keys, Authorization headers, or embedded credentials.

### Controlled runtime
Before Production apply, verify in request/status flow that:

- a request can be created for `titan_staged_production_finalize_v1`;
- it cannot be applied without Level-4 confirmation;
- a consumed request cannot be replayed;
- status persists verification evidence.

### Production success
Success requires all of:

- `nginx -t` PASS;
- `prhm-edge-nginx.service` active;
- all three Titan hostnames negotiate TLS with a hostname-valid certificate;
- certificate SAN includes the exact three approved Titan hostnames;
- frontend root and admin login path reach the Titan applications rather than a default webserver body;
- unrelated edge hostnames remain healthy in bounded regression probes.

## Explicit Non-Goals
This action does not:

- merge `prhmonline/titan-front` PR #1 or `prhmonline/titan-back` PR #1;
- deploy or build Titan application code;
- run Yii migrations;
- rotate SMTP/SMS/payment credentials;
- send real SMS or payment requests;
- alter DNS;
- change HAProxy routing unless a separately reviewed finding proves it necessary;
- modify any project other than Titan-specific edge/TLS configuration and the Host Actions control-plane registration required to expose this fixed action.

## Handoff Gate
After this action is installed and its schema is visible in a fresh connector session, Production execution remains a separate Level-4 apply step. Application migration/UAT and PR merge stay behind subsequent release gates.
