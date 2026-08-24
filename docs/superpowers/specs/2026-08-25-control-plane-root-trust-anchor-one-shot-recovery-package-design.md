# Control Plane Root Trust Anchor One-Shot Recovery Package Design

**Status:** APPROVED

**Approved gate:** `SPEC_APPROVED_CONTROL_PLANE_ROOT_TRUST_ANCHOR_ONE_SHOT_RECOVERY_PACKAGE_V1`

## Goal

Build a one-shot, SHA-bound recovery package that repairs only the current partial-promotion defect in the PRHM control-plane trust anchor. This package does not install Park Bazar v18 and does not mutate Park Production.

## Fixed baselines

- Base `/opt/prhm-agent-selfmaint/server.js`: `e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd`
- Executor `/opt/prhm-agent-selfmaint-exec/server.js`: `1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd`
- MCP `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`: `44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71`
- Approval policy `/opt/prhm-company-control-plane/config/approval-policy.json`: `c0cb39528b9658cc01d9c97f4011f9200efa9e0a862d202cf4ef82824594c9e0`
- Recovery shell artifact: `142383a58e5647a95bf2c7a4200772e7b7eb7cdde6783df991aec89d6f8151dd`
- Recovery JSON artifact: `b3918639f19a489373489e714c86c733f5b8c0a851727b2b65b3831b071cb1d2`

## Allowed behavior

The package may only:

1. Verify all four control-plane baselines before the first write.
2. Verify that `root_scripts_fixed_stage_v1` already exists in the executor implementation.
3. Register exactly `root_scripts_fixed_stage_v1` in the base registry.
4. Add the matching approval-policy scope for exactly that action.
5. Materialize exactly the two fixed recovery artifacts into the fixed recovery landing area with exact SHA verification.
6. Validate syntax/schema of touched control-plane files.
7. Restart only a fixed allowlist of required control-plane services.
8. Run fixed health checks.
9. Roll back every mutation from the same run on any failure.

## Explicitly forbidden

- arbitrary command or arbitrary path input
- generic shell executor
- SSH, self-SSH, or `sshpass`
- external network fetch, `curl`, or `wget`
- database mutation
- Park Production mutation
- Project Registry widening
- ProtectHome or ReadWritePaths widening beyond the fixed recovery action
- generic Host Action installer behavior
- invocation of `park_bazar_migrate_v1`

## Result contract

A successful result must include:

```text
ok=true
action=control_plane_root_trust_anchor_one_shot_recovery_v1
schema_version=prhm.root-trust-anchor-recovery-result.v1
baseline_verified=true
root_scripts_registered=true
approval_policy_registered=true
recovery_artifacts_verified=true
arbitrary_command=false
arbitrary_path=false
external_network=false
database_mutation=false
production_application_mutation=false
rollback_performed=false
```

## Failure behavior

The package is fail-closed. Baseline drift, artifact SHA mismatch, missing executor implementation, ambiguous registry/policy anchors, schema/syntax validation failure, restart failure, or health-check failure must abort the run. If any write already occurred, the package must restore all files/artifacts changed by the run and report `rollback_performed=true`.

## Idempotency

A second run against an already-correct state must be duplicate-safe: no duplicate registry or policy entry may be created, artifact contents must remain byte-identical, and the result must identify the state as already repaired or unchanged.

## Testing requirements

TDD is mandatory. Tests must prove:

- genuine RED before implementation
- baseline drift rejection
- recovery artifact SHA mismatch rejection
- partial registry/policy state handling
- duplicate-safe execution
- failure after first write triggers complete rollback
- final GREEN with all invariants true
- forbidden capability scan remains clean

## Production boundary

This recovery package must not touch either Park root, the Park database, Park systemd service, slider data, event rows, or the legacy Park migration wrapper. Park remains `NO-GO / NOT DELIVERY READY` until a later dedicated production-finalization gate passes all P0 checks.
