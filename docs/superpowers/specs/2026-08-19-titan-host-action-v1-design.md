# Titan Staged Production Finalize Host Action V1 — Design

## Goal
Add one fixed, no-input, Level-4 Host Action named `titan_staged_production_finalize_v1` for safely provisioning Titan production TLS/HTTPS edge routing with snapshot-first execution, validation, smoke verification, and automatic rollback.

## Scope
The action is hard-bound to exactly these hostnames:
- `titanfitness-club.com`
- `www.titanfitness-club.com`
- `admin.titanfitness-club.com`

The action may modify only Titan-related Edge TLS/vhost state and the minimal control-plane registry/schema required to expose the action.

## Non-goals
The action must not:
- merge `titan-front` or `titan-back` pull requests;
- run Titan database migrations;
- rotate application SMTP/SMS/payment secrets;
- perform real payment or SMS transactions;
- modify unrelated projects, certificates, vhosts, backends, or renewal mappings;
- expose arbitrary hostnames, paths, shell commands, service names, or secret input.

## Safety model
1. Fixed allowlisted action only; no user-controlled command/path/hostname arguments.
2. Level-4 request/apply approval flow remains mandatory.
3. Before the first mutation, capture rollback material for every Titan-related Edge file that may change, plus enough metadata to restore absence/presence exactly.
4. Preflight must fail closed if DNS/ACME reachability, expected Edge service identity, backend reachability, filesystem guards, or existing configuration assumptions do not match the known topology.
5. TLS issuance is limited to the three fixed Titan names and uses the existing PRHM ACME/webroot pattern.
6. Generated certificate/key deployment is Titan-scoped; no existing certificate lineage may be overwritten unless it is the Titan lineage created by this action.
7. Add an HTTPS `8443 ssl http2` Titan server block while preserving the existing HTTP `8080` Titan block and unrelated routing.
8. Run `nginx -t -c /etc/nginx/nginx.phase7b.conf` before any reload.
9. Reload only `prhm-edge-nginx.service` via controlled HUP after config validation passes.
10. Verify certificate SAN coverage, local SNI response, public HTTPS response, frontend root smoke, and admin `/login` smoke.
11. Any failure after mutation triggers automatic rollback to the captured Titan-scoped state, followed by config validation and controlled reload if required.
12. Output must redact secrets/private keys and return only bounded verification evidence, PASS/FAIL markers, fingerprints/hashes where useful, and rollback outcome.

## Expected execution phases
### Phase A — Read-only preflight
- confirm Node1 Edge identity and active `prhm-edge-nginx.service`;
- confirm fixed Nginx config path;
- confirm the current Titan HTTP vhost exists and proxies to the expected production VM path already established by the live audit;
- confirm Titan HTTPS certificate/key are absent or, if present on a retry, match the fixed Titan lineage/state expected by the action;
- verify ACME challenge webroot and hostname reachability for the fixed names;
- verify backend HTTP reachability before exposing HTTPS.

### Phase B — Snapshot
Capture Titan-scoped copies/metadata for:
- Nginx Edge config;
- Titan certificate/key deployment paths;
- Titan Certbot lineage/renewal state if present;
- Titan-related deploy-script mapping if the action adds renewal deployment wiring.

The snapshot must distinguish “file absent before run” from “file existed before run” so rollback can restore exact prior state.

### Phase C — Provision TLS
Issue or reuse a valid Let’s Encrypt certificate whose SAN set covers exactly the required Titan names. Deploy the public certificate and private key into Titan-specific Edge paths with restrictive permissions. Do not print key material.

### Phase D — Configure HTTPS
Add the Titan HTTPS server block on 8443, referencing only Titan certificate paths and proxying to the same verified Titan backend target as the HTTP vhost. Preserve ACME handling and all unrelated server blocks.

### Phase E — Validate and reload
Run Nginx syntax/config validation. Only on PASS send controlled HUP to `prhm-edge-nginx.service`.

### Phase F — Verify
Require all of:
- local SNI certificate hostname validation PASS;
- SAN coverage PASS for the fixed names;
- public HTTPS root for `titanfitness-club.com` reaches the Titan frontend rather than default-server content;
- public HTTPS `/login` for `admin.titanfitness-club.com` reaches the Yii application route rather than webserver-level 404/default content;
- HTTP behavior remains intentional and ACME path remains reachable;
- unrelated representative Edge host smoke remains PASS.

### Phase G — Rollback on failure
If any post-mutation gate fails, restore the exact Titan-scoped snapshot, validate Nginx, reload if required, and verify the prior state. Report the original failure and rollback PASS/FAIL separately.

## Control-plane exposure
Register `titan_staged_production_finalize_v1` in the fixed Host Actions v2 action enum and executor registry. The request accepts only the action name. The apply endpoint consumes the request id plus the standard `CONFIRM_LEVEL_4_CRITICAL` second confirmation. No new arbitrary parameters are permitted.

## Acceptance criteria
- schema exposes the new fixed enum value;
- request creation succeeds only for the fixed action;
- dry/static tests prove no arbitrary host/path/command input exists;
- failure-path tests prove rollback is invoked after every mutation-stage failure;
- Nginx config must validate before reload;
- no secrets are emitted;
- existing Host Actions regression suite remains green;
- production execution is not part of code bootstrap itself and occurs only through the normal Level-4 request/apply flow after rollout.

## Release sequencing
1. implement and test the control-plane bootstrap in isolation;
2. review exact diff and regression results;
3. deploy the new control-plane schema/executor through the established bootstrap path;
4. verify a fresh ChatGPT/MCP schema sees the new enum;
5. create a Level-4 request for `titan_staged_production_finalize_v1`;
6. apply only after the standard second confirmation;
7. inspect verification evidence before moving to Titan migration/UAT/merge gates.
