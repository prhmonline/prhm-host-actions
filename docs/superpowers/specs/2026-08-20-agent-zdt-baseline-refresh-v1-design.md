# Agent ZDT Baseline Refresh V1 — Design

## Goal
Restore the existing `agent_zero_downtime_bootstrap_v1` preflight contract after legitimate self-maintenance runtime upgrades changed two protected SHA-256 baselines, without bypassing the Host Actions approval architecture, directly restarting MCP slots, or changing any application project.

The remediation must make the existing zero-downtime bootstrap accept the currently verified self-maintenance runtime identities and nothing else. It must not broaden the bootstrap into a generic updater or command runner.

## Problem
`agent_zero_downtime_bootstrap_v1` is installed and reachable through Host Actions v2, but its production preflight currently fails closed with `source_sha_mismatch` before any migration or cutover.

Fresh read-only evidence shows that seven of the nine protected source identities still match exactly. Only the Base and Executor runtime hashes advanced after later self-maintenance releases.

The active MCP topology is already blue/green capable:
- public router: `127.0.0.1:8123`
- active blue MCP slot: `127.0.0.1:8124`
- inactive green MCP slot: `127.0.0.1:8125`
- legacy MCP service: `127.0.0.1:8130`

The Source Mapping compatibility wrapper is already present on disk in `src/plugins/safeFiles.js`, but the public connector is still served by the older Blue process. The correct recovery sequence is therefore to repair the stale bootstrap baseline first, then reuse the existing zero-downtime action.

## Verified live evidence
The canonical and installed zero-downtime helpers are byte-identical before remediation:
- `/home/agent/ssh-mcp-server/ops/agent-zdt/agent-zero-downtime-bootstrap-v1.js`
- `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js`
- current SHA-256 for both: `4f1d5a14ae6e13cc25f442dceca7507e8f79088836f4735dcbcad782be126f26`

The stale protected identities inside those helpers are:
- `/opt/prhm-agent-selfmaint/server.js`
  - stale expected SHA: `4d4c9f1a8ff9099165f09a4df0c43735a320b20ca1c0f5c27def299a1fcabb25`
  - verified current SHA: `b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877`
- `/opt/prhm-agent-selfmaint-exec/server.js`
  - stale expected SHA: `372083619c6c5dd813e413d2873a9015c647ce3a5cb5037b3c1cc4e671c2b22a`
  - verified current SHA: `5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad`

The seven protected identities that already match and must remain unchanged are:
- `/home/agent/ssh-mcp-server/server.js` = `558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f`
- `/home/agent/ssh-mcp-server/src/core/registry.js` = `cf3681ca4d4632156df2f77886afe59c07da9a86dbcb68f4217577f811b22231`
- `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js` = `ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34`
- `/home/agent/ssh-mcp-server/src/plugins/selfmaint.js` = `fcf4420ab9b9c0b540f0e88f923065e16a331580cd238a097b9b1c53db34b2d0`
- `/home/agent/ssh-agent-api/server.js` = `5c6ffbd60a5347ad2f21352de856bde2033b7ad5b3599301afd3139be8791102`
- `/opt/prhm-agent-zdt/router.mjs` = `53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78`
- `/opt/prhm-agent-zdt/api-slot-launcher.cjs` = `d20793dc79ee6d0ffa2ee4bb3b4d5dc1c66750ba0e04f821acb3a45421dcb5ea`

## Chosen approach
Create one independent, fixed bootstrap artifact in `prhmonline/prhm-host-actions`:

- `bootstrap-agent-zdt-baseline-refresh-v1.js`
- `test-agent-zdt-baseline-refresh-v1.js`

The bootstrap is transported through the existing DeployHQ project `prhm-host-actions` to the already configured server `PRHM Host Bootstrap - node1` (`agent.prhm.ir`, SSH port `22022`, server path `/root`).

The bootstrap is not registered as a new Host Action. This intentionally breaks the current chicken-and-egg condition: the Host Actions executor cannot safely register the remediation that is required to repair the guard protecting that same executor path.

The bootstrap has exactly two modes:
- `--preflight-only`
- `--apply`

No caller-controlled path, hostname, repository, branch, service, SHA, command, environment value, or arbitrary argument is accepted.

## Files the bootstrap may modify
Exactly these two files:
1. `/home/agent/ssh-mcp-server/ops/agent-zdt/agent-zero-downtime-bootstrap-v1.js`
2. `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js`

No other file may be changed by this remediation.

## Preflight contract
`--preflight-only` must perform only read-only checks and return a bounded JSON result.

It must fail closed unless all of the following are true:
1. effective UID is root;
2. both target helper files are regular files, not symlinks;
3. both target helper files have SHA-256 exactly `4f1d5a14ae6e13cc25f442dceca7507e8f79088836f4735dcbcad782be126f26`;
4. both helper files are byte-identical;
5. each helper contains exactly one stale Base SHA literal and exactly one stale Executor SHA literal;
6. neither helper already contains a conflicting/new baseline in the target positions;
7. the current Base runtime SHA is exactly `b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877`;
8. the current Executor runtime SHA is exactly `5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad`;
9. all seven other protected identities listed above still match exactly;
10. `/usr/local/bin/prhm-node` exists;
11. both patched candidate helper bodies pass `/usr/local/bin/prhm-node --check` before any production write;
12. candidate helper bodies differ from originals only by the two exact SHA literal replacements;
13. no service restart/reload, systemd mutation, database mutation, network mutation, payment, SMS, TLS, Nginx, Git push, or application deployment occurs.

Expected preflight result fields include:
- `ok`
- `action: "agent_zdt_baseline_refresh_v1"`
- `preflight_only: true`
- `production_mutation: false`
- `database_mutation: false`
- `service_restart_reload: false`
- `target_count: 2`
- `target_sha_match: true`
- `runtime_baseline_match: true`
- `other_protected_sha_match: true`
- `replacement_count_per_file: 2`
- `candidate_syntax_ok: true`

No secret, token, Authorization header, environment value, private key, DSN, password, or credential may be printed.

## Apply contract
`--apply` may proceed only after running the same full preflight checks in-process immediately before the first write.

The apply phase must:
1. create a dedicated backup directory under `/var/backups/prhm-agent-zdt-baseline-refresh/` with mode `0700`;
2. copy both original helper files into that backup directory before the first write;
3. record original SHA-256 values in a bounded manifest;
4. generate both patched bodies entirely in memory;
5. replace only these two exact literals in each helper:
   - `4d4c9f1a8ff9099165f09a4df0c43735a320b20ca1c0f5c27def299a1fcabb25` → `b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877`
   - `372083619c6c5dd813e413d2873a9015c647ce3a5cb5037b3c1cc4e671c2b22a` → `5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad`
6. write each destination atomically using a same-directory temporary file and rename;
7. preserve the original file mode/ownership;
8. run syntax validation against both installed patched files;
9. verify both patched files are byte-identical;
10. verify each old literal count is zero and each new literal occurs exactly once in the corresponding EXPECTED_SHA entry;
11. verify the seven unrelated protected identities remain unchanged;
12. perform no service restart/reload and no zero-downtime cutover itself.

## Rollback contract
If any error occurs after the first mutation, rollback is mandatory.

Rollback must:
1. restore both files atomically from the pre-created backups;
2. verify both restored SHA-256 values are exactly `4f1d5a14ae6e13cc25f442dceca7507e8f79088836f4735dcbcad782be126f26`;
3. verify restored files remain byte-identical;
4. report `rollback_performed: true` and `rollback_verified: true` only after verification succeeds;
5. hard-fail with a distinct rollback failure class if either restore verification fails.

No service restart is required for rollback because the remediated helper is executed as a fresh child process on the next Host Action invocation.

## Success result contract
A successful apply returns bounded JSON containing only non-secret evidence:
- `ok: true`
- `action: "agent_zdt_baseline_refresh_v1"`
- `preflight_only: false`
- `production_mutation: true`
- `database_mutation: false`
- `service_restart_reload: false`
- `target_count: 2`
- original helper SHA-256
- resulting helper SHA-256
- backup directory path
- replacement counts
- syntax verification state
- unrelated protected SHA verification state
- `rollback_performed: false`

The exact resulting helper SHA-256 is derived from the final reviewed bootstrap implementation and must be pinned in tests before production execution.

## DeployHQ execution model
The existing DeployHQ project and server are reused. No new server or project is created.

The rollout uses a temporary, fixed DeployHQ config-file artifact for `bootstrap-agent-zdt-baseline-refresh-v1.js` and a temporary exact SSH command. Existing retired commands remain no-ops.

Sequence:
1. deploy the reviewed bootstrap artifact to `/root/bootstrap-agent-zdt-baseline-refresh-v1.js`;
2. set one temporary exact command to run `/usr/local/bin/prhm-node /root/bootstrap-agent-zdt-baseline-refresh-v1.js --preflight-only`;
3. execute a config-file deployment and require the preflight JSON contract to PASS;
4. immediately retire the temporary command back to `true`;
5. require a fresh explicit `CONFIRM_LEVEL_4_CRITICAL` from the user before mutation;
6. set the temporary command to the exact `--apply` invocation;
7. execute one config-file deployment;
8. verify apply output and both helper SHAs through read-only server evidence;
9. retire the temporary command back to `true` again.

The bootstrap source may remain in `/root` because it contains no secret and accepts no arbitrary inputs. Leaving the artifact is preferred over adding cleanup mutation to the recovery path.

## Post-remediation sequence
The baseline refresh is not the final objective. After it succeeds:
1. create a fresh Level-4 request for the existing `agent_zero_downtime_bootstrap_v1`;
2. execute it through the existing Host Actions v2 approval path;
3. require zero-downtime bootstrap preflight PASS;
4. verify Blue/Green/Router health and stable public MCP health on `8123`;
5. verify the active MCP process has loaded the current `src/plugins/safeFiles.js` compatibility wrapper;
6. invoke the fixed Source Mapping V2 sentinel through the already-exposed `safe_file_read` path;
7. complete the Park Bazar and Gisheh Source Mapping Gate V2 using only credential-safe metadata.

## Security invariants
1. No arbitrary shell or arbitrary path interface is added to MCP or Agent API.
2. No new Host Action enum entry is required for the baseline refresh.
3. The bootstrap is hard-bound to two exact target files and exact before-state identities.
4. Any source drift causes fail-closed behavior before mutation.
5. No runtime secret values are read or emitted.
6. No application project files are modified.
7. No Park Bazar, CF Park, Gisheh, or Solo Company business/runtime data is mutated.
8. No direct Blue restart, direct Router cutover, or manual `/opt` edit is used as a workaround.
9. Existing `agent_zero_downtime_bootstrap_v1` remains the only component authorized to perform the later Blue/Green migration.
10. The DeployHQ command used for this recovery is exact, temporary, and returned to `true` after each execution.

## Non-goals
This work does not:
- change the Base or Executor runtime implementations;
- change `safeFiles.js`;
- register new Source Mapping tools;
- refresh `mcp_candidate_schema_compare_v1`;
- modify approval policy semantics;
- restart MCP/API services directly;
- perform Blue/Green cutover itself;
- modify Git state on Park Bazar, CF Park, or Gisheh;
- merge unrelated Titan or other Host Actions work;
- change any credentials, tokens, TLS certificates, DNS, payment, SMS, or database state.

## Testing requirements
The repository test must prove at minimum:
1. `--preflight-only` reports no mutation;
2. wrong target helper SHA fails closed;
3. non-identical canonical/installed helpers fail closed;
4. wrong Base runtime SHA fails closed;
5. wrong Executor runtime SHA fails closed;
6. any of the seven unrelated protected SHA mismatches fail closed;
7. missing or duplicate stale literal fails closed;
8. candidate syntax failure blocks writes;
9. apply changes only the four total literal occurrences across two files;
10. injected post-write failure restores both original helper bytes;
11. successful apply produces byte-identical patched helpers;
12. no service-control command is reachable from either mode;
13. unexpected CLI arguments fail closed.

## Acceptance criteria
The design is complete only when all of the following can be demonstrated:
- the bootstrap and test are reviewed on an isolated branch;
- tests are RED before implementation and GREEN after implementation;
- `node --check` passes for the bootstrap and resulting helper candidates;
- DeployHQ preflight-only execution passes on the live target with `production_mutation=false`;
- a fresh user Level-4 confirmation is obtained before `--apply`;
- live apply succeeds with backup and post-write verification;
- both target helpers contain only the intended two baseline updates and remain byte-identical;
- no service restart/reload occurs during baseline refresh;
- a subsequent fresh `agent_zero_downtime_bootstrap_v1` request passes its SHA preflight and performs the existing guarded zero-downtime flow;
- public MCP health remains stable and the Source Mapping V2 sentinel becomes effective on the serving connector path.
