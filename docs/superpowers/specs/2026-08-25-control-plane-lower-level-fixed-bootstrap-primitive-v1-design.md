# Control Plane Lower-Level Fixed Bootstrap Primitive V1 — Design

## Status
Approved in chat as `SPEC_APPROVED_PRHM_CONTROL_PLANE_LOWER_LEVEL_FIXED_BOOTSTRAP_PRIMITIVE_V1`.

## Goal
Use the existing Level-4 SHA-bound self-maintenance boundary, without widening its allowlist, to install one fixed Agent API bridge and one zero-input MCP facade that together make the already-approved Root Scripts First-Install Bridge requestable.

## Existing Trust Boundary
- `selfmaint_request` accepts only `target=agent_api|agent_mcp`, an allowlisted path, an exact expected SHA-256, and replacement content stored server-side for the request lifetime.
- `selfmaint_apply` accepts only request id plus literal `CONFIRM_LEVEL_4_CRITICAL` and executes the stored request.
- Current self-maintenance executor health is required before any apply.

## Fresh Live Bindings
- Agent API target: `selfmaintRoutes.js`
- Agent API baseline SHA-256: `45f22b6879add519c51a0dadaf9840a62b1be3d0301f562f70b92656a89fa8c4`
- Agent MCP target: `src/plugins/selfmaint.js`
- Agent MCP baseline SHA-256: `0cc9fd75a064fdee5e4c2f161fa8bc0c4470e65cb3b079ce3abe67113b6676ab`
- Root Scripts request-surface candidate SHA-256: `d464e0aa0b8daa6c1e623f523917c27c5da065e388c1017b3fe7d9098433e60e`
- Existing root-scripts helper SHA-256: `50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee`

## Fixed Surfaces
- `root_scripts_first_install_bridge_request_v1()` — zero input.
- `root_scripts_first_install_bridge_apply_v1(request_id, second_confirmation)` — only UUID request id plus literal Level-4 second confirmation.
- No runtime action, path, command, content, repository, URL, SHA, service, SQL, environment, token, credential, or secret input.

## Installation Sequence
1. Render exact Agent API bridge candidate from the bound baseline.
2. Create a SHA-bound `selfmaint_request` for `agent_api/selfmaintRoutes.js`.
3. Apply only after fresh `CONFIRM_LEVEL_4_CRITICAL`.
4. Verify Agent API SHA and self-maintenance health.
5. Render exact MCP facade candidate from the bound baseline.
6. Create a separate SHA-bound `selfmaint_request` for `agent_mcp/src/plugins/selfmaint.js`.
7. Apply only after a fresh independent Level-4 confirmation.
8. Verify MCP SHA/schema and the two fixed tools.
9. Use the fixed request/apply flow to install the already-approved First-Install Bridge.

## Fail-Closed Rules
Candidate SHA drift, baseline drift, symlink/non-regular target, unhealthy service, wrong/expired request, action/hash mismatch, wrong confirmation, or platform safety rejection stops before further mutation. No generic writer fallback is permitted.

## Explicit Non-Goals
No generic root write, no `safe_file_upload` as approval authority, no ZDT repurpose, no Honartik installer repurpose, no executor/helper/application/database mutation, and no public MCP cutover.
