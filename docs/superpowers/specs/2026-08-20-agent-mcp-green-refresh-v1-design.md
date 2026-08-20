# Agent MCP Green Refresh V1 Design

## Goal

Reload the current production MCP source into a fresh backend process and move the stable MCP router from Blue (`127.0.0.1:8124`) to Green (`127.0.0.1:8125`) without restarting the public router, without touching the Agent API topology, and while preserving an immediate Blue rollback path until the live Source Mapping compatibility sentinel is verified through the real ChatGPT connector.

This is a recovery/refresh workflow for an already-installed zero-downtime topology. It does **not** rerun the initial `agent_zero_downtime_bootstrap_v1` migration.

## Evidence and problem statement

The current production topology is already migrated:

- public MCP router: `127.0.0.1:8123`, `prhm-agent-mcp-router.service`, active/enabled;
- Blue backend: `127.0.0.1:8124`, `prhm-agent-mcp-blue.service`, active/enabled;
- Green backend: `127.0.0.1:8125`, `prhm-agent-mcp-green.service`, inactive/disabled;
- legacy MCP backend: `127.0.0.1:8130`, occupied;
- public API/router topology is already active on `8099/8100/8110` and is outside this change.

The existing `agent_zero_downtime_bootstrap_v1` initial-migration preflight requires all candidate API/MCP slot ports to be free. On the current already-migrated topology it would therefore fail closed with `candidate_port_busy`; it is not the correct refresh primitive.

The MCP router implementation at `/opt/prhm-agent-zdt/router.mjs` reads `/var/lib/prhm-agent-zdt/mcp-active` on every request and permits only `8124`, `8125`, or `8130`. This allows an atomic backend pointer switch without restarting the router.

Pinned production identities at design time:

- `/home/agent/ssh-mcp-server/server.js` = `558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f`
- `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js` = `87da44a939478786b9a48585c1cccacd862b683831dbba976d8b6a85869d2473`
- `/opt/prhm-agent-zdt/router.mjs` = `53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78`

The safe-files source already contains the Source Mapping compatibility sentinel `__PRHM_SOURCE_MAPPING_COMPAT_V2__`; the problem is that the serving Blue process predates that source update.

## Artifact

Create one fixed recovery bootstrap in `prhmonline/prhm-host-actions`:

`bootstrap-agent-mcp-green-refresh-v1.js`

The bootstrap accepts exactly one of four CLI modes:

- `--preflight-only`
- `--apply`
- `--rollback`
- `--finalize`

No arbitrary path, port, service, command, hostname, branch, SHA, environment value, token, or extra argument is accepted.

## Scope boundaries

The bootstrap may operate only on:

- `prhm-agent-mcp-router.service`
- `prhm-agent-mcp-blue.service`
- `prhm-agent-mcp-green.service`
- `/var/lib/prhm-agent-zdt/mcp-active`
- `/home/agent/ssh-mcp-server/server.js` (read/identity only)
- `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js` (read/identity only)
- `/opt/prhm-agent-zdt/router.mjs` (read/identity only)
- its own backup/evidence tree under `/var/backups/prhm-agent-mcp-green-refresh/`

Explicitly out of scope:

- Agent API ports, units, state files, or source;
- `prhm-agent-mcp.service` legacy backend except read-only listener verification;
- database changes;
- application/project changes;
- Git operations on production;
- TLS/DNS/payment/SMS changes;
- credential, environment, token, header, or DSN output;
- Router restart/reload;
- Blue restart;
- stopping Blue during `--apply`.

## Preflight contract

`--preflight-only` is strictly read-only and must return bounded JSON.

It must fail closed unless all of the following are true:

1. running as root on the expected production host;
2. the three pinned source/router SHA-256 identities match exactly;
3. `prhm-agent-mcp-router.service` is active and enabled;
4. `prhm-agent-mcp-blue.service` is active and enabled;
5. `prhm-agent-mcp-green.service` is inactive and disabled;
6. public MCP `8123` is healthy and ready;
7. Blue `8124` is healthy and ready;
8. Green `8125` is not listening;
9. legacy `8130` remains listening but is not modified;
10. `/var/lib/prhm-agent-zdt/mcp-active` is a regular, non-symlink file containing exactly `8124` plus optional trailing newline;
11. the Green and Blue unit contracts both execute `/usr/local/bin/prhm-node /home/agent/ssh-mcp-server/server.js`, have the expected WorkingDirectory, and bind their documented ports through their fixed environment/unit configuration;
12. the router unit uses `/opt/prhm-agent-zdt/router.mjs` and the expected state file;
13. sufficient disk exists for a small backup/evidence bundle.

Required preflight result fields include:

```json
{
  "ok": true,
  "action": "agent_mcp_green_refresh_v1",
  "preflight_only": true,
  "production_mutation": false,
  "database_mutation": false,
  "api_mutation": false,
  "router_restart_reload": false,
  "blue_restart_stop": false,
  "current_backend": 8124,
  "candidate_backend": 8125,
  "source_sha_match": true,
  "topology_match": true,
  "green_free": true,
  "public_health": true,
  "blue_health": true
}
```

## Apply contract

`--apply` requires a fresh explicit user `CONFIRM_LEVEL_4_CRITICAL` before production execution. The confirmation is external to the script and must not be reused from another request/action.

`--apply` must rerun the complete preflight immediately before its first mutation, then:

1. create `/var/backups/prhm-agent-mcp-green-refresh/<timestamp>/` with mode `0700`;
2. save a bounded manifest containing only path metadata, service active/enabled states, the exact pre-change router state-file bytes/mode/uid/gid, and SHA-256 identities; no secrets or environment values;
3. start `prhm-agent-mcp-green.service` without enabling it yet;
4. require Green `8125/health` and `8125/ready` to pass;
5. atomically replace `/var/lib/prhm-agent-zdt/mcp-active` with `8125\n`, preserving safe ownership/mode semantics and fsyncing file + parent directory;
6. require public `8123/health` and `8123/ready` to pass through the router;
7. persist bounded success evidence;
8. leave Blue `8124` active and enabled as the immediate rollback backend;
9. leave Green active but disabled until external semantic validation completes;
10. leave legacy `8130` and all API topology untouched.

A successful apply result must include:

```json
{
  "ok": true,
  "action": "agent_mcp_green_refresh_v1",
  "preflight_only": false,
  "production_mutation": true,
  "database_mutation": false,
  "api_mutation": false,
  "router_restart_reload": false,
  "blue_restart_stop": false,
  "previous_backend": 8124,
  "active_backend": 8125,
  "green_started": true,
  "public_health": true,
  "rollback_performed": false
}
```

## External semantic validation gate

After `--apply`, before `--finalize`, the real ChatGPT connector must execute:

- `safe_file_read`
- `target="root_scripts"`
- `path="__PRHM_SOURCE_MAPPING_COMPAT_V2__"`

This validation intentionally happens outside the bootstrap because `/mcp` is Bearer-authenticated and the recovery bootstrap must not read, copy, print, or depend on MCP credentials.

PASS requires the sentinel to return the structured Source Mapping V2 evidence rather than `invalid root script name`.

Until this external gate passes, Blue remains running and enabled.

## Rollback contract

`--rollback` is a separate Level-4 mutation and is available after an apply if external semantic validation fails or an operator explicitly requests rollback.

It must bind to the latest valid apply evidence and fail closed if the current state does not match that evidence. It then:

1. atomically restores `mcp-active` to `8124\n` from the saved pre-state;
2. requires public `8123/health` and `/ready` to pass on Blue;
3. stops Green only if it was inactive before the apply;
4. restores Green enabled/disabled state to the saved pre-state;
5. never restarts or stops Blue;
6. never restarts the Router;
7. verifies source/router SHA identities remain unchanged;
8. records `rollback_performed=true`.

## Finalize contract

`--finalize` is a separate Level-4 mutation and may run only after the external sentinel has been observed to PASS and the current state still matches the successful apply evidence.

Finalize must:

1. verify the router still targets `8125`;
2. verify Green and public MCP health/ready;
3. enable Green for reboot persistence;
4. disable Blue **without stopping it**, preserving a live emergency fallback process for the remainder of the maintenance window;
5. verify public MCP remains healthy;
6. never restart the Router or either backend;
7. never touch the Agent API topology;
8. persist `finalized=true` evidence.

Stopping the old Blue process is deliberately outside V1 and may be handled later after an observation window.

## Automatic rollback during apply

If any error occurs after the first mutation and before apply success is persisted, the script must automatically:

- restore the exact saved `mcp-active` bytes atomically;
- restore Green active/enabled state to pre-state;
- verify public `8123` health on Blue;
- verify Blue was never stopped/restarted;
- emit bounded failure evidence with `rollback_performed=true`.

If rollback verification fails, exit non-zero with an explicit bounded rollback failure state.

## Security and evidence rules

- Never print or persist token/API key/password/Authorization/cookie/private-key/DSN/environment values.
- Never read MCP Bearer credentials.
- Health/ready checks use unauthenticated loopback endpoints only.
- No arbitrary shell input is accepted.
- All paths, units, ports, and expected SHA identities are hard-coded constants.
- All production writes use backup + atomic rename + fsync where applicable.
- Evidence output is bounded JSON containing booleans, ports, service states, timestamps, backup path, SHA-256 values, and PASS/FAIL fields only.

## TDD requirements

Tests must prove at minimum:

1. the bootstrap is absent before implementation (RED);
2. only the four exact CLI modes are accepted;
3. all MCP paths/ports/units and pinned SHA identities are present;
4. no API mutation tokens/units/state paths are present in mutation logic;
5. preflight is read-only;
6. apply starts Green but does not stop/restart Blue or restart Router;
7. state-file update is atomic and fsync-backed;
8. automatic rollback restores the exact previous state;
9. rollback/finalize require persisted apply evidence and current-state matching;
10. finalize enables Green and disables-but-does-not-stop Blue;
11. no secret/environment output exists;
12. syntax check and full `node:test` suite pass.

## Rollout sequence

1. design/spec review;
2. implementation plan;
3. TDD RED;
4. minimal bootstrap GREEN;
5. local/sandbox syntax + tests;
6. DeployHQ config-file artifact bound to exact reviewed bytes;
7. live `--preflight-only` only;
8. fresh explicit Level-4 confirmation;
9. live `--apply`;
10. independent post-apply health verification;
11. real connector Source Mapping sentinel test;
12. if PASS: fresh Level-4 confirmation then `--finalize`;
13. if FAIL: fresh Level-4 confirmation then `--rollback`;
14. after finalize, complete Source Mapping Gate V2 for Park Bazar/Gisheh.

## Non-goals

- replacing the general ZDT architecture;
- refreshing the Agent API;
- adding a new MCP tool/action enum;
- stopping Blue during the cutover;
- cleaning up legacy `8130`;
- merging unrelated stale comparator work;
- changing Park Bazar, Gisheh, or Solo Company application source.
