# Control Plane Root of Trust Out-of-Band Fixed Seed Provision Design

## Status
Approved: `SPEC_APPROVED_CONTROL_PLANE_ROOT_OF_TRUST_OUT_OF_BAND_FIXED_SEED_PROVISION_V1`

## Problem
The live Control Plane has no native root install trust anchor capable of promoting a new fixed Host Action across base registry, executor, MCP and approval policy. MCP-only bootstraps are insufficient because the verifier installer action is absent from base/executor. Reusing unrelated installers or generic write/shell paths would violate fail-closed trust boundaries.

## Decision
Provision a one-shot, out-of-band, zero-input, SHA-bound seed whose only purpose is to install the already-tested `control_plane_typed_bootstrap_fixed_verifier_native_install_v1` action. The seed is not a generic installer and is disabled/consumed after successful promotion.

## Fixed bindings
- Native installer action: `control_plane_typed_bootstrap_fixed_verifier_native_install_v1`
- Bootstrap target: `control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1`
- Verifier target: `control_plane_typed_bootstrap_embedded_payload_integrity_verify_v1`
- Native installer implementation SHA256: `eeeccf448d9792ea69df4313864374945684e7cbb1ae6b0eedfa37b84d51f369`
- Native installer test SHA256: `7fb9e74d823dafc967928b65ef16bff74489d108aa2642399c027da660708a8c`
- Native installer manifest SHA256: `a75182d3a5160b38e27e396765e0a7fd9d1aed5e556e2f6b566c5dcdcca29d99`
- Verifier implementation SHA256: `f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a`

## Security invariants
1. Zero runtime inputs: no arbitrary command, path, repository, URL, SQL, hostname, service, payload or artifact selector.
2. Fresh preflight must verify exact current SHA256 values for `/opt/prhm-agent-selfmaint/server.js`, `/opt/prhm-agent-selfmaint-exec/server.js`, `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`, and `/opt/prhm-company-control-plane/config/approval-policy.json`. Any drift aborts before write.
3. The seed may install only the fixed native installer action and exact bound artifact bytes.
4. Before-images for all mutated files are captured before the first write. Partial failure causes reverse-order invocation-local rollback.
5. Syntax/config validation is mandatory before service reload.
6. Only a fixed allowlist of control-plane services may be reloaded.
7. Post-activation verification must prove a real `host_action_v2_request` for the newly installed native installer is accepted. File presence alone is not success.
8. The seed must become consumed/disabled after successful promotion and cannot be reused for another action.
9. No Park Bazar production application or database mutation occurs in this Gate.
10. No generic shell carrier, self-SSH, sshpass, temporary systemd-run, traversal, sibling-path hack, ProtectHome/ReadWritePaths widening, broad registry/policy wildcarding, or unrelated installer repurposing.

## Success criteria
The seed is considered provisioned only when TDD proves fail-closed baseline binding, exact artifact binding, rollback at every partial-write point, idempotent/consumed behavior, forbidden-surface absence, and a post-provision request probe proves the new native installer action is recognized. Production Park remains byte-identical during this Gate.
