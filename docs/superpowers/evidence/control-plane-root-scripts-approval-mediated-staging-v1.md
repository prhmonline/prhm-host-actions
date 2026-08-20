# Control Plane Root Scripts Approval-Mediated Staging V1 — Candidate Evidence

## Scope
Development/review evidence only for the approved architecture in:
- Spec: `docs/superpowers/specs/2026-08-21-control-plane-root-scripts-typed-staging-capability-v1-design.md`
- Plan: `docs/superpowers/plans/2026-08-21-control-plane-root-scripts-approval-mediated-staging-architecture-v1.md`

This evidence does not authorize or record any production installation, self-maintenance request/apply, MCP rolling exposure, production staging, service restart, or Root-of-Trust apply.

## Reviewed Git Identity
- Branch: `design/control-plane-root-scripts-typed-staging-capability-v1`
- Verified implementation head before this evidence commit: `d7856240dad90ac4d3af692320533c9468b04f87`
- Spec commit: `32cd1c523f28e9cbdcd4f4af5e83dcd2f0652654`
- Plan commit: `bfc22274f1f38d0299cea9da98312982f919955e`

Implementation commits:
- Task 1 packaging: `0a4d798aba2f8d576149321b5d50fe1bdb0c7199`
- Task 2 mediator contract: `93fa30831b671f4179cd0d30ee8d009ac7d7eaae`
- Task 3 MCP facade: `b396184660d9cee767e0e0bb8af557bb811242b0`
- Task 4 atomic staging: `f0e9ac59e2e3effc7249e45909105603b5d2628b`
- Task 5 preflight-only: `1590b52c073952026d5add536a486ca6109c917d`
- Task 6 integration/security: `66e62b9e7422cbe4888497a5d9da88a0b940104f`
- Final review hardening: `d7856240dad90ac4d3af692320533c9468b04f87`

## Candidate Identities
### MCP safeFiles candidate
- Path: `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`
- Bytes: `114436`
- SHA-256: `780348a1a10ec4b8d188e8fdda8c348f5544115a0cf37bf58bc18b3342a7630c`
- Self-maintenance ceiling: `120000`
- Ceiling gate: `PASS`
- Verified live baseline source identity: `20090` bytes / `9f291891673806e34d2681ba7b8227ddd4470f73cec12f69a7c3e9035808caa2`

### Privileged mediator candidate
- Path: `candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js`
- Bytes: `106190`
- SHA-256: `e8fc3f5185f01efeca5563490461566f64fc8bda1534bad5a3c39e73a7108abb`

Both candidate blobs were re-read from GitHub at head `d7856240dad90ac4d3af692320533c9468b04f87` and independently SHA-256 verified byte-for-byte against the locally tested candidates.

## Immutable Staged Artifact Bindings
- Source commit: `51027bc81f16840580b3ed5ca09d6c42f78dc044`
- `control-plane-typed-bootstrap-transport-v1.js`: `72854` bytes / `049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335`
- `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`: `109634` bytes / `d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e`
- Embedded transport package manifest SHA-256: `aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728`
- Runtime artifact fetch: `NO`

## Fixed MCP Surface
Exactly four MCP-facing tool names are implemented:
1. `control_plane_root_scripts_stage_transport_request_v1`
2. `control_plane_root_scripts_stage_transport_apply_v1`
3. `control_plane_root_scripts_stage_transport_status_v1`
4. `control_plane_root_scripts_transport_preflight_v1`

Fixed mediator socket identity in the MCP candidate:
`/run/prhm-root-scripts-stage-mediator-v1/mediator.sock`

Caller-visible approval token: `NO`
Caller-controlled path/content/command/URL/repository/SHA/project/role/environment/risk: `NO`

## Fresh Verification
Command class executed after final review hardening:
- full focused Node test suite
- `node --check` on both candidates
- byte count and SHA-256 on both candidates
- bounded security-surface assertions

Results:
```text
TESTS=32
PASS=32
FAIL=0
SKIPPED=0
TODO=0
SAFEFILES_SYNTAX=PASS
MEDIATOR_SYNTAX=PASS
SAFEFILES_SIZE_GATE=PASS
MCP_APPROVAL_TOKEN_SURFACE=PASS
MCP_ARBITRARY_SCHEMA_SURFACE=PASS
MCP_EXACT_FOUR_TOOLS=PASS
MEDIATOR_APPLY_ARGV_UNREACHABLE=PASS
MEDIATOR_PREFLIGHT_ONLY=PASS
EXACT_STAGING_DIRECTORY_GUARD=PASS
FIXED_OPERATION_BINDING=PASS
```

TDD/security cases include:
- exact immutable artifact reconstruction and SHA/byte checks
- fixed Level-4 request binding and deterministic arguments hash
- wrong confirmation/mismatched request/validation/consume/replay fail-closed behavior
- approval token non-exposure
- exact four MCP schemas
- fixed Unix-socket route surface
- exact two-file staging only
- unexpected staging-directory entry rejection before mutation and preflight
- symlink/non-regular destination rejection
- same-directory temporary writes and atomic rename
- second-file failure rollback
- rollback-failure critical evidence
- staged-file tamper/mode rejection before preflight
- fixed `/usr/local/bin/prhm-node <fixed-bootstrap> --preflight-only`, `shell:false`
- contradictory preflight evidence rejection
- end-to-end request → apply → stage → status → preflight using a development-only Unix socket and fake Approval Center adapters

## Independent Review
Final scoped semantic security re-review after exact-directory hardening:
```text
CRITICAL=0
IMPORTANT=0
MINOR=0
VERDICT=compliant
```

Ruling recorded from review: production listener/service installation is intentionally outside this development plan. Its separate installation gate MUST enforce a fixed socket parent directory mode `0700`, socket mode `0600`, fixed ownership, no alternate listener path, and no broad local access.

## Live Integration Prerequisite
Read-only live policy inspection found that operation:
`host_action.control_plane_root_scripts_stage_transport_v1`

is not currently present in `/opt/prhm-company-control-plane/config/approval-policy.json`.

Therefore the future mediator installation gate MUST register the exact fixed Approval Policy operation at Level-4 and bind it to the mediator contract. Until that occurs, Production request creation is expected to fail closed under default-deny.

```text
LIVE_POLICY_OPERATION_PRESENT=NO
POLICY_REGISTRATION_REQUIRED_BEFORE_MEDIATOR_USE=YES
```

## Explicit Production Boundary
```text
PRODUCTION_MUTATION=NO
SELFMAINT_REQUEST=NO
SELFMAINT_APPLY=NO
MCP_ROLLING_REFRESH=NO
PRODUCTION_STAGING=NO
ROOT_OF_TRUST_APPLY=NO
SERVICE_RESTART=NO
DEPLOYHQ_MUTATION=NO
NODE1_RECREATED=NO
HONARTIK_MUTATION=NO
IMOTION_MUTATION=NO
DATABASE_MUTATION=NO
APPLICATION_MUTATION=NO
```

## Next Governed Gate
The first production-facing step is not MCP self-maintenance and not staging. The mediator/policy boundary must be installed first under its own reviewed, SHA-bound gate:

`CONTROL_PLANE_ROOT_SCRIPTS_APPROVAL_MEDIATOR_INSTALL_V1`

That gate must cover only the exact mediator candidate, exact Approval Policy registration, fixed service/socket confinement, health/status verification, and invocation-bound rollback. It must not install the MCP candidate, expose public MCP schema, stage the Root-of-Trust artifacts, or execute Root-of-Trust apply.
