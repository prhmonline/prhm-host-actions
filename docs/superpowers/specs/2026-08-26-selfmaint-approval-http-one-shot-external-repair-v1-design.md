# PRHM Control Plane Selfmaint Approval HTTP One-Shot External Repair V1 — Design

## Status

Design approved in chat by `SPEC_APPROVED_PRHM_CONTROL_PLANE_SELFMAINT_APPROVAL_HTTP_ONE_SHOT_EXTERNAL_REPAIR_PRIMITIVE_V1`.

This document defines a one-shot, SHA-bound external repair primitive for the live PRHM self-maintenance approval HTTP transport. It is intentionally outside the broken selfmaint/Host Actions request path. No production execution is authorized by this document alone.

## Problem

The live self-maintenance service creates approval requests through `approvalHttp()`. That function currently enters the network namespace of `prhm-company-registry.service` and then calls `http://127.0.0.1:18133`. Approval Center listens on host loopback, so `127.0.0.1:18133` inside the Registry network namespace is not the host loopback listener and the request fails with connection refused.

Observed failure path:

`selfmaint_request -> approvalHttp() -> nsenter -t <registry_pid> -n -> curl http://127.0.0.1:18133 -> ECONNREFUSED`.

Host evidence simultaneously shows `prhm-company-approval.service` active/running and host `127.0.0.1:18133` listening.

## Fixed Identity

- Primitive name: `prhm-selfmaint-approval-http-one-shot-repair-v1`
- Inputs: none
- Target count: exactly one
- Target: `/opt/prhm-agent-selfmaint/server.js`
- Frozen live preimage SHA-256: `6c28dc9f2ac7dee674f4382de0a2da422c56198243e8a2790c5ad5e6bdabcddb`
- Service allowed to restart: `prhm-agent-selfmaint.service` only
- Repair lifetime: one successful execution

The primitive accepts no caller-supplied path, command, content, URL, host, port, SHA, service, action, repository, credential, environment, SQL, or arbitrary payload.

## Exact Repair Contract

The only semantic change is within `approvalHttp()`.

The current implementation constructs argv beginning with:

`['-t', registryPid(), '-n', 'curl', ...fixed curl arguments...]`

and invokes:

`cp.spawnSync('nsenter', args, ...)`.

The repaired implementation must instead construct argv containing only the existing fixed curl arguments:

`['-sS', '--max-time', '8', '-X', method, ...existing headers/body..., fixed URL]`

and invoke:

`cp.spawnSync('curl', args, ...)`.

Therefore the approved semantic delta has exactly two coupled parts:

1. executable: `nsenter` -> `curl`;
2. argv prefix: remove exactly `'-t', registryPid(), '-n', 'curl'`.

Applying only one of these two changes is invalid and must fail verification.

The fixed Approval Center URL remains exactly `http://127.0.0.1:18133`.

The repair does not change:

- Approval Center URL;
- approval request/decision endpoints;
- request or decision tokens;
- request body or binding fields;
- TTL;
- Level-4 confirmation literal;
- validate/consume flow;
- selfmaint target/path allowlists;
- Host Actions registry;
- approval policy;
- executor code;
- MCP code;
- Registry service or network configuration.

`registryPid()` may remain unused after the repair. Removing unrelated dead code is explicitly out of scope.

## Preflight

Preflight is zero-write and must fail closed unless every condition passes:

1. effective UID is root;
2. target exists and is a regular file;
3. target is not a symlink;
4. target realpath equals the exact target path;
5. current SHA-256 equals the frozen preimage SHA;
6. the exact broken `approvalHttp()` anchor occurs once;
7. the exact fixed `approvalHttp()` anchor occurs zero times;
8. Approval Center service is active;
9. host-loopback `127.0.0.1:18133` is reachable;
10. generated candidate passes Node syntax validation;
11. generated candidate differs from the preimage only by the two coupled changes defined in Exact Repair Contract.

Any mismatch produces a non-zero failure before any persistent write.

## Apply Sequence

1. Repeat all preflight checks immediately before mutation.
2. Generate the complete fixed candidate in memory.
3. Validate candidate syntax with the fixed Node runtime.
4. Compute and bind the deterministic candidate/postimage SHA-256 before mutation.
5. Create an invocation-bound backup under a fixed repair-specific backup root.
6. Preserve original ownership and mode.
7. Write to a temporary file in the target filesystem and atomically rename over the target.
8. Verify the installed SHA equals the bound deterministic postimage SHA.
9. Restart only `prhm-agent-selfmaint.service`.
10. Verify the service is active and its `/health` response is healthy.
11. Perform a request-only end-to-end acceptance using the immutable embedded MCP selfmaint replacement bytes defined below.
12. Persist bounded success evidence.
13. Persist retirement state so subsequent executions perform no mutation.

## Acceptance Probe

Acceptance must create a real Level-4 self-maintenance request but must not apply it.

Acceptance target:

- `target=agent_mcp`
- `path=src/plugins/selfmaint.js`
- expected live SHA-256: `0cc9fd75a064fdee5e4c2f161fa8bc0c4470e65cb3b079ce3abe67113b6676ab`
- prepared candidate SHA-256: `59498a1de0b9607b73674e44c2aaa8e12652cff567e0927f508a57dcb764ffdb`

The implementation artifact must contain the complete prepared MCP candidate bytes internally as immutable data or as an immutable build-time sibling artifact whose exact SHA is hard-coded. It must verify those bytes equal `59498a1de0b9607b73674e44c2aaa8e12652cff567e0927f508a57dcb764ffdb` before issuing the acceptance request. It may not read replacement content from an arbitrary runtime path, URL, repository, stdin, environment variable, or caller input.

Acceptance succeeds only if a correctly bound Level-4 request ID is returned for the exact MCP target/path/preimage/candidate. The probe must not invoke `selfmaint_apply`.

## Rollback

If any verification after the first persistent write fails:

1. restore the invocation-bound backup atomically;
2. restart only `prhm-agent-selfmaint.service`;
3. verify the original SHA is restored;
4. verify selfmaint health;
5. persist rollback evidence;
6. return failure.

If rollback itself fails, persist explicit critical evidence and never record success or retirement.

A failed acceptance probe after the selfmaint source change counts as a post-write verification failure and therefore triggers rollback.

## Retirement

State path is fixed under:

`/var/lib/prhm-agent-selfmaint-exec/selfmaint-approval-http-one-shot-repair-v1/state.json`

Successful state must include at least:

- schema version;
- `completed=true`;
- `retired=true`;
- preimage SHA-256;
- postimage SHA-256;
- acceptance request ID;
- timestamp;
- rollback status.

A second execution returns `already_completed` and performs zero writes, zero requests, and zero service operations.

The executable artifact may remain present for audit. Code presence does not imply re-execution authority.

## TDD Requirements

Implementation must be test-first and cover at least:

- exact preimage eligibility;
- wrong preimage fail-closed;
- symlink rejection;
- wrong realpath rejection;
- zero-write preflight;
- broken anchor occurs exactly once;
- missing/duplicate anchor rejection;
- both coupled transport edits required together;
- candidate syntax success;
- semantic delta limited to the approved repair;
- deterministic postimage SHA binding;
- immutable acceptance candidate SHA verification;
- backup and atomic replacement;
- service restart failure rollback;
- post-restart health failure rollback;
- postimage SHA mismatch rollback;
- request-only acceptance success;
- acceptance binding exact target/path/preimage/candidate;
- acceptance does not apply the MCP patch;
- acceptance failure triggers rollback;
- second execution returns already-completed with no request/mutation;
- rollback failure records critical evidence.

## Execution Authority and Bootstrap Constraint

This primitive cannot be installed or executed through the currently broken `selfmaint_request`, the Host Actions request path that shares the same approval transport, or by repurposing unrelated fixed actions.

The design does not authorize any of the following:

- generic `ops_execute` write;
- generic root shell;
- generic safe-file overwrite as root authority;
- `safe_file_upload` as approval authority;
- ZDT bootstrap repurposing;
- Honartik installer repurposing;
- DeployHQ revival;
- policy broadening;
- arbitrary path/command/action/content execution.

Production execution therefore requires a separately identified and sanctioned out-of-band root/operator channel that can execute the exact immutable artifact. If no such channel exists, implementation may be built and verified but production repair remains blocked at the external root-of-trust boundary.

## Out of Scope

- changing Approval Center or Registry topology;
- joining network namespaces;
- firewall/security relaxation;
- modifying approval policy;
- modifying executor, MCP, application, or database state;
- installing a generic future root-execution mechanism;
- merging unrelated cleanup/refactoring.

## Gate Sequence

1. Written spec review approval.
2. Write implementation plan.
3. TDD the one-shot immutable repair artifact.
4. Verify exact artifact bytes/SHA and deterministic postimage SHA.
5. Discover/verify a sanctioned out-of-band execution channel.
6. If none exists, stop fail-closed at the external root-of-trust boundary.
7. If one exists, require a fresh critical execution approval at the actual apply boundary.
8. Execute one-shot repair and verify request-only acceptance.
9. Verify retirement.
10. Resume the MCP facade selfmaint request/apply chain.
