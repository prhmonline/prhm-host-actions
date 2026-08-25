# Lower-Level Bootstrap Amendment — Existing Root Scripts Stage Mediator V1

## Status
Approved in chat as `SPEC_AMENDMENT_APPROVED_PRHM_LOWER_LEVEL_BOOTSTRAP_USE_EXISTING_ROOT_SCRIPTS_STAGE_MEDIATOR_V1`.

## Discovery
A fixed root-scripts mediator already exists at `/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/` and is active as `prhm-root-scripts-stage-mediator-v1.service`. Its fixed Unix socket is `/run/prhm-root-scripts-stage-mediator-v1/mediator.sock`.

The live approval policy already binds `control_plane_root_scripts_stage_transport_v1` to `host_action.control_plane_root_scripts_stage_transport_v1` at Level 4. The mediator owns request, decision, validation, consume, preflight, and fixed staging transactions; therefore a new Agent API approval bridge is unnecessary.

## Revised Architecture
`existing fixed mediator -> one-file MCP facade -> existing typed bootstrap transport -> First-Install Bridge -> root_scripts_fixed_stage_request_v1`

## MCP Surface
Exactly three tools are permitted:
- `control_plane_root_scripts_stage_preflight_v1()`
- `control_plane_root_scripts_stage_request_v1()`
- `control_plane_root_scripts_stage_apply_v1(request_id, second_confirmation)`

The first two tools accept zero input. The apply tool accepts only a UUID request id and the literal `CONFIRM_LEVEL_4_CRITICAL`.

## Fixed Boundary
The facade may only connect to `/run/prhm-root-scripts-stage-mediator-v1/mediator.sock` and may only call `POST /v1/preflight`, `POST /v1/request`, and `POST /v1/apply`. It may not accept or synthesize runtime action, path, command, payload, SHA, repository, URL, service, SQL, credential, token, host, port, or environment inputs.

## Fail-Closed Rules
Invalid UUID, wrong second confirmation, unexpected route, socket failure, timeout, oversized response, non-2xx response, invalid JSON, or mediator `ok !== true` stops the operation. No Agent API bridge, generic writer, arbitrary shell, safe-file authority, ZDT repurpose, Honartik repurpose, or alternate approval path is permitted.

## Mutation Boundary
This amendment gate persists and tests code only. Live MCP mutation requires a separate self-maintenance request against the freshly re-read `src/plugins/selfmaint.js` baseline and a separate Level-4 apply confirmation.
