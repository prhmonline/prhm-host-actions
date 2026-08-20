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
