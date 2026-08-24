# PRHM Host Actions GitHub Fixed Deployment Channel Design

## Status
Approved by `SPEC_APPROVED_PRHM_HOST_ACTIONS_GITHUB_FIXED_DEPLOYMENT_CHANNEL_V1` on 2026-08-24.

## Goal
Add a narrowly scoped external delivery channel that can bootstrap one fixed, immutable Host Actions control-plane artifact when the existing in-band Agent 2 control plane cannot safely install its own promotion surface.

This design creates no generic deployment shell, no arbitrary command runner, no arbitrary file writer, and no replacement for the existing Level-4 approval flow.

## Context
The current control-plane executor is healthy and exposes `root_scripts_fixed_stage_v1`, but the live helper is bound to the wrong landing path. The already-verified replacement candidate is:

- source: `agent_api/root-stage-fixed-v1.candidate.txt`
- source SHA-256: `22181213d9c6a1b5982778530a9b674782f6de023e6ed75f915366f995eb5bd8`
- target: `/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js`
- expected current target SHA-256: `50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee`

The in-band promotion action `root_scripts_fixed_stage_promotion_v1` is not currently registered. DeployHQ is unavailable because the connected account is suspended for a payment issue. The repository currently has no GitHub Actions workflow, webhook, repository Actions variable, or repository Actions secret suitable for deployment.

## Chosen Architecture
Use a GitHub-hosted runner plus a dedicated SSH principal on the control-plane host whose `authorized_keys` entry is restricted to one fixed forced command.

GitHub is transport only. It does not receive a root shell and it does not become an approval authority.

The server-side forced command executes a fixed dispatcher that recognizes only the immutable bootstrap action defined by this specification. The dispatcher accepts no arbitrary path, command, content, destination, SHA, service name, SQL, host, or environment input.

### SSH restrictions
The dedicated key entry must include all of the following restrictions:

- `no-port-forwarding`
- `no-agent-forwarding`
- `no-X11-forwarding`
- `no-pty`
- `command="<fixed bootstrap dispatcher>"`

The principal must not provide an interactive shell.

## Workflow Surface
The first version of the workflow should be zero-input whenever technically possible. If GitHub requires an input for future extensibility, that input must be an enum and the initial allowlist must contain only:

`root_scripts_fixed_stage_promotion_v1`

The workflow must not accept caller-provided path, content, source SHA, target SHA, command, host, username, service, token, database, SQL, or arbitrary JSON.

GitHub Actions permissions must be minimized. The initial workflow requires at most `contents: read`. It must not enable `contents: write`, `packages: write`, `id-token: write`, or other write scopes unless a later approved design proves a requirement.

The workflow must execute from an immutable commit SHA or signed release reference. A mutable `main` tip must never be treated as the production bootstrap artifact identity.

## Fixed Promotion Contract
The first fixed operation is `root_scripts_fixed_stage_promotion_v1`.

The dispatcher is hard-bound server-side to:

- source identity: `agent_api/root-stage-fixed-v1.candidate.txt`
- source SHA-256: `22181213d9c6a1b5982778530a9b674782f6de023e6ed75f915366f995eb5bd8`
- target path: `/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js`
- expected target preimage SHA-256: `50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee`
- arbitrary path: false
- arbitrary command: false
- external network from dispatcher: false
- database mutation: false
- DrTarjomeh application mutation: false

The workflow must not be able to override any of those values.

## Preflight
Before the first mutation, the dispatcher must verify all of the following:

1. Host identity equals the expected control-plane host identity.
2. Source exists as a regular file and is not a symbolic link.
3. Source SHA-256 equals the fixed source SHA.
4. Target exists as a regular file and is not a symbolic link.
5. Target SHA-256 equals the fixed expected preimage SHA.
6. The candidate passes `/usr/local/bin/prhm-node --check`.
7. The self-maintenance executor is healthy before mutation.
8. No unexpected caller arguments are present.

Any mismatch fails closed before mutation.

## Apply Sequence
After successful preflight:

1. Create an exact timestamped backup of the current target with restrictive permissions.
2. Write the candidate to a sibling temporary file using exclusive creation.
3. Preserve the intended mode and ownership.
4. `fsync` the temporary file.
5. Atomically rename the temporary file over the target.
6. `fsync` the containing directory.
7. Verify the installed target SHA equals `22181213d9c6a1b5982778530a9b674782f6de023e6ed75f915366f995eb5bd8`.
8. Run `/usr/local/bin/prhm-node --check` against the installed target.
9. Restart only the service required to load the changed helper, if a restart is actually required by the runtime architecture.
10. Verify `prhm-agent-selfmaint-exec` health.
11. Verify `root_scripts_fixed_stage_v1` remains present in the executor action list.
12. Verify the live helper now contains landing `/home/agent/ssh-agent-runtime/root-stage-v1`.
13. Persist a sanitized result containing before/after SHA, backup location identifier, verification status, and rollback status, with no secret material.

## Rollback
Rollback is automatic after the first mutation if any later verification fails.

Rollback must:

1. Restore the exact preimage backup atomically.
2. Verify the restored SHA equals `50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee`.
3. Restore service state if a restart occurred.
4. Re-run executor health verification.
5. Return `FAILED_ROLLED_BACK` only after restored health is confirmed.

If rollback itself cannot be verified, the result must explicitly report rollback failure and must never claim success.

## Approval Boundary
GitHub deployment does not replace the PRHM approval system.

The GitHub channel only installs the fixed promotion capability. After the tool becomes visible in a fresh Agent 2 schema, any critical control-plane action must continue to use the existing sequence:

`host_action_v2_request` -> explicit `CONFIRM_LEVEL_4_CRITICAL` -> `host_action_v2_apply`

Existing approval expiry, request binding, one-time consumption, signature validation, and replay protection remain unchanged.

## Credential Boundary
The GitHub repository secret may contain only the credential required by this fixed SSH transport. Secret values must never be printed, persisted in artifacts, echoed in shell tracing, or returned by the dispatcher.

The SSH principal must be dedicated to this channel and must not reuse a broad administrative key unless a later evidence-backed review proves that reuse is equally constrained.

Creating the SSH principal, forced-command entry, and repository secret is an implementation-stage security mutation and requires its own explicit execution gate. This design document does not authorize that mutation by itself.

## Rejected Alternatives
### Self-hosted GitHub runner
Rejected for the initial design because it creates a persistent GitHub-controlled process inside the sensitive control-plane environment and materially expands the trust boundary.

### Webhook/API pull model
Rejected for the initial bootstrap because it requires adding a new authenticated endpoint and verification code to the Agent API before the channel exists, recreating the current bootstrap paradox.

### Generic SSH or generic file write
Explicitly prohibited. No arbitrary root shell, `ssh command`, generic upload, generic `ops_execute access=write`, generic `safe_file_write`, or caller-selected destination is part of this design.

## TDD RED Matrix
The implementation must first demonstrate failing tests for:

- unknown action -> deny
- unexpected input -> deny
- source SHA mismatch -> deny before mutation
- target SHA mismatch -> deny before mutation
- source symlink -> deny
- target symlink -> deny
- wrong host identity -> deny
- candidate syntax failure -> deny
- missing baseline health -> deny
- second execution after successful one-time promotion -> deny or explicit `already_applied` with no mutation
- injected post-write verification failure -> rollback path exercised
- attempted interactive SSH shell -> deny
- attempted port/agent/X11 forwarding -> deny by SSH options

## TDD GREEN Matrix
Passing tests must prove:

- exact expected source and exact expected target preimage are accepted
- backup is created before replacement
- replacement is atomic
- final SHA is exact
- arbitrary path and arbitrary command remain impossible
- no production application or database path is touched
- injected post-write failure restores the exact preimage
- rollback SHA and executor health are verified
- workflow has no arbitrary deployment inputs
- workflow secret values are never logged
- fixed SSH principal cannot start an interactive shell
- only the fixed dispatcher can execute through the key

## Integration Acceptance
Before any production bootstrap is permitted:

1. Unit/TDD suite is green.
2. Workflow YAML passes static review for minimal permissions and fixed inputs.
3. Server-side dispatcher passes syntax tests and fixture tests without root mutation.
4. Forced-command behavior is proven in a non-destructive test path.
5. Repository secret metadata exists without exposing its value.
6. A dry/preflight invocation proves all production baseline hashes without writing.
7. An explicit execution gate authorizes creation of the trust anchor and first fixed promotion.

## Scope Guard
This project may modify only the GitHub deployment-channel assets and the control-plane registration/dispatcher assets required for this fixed bootstrap.

It must not modify:

- DrTarjomeh production application files
- DrTarjomeh databases
- payment configuration
- SMS/email configuration
- unrelated Host Actions
- unrelated SSH accounts or authorized keys
- unrelated GitHub repositories

No DrTarjomeh staging clone is executed by this design.

## Success Criteria
This design is successful when a fresh, evidence-backed external path exists that can install only the fixed `root_scripts_fixed_stage_promotion_v1` capability, with immutable artifact binding, constrained SSH execution, minimized GitHub permissions, exact SHA verification, automatic rollback, and no weakening of the existing Level-4 approval model.

Implementation remains a separate gate.