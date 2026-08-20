# Honartik iTicket V14 Read-Only Preflight Adapter — Design

Date: 2026-08-20
Status: Design review
Base repository: `prhmonline/prhm-host-actions`
Base commit: `1ecd932451d7464e354419b67f2c605d93135854`
Related Host Action: `honartik_iticket_dark_backend_batch1_v1`
Related bootstrap: `bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js`

## Problem

Bootstrap V14 already implements the correct `preflight()` logic for the Honartik iTicket dark backend Batch 1 installation, but there is no safe live entrypoint that can execute only that preflight against the current production Control Plane and isolated Honartik worktrees.

DeployHQ must not be used as the preflight executor. A DeployHQ API `mode=preview` request was observed to create and start a deployment record rather than behaving as a guaranteed dry-run. The attempt failed and post-checks confirmed the four Control Plane baseline files and Honartik production HEADs remained unchanged, but the preview semantics are not suitable as the safety boundary for future preflight execution.

## Goal

Add a fixed, zero-input, read-only Agent/MCP tool named:

`honartik_iticket_v14_preflight_readonly`

The tool executes the existing V14 preflight logic only and returns bounded JSON evidence. It must not expose an arbitrary command, path, ref, file, host, environment, token, or argument surface.

## Non-goals

- Do not install `honartik_iticket_dark_backend_batch1_v1`.
- Do not modify Honartik application files or worktrees.
- Do not restart or reload Honartik services.
- Do not modify the database.
- Do not read a real iTicket token.
- Do not make an outbound iTicket API request.
- Do not create a Level-4 approval request merely to run preflight.
- Do not duplicate the V14 preflight validation logic in a second independent implementation.

## Chosen architecture

Use a three-part read-only adapter:

1. A SHA-bound copy of the merged V14 bootstrap is installed as a read-only preflight payload under a dedicated Control Plane read-only-actions directory.
2. A fixed Agent API route executes that payload with only `--preflight-only` and parses/validates its JSON result.
3. A zero-input MCP tool calls that fixed Agent API route and returns the bounded result.

The adapter does not add the iTicket action to the Host Actions v2 action enum, Executor action registry, or approval policy. Those remain part of the later V14 installation gate.

## Why this approach

### Rejected: duplicate preflight logic

Reimplementing baseline/worktree/helper verification in a new route would create two sources of truth and allow the installer preflight and exposed preflight to drift.

### Rejected: generic read-only command endpoint

A generic command/path input would increase the attack surface and would weaken the existing fixed-tool security model.

### Rejected: DeployHQ as preflight runner

DeployHQ remains acceptable as a one-time transport for installing the adapter itself, but must not be relied on as the runtime preflight safety boundary.

### Selected: fixed SHA-bound adapter

This preserves the V14 bootstrap as the single source of truth while exposing only one fixed operation with zero caller-controlled execution parameters.

## One-time adapter installation

The adapter itself requires one controlled installation because it does not yet exist on the live Agent.

That installation must be delivered from this repository through the existing versioned host-bootstrap path. DeployHQ may transport and execute the installer only as an explicit real installation step; `preview` mode must not be treated as a dry-run.

The adapter installer is separate from Bootstrap V14 and must not install or register `honartik_iticket_dark_backend_batch1_v1`.

Expected adapter installer mutation scope is limited to:

- the fixed read-only preflight payload file;
- the Agent API fixed route/handler binding required to expose it;
- the MCP fixed zero-input tool binding required to call the Agent API route.

The exact live files must be discovered and SHA-pinned during implementation preflight; implementation must fail closed if the expected wrapper/module anchors have changed.

No Approval Policy mutation is required for the read-only tool.
No Host Actions Base/Executor action-registration mutation is required for the read-only tool.

## Runtime execution contract

The exposed MCP tool accepts no arguments.

The Agent API handler runs only the fixed payload with:

`--preflight-only`

The payload SHA must equal the SHA of the merged `bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js` at the pinned source commit used by the adapter installer.

The handler rejects the result unless all required fields and safety flags match the contract.

## Required preflight checks

The existing V14 `preflight()` remains authoritative and must verify at least:

- hostname is the expected production host;
- Base Control Plane SHA matches the V14 baseline;
- Executor SHA matches the V14 baseline;
- MCP Host Actions v2 plugin SHA matches the V14 baseline;
- Approval Policy SHA matches the V14 baseline;
- frontend isolated worktree exists;
- backend isolated worktree exists;
- frontend worktree branch is exactly `feature/iticket-dark-v1`;
- backend worktree branch is exactly `feature/iticket-dark-v1`;
- frontend worktree HEAD is exactly `ecd3bfce8790b5cb3d32afbfbf45bc39839dba62`;
- backend worktree HEAD is exactly `54d8038a64ce64e78c84dfeaffbb4cca36446108`;
- both isolated worktrees are clean;
- production source HEADs remain bound to those expected commits;
- embedded Batch 1 payload hashes are valid;
- V14 helper SHA is valid;
- Batch 1 target files are absent before installation.

## Required output contract

Success must be bounded to a JSON object equivalent to:

```json
{
  "ok": true,
  "schema_version": "prhm.host-action-install-preflight.v1",
  "action": "honartik_iticket_dark_backend_batch1_v1",
  "preflight_only": true,
  "baseline_match": true,
  "control_plane_mutation": false,
  "production_mutation": false,
  "production_application_tree_mutation": false,
  "database_mutation": false,
  "deploy": false,
  "external_network": false,
  "token_read": false
}
```

The adapter may add bounded identity/fingerprint fields such as payload SHA, version, worktree HEAD, and branch. It must not return file contents, environment values, credentials, Authorization headers, iTicket access tokens, or arbitrary command output.

## Fail-closed behavior

Any of the following must cause a non-success result with no fallback mutation:

- payload SHA mismatch;
- unexpected Agent/API/MCP baseline during adapter installation;
- missing V14 payload;
- V14 preflight process non-zero exit;
- malformed JSON;
- missing required safety fields;
- any safety field indicating mutation/network/token activity;
- V14 baseline mismatch;
- worktree dirty/missing/wrong branch/wrong HEAD;
- Batch 1 target already present.

No automatic attempt to repair any failed preflight condition is allowed.

## Process isolation

The read-only runner must use an execution sandbox appropriate for read-only inspection. It must not receive writable access to the Honartik application/worktree trees or Control Plane configuration files.

Outbound network access must be blocked. The V14 preflight does not require network access.

The only returned data is the validated bounded JSON result.

## Testing strategy

Implementation must use TDD and include:

1. RED: tool/route/payload adapter absent.
2. Unit tests for zero-input schema and exact fixed route.
3. Tests that arbitrary args/path/command fields are impossible.
4. Tests that the runner always appends or enforces `--preflight-only`.
5. Tests that payload SHA drift fails closed.
6. Tests that malformed/non-zero preflight results fail closed.
7. Tests that any mutation/network/token flag set to true fails closed.
8. Regression test that the embedded/read-only payload bytes match the pinned merged V14 bootstrap bytes.
9. Syntax checks for all changed Node.js files.
10. Live post-install schema check proving the new read-only tool appears without registering the iTicket mutation action.

## Installation verification

After the one-time adapter installer is approved and applied, verify:

- Agent API health remains PASS;
- MCP health remains PASS;
- the tool schema contains `honartik_iticket_v14_preflight_readonly`;
- the tool has zero input parameters;
- Host Actions v2 action enum does not gain the iTicket mutation action as a side effect;
- Control Plane Approval Policy is unchanged;
- Host Actions Base/Executor registries are unchanged;
- Honartik production and isolated worktrees are unchanged.

## First live preflight acceptance criteria

Only after adapter installation is verified, invoke `honartik_iticket_v14_preflight_readonly`.

Proceed toward V14 installation only if all of the following are true:

- `ok=true`
- `preflight_only=true`
- `baseline_match=true`
- `control_plane_mutation=false`
- `production_mutation=false`
- `production_application_tree_mutation=false`
- `database_mutation=false`
- `deploy=false`
- `external_network=false`
- `token_read=false`

Any mismatch stops the rollout.

## Later gate

A PASS from this read-only preflight does not authorize installation.

The later installation of Bootstrap V14 remains a separate critical Control Plane mutation and requires its own explicit Level-4 approval. The later invocation of `honartik_iticket_dark_backend_batch1_v1` remains another separately approved Level-4 action.
