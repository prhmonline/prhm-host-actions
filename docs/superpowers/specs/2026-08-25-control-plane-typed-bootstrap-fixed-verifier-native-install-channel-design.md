# Control Plane Typed Bootstrap Fixed Verifier Native Install Channel Design

## Status
Approved: `SPEC_APPROVED_CONTROL_PLANE_TYPED_BOOTSTRAP_FIXED_VERIFIER_NATIVE_BOOTSTRAP_INSTALL_CHANNEL_V1`

## Goal
Provide a native, fixed, zero-input Host Actions v2 installation channel that can register `control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1`, which in turn exposes the already-tested verifier `control_plane_typed_bootstrap_embedded_payload_integrity_verify_v1`.

## Canonical inputs
- Bootstrap planner commit: `0d40e9e051cc39d23fed106fd7b301c7e1654568`
- Verifier implementation SHA-256: `f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a`
- Bootstrap action: `control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1`
- Native installer action: `control_plane_typed_bootstrap_fixed_verifier_native_install_v1`
- Verifier tool/action target: `control_plane_typed_bootstrap_embedded_payload_integrity_verify_v1`

## Architecture
The installer is action-specific and accepts no command, path, repository, artifact, service, network, SQL, credential or payload input. It validates exact current SHA-256 baselines for the control-plane base registry, executor, MCP Host Actions v2 plugin and approval policy before any mutation. It then performs the minimum deterministic registration needed across those four surfaces, with invocation-local before-images, reverse-order rollback, idempotency and strict result validation.

## Security invariants
1. Level-4 approval is mandatory and one-time-use semantics remain unchanged.
2. No generic shell carrier, self-SSH, sshpass, traversal, sibling-path tricks, temporary `systemd-run`, or sandbox widening may be introduced.
3. Do not repurpose `host_action_v2_installer_v1`; it remains Honartik-specific.
4. Do not broaden Project Registry, `ProtectHome`, `ReadWritePaths`, or approval policy scopes.
5. The installer only registers the fixed bootstrap action and its exact operation/policy bindings.
6. Any baseline drift, ambiguous anchor, malformed policy, duplicate/conflicting registration, artifact SHA mismatch, or verification failure must fail closed before success is reported.
7. Every partial mutation must be rolled back to byte-identical before-images.
8. A second identical run is idempotent and reports no effective change.
9. This design does not modify Park Bazar production files or database state.

## Success criteria
TDD must prove baseline-drift rejection, exact action/operation binding, malformed and ambiguous anchor rejection, duplicate/conflict handling, rollback at every mutation boundary, Level-4 contract enforcement, forbidden-surface absence, second-run idempotency, manifest SHA binding and immutable GitHub read-back. Server-side apply is explicitly out of scope for the TDD/build Gate.
