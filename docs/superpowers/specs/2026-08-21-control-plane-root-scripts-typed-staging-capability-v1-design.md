# Control Plane Root Scripts Typed Staging Capability V1 — Design

## Status
Design review approved in chat for written-spec capture. This document authorizes no implementation, self-maintenance request, MCP restart/refresh, staging mutation, Root-of-Trust preflight, DeployHQ operation, or Control Plane apply.

## Purpose
Provide one narrowly fixed MCP capability that can stage exactly the two immutable artifacts required by the Control Plane Bootstrap Root-of-Trust ceremony and execute only their fixed host `--preflight-only` path. It must not create a reusable root-file writer, generic script runner, arbitrary package installer, shell bridge, or application deployment primitive.

## Existing Trust Path
The capability is installed only by replacing the already-existing MCP source file `src/plugins/safeFiles.js` through the existing SHA-bound `selfmaint_request(target=agent_mcp)` / `selfmaint_apply` flow. Self-maintenance may replace existing files only; this design intentionally creates no new bootstrap helper for installing itself.

Last observed live source evidence, for compatibility review only and never as a permanent assumption:
- `src/plugins/safeFiles.js`: 20090 bytes, SHA-256 `9f291891673806e34d2681ba7b8227ddd4470f73cec12f69a7c3e9035808caa2`
- self-maintenance replacement ceiling: 120000 bytes
- MCP Blue runs without an explicit `User=` assignment, under `ProtectHome=read-only` and `ProtectSystem=full`

Immediately before any implementation request, the live source SHA and service topology must be captured again. Drift fails closed until the candidate is explicitly rebased and retested.


## Candidate Artifact Boundary Amendment V1
Development Tasks 1-6 run only in `prhmonline/prhm-host-actions`. The live MCP repository is not a development worktree for this change.

- Development candidate artifact: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Production deployment target later: `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js`
- The candidate MUST begin from the freshly captured live baseline bytes and then contain only the reviewed capability change.
- Tasks 1-6 MUST NOT edit, commit, upload, or self-maintain the live MCP file.
- Task 7, under a separate production gate, binds `selfmaint_request(target=agent_mcp, path=src/plugins/safeFiles.js)` to the fresh live old SHA and the exact immutable candidate bytes.
- The candidate artifact itself is never executed from the `prhm-host-actions` repository and is not a generic deployment script.

This amendment changes only the development artifact boundary. All fixed tool schemas, Approval Center requirements, filesystem confinement, size ceiling, no-network rule, and separate production gates remain unchanged.

## Capability Identity
- Capability id: `control_plane_root_scripts_typed_staging_capability_v1`
- Development candidate artifact: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`; the existing live MCP file `src/plugins/safeFiles.js` is replaced only later through the separately approved self-maintenance gate
- New generic writer: none
- New Executor action: none
- New helper file required to install capability: none
- Caller-controlled command/path/URL/repository/commit/content/environment/credential fields: none

## Fixed Artifact Identity
The candidate bytes are bound to immutable repository commit:
- Repository: `prhmonline/prhm-host-actions`
- Source commit: `51027bc81f16840580b3ed5ca09d6c42f78dc044`

Artifact 1:
- Name: `control-plane-typed-bootstrap-transport-v1.js`
- Bytes: `72854`
- SHA-256: `049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335`

Artifact 2:
- Name: `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`
- Bytes: `109634`
- SHA-256: `d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e`

Embedded transport package identity:
- Package id: `deployhq_control_adapter_node1_recreate_v1`
- Manifest SHA-256: `aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728`

No mutable `HEAD`, branch tip, tag, external URL argument, or caller-provided SHA is accepted at runtime.

## Fixed Staging Root
The capability writes only under:

`/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/`

The previously considered `/root/...` staging location is explicitly abandoned because MCP is intentionally constrained by `ProtectHome=read-only`. This design must not weaken that sandbox.

Fixed staged filenames are exactly:
- `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/control-plane-typed-bootstrap-transport-v1.js`
- `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`

No request field may alter either destination.

## Tool Surface
The capability adds exactly three fixed tools.

### 1. `control_plane_root_scripts_stage_transport_v1`
Purpose: stage both immutable artifacts atomically/scopably.

Input surface:
- `second_confirmation`: literal `CONFIRM_LEVEL_4_CRITICAL`
- approval-bound fields required by the existing Approval Center integration, if represented by runtime metadata rather than user-visible schema

No other caller input is accepted.

The tool must require both:
1. the fresh literal Level-4 confirmation; and
2. successful validation and single-use consumption through the existing company Approval Center using a fixed operation identity for this exact stage action.

A literal confirmation alone must never authorize filesystem mutation.

Operation identity:
`host_action.control_plane_root_scripts_stage_transport_v1`

Risk/environment:
- risk: `critical`
- environment: `production`
- approval: fresh, scoped, single-use Level-4

Stage semantics:
1. validate approval before write;
2. ensure the staging root resolves exactly and is not a symlink;
3. reject a symlink or non-regular pre-existing destination;
4. materialize only the two fixed embedded artifact byte sequences;
5. verify expected byte length before commit;
6. verify expected SHA-256 before commit;
7. write through invocation-owned temporary files in the same fixed staging directory;
8. set ownership `root:root` and mode `0600`;
9. atomically rename into the two exact destination filenames;
10. re-read and verify byte length and SHA-256 after commit;
11. on partial failure, roll back only files created/replaced by this invocation and persist bounded evidence.

No service restart or Control Plane destination mutation is permitted.

### 2. `control_plane_root_scripts_stage_transport_status_v1`
Purpose: read bounded staging evidence only.

Input surface: empty.

Returns only bounded metadata for the two fixed staged paths:
- exists
- regular_file
- symlink=false/true
- bytes
- sha256
- mode
- owner/group identity in non-secret form
- ready

It never returns artifact content, environment data, credentials, headers, tokens, private keys, or unrelated directory listings.

### 3. `control_plane_root_scripts_transport_preflight_v1`
Purpose: execute only the already-staged registration bootstrap in its supported read-only host preflight mode.

Input surface: empty.

Before execution it must independently revalidate both fixed staged artifact paths, byte lengths, SHA-256 values, regular-file status, non-symlink status, ownership, and mode.

The only permitted executable invocation is semantically equivalent to:

`/usr/local/bin/prhm-node /var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js --preflight-only`

Implementation must use a fixed executable and fixed argv through `execFile`/`spawn`-style APIs; shell execution is forbidden. No alternate arguments are reachable. `--apply` must be structurally unreachable from this capability.

Expected output must prove the registration bootstrap remained preflight-only and did not mutate production destinations or services. Any missing or contradictory evidence fails closed.

## Embedded Artifact Packaging and Size Gate
The two immutable artifacts may be stored inside the existing MCP source as deterministic compressed/base64 constants or another deterministic byte representation, provided decoding cannot be influenced by caller input.

Hard implementation gate:

`FINAL_SAFEFILES_JS_BYTES <= 120000`

The complete replacement `src/plugins/safeFiles.js` must remain within the existing self-maintenance payload ceiling. If it does not, implementation stops. There is no automatic fallback to network fetch, mutable Git checkout, new helper bootstrap, generic upload, shell pipeline, or weakened self-maintenance validation.

The implementation plan must include deterministic reconstruction tests proving reconstructed bytes exactly match the two fixed SHA-256 values and byte lengths.

## Approval and Confirmation Boundary
Capability installation, public schema exposure, staging, and later Root-of-Trust apply remain distinct gates.

No confirmation may be reused across gates.

Required sequence:
1. implement and test candidate `safeFiles.js` change off-host;
2. create a SHA-bound `selfmaint_request(target=agent_mcp)` for that exact existing file;
3. obtain a fresh `CONFIRM_LEVEL_4_CRITICAL` and consume it only for capability source installation;
4. verify installed source SHA and legacy MCP health;
5. perform separately approved MCP rolling schema refresh/exposure through the existing governed ZDT path;
6. create/validate a separate Approval Center request for `control_plane_root_scripts_stage_transport_v1` and obtain a fresh Level-4 confirmation;
7. stage the two exact artifacts;
8. run the fixed preflight-only tool and verify evidence;
9. only later enter `CONTROL_PLANE_BOOTSTRAP_ROOT_OF_TRUST_APPLY_V1` with another fresh approval/confirmation.

The staging capability itself never executes the Root-of-Trust `--apply` operation.

## Explicitly Forbidden Behavior
The capability must not expose or perform:
- arbitrary path writes;
- arbitrary content writes;
- arbitrary command or argument execution;
- arbitrary URL/repository/branch/tag/commit/SHA inputs;
- mutable `HEAD` or network artifact fetch at execution time;
- shell invocation, `eval`, `exec`, `curl | bash`, `wget | sh`, or equivalent streamed execution;
- generic `root_scripts` widening;
- `/root` write enablement or weakening of `ProtectHome=read-only`;
- weakening of `ProtectSystem=full`;
- generic safe-file upload behavior for root paths;
- `systemctl restart`, `reload`, or `daemon-reload` from the staging/preflight tools;
- public MCP cutover from the capability itself;
- Control Plane Base/Executor/Policy/MCP/ZDT destination installation;
- DeployHQ API calls or node1 recreation;
- credential provisioning or reading credential values;
- Honartik, iMotion, database, redirect, canonical, SEO, or application mutation.

## Rollback Boundary
Staging rollback is invocation-bound only. The stage tool may restore or remove only the two fixed staging destinations that it changed during that invocation. It must not perform broad directory cleanup or touch installed Control Plane files.

If rollback fails, return/persist bounded critical evidence including `critical_failure=true` and `rollback_failed=true`, without secret values, then stop. No alternate remediation is executed automatically.

## MCP and Runtime Boundary
Installing the capability source through self-maintenance may restart only the service already defined by the existing self-maintenance target contract. Public Blue/Green/router exposure is not implied by source installation and remains a separate governed rolling-refresh step.

The capability must not patch MCP service hardening to gain filesystem access. If the fixed `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/` destination is not writable under the actual runtime confinement, implementation fails closed and the design must be revisited instead of weakening service protections.

## Acceptance Criteria
The implementation is acceptable only if all of the following are independently verified:
1. candidate modifies only intended existing MCP source/test/spec/plan surfaces;
2. final `safeFiles.js` payload is at most 120000 bytes;
3. current live `safeFiles.js` baseline is freshly captured and exact before creating self-maintenance request;
4. self-maintenance replacement is bound to the exact old SHA and exact new content;
5. no new generic privileged writer exists;
6. stage tool accepts no path/content/command/URL/repository/SHA parameters;
7. Approval Center validation and one-time consume are mandatory before staging mutation;
8. confirmation reuse is impossible across gates;
9. both reconstructed artifacts exactly match fixed byte lengths and SHA-256 values;
10. staging root and destination files reject symlinks/path escape;
11. writes are same-directory temporary-file plus atomic rename;
12. post-write byte/SHA verification passes;
13. status tool exposes metadata only and no file content;
14. preflight tool has fixed executable and fixed `--preflight-only` argv;
15. `--apply` is unreachable;
16. MCP sandbox settings remain unchanged;
17. `/root` is not made writable;
18. no service restart occurs from stage/status/preflight tool code;
19. no DeployHQ/Honartik/iMotion/database/application mutation occurs;
20. staging rollback is invocation-bound;
21. source installation, MCP rolling exposure, staging, and Root-of-Trust apply each require their own governed gate;
22. all implementation tests and syntax checks pass with zero skipped security cases.

## Required Test Classes
At minimum the implementation plan must include tests for:
- exact tool names and schemas;
- zero arbitrary input surface;
- Approval Center validation/consume requirement;
- invalid/replayed approval rejection;
- wrong embedded transport SHA rejection;
- wrong embedded bootstrap SHA rejection;
- wrong artifact length rejection;
- deterministic reconstruction;
- final source payload size ceiling;
- staging-root symlink rejection;
- destination symlink rejection;
- non-regular destination rejection;
- atomic write/journal ordering;
- partial-stage rollback;
- rollback-failure evidence;
- metadata-only status output;
- fixed preflight executable and argv;
- structural absence of `--apply` execution path;
- structural absence of generic command/path/content/URL inputs;
- no shell/eval/network execution;
- no systemctl mutation from capability;
- no sandbox hardening changes;
- no DeployHQ/Honartik/iMotion/application mutation.

## Out of Scope
- Root-of-Trust `--apply` execution.
- DeployHQ adapter package installation.
- canonical DeployHQ node1 recreation.
- Blue V4/public MCP cutover beyond the separately approved schema-exposure refresh required to expose this capability.
- iMotion target registration.
- Honartik temporary target cleanup.
- any application, database, SEO, redirect, canonical, payment, or credential changes.
