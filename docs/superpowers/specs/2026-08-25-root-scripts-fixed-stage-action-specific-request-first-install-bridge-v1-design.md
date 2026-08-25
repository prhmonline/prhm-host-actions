# Root Scripts Fixed Stage Action-Specific Request First-Install Bridge V1 — Design

## Status
Design approved in chat via `SPEC_APPROVED_PRHM_ROOT_SCRIPTS_FIXED_STAGE_ACTION_SPECIFIC_REQUEST_FIRST_INSTALL_BRIDGE_V1`. Written-spec self-review found one critical architectural prerequisite: **no already-live lower-level first-install primitive is currently registered in the Base or Executor.** Therefore implementation is fail-closed until a sanctioned lower-level execution primitive is identified or separately designed and approved. This document captures that amendment explicitly.

## Purpose
Resolve the circular-bootstrap problem for the already verified `root_scripts_fixed_stage_request_v1` recovery candidate by introducing one fixed, zero-input, SHA-bound, self-retiring first-install bridge. The bridge exists only to install that exact candidate through a Level-4 control-plane boundary without DeployHQ, raw shell, generic privileged writes, repurposing ZDT, or repurposing the Honartik-specific Host Actions installer.

## Fixed Identity
- Action: `root_scripts_fixed_stage_action_specific_request_first_install_bridge_v1`
- Operation: `host_action.root_scripts_fixed_stage_action_specific_request_first_install_bridge_v1`
- Environment: `production`
- Risk: `critical`
- Apply confirmation: literal `CONFIRM_LEVEL_4_CRITICAL`
- Runtime request fields: none

## Exact Candidate Binding
The bridge is permanently bound to exactly one reviewed candidate lineage:
- Repository: `prhmonline/prhm-host-actions`
- Source commit: `b61950062a7f80cc0d4b470923f24937eb4a3333`
- Candidate path: `candidates/control-plane/root-scripts-fixed-stage-action-specific-request-bootstrap-v1.mjs`
- Candidate bytes: `9557`
- Candidate SHA-256: `d464e0aa0b8daa6c1e623f523917c27c5da065e388c1017b3fe7d9098433e60e`

No repository, branch, commit, path, URL, content, SHA, command, environment value, token, credential, package id, service name, or action may be supplied by the runtime request.

## Live Baseline Bindings
Before implementation, and again immediately before any live preflight/apply, the bridge must bind and verify exact SHA-256 values for:
- `/opt/prhm-agent-selfmaint/server.js` = `e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd`
- `/opt/prhm-company-control-plane/config/approval-policy.json` = `76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d`
- `/home/agent/ssh-mcp-server/src/core/registry.js` = `484005617703516bbba877482330428e3b74ea3b7ce227685506aad11edf7762`
- Existing helper `/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js` = `50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee`

These values are evidence, not permanent assumptions. Any drift fails closed before mutation. Rebinding requires compatibility review and fresh tests; SHA guards are never disabled.

## Critical Bootstrap Prerequisite
A First-Install Bridge cannot install itself. Before implementation may begin, an **already-live, sanctioned lower-level primitive** must exist that can invoke this exact bridge candidate without first requiring the Base/Policy/MCP registration that this bridge is meant to create.

Fresh live inspection found no matching `first_install`, `first-install`, `typed_bootstrap_first_install`, `control_plane_typed_bootstrap_first_install_bridge_v1`, or `root_scripts_fixed_stage_action_specific_request_first_install_bridge_v1` registration in the current Base/Executor surfaces.

Therefore:
- this spec does **not** authorize implementation merely by adding another Host Actions v2 action;
- this spec does **not** authorize `ops_execute access=write`, generic shell, generic file write, path tricks, or policy broadening as the missing primitive;
- this spec does **not** authorize repurposing ZDT or the Honartik installer;
- implementation planning must stop if no lower-level sanctioned primitive is identified;
- if a new lower-level primitive is required, it needs its own architecture/spec/approval before this bridge can move to TDD.

This prerequisite prevents recursive bootstrap designs from being mistaken for executable recovery paths.

## Why Existing Primitives Are Not Reused
### `selfmaint_request` / `selfmaint_apply`
They remain scoped to the existing Agent API/MCP self-maintenance boundary. Expanding them to arbitrary Base/Policy/Registry targets would create a generic privileged writer and is forbidden. Prior direct Level-4 apply attempts were also blocked before reaching Agent 2, so this pair is not considered the lower-level bootstrap prerequisite for this design.

### `agent_zero_downtime_bootstrap_v1`
This action owns ZDT topology/migration semantics. It must not become a package or registration installer.

### `host_action_v2_installer_v1`
The live installer is hard-bound to the Honartik flow. It must not be repurposed.

### DeployHQ
The account is suspended for non-payment and is intentionally removed from this execution path.

## First-Install Bridge Scope
Once the Critical Bootstrap Prerequisite is independently satisfied, the bridge may only:
1. verify the exact candidate bytes and candidate SHA;
2. verify all live baseline SHA bindings;
3. verify the bridge has not previously completed successfully;
4. stage exactly the one fixed candidate under its private staging root;
5. reverify staged byte length, SHA-256, regular-file/non-symlink state, ownership and mode;
6. run Node syntax verification on the staged candidate with a fixed executable and fixed argv;
7. after fresh Level-4 authorization, execute only the staged fixed candidate with `--apply CONFIRM_LEVEL_4_CRITICAL`;
8. verify resulting Base/Policy/MCP Registry SHA values match the candidate-produced post-state evidence;
9. verify `prhm-company-approval.service`, `prhm-agent-selfmaint.service`, and `prhm-agent-mcp.service` are active;
10. verify `root_scripts_fixed_stage_request_v1` is registered and zero-input;
11. persist bounded, secret-free evidence;
12. set `bridge_state=retired` only after all verification succeeds.

## Fixed Staging Root
`/var/lib/prhm-agent-selfmaint-exec/root-scripts-fixed-stage-request-first-install-bridge-v1/`

Only the exact candidate filename may exist in the invocation-owned staging area. Caller-controlled subpaths are impossible.

## Preflight Contract
Preflight performs zero production writes and returns bounded evidence including:
- exact candidate SHA/bytes match;
- exact live baseline SHA matches;
- helper SHA match;
- staging-root contract pass;
- syntax verification capability pass;
- required service health pass;
- `bridge_state` not retired;
- `production_mutation=false`;
- `database_mutation=false`;
- `application_mutation=false`;
- `executor_mutation=false`;
- `helper_mutation=false`;
- `deployhq_mutation=false`;
- `mcp_cutover=false`.

Any mismatch fails closed before mutation.

## Apply Contract
A fresh persisted Level-4 request and literal `CONFIRM_LEVEL_4_CRITICAL` are required. Apply must:
1. reverify candidate and all live baselines;
2. verify the bridge is not retired;
3. capture invocation-bound backups for every file the candidate may mutate;
4. stage only the exact candidate;
5. reverify stage integrity and syntax;
6. execute only `/usr/local/bin/prhm-node <fixed-staged-candidate> --apply CONFIRM_LEVEL_4_CRITICAL` with `shell:false`, fixed argv, bounded timeout/output, and fixed minimal environment;
7. validate the candidate result contract and post-state SHA evidence;
8. verify the three required services are active;
9. verify the new MCP request tool exists and has an empty input schema;
10. persist success evidence;
11. write the retirement marker only after every verification passes.

## Self-Retirement
After one verified successful installation:
- `bridge_state=retired` is persisted with candidate identity and post-install SHA evidence;
- later request/preflight/apply attempts fail closed with `first_install_already_completed` or equivalent bounded result;
- the bridge code may remain installed for auditability, but its execution guard is permanently closed for this V1 candidate;
- no automatic code deletion is required.

## Transaction and Rollback
Rollback is invocation-bound only. Before first mutation, capture the exact pre-state for:
- Base registry file;
- Approval policy file;
- MCP registry file;
- service active/inactive state for services the candidate can restart;
- bridge-owned staging files.

If apply fails after mutation begins:
- restore only files changed by this invocation from verified backups;
- restore only service state changed by this invocation;
- remove only bridge-owned staging artifacts;
- do not touch executor/helper/application/database/DeployHQ state;
- persist `rollback_performed=true`.

If rollback itself fails, persist explicit bounded evidence:
- `ok=false`
- `critical_failure=true`
- `rollback_failed=true`

No broad automatic remediation is permitted after rollback failure.

## Explicitly Forbidden Capabilities
The bridge must not accept, derive from caller input, or execute:
- arbitrary action;
- arbitrary path or destination;
- arbitrary command or shell;
- arbitrary payload/content;
- repository/branch/commit/URL input;
- caller-provided SHA;
- credentials/tokens/secrets;
- SQL or database access;
- external network fetch;
- DeployHQ API access;
- application content changes;
- executor changes;
- helper changes;
- public MCP cutover;
- unrelated service changes.

## Required Result Contract
Successful apply evidence must include at least:
- `ok=true`
- `schema_version=prhm.root-scripts-fixed-stage-request-first-install-bridge-result.v1`
- `action=root_scripts_fixed_stage_action_specific_request_first_install_bridge_v1`
- exact candidate SHA and byte count;
- exact pre/post SHA evidence for Base/Policy/MCP Registry;
- helper SHA evidence;
- `installed_tool=root_scripts_fixed_stage_request_v1`
- `bridge_state=retired`
- `production_mutation=true`
- `database_mutation=false`
- `application_mutation=false`
- `executor_mutation=false`
- `helper_mutation=false`
- `deployhq_mutation=false`
- `mcp_cutover=false`
- `rollback_performed=false`
- bounded service-health evidence.

No secret/token/credential value may appear in result, logs, tests, or chat.

## TDD Acceptance Cases
At minimum:
1. exact candidate and live baselines pass preflight;
2. wrong candidate SHA fails closed;
3. candidate byte-count mismatch fails closed;
4. Base drift fails before mutation;
5. Policy drift fails before mutation;
6. MCP Registry drift fails before mutation;
7. helper drift fails before mutation;
8. request surface is zero-input;
9. arbitrary path/action/command/payload injection is structurally impossible;
10. preflight performs zero writes;
11. staged candidate path/owner/mode/SHA are exact;
12. only fixed executable and argv can run;
13. wrong/missing second confirmation fails before mutation;
14. successful apply verifies post-state and retires bridge;
15. second execution after retirement fails closed;
16. partial write triggers invocation-bound rollback;
17. service verification failure triggers rollback;
18. rollback failure emits explicit critical evidence;
19. executor/helper remain byte-identical;
20. application/database/DeployHQ remain untouched;
21. runtime never merges around drift: any live SHA mismatch fails closed. Preservation of concurrent unrelated additions requires a separate compatibility rebind, candidate regeneration, and fresh review before a new request.

## Gate Sequence
1. Written spec review approval.
2. Verify or design a sanctioned lower-level bootstrap primitive.
3. If no primitive exists, stop this Gate and enter a separate architecture Gate for that primitive.
4. Only after prerequisite satisfaction: implementation plan.
5. TDD RED → GREEN on isolated branch.
6. Draft PR / independent review.
7. Fresh live read-only baseline capture and compatibility rebind if needed.
8. Fixed bridge preflight through the already-approved lower-level primitive.
9. Fresh Level-4 confirmation for bridge apply.
10. Verify bridge retirement and `root_scripts_fixed_stage_request_v1` exposure.
11. Only then create a fresh request for `root_scripts_fixed_stage_v1`.

## Out of Scope
- inventing or installing the lower-level bootstrap primitive inside this spec;
- executing `root_scripts_fixed_stage_v1` itself;
- installing DrTarjomeh root seed;
- staging clone backend implementation;
- DeployHQ recovery/payment;
- GitHub SSH trust-anchor installation;
- Honartik/iMotion/application/database changes;
- any generic privileged transport or writer.

## Security Principle
This bridge is a single-purpose bootstrap exception with a closed-world candidate identity and one successful lifetime. It must never evolve into a reusable arbitrary installer. If the lower-level bootstrap prerequisite is absent, the correct result is a blocked Gate, not another recursive bridge.