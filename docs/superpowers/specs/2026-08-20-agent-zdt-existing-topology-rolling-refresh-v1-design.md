# Agent ZDT Existing-Topology Rolling Refresh V1 — Design

## Goal

Replace the one-time `agent_zero_downtime_bootstrap_v1` assumption with a safe rolling-refresh path for hosts where the API/MCP ZDT topology already exists and one or more candidate slots are occupied.

The new action must discover the currently serving slot from the router state file, refresh only the opposite slot, cut public traffic only after candidate health/readiness passes, preserve the old serving slot as rollback capacity, and keep API and MCP as independent lanes.

## Observed Production Topology

The read-only preflight on 2026-08-20 established:

- API public router: `127.0.0.1:8099`, active.
- API Blue: `127.0.0.1:8100`, active.
- API Green: `127.0.0.1:8102`, currently inactive/free.
- API Legacy: `127.0.0.1:8110`, active.
- MCP public router: `127.0.0.1:8123`, active.
- MCP Blue: `127.0.0.1:8124`, active and currently receiving live tool traffic.
- MCP Green: `127.0.0.1:8125`, active.
- MCP Legacy: `127.0.0.1:8130`, active.
- `127.0.0.1:8101` remains reserved and must never be used by this action.

The initial bootstrap failed closed with `candidate_port_busy:8100`, proving that bootstrap-style "all candidate ports must be free" validation is no longer correct for the installed topology.

## Existing Proven Contract To Reuse

Two existing MCP-only implementations already establish the rolling-refresh safety model:

- `bootstrap-agent-mcp-blue-rolling-refresh-v2.js`: Green `8125` -> Blue `8124`.
- `bootstrap-agent-mcp-green-rolling-refresh-v2.js`: Blue `8124` -> Green `8125`.

Their proven invariants are reused:

1. fixed ports and fixed state-file paths;
2. active backend determined from the pointer, not inferred from process state;
3. source/unit topology validation before mutation;
4. candidate restart only;
5. candidate `/health` and `/ready` before cutover;
6. atomic, fsync-backed pointer replacement;
7. public `/health` and `/ready` after cutover;
8. old serving backend remains running until finalize;
9. rollback restores pointer first, then candidate pre-state;
10. apply, rollback and finalize are separate evidence-bearing phases.

## New Action

Canonical action name:

`agent_zdt_existing_topology_rolling_refresh_v1`

It is a fixed Level-4 Host Actions v2 action. It accepts no arbitrary command, path, port, service, environment value, target slot or source SHA from the caller.

### Fixed lane configuration

API lane:

- public: `8099`
- blue: `8100`
- green: `8102`
- legacy: `8110`
- pointer: `/var/lib/prhm-agent-zdt/api-active`
- router: `prhm-agent-api-router.service`
- blue unit: `prhm-agent-api-blue.service`
- green unit: `prhm-agent-api-green.service`

MCP lane:

- public: `8123`
- blue: `8124`
- green: `8125`
- legacy: `8130`
- pointer: `/var/lib/prhm-agent-zdt/mcp-active`
- router: `prhm-agent-mcp-router.service`
- blue unit: `prhm-agent-mcp-blue.service`
- green unit: `prhm-agent-mcp-green.service`

Reserved port `8101` is outside every allowed slot set and must be asserted untouched in preflight and final evidence.

## Active-Slot Detection

For each lane, read the fixed pointer as a regular non-symlink file. Only the lane's Blue or Green port is accepted.

- API accepts exactly `8100` or `8102`.
- MCP accepts exactly `8124` or `8125`.

Any missing, malformed, symlinked or unexpected pointer fails closed before mutation.

The candidate is always the opposite Blue/Green slot. Legacy is never a rolling candidate.

## Preflight Contract

Preflight is strictly read-only and returns `production_mutation=false`.

For each lane it must verify:

- router unit loaded, enabled and running;
- Blue and Green unit definitions match the expected fixed launch contract;
- active pointer is valid;
- active backend is running and passes `/health` and `/ready`;
- public router passes `/health` and `/ready`;
- legacy port is listening;
- candidate unit exists and is safe to restart, whether currently active or inactive;
- fixed source/helper/router SHA bindings match the reviewed baseline;
- no slot or configuration references port `8101`;
- required filesystem targets are regular files, not symlinks.

Preflight output reports, independently for API and MCP:

- `current_backend`
- `candidate_backend`
- current/candidate slot names
- router/public health/readiness
- candidate current active/enabled state
- legacy listener presence
- source/topology SHA state
- `apply_ready`

No current lane direction is hard-coded.

## Apply Sequence

Lanes are sequential, never parallel.

### API lane first

1. Re-run API preflight immediately before mutation.
2. Capture exact API pointer bytes/metadata and candidate active/enabled pre-state.
3. Persist pre-state evidence before restart.
4. Restart/start only the API candidate unit.
5. Require candidate `/health` and `/ready`.
6. Re-read pointer and require it is unchanged from the captured active backend.
7. Atomically write pointer to candidate using temporary file + fsync + rename + directory fsync.
8. Require public API `/health` and `/ready`.
9. Persist API applied evidence.
10. Keep previous API backend running.

If any post-mutation API step fails, restore the API pointer first, verify public API, restore candidate active/enabled pre-state, persist rollback evidence, and do not start MCP.

### MCP lane second

MCP starts only after API applied evidence is valid and public API remains healthy/ready.

The same sequence is used for MCP. On MCP failure, rollback MCP pointer first and restore MCP candidate pre-state. A successful API lane remains applied; the action must report this partial-success state explicitly rather than silently reversing API.

## Finalize Contract

Finalize is a separate Level-4 invocation/state transition and requires valid applied evidence.

For each successfully applied lane:

- verify pointer still targets the candidate;
- verify old and new backend remain healthy/ready as required by the lane contract;
- enable the new active slot;
- disable the old slot from boot-time enablement only;
- do not stop the old slot during finalize;
- re-check public health/readiness;
- persist finalized evidence.

No router restart/reload occurs.

## Explicit Rollback Contract

Rollback requires valid non-finalized apply evidence.

For each lane selected for rollback:

1. validate evidence and source/topology identities;
2. restore the saved pointer bytes first;
3. require public health/readiness through the restored backend;
4. restore candidate active/enabled state exactly;
5. persist rollback evidence.

API and MCP rollback evidence are independent.

## Host Actions v2 Integration

The action must be registered in the existing four-layer Control Plane architecture:

1. MCP `hostActionsV2.js` enum;
2. Base Self-Maintenance `HOST_ACTION_V2_SPECS`;
3. Executor `HOST_ACTION_V2_SPECS` plus fixed dispatcher;
4. Approval Policy as `host_action.agent_zdt_existing_topology_rolling_refresh_v1`, Level 4.

Execution is performed by a fixed helper under `/opt/prhm-agent-selfmaint-exec/actions/`. The executor invokes it through a hardened transient systemd unit with only the exact write paths required for pointer state, evidence/backups and candidate service control.

## Mutation Scope

Allowed during apply/finalize/rollback:

- fixed API/MCP Blue/Green service start/restart and enable/disable operations;
- exact API/MCP pointer files;
- action-local backup/evidence directories.

Prohibited:

- router restart/reload;
- legacy API/MCP stop/restart;
- use or modification of port `8101`;
- database mutation;
- application/site/SEO mutation;
- arbitrary shell, path, service or port input;
- credential/token/env-value output;
- deletion of rollback backend during apply/finalize.

## Result Contract

Result schema: `prhm.host-action-result.v1`.

Minimum preflight evidence:

- `ok=true`
- `action=agent_zdt_existing_topology_rolling_refresh_v1`
- `preflight_only=true`
- `production_mutation=false`
- `api.current_backend`
- `api.candidate_backend`
- `mcp.current_backend`
- `mcp.candidate_backend`
- `reserved_8101_untouched=true`

Minimum successful apply evidence:

- `production_mutation=true`
- API lane applied and verified before MCP begins;
- per-lane previous/active backend;
- per-lane candidate restart/start state;
- public health/readiness after each cutover;
- `rollback_performed=false` for successful lanes;
- old backend retained as fallback.

Partial failure must explicitly state which lane is applied, which lane rolled back or never started, and whether public API/MCP health is preserved.

## Acceptance Criteria

The design is accepted when tests prove:

- Blue-active and Green-active direction selection for both lanes;
- malformed/legacy pointer rejection;
- candidate may already be running or may be stopped;
- only candidate is restarted/started;
- API completes before MCP starts;
- API failure prevents MCP mutation;
- MCP failure rolls back MCP while preserving successful API state;
- pointer-first automatic rollback;
- explicit rollback and finalize require valid evidence;
- router and legacy services are never restarted/stopped;
- port `8101` is absent from all candidate/write paths;
- no secret-bearing evidence is persisted or printed.

## Rollout

1. Implement and test in an isolated Git branch/worktree.
2. Run syntax and unit tests locally.
3. Run a commit-pinned Production `--preflight-only` with no file/system mutation.
4. Review preflight evidence against current topology.
5. Install/register the fixed Host Action through the existing approval-aware installer path.
6. Re-discover MCP schema and verify the new action is exposed.
7. Create a fresh Level-4 request.
8. Apply only after explicit `CONFIRM_LEVEL_4_CRITICAL`.
9. Verify persisted evidence and public health before any finalize decision.


## Approved Amendment — Three Fixed Phase Actions

The Host Actions v2 interface accepts only a fixed action name and no caller-supplied phase argument. Therefore the rolling-refresh control surface is split into three independent zero-input Level-4 actions that share the same helper implementation:

- `agent_zdt_existing_topology_rolling_refresh_v1` — executes `--apply` only.
- `agent_zdt_existing_topology_rolling_refresh_rollback_v1` — executes `--rollback` only.
- `agent_zdt_existing_topology_rolling_refresh_finalize_v1` — executes `--finalize` only.

`--preflight-only` remains a read-only commit-pinned verification step and is not exposed as a mutating Host Action. Each phase action requires its own one-time Level-4 approval and typed scope. The Executor injects the fixed helper phase server-side; callers cannot provide a command, path, port, slot, action alias, or mode. Rollback and finalize remain evidence-gated and can only operate on a valid prior apply record. Automatic finalize is prohibited.


## Amendment — MCP Schema-Only Rolling Exposure

Approved token: `SPEC_AMENDMENT_APPROVED_AGENT_ZDT_SCHEMA_EXPOSURE_ROLLING_V1`.

Task 9 must not restart the legacy MCP service to expose the new Host Actions v2 schema. After the four-layer install and post-install SHA verification, the installer must read the existing MCP blue/green topology, identify the active pointer (`8124` or `8125`), restart only the opposite candidate slot, require candidate health/ready, atomically cut the MCP pointer, require public `8123` health/ready, and keep the old active backend healthy and running as rollback capacity. API, routers, legacy services and reserved port `8101` are untouched.

If schema exposure fails after pointer cutover, rollback is pointer-first, then candidate pre-state restore, then the four-layer installer restore. If the candidate had been active before exposure, it is reloaded after the old source files are restored so no standby process retains the new schema in memory. There is no auto-finalize and the actual rolling-refresh apply remains a separate Level-4 action.
