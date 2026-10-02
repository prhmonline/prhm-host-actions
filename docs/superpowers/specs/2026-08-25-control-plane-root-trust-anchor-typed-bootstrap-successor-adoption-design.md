# Control Plane Root Trust Anchor Typed Bootstrap Successor Adoption Design

## Status
Approved: `SPEC_APPROVED_CONTROL_PLANE_ROOT_TRUST_ANCHOR_TYPED_BOOTSTRAP_SUCCESSOR_ADOPTION_V1`

## Problem
The legacy `control-plane-approval-bootstrap-recovery-v1.sh` and `.json` artifacts are referenced by fixed helper metadata, but their canonical bytes cannot be proven from current GitHub branches/history, current landing paths, or sanctioned stage inventory. Reconstructing those bytes would violate provenance requirements.

A newer installed mediator provides an authoritative successor chain with embedded Brotli+Base64 payloads and SHA verification:

- `control-plane-typed-bootstrap-transport-v1.js` — 72854 bytes — SHA256 `049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335`
- `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js` — 109634 bytes — SHA256 `d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e`

The current approval policy contains `host_action.control_plane_root_scripts_stage_transport_v1`, but the request registry currently rejects `control_plane_root_scripts_stage_transport_v1` with `host_action_v2_not_allowed`.

## Decision
Adopt the installed typed-bootstrap mediator chain as the canonical successor trust path. Do not recreate or execute the unproven legacy recovery-v1 bytes.

## Security invariants
1. Embedded payload bytes must decompress to exactly the documented byte counts and SHA-256 values before use.
2. No arbitrary command, path, repository, SQL, hostname, service, or artifact input may be accepted.
3. The operation remains Level-4 approval mediated.
4. Request without a registered action must fail closed.
5. Apply without a fresh valid Level-4 approval must fail closed.
6. Staging and registration changes must be transactional and invocation-bound; any partial failure triggers rollback of that invocation only.
7. No Park Bazar production application files or database rows are modified by successor adoption.
8. No fallback to legacy recovery-v1 bytes is allowed.
9. No generic shell carrier, self-SSH, sshpass, temporary systemd-run, broad ProtectHome/ReadWritePaths widening, or unrelated installer repurposing is allowed.

## Success criteria
TDD must prove embedded artifact integrity, exact action/policy binding, fail-closed request/apply behavior, duplicate-safe/idempotent adoption, rollback correctness, forbidden-surface absence, and a final no-Park-production-mutation audit. Only after these tests pass may a separate registration/apply Gate be considered.
