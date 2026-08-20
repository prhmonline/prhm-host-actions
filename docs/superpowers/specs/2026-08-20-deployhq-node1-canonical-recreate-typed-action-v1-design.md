# DeployHQ Node1 Canonical Recreate Typed Action V1 — Design

## Status
Approved in chat for design capture; implementation is not yet authorized.

## Problem
The canonical DeployHQ target `PRHM Host Bootstrap - node1` disappeared from the `prhm-host-actions` project while temporary Honartik iTicket targets remained. Direct DeployHQ server-target creation was blocked by policy. The recovery path must therefore use a typed, fixed-scope control-plane action rather than raw shell or a generic connector mutation.

## Action Contract

Action name: `deployhq_node1_canonical_recreate_v1`

Risk: `critical`

Environment: `production`

Level-4 confirmation required: yes.

The action accepts no free-form target configuration. The canonical target is fixed to:

- project: `prhm-host-actions`
- name: `PRHM Host Bootstrap - node1`
- hostname: `185.191.76.138`
- port: `22022`
- username: `root`
- protocol: `ssh`
- server_path: `/root`
- branch/preferred branch: `main`
- auto_deploy: `false`
- SSH-key authentication only

## Safety Boundaries

The action MUST NOT:

- queue or execute any deployment;
- create or execute any DeployHQ SSH command;
- create a config-file deployment;
- mutate/delete/rename temporary Honartik targets;
- mutate active Honartik commands;
- accept arbitrary hostname, username, path, command, token, secret, or credential input;
- print secrets or private keys.

## Precheck

Before mutation the action must:

1. Verify the expected DeployHQ project identity.
2. Read the current server inventory.
3. Snapshot temporary Honartik target identifiers and count.
4. Snapshot deployment count / latest deployment identity sufficient to detect an unexpected deployment side effect.
5. Inspect any existing target named `PRHM Host Bootstrap - node1`.
6. If an exact canonical target already exists, return an idempotent success with `canonical_created=false` and perform no mutation.
7. If the same name exists with any mismatched fixed field, fail closed with `canonical_name_conflict`.
8. Verify the action is not running from a context that permits free-form command execution.

## Apply

If no canonical target exists, create exactly one DeployHQ SSH target using the fixed contract. No other DeployHQ mutation is allowed.

The implementation must record whether this invocation created the target and the returned target identifier so rollback can only affect that newly-created object.

## Verification

Immediately read the created target back and verify all fixed fields:

- name
- hostname
- port
- username
- protocol_type
- server_path
- branch / preferred branch where exposed
- auto_deploy=false

Then verify:

- temporary Honartik target identifiers and count are unchanged;
- no deployment count/identity change attributable to this action occurred;
- no command execution side effect occurred;
- exactly one canonical target exists.

Successful evidence must include:

```text
ok=true
action=deployhq_node1_canonical_recreate_v1
canonical_created=true|false
canonical_identifier=<uuid>
config_match=true
deployment_executed=false
command_executed=false
honartik_targets_mutated=false
rollback_performed=false
```

## Rollback

Rollback is permitted only when all of the following are true:

- this invocation created a new canonical target;
- verification subsequently failed;
- the target identifier to delete exactly equals the identifier returned by this invocation.

Rollback must delete only that newly-created target. It must never delete a pre-existing target or any Honartik target.

If rollback itself fails, persist explicit critical failure evidence with `rollback_failed=true` and do not attempt any broader cleanup.

## Approval and Execution Boundary

The action is registered through the existing Host Action v2 approval system. Creating a request is non-executing. Apply requires a fresh literal `CONFIRM_LEVEL_4_CRITICAL` bound to the specific request. Confirmations are single-use and must not be reused across retries or replacement requests.

## Error Contract

The implementation should fail closed with stable machine-readable errors including at minimum:

- `deployhq_project_mismatch`
- `canonical_name_conflict`
- `deployhq_inventory_unavailable`
- `canonical_create_failed`
- `canonical_readback_failed`
- `canonical_config_mismatch`
- `honartik_targets_changed`
- `unexpected_deployment_side_effect`
- `unexpected_command_side_effect`
- `rollback_failed`

## TDD Acceptance Cases

1. Clean create -> PASS, one canonical target created.
2. Exact canonical duplicate -> idempotent PASS, no mutation.
3. Same name with wrong config -> FAIL_CLOSED.
4. DeployHQ create failure -> FAIL, no rollback unless an identifier was actually returned.
5. Read-back mismatch -> rollback only newly-created target.
6. Rollback failure -> explicit critical failure evidence.
7. TEMP Honartik target set changes during operation -> FAIL and rollback newly-created canonical target when safe.
8. Deployment side effect detected -> FAIL and rollback newly-created canonical target when safe.
9. Command side effect detected -> FAIL and rollback newly-created canonical target when safe.
10. Secret-like fields in evidence -> redacted / omitted.

## Implementation Shape

Preferred artifacts:

- typed action helper for `deployhq_node1_canonical_recreate_v1`;
- bootstrap/registration installer for Base, Executor, approval policy, and MCP schema exposure;
- unit/contract tests covering the acceptance cases;
- preflight mode that performs inventory and contract checks only, with `production_mutation=false`.

The implementation must preserve current iMotion, MCP Blue/Green, and Honartik runtime state. Installing the typed action and executing the action are separate Level-4 gates.

## Out of Scope

- deleting temporary Honartik DeployHQ targets;
- retiring or modifying active Honartik commands;
- running Blue V4 MCP cutover;
- registering iMotion targets;
- changing iMotion or WordPress files;
- changing redirects, canonicals, databases, or application content.

## Amendment: DeployHQ Control Adapter V1

Direct DeployHQ mutation is not available from the host-action runtime and no existing server-side DeployHQ adapter or credential source was found. The typed node1 recreate action therefore MUST call a dedicated localhost-only adapter rather than DeployHQ directly.

### Adapter service

Service name: `prhm-deployhq-control.service`

Listen address: `127.0.0.1` only. No public listener is permitted.

Allowed operations are fixed and closed:

- `GET /v1/node1` — read canonical node1 state plus immutable TEMP Honartik identifiers/count.
- `POST /v1/node1/create-fixed` — create exactly the approved canonical node1 target. No request body may override hostname, username, path, port, branch, protocol or auto-deploy.
- `DELETE /v1/node1/:identifier` — permitted only when the identifier equals the adapter's same-request created identifier supplied through the typed host-action rollback journal. Arbitrary deletes are forbidden.
- `GET /health` — reports readiness without exposing credentials.

Any other method/path returns fail-closed. There is no raw URL, raw API path, generic proxy, arbitrary JSON payload, deployment endpoint, SSH-command endpoint, config-file endpoint, or server mutation primitive.

### Credential boundary

The DeployHQ credential MUST NOT exist in Git, chat, action requests, logs, persisted result JSON, environment dumps, command lines, or helper arguments. The service consumes a systemd credential named `deployhq_token` from `${CREDENTIALS_DIRECTORY}/deployhq_token`. The unit uses `LoadCredential=deployhq_token:<root-only-source>` and the bootstrap only verifies source metadata/presence; it never prints or copies the token into repository content.

Permitted credential evidence is limited to:

- `credential_present=true|false`
- byte length
- short SHA-256 fingerprint (maximum 12 hex characters)

The source credential provisioning itself is a separate Level-4 gate if the source is absent. Installing code or the service MUST NOT fabricate a credential.

### Adapter hardening

The service MUST run as a dedicated unprivileged account when feasible, with `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, an explicit writable state directory only, and no shell execution. Outbound network is limited by application code to the fixed DeployHQ API origin.

### Adapter API behavior

The adapter validates the expected DeployHQ project `prhm-host-actions`, snapshots TEMP Honartik target identifiers/count, and exposes only redacted normalized server fields. It rejects same-name wrong-config canonical targets with `canonical_name_conflict`. Exact canonical duplicates are idempotent reads and are never recreated.

Create-fixed performs exactly one server-target create using the fixed contract. It MUST NOT queue a deployment or create/execute a command. Read-back is mandatory.

### Host Action boundary

`deployhq_node1_canonical_recreate_v1` talks only to `http://127.0.0.1:<fixed-port>` and never receives the DeployHQ credential. The host action remains Level-4 critical. Installation of the adapter and execution of the recreate action are separate Level-4 gates.

### Additional TDD acceptance cases

11. Unknown adapter route/method -> 404/405 fail-closed, no outbound call.
12. Request body attempts to override fixed node1 fields -> 400 fail-closed, no outbound mutation.
13. Missing systemd credential -> health not-ready / mutation disabled; secret not requested from the caller.
14. Credential value appears in thrown upstream error -> redacted before logs/evidence.
15. DeployHQ response contains unexpected secret-like fields -> omitted/redacted from normalized adapter output.
16. Adapter binds non-loopback address -> startup failure.
17. Host action attempts direct DeployHQ access -> contract test failure.

### Revised implementation boundary

The work is split into two independently testable subsystems:

1. DeployHQ Control Adapter V1: core client, fixed routes, redaction, systemd unit/bootstrap and credential-presence preflight.
2. Node1 Canonical Recreate Typed Action V1: Host Action v2 helper/registration using only the localhost adapter.

No production installation, credential provisioning, adapter start/restart, or node1 recreation is authorized by this design amendment itself.

