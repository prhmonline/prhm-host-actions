# PRHM Root-of-Trust Out-of-Band Fixed Seed Provision V1 — Design

Date: 2026-08-25
Status: Approved design, documentation only
Repository: `prhmonline/prhm-host-actions`

## Purpose

Define the single-use out-of-band Root-of-Trust seed needed to restore a sanctioned fixed-action registration path when the live Agent API/MCP/self-maintenance trust chain cannot bootstrap its own missing action.

The seed exists only to install one fixed registration surface for the already-defined control-plane action:

`control_plane_root_scripts_stage_transport_v1`

The seed must not execute that transport action. It only restores its registration into the existing Host Actions v2 trust chain so that a later, separate Level-4 request can authorize and execute the transport.

## Problem Statement

The current control plane has a bootstrap paradox:

- `host_action_v2_request` rejects the root-scripts transport action as not allowed.
- generic `selfmaint_apply` and typed self-maintenance confirmation/apply paths are blocked at the platform boundary.
- existing native Host Actions v1 is hard-bound to `harden_agent_api_v1` and is not an installer.
- the Agent ZDT bootstrap is action/hash-bound to ZDT and must not be repurposed.
- safe-file commit into the MCP mount may fail read-only (`EROFS`).
- no existing independent GitHub/webhook/updater/root seed is exposed in Agent 1 or Agent 2.

Therefore the first fixed seed must originate outside the mutable Agent API/MCP trust boundary.

## Security Boundary

The Root Seed is not a general installer.

It MUST NOT accept:

- action name input;
- path input;
- file content input;
- command or shell input;
- service name input;
- environment overrides;
- credential, SSH key, token or secret input;
- Git ref/branch/tag input;
- arbitrary SHA input at runtime.

All paths, action identity, baseline hashes, expected post-state hashes, services, rollback locations and execution steps are compile-time constants in the artifact.

## Fixed Scope

The only action registered by V1 is:

`control_plane_root_scripts_stage_transport_v1`

The seed MUST NOT execute:

- `control_plane_root_scripts_stage_transport_v1`;
- `root_scripts_fixed_stage_v1`;
- DrTarjomeh staging clone operations;
- DrTarjomeh application changes;
- database changes;
- payment, SMS, mail or queue actions.

## Chosen Architecture

### One-shot provider/VM-console root execution

The preferred trust boundary is a one-shot root execution channel independent of:

- Agent API;
- Agent MCP;
- self-maintenance request/apply;
- Host Actions v1/v2 request/apply;
- DeployHQ;
- GitHub Actions credentials;
- inbound SSH deploy credentials.

Typical valid examples are a provider console, hypervisor/VM console, recovery console or equivalent host-level root channel under the operator's control.

This channel runs exactly one immutable seed artifact and does not become a permanent management plane.

## Seed Artifact Contract

Suggested artifact identity:

`prhm-root-of-trust-fixed-seed-v1`

The final artifact MUST be content-addressed by an explicit SHA-256 before execution.

Inputs: none.

Outputs: bounded JSON result only.

Expected result fields:

- `schema_version`
- `seed_id`
- `started_at`
- `finished_at`
- `baseline_verified`
- `before_sha256`
- `after_sha256`
- `action_registered`
- `services_healthy`
- `rollback_performed`
- `result`

No secret, token, environment value, private key or approval token may be written to the result.

## Preflight

Before any mutation, the seed MUST fail closed unless all of the following pass:

1. expected host/control-plane identity;
2. exact expected SHA-256 for every file it will modify;
3. each target is a regular file and not a symlink;
4. required service/unit identities match expected constants;
5. the fixed transport helper identity and SHA match the approved transport artifact where referenced by registration metadata;
6. the action is not already registered in a conflicting form;
7. backup destination is available;
8. candidate syntax/parse validation passes before replacement.

Any baseline drift aborts with zero mutation.

## Mutation Scope

The seed may modify only the exact control-plane registration layers proven necessary by fresh implementation-time source discovery.

Expected layers are:

1. base self-maintenance Host Actions v2 registry/spec;
2. executor Host Actions v2 registry/dispatcher;
3. approval policy binding required for the fixed action.

MCP request schema should not be changed if the live schema already accepts the fixed action string and the backend is the only rejecting layer.

The implementation plan MUST re-verify this assumption before coding.

## Registration Semantics

The registered action must bind to the fixed transport semantics already established for the project.

The registration MUST NOT expose arbitrary parameters.

The resulting Host Actions v2 request must bind:

- project: `control_plane`;
- environment: `production`;
- action: `control_plane_root_scripts_stage_transport_v1`;
- risk: critical / Level-4;
- arguments: fixed action-only request;
- one-time approval consumption;
- existing approval expiry/replay protections.

The seed itself does not authorize or execute the transport.

## Atomicity and Rollback

For each modified file:

1. verify current SHA;
2. make a byte-exact backup with restrictive mode;
3. write candidate to a temporary file in the same filesystem;
4. fsync file data;
5. atomically rename into place;
6. verify installed SHA;
7. validate syntax/parse state;
8. restart only services required by the changed layer;
9. verify health and action registration.

If any step after the first mutation fails:

1. restore every changed file from the exact backup;
2. restart required services;
3. verify restored SHA values;
4. verify service health;
5. emit `FAILED_ROLLED_BACK` only if rollback verification passes.

If rollback verification fails, emit `FAILED_ROLLBACK_INCOMPLETE` and do not claim recovery.

## Idempotency

A second execution on an already-correct installation must return a bounded no-op result such as:

`ALREADY_APPLIED`

It must not rewrite files unnecessarily or create registration duplicates.

## Post-Install Verification

A successful seed execution requires all of the following evidence:

- expected post-install SHA for every changed file;
- syntax/parse validation PASS;
- required control-plane services healthy;
- `host_action_v2_request({ action: "control_plane_root_scripts_stage_transport_v1" })` is no longer rejected as `host_action_v2_not_allowed`;
- the resulting request is Level-4, action-bound, hash-bound, expiring and one-time-use;
- no transport execution occurred;
- DrTarjomeh application/database state was untouched.

Creating the test Level-4 request is acceptable verification; applying it is outside this seed Gate.

## TDD Requirements

Before production execution, repository-side tests must prove at minimum:

### RED cases

- wrong host identity -> deny;
- baseline SHA drift -> deny;
- symlink target -> deny;
- missing fixed transport identity -> deny;
- candidate syntax failure -> deny;
- conflicting existing action -> deny;
- injected post-write health failure -> rollback;
- injected partial multi-file failure -> full rollback;
- unexpected argument/env override -> deny;
- second execution -> deterministic `ALREADY_APPLIED` or equivalent.

### GREEN case

Given the exact fixed fixture:

- baseline verification passes;
- backups are created;
- only the fixed registration layers change;
- atomic replacement completes;
- final SHA values match;
- registration becomes visible;
- no transport action executes;
- no arbitrary input surface exists.

## Out-of-Band Provisioning Rules

The implementation may prepare and hash the seed artifact inside the repository, but production execution must occur only through an independently trusted root channel.

The artifact must be transferred in a way that preserves its pre-approved SHA-256. The operator must verify the SHA on the target host before execution.

No long-lived root credential, new SSH deployment key, GitHub Actions secret or permanent listener is created by V1.

## Explicit Non-Goals

V1 does not:

- create a generic native installer framework;
- create a reusable arbitrary root execution API;
- replace Level-4 approval;
- execute root-scripts transport;
- repair DrTarjomeh itself;
- clone staging;
- modify production databases;
- create deployment credentials;
- install a self-hosted runner;
- add a webhook listener.

## Acceptance Criteria

The Gate can be marked PASS only when:

1. repository TDD is green;
2. the seed artifact has a stable SHA-256;
3. fresh production baseline hashes match its manifest;
4. the artifact is executed through an out-of-band root boundary;
5. post-install hashes and health checks pass;
6. the target Host Actions v2 action is requestable;
7. transport itself has not executed;
8. no DrTarjomeh application/database mutation occurred.

## Next Boundary

After this seed is successfully installed and verified, the next operation is a fresh Level-4 request for:

`control_plane_root_scripts_stage_transport_v1`

That request/apply lifecycle is a separate Gate and must remain subject to the existing approval, expiry, hash binding and one-time-consumption controls.
