# Honartik iTicket V14 Read-Only Preflight Adapter — Design

Date: 2026-08-20
Status: Design review
Base repository: `prhmonline/prhm-host-actions`
Base commit: `1ecd932451d7464e354419b67f2c605d93135854`
Related Host Action: `honartik_iticket_dark_backend_batch1_v1`
Related bootstrap: `bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js`

## Problem

Bootstrap V14 already implements the authoritative `preflight()` logic for the Honartik iTicket dark backend Batch 1 installation, but there is no safe live entrypoint that can execute only that preflight against the current production Control Plane and isolated Honartik worktrees.

DeployHQ must not be used as the runtime preflight executor. A DeployHQ API `mode=preview` request was observed to create and start a deployment record rather than behaving as a guaranteed dry-run. The attempt failed and post-checks confirmed the four Control Plane baseline files and Honartik production HEADs remained unchanged, but the preview semantics are not suitable as the future preflight safety boundary.

## Goal

Add a fixed, zero-input, read-only Agent/MCP tool named:

`honartik_iticket_v14_preflight_readonly`

The tool calls the existing V14 `preflight()` export only and returns bounded JSON evidence. It must not expose an arbitrary command, path, ref, file, host, environment, token, or argument surface.

## Non-goals

- Do not install `honartik_iticket_dark_backend_batch1_v1`.
- Do not modify Honartik application files or worktrees.
- Do not restart or reload Honartik services.
- Do not modify the database.
- Do not read a real iTicket token.
- Do not make an outbound iTicket API request.
- Do not create a Level-4 approval request merely to run preflight.
- Do not duplicate the V14 preflight validation logic in a second independent implementation.
- Do not expose a generic shell, command, file, path, or subprocess execution interface.

## Chosen architecture

Use a three-part read-only adapter:

1. A SHA-bound copy of the merged V14 bootstrap is installed as a fixed read-only preflight payload under a dedicated Control Plane read-only-actions directory.
2. A fixed Agent API route verifies the payload SHA, loads it as a CommonJS module through a capability-restricted module loader, and invokes only its exported `preflight()` function.
3. A zero-input MCP tool calls that fixed Agent API route and returns only the validated bounded result.

The adapter does not add the iTicket mutation action to the Host Actions v2 action enum, Executor action registry, Base registry, or Approval Policy. Those remain part of the later V14 installation gate.

## Why this approach

### Rejected: duplicate preflight logic

Reimplementing baseline/worktree/helper verification in a new route would create two sources of truth and allow the installer preflight and exposed preflight to drift.

### Rejected: generic read-only command endpoint

A generic command/path input would increase the attack surface and weaken the existing fixed-tool security model.

### Rejected: DeployHQ as runtime preflight runner

DeployHQ remains acceptable only as a one-time transport for installing the adapter itself. It must not be the runtime preflight safety boundary and `preview` must not be treated as a dry-run guarantee.

### Rejected: CLI execution of the V14 bootstrap

Launching the complete bootstrap as a normal child process with `--preflight-only` gives the process more filesystem/process capabilities than the exposed read-only operation needs.

### Selected: fixed SHA-bound module adapter

The Agent API verifies exact bytes, loads the known bootstrap as a module, and calls only `preflight()`. This keeps V14 as the single source of truth and creates no caller-controlled execution parameters.

## One-time adapter installation

The adapter itself requires one controlled installation because it does not yet exist on the live Agent.

That installation must be delivered from this repository through the existing versioned host-bootstrap path. DeployHQ may transport and execute the adapter installer only as an explicit real installation step; `preview` mode must not be treated as a dry-run.

The adapter installer is separate from Bootstrap V14 and must not install or register `honartik_iticket_dark_backend_batch1_v1`.

Expected persistent mutation scope is limited to:

- the fixed read-only preflight payload file;
- the Agent API fixed route/handler binding required to expose it;
- the MCP fixed zero-input tool binding required to call that Agent API route.

The exact live files must be discovered and SHA-pinned during implementation preflight. The installer must fail closed if the expected wrapper/module anchors have changed.

No Approval Policy mutation is required for the read-only tool.
No Host Actions Base/Executor action-registration mutation is required for the read-only tool.

The one-time adapter installation is a Control Plane mutation and therefore must remain a separately reviewed/approved installation gate. Installing the adapter does not authorize V14 installation.

## Runtime module capability boundary

The Agent API handler must not execute arbitrary CLI text and must not pass user-controlled arguments to the V14 payload.

The handler must:

1. Read the fixed payload path.
2. Verify its SHA-256 equals the pinned merged V14 bootstrap SHA.
3. Compile/load those exact bytes as a CommonJS module in an isolated loader context.
4. Temporarily restrict module dependencies supplied to that payload during the preflight invocation.
5. Verify the module exports `preflight` as a function.
6. Call `preflight()` with no arguments.
7. Validate and return only the bounded result.

### Filesystem capability

The payload receives a read-only `fs` facade for runtime preflight execution. Mutating functions must throw, including file creation, write, rename, chmod/chown, unlink/remove, copy, truncate, and write-capable `open` flags.

Read operations required by the existing V14 `preflight()` remain allowed.

### Child-process capability

The payload receives a restricted `child_process` facade. During preflight, process creation is permitted only for the fixed read-only Git inspection calls already used by V14 against its fixed roots/worktrees.

The adapter must reject execution of shells, SSH, systemctl, systemd-run, curl, PHP, arbitrary binaries, or arbitrary Git arguments.

No caller input can influence executable path or arguments.

### Network capability

Network-capable Node modules/APIs required only by installation/health code, including HTTP/HTTPS/net/tls/dgram/fetch-style access, must be unavailable or deny execution in the preflight loader context.

If the preflight code unexpectedly attempts network access, the invocation fails closed.

### Environment capability

No iTicket environment variable or token is read or passed to the payload. The adapter may provide only a minimal fixed process context required for read-only Git inspection.

## Authoritative payload binding

The runtime payload bytes must match the merged:

`bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js`

at the source commit pinned by the adapter installer.

The first implementation plan must pin the actual SHA-256 from GitHub and enforce byte-for-byte equality between the repository bootstrap and the installed read-only payload.

Any payload SHA drift fails closed and requires a new reviewed adapter revision.

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

For this contract, `control_plane_mutation=false` means the runtime invocation performs no persistent or transient Control Plane write/change; the adapter installation itself is outside this runtime result and is separately gated.

## Fail-closed behavior

Any of the following must cause a non-success result with no fallback mutation:

- payload SHA mismatch;
- unexpected Agent/API/MCP baseline during adapter installation;
- missing V14 payload;
- module compile/load failure;
- missing/non-function `preflight` export;
- any attempted write through the filesystem facade;
- any attempted disallowed process execution;
- any attempted network access;
- malformed/non-object preflight result;
- missing required safety fields;
- any safety field indicating mutation/network/token activity;
- V14 baseline mismatch;
- worktree dirty/missing/wrong branch/wrong HEAD;
- Batch 1 target already present.

No automatic attempt to repair any failed preflight condition is allowed.

## Testing strategy

Implementation must use TDD and include:

1. RED: tool/route/payload adapter absent.
2. Unit tests for zero-input schema and exact fixed route.
3. Tests that arbitrary args/path/command fields are impossible.
4. Test that payload SHA drift fails closed.
5. Test that the adapter calls exported `preflight()` with zero arguments and does not execute the bootstrap CLI entrypoint.
6. Tests that filesystem mutation APIs are denied by the loader facade.
7. Tests that child-process execution outside fixed read-only Git inspection is denied.
8. Tests that network module/API access is denied.
9. Tests that malformed/non-object preflight results fail closed.
10. Tests that any mutation/network/token flag set to true fails closed.
11. Regression test that installed/read-only payload bytes match the pinned merged V14 bootstrap bytes.
12. Syntax checks for all changed Node.js files.
13. Live post-install schema check proving the new read-only tool appears without registering the iTicket mutation action.

## Installation verification

After the one-time adapter installer is separately approved and applied, verify:

- Agent API health remains PASS;
- MCP health remains PASS;
- the tool schema contains `honartik_iticket_v14_preflight_readonly`;
- the tool has zero input parameters;
- Host Actions v2 action enum does not gain the iTicket mutation action as a side effect;
- Control Plane Approval Policy is unchanged;
- Host Actions Base/Executor registries are unchanged;
- Honartik production and isolated worktrees are unchanged;
- installed payload SHA equals the repository-pinned V14 bootstrap SHA.

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

## Later gates

A PASS from this read-only preflight does not authorize installation.

The later installation of Bootstrap V14 remains a separate critical Control Plane mutation and requires its own explicit Level-4 approval. The later invocation of `honartik_iticket_dark_backend_batch1_v1` remains another separately approved Level-4 action.
