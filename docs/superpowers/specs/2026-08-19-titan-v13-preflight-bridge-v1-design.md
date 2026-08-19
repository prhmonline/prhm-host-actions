# Titan V13 Preflight Bridge V1 — Design

## Goal
Provide one fixed, read-only bridge through the already-exposed `agent_zero_downtime_bootstrap_v1` path so the live Control Plane can execute exactly `bootstrap-host-actions-v13-titan-staged-production-finalize.js --preflight-only` without exposing arbitrary shell, registering Titan V13, issuing TLS, or mutating Production.

## Problem
The Titan V13 bootstrap exists on `design/titan-host-action-v1`, but `titan_staged_production_finalize_v1` is not yet present in the live `host_action_v2_request` enum. The generic read executor cannot execute the bootstrap and the write executor accepts only typed JSON. Adding another new Host Action solely for preflight would recreate the same schema/bootstrap chicken-and-egg problem.

## Chosen approach
Extend the already-exposed `agent_zero_downtime_bootstrap_v1` implementation with one fixed child-preflight operation for Titan V13. This is not a generic command runner. The bridge has no user-controlled hostname, path, branch, ref, command, service, or argument fields.

The bridge must be hard-bound to:
- repository: `prhmonline/prhm-host-actions`
- branch: `design/titan-host-action-v1`
- bootstrap path: `bootstrap-host-actions-v13-titan-staged-production-finalize.js`
- execution argument: exactly `--preflight-only`
- expected action result: `titan_staged_production_finalize_v1`

## Security invariants
1. No arbitrary shell, command, path, hostname, service, repository, branch, ref, or arguments may be supplied by the caller.
2. The bridge may execute only the fixed Titan V13 bootstrap preflight.
3. `--preflight-only` is mandatory and no install/register mode is reachable through this bridge.
4. The bridge must fail closed if the fixed repository/ref/artifact identity does not match the approved state.
5. No secret, private key, token, Authorization header, ACME account material, or environment secret may be printed.
6. No registration, TLS issuance, Nginx mutation, service reload/restart, migration, payment, SMS, or PR merge may occur.
7. The child result is accepted only if all required read-only invariants are explicitly present and PASS.
8. Any malformed, partial, ambiguous, or unexpected child output is a hard failure.

## Artifact binding
The bridge must bind to the approved Titan PR state rather than fetching or executing an arbitrary moving target.

At minimum it must verify:
- repository is exactly `prhmonline/prhm-host-actions`;
- branch is exactly `design/titan-host-action-v1`;
- bootstrap file path is exact;
- the expected Git blob identity is pinned by the implementation or a stronger content SHA-256 derived from the exact approved bootstrap bytes;
- the fetched/materialized bootstrap content matches that expected identity before execution.

If the Titan branch advances, the bridge must fail closed until the expected artifact identity is intentionally updated and reviewed.

## Execution contract
The bridge launches the fixed bootstrap through the trusted PRHM Node runtime with exactly one argument:

`--preflight-only`

No second child argument is permitted. No environment-provided command expansion is permitted. The bridge should use a minimal inherited environment and must not echo the environment.

## Required child PASS contract
The bridge reports PASS only when the child exits successfully and its JSON result satisfies all of:
- `ok === true`
- `preflight_only === true`
- `production_mutation === false`
- `database_mutation === false`
- `action === 'titan_staged_production_finalize_v1'`
- baseline/state guard PASS
- helper preflight PASS
- control-plane candidate validation PASS

The exact internal field names for the final three gates must be taken from the current Titan V13 bootstrap output contract. If the bootstrap exposes nested objects, validation must be explicit rather than truthy/loose.

## Bridge result
The bridge returns a bounded result containing only:
- overall PASS/FAIL;
- bridge schema/version;
- fixed operation name;
- non-secret artifact fingerprints;
- fixed repository/branch/bootstrap identifiers;
- child exit/pass state;
- the required Titan preflight gate statuses;
- `production_mutation:false`;
- `database_mutation:false`;
- `registration:false`;
- `tls_issuance:false`;
- `nginx_mutation:false`;
- `service_reload_restart:false`.

It must not proxy arbitrary child stdout/stderr if that could expose secrets. Child errors must be reduced to bounded error classes/messages after redaction.

## Control-plane exposure
The preferred implementation reuses the existing exposed `agent_zero_downtime_bootstrap_v1` request/apply contract and adds a fixed internal Titan-preflight branch selected by an already-approved, typed operation discriminator only if that discriminator is already supported safely by the current action contract.

If the current exposed action has no safe fixed-operation discriminator, the implementation must instead add a dedicated fixed internal mode that is not caller-controlled through arbitrary strings. Under no circumstance may the action become a generic bootstrap executor.

## Non-goals
This bridge does not:
- register `titan_staged_production_finalize_v1`;
- install the Titan V13 helper;
- modify the Host Actions enum for Titan itself;
- mutate Edge/Nginx/TLS state;
- merge PR #31;
- perform Titan database migrations;
- run real payments or SMS;
- rotate application secrets.

## Acceptance criteria
- the existing `agent_zero_downtime_bootstrap_v1` behavior remains intact for its existing use;
- a contract test proves there is no arbitrary command/path/ref/hostname/service input;
- a contract test proves only the exact Titan V13 bootstrap and `--preflight-only` are reachable;
- artifact identity mismatch fails closed before child execution;
- unexpected child output fails closed;
- child result with any mutation flag true fails closed;
- secret-like child output is not returned verbatim;
- existing Host Actions regression tests remain green;
- live execution produces only a read-only Titan V13 preflight result;
- Titan registration remains a separate later gate.

## Rollout sequence
1. inspect the current source and schema contract of `agent_zero_downtime_bootstrap_v1`;
2. write RED contract tests for the fixed Titan bridge and regression tests for existing behavior;
3. implement the minimal fixed bridge without generic execution capability;
4. run syntax, targeted tests, and Host Actions regression tests;
5. review the exact diff and keep PR #31 Draft;
6. deploy only the bridge/control-plane change through the established guarded path;
7. verify the live schema/action still exposes the existing action and no generic fields appeared;
8. invoke the fixed Titan preflight bridge;
9. require the full read-only PASS contract before authorizing Titan V13 registration.
