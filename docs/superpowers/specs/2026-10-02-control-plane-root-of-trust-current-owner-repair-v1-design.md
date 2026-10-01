# Control Plane Root-of-Trust Current-Owner Repair V1 — Design

Date: 2026-10-02
Status: Design approved; written spec awaiting review
Repository: `prhmonline/prhm-host-actions`

## Purpose

Define a single-purpose Root-of-Trust bootstrap that breaks the current Control Plane bootstrap loop without weakening the existing approval model.

The bootstrap exists for one reason only: execute the already-prepared, fixed current-owner repair that restores the Host Actions v2 installer/registration chain to the current live owners and hashes.

After the repair succeeds, normal Host Actions v2 request/apply flow becomes authoritative again and the Root-of-Trust bootstrap must no longer be needed for this operation.

## Current Failure State

The current system is blocked by a circular dependency:

1. the prepared current-owner repair is not requestable because Host Actions v2 does not currently allowlist it;
2. the legacy installer-refresh path that would normally repair that registration is itself bound to stale preimages;
3. the legacy repair expects older approval-policy and mediator SHA-256 values, while the live files have advanced to newer owners;
4. retrying the stale repair is therefore unsafe and must fail closed;
5. directly invoking root shell logic would bypass the intended control-plane safety boundary and is not an acceptable recovery method.

Observed live evidence immediately before this design:

- staged root-scripts transport completed successfully and did not mutate production applications or databases;
- the legacy installer-refresh repair request remained `pending` after the malformed transport response, proving it was not consumed;
- live approval policy SHA-256: `2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a`;
- live root-scripts stage mediator SHA-256: `26ec21a51e3b0cb5e5aafd8a70531efb84243409557f2af186d16e90b673b3ee`;
- the legacy repair embeds different preimage hashes and therefore cannot be reused safely;
- Solo Company Runtime has not been installed by this recovery attempt.

These values are evidence, not permanent runtime inputs. The implementation must re-read and re-bind all required current-owner hashes before producing the executable artifact.

## Decision

Create one new fixed, zero-input, SHA-bound Root-of-Trust bootstrap dedicated to the current-owner repair.

The recovery sequence is:

```text
Root-of-Trust fixed bootstrap
  -> verify current owners and exact live preimages
  -> execute exactly the fixed current-owner repair
  -> verify Host Actions v2 registration/approval path
  -> retire/bootstrap no-op
  -> resume normal Host Actions v2 flow
  -> Solo Company bootstrap
  -> Solo Company Runtime install
  -> health/status verification
```

The Root-of-Trust bootstrap is a recovery bridge, not a new management plane.

## Security Boundary

The bootstrap MUST NOT accept any runtime input except the existing explicit Level-4 confirmation at its invocation boundary.

It MUST NOT accept:

- action name;
- path;
- file content;
- shell command;
- service name;
- environment override;
- repository, branch, tag or commit selector;
- arbitrary SHA-256;
- approval token supplied by the caller;
- database query;
- hostname or URL;
- credential, password, token, key or secret.

All repair identities, file paths, expected preimages, expected post-state hashes, service identities, helper identity, rollback paths and verification steps are compile-time constants in the reviewed artifact.

Any mismatch is a hard deny with zero mutation.

## Fixed Scope

The bootstrap may perform only the minimum mutation required to execute the already-prepared current-owner repair and restore the normal Host Actions v2 control path.

Allowed effects are limited to the exact Control Plane registration/approval/mediator files proven by implementation-time discovery to be owned by that repair.

It MUST NOT modify:

- Company OS application code or data;
- Solo Company application/runtime data;
- project production trees;
- any production database;
- DirectAdmin configuration;
- DNS or SSL;
- payment gateways;
- SMS/email sending configuration;
- customer/order/ticket data;
- unrelated Host Actions;
- Git repository working trees outside the dedicated development artifact.

## Artifact Identity

Suggested immutable artifact identity:

`control-plane-root-of-trust-current-owner-repair-v1`

Inputs: none, except an external exact Level-4 confirmation literal enforced by the invocation surface.

Expected bounded result fields:

- `schema_version`
- `action`
- `target_repair`
- `started_at`
- `finished_at`
- `baseline_verified`
- `preimage_sha256`
- `postimage_sha256`
- `repair_executed`
- `registration_verified`
- `services_healthy`
- `rollback_performed`
- `rollback_failed`
- `result`

No secrets, credentials, environment contents or approval tokens may appear in output or persisted evidence.

## Current-Owner Binding

The bootstrap must bind to the current live owners, not to historical installer-refresh hashes.

Implementation-time discovery MUST determine and freeze:

1. exact current regular-file targets required by the current-owner repair;
2. exact SHA-256 of every target preimage;
3. exact SHA-256 and identity of the prepared current-owner repair helper/artifact;
4. exact expected post-state SHA-256 values;
5. exact services that must be restarted or reloaded;
6. exact Host Actions v2 action identity that becomes requestable after repair.

The final executable artifact may run only if every frozen precondition still matches at execution time.

No dynamic "use whatever is current" behavior is allowed after review.

## Preflight

Before the first mutation, the bootstrap MUST fail closed unless all of the following pass:

1. expected host/control-plane identity matches;
2. each target path equals the fixed reviewed path;
3. each existing target is a regular file, not a symlink;
4. each target realpath equals its expected fixed path;
5. owner/group/mode constraints match the reviewed baseline;
6. every live preimage SHA-256 equals the frozen current-owner manifest;
7. the prepared repair helper/artifact SHA-256 equals its reviewed hash;
8. candidate syntax/JSON parsing succeeds before installation;
9. required services exist with the expected identities;
10. the target repair is not already applied in a conflicting form;
11. backup storage is writable and confined to the fixed backup root;
12. no unexpected arguments or environment-based overrides are present.

If the system is already in the exact desired post-state, the bootstrap must return `ALREADY_APPLIED` without rewriting files.

## Repair Execution Model

The bootstrap MUST NOT reproduce the old installer-refresh mutation logic by hand.

Instead it must execute exactly the reviewed current-owner repair artifact after verifying its identity and preconditions.

This preserves one repair implementation and avoids having two independently drifting copies of approval-policy/mediator patch logic.

The current-owner repair must remain responsible for its own bounded mutation, syntax validation, service restart and local rollback contract.

The Root-of-Trust wrapper adds the independent trust boundary, current-owner preflight, Level-4 gate and post-repair verification.

## Level-4 Semantics

Recovery remains critical/Level-4.

The bootstrap must require the exact confirmation literal:

`CONFIRM_LEVEL_4_CRITICAL`

The confirmation must be consumed only by the fixed invocation surface; it must not become a general approval token or reusable credential.

A successful Root-of-Trust bootstrap does not grant approval for later Solo Company production installation. Any subsequent Host Actions v2 production action continues to use its own normal request/expiry/one-time confirmation lifecycle.

## Atomicity and Rollback

The wrapper and target repair together must provide all-or-nothing recovery.

Before mutation:

1. capture exact preimage metadata;
2. create byte-exact restrictive backups for every file that may change;
3. verify backup SHA-256 values;
4. validate the target repair artifact and expected result contract.

During mutation:

1. execute only the fixed repair helper through a constrained one-shot service/sandbox;
2. prohibit arbitrary child commands except the fixed binaries/services required by the reviewed repair;
3. require bounded execution time;
4. capture bounded result evidence.

After mutation:

1. verify every expected post-state SHA-256;
2. validate syntax/JSON for every changed artifact;
3. verify required services are active/healthy;
4. verify Host Actions v2 recognizes the repaired target action/path;
5. verify no unrelated production application or database state changed.

If any post-mutation assertion fails, restore every changed file from the exact backup, restart only the required services, verify restored SHA values and report `FAILED_ROLLED_BACK` only if rollback verification succeeds.

If rollback verification fails, report `FAILED_ROLLBACK_INCOMPLETE` and stop all further recovery steps.

## Independent Execution Surface

The Root-of-Trust execution surface must be independent of the broken Host Actions v2 allowlist/installer chain.

It may be exposed only as a fixed zero-input recovery surface whose implementation is itself SHA-bound and reviewed.

It MUST NOT expose a generic shell, arbitrary command runner, generic file writer or general root API.

The implementation plan must select the smallest currently available trusted independent surface and document why it does not depend on the broken Host Actions v2 registration path.

If no such safe independent surface is available, implementation stops before production execution; the design must not be weakened to force progress.

## Post-Repair Verification

A successful repair requires evidence for all of the following:

1. fixed bootstrap preflight passed against current-owner hashes;
2. current-owner repair executed exactly once;
3. expected post-state hashes match;
4. required Control Plane services are active;
5. the formerly blocked Host Actions v2 action is no longer rejected as `host_action_v2_not_allowed`;
6. a fresh request can be created with the expected Level-4/critical classification;
7. request expiry and one-time-use semantics remain intact;
8. no arbitrary action/path/command surface was introduced;
9. Company OS remains healthy;
10. production application trees and databases remain unchanged;
11. Solo Company Runtime has still not been installed unless a later separately approved step explicitly installs it.

Creating a fresh bounded test request is allowed for verification. Applying an unrelated production action is not.

## TDD Requirements

Repository-side tests must exist before implementation is considered complete.

### RED / deny cases

- wrong host identity -> deny;
- one preimage SHA drift -> deny before mutation;
- target is a symlink -> deny;
- wrong owner/mode -> deny;
- repair helper SHA mismatch -> deny;
- unexpected runtime argument -> deny;
- environment override attempt -> deny;
- candidate syntax/JSON invalid -> deny;
- target repair already present in conflicting form -> deny;
- injected helper failure -> rollback/no partial state;
- injected service-health failure -> rollback;
- injected post-write SHA mismatch -> rollback;
- rollback SHA mismatch -> critical rollback-incomplete state;
- second execution after exact success -> deterministic `ALREADY_APPLIED`.

### GREEN case

Given the exact fixed fixture:

- preflight validates all current-owner identities;
- only the approved repair-owned files can change;
- the fixed target repair executes;
- post-state hashes match;
- required services are healthy;
- Host Actions v2 recognizes the restored action;
- no generic input surface exists;
- no database/application mutation occurs;
- bounded evidence is produced without secrets.

## Failure Semantics

The bootstrap uses explicit terminal states:

- `SUCCEEDED`
- `ALREADY_APPLIED`
- `DENIED_BASELINE_DRIFT`
- `FAILED_NO_MUTATION`
- `FAILED_ROLLED_BACK`
- `FAILED_ROLLBACK_INCOMPLETE`

No failure may be reported as success merely because services are running.

Malformed transport output without proof of mutation must be treated as unknown/no-op until persisted state and hashes prove otherwise.

One-time request state must always be checked before retrying a failed or malformed invocation.

## Cleanup and Retirement

After successful post-repair verification:

- temporary execution artifacts are deleted;
- temporary result files are removed after evidence is persisted in the approved location;
- no listener, daemon, timer, cron, socket or background agent is left behind solely for this bootstrap;
- the immutable repository artifact remains for audit/reproducibility;
- the production recovery surface should become an idempotent no-op or be removed if removal can be done without reopening the bootstrap dependency.

The implementation plan must choose the safer of no-op retention vs removal based on the actual execution surface.

## Resume Path After Success

Once this Gate is GREEN, work returns immediately to the normal Control Plane path:

1. fresh Host Actions v2 request for the Solo Company bootstrap/install prerequisite;
2. normal approval-bound apply;
3. Solo Company Runtime installation;
4. runtime health/status verification;
5. Company OS integration continuation.

No Root-of-Trust mechanism is used for those normal steps.

## Explicit Non-Goals

V1 does not:

- create a generic root executor;
- replace Host Actions v2;
- replace Level-4 approval;
- modernize the entire installer-refresh subsystem;
- re-register every historical Host Action;
- rewrite the approval policy architecture;
- change Company OS UI;
- install Solo Company Runtime itself;
- migrate Company OS data;
- modify any business application or database;
- bypass existing production approvals after recovery.

## Acceptance Criteria

This recovery Gate is PASS only when all are true:

1. repository TDD for the fixed bootstrap is GREEN;
2. the executable artifact has a stable reviewed SHA-256;
3. execution-time current-owner preimages exactly match the frozen manifest;
4. explicit `CONFIRM_LEVEL_4_CRITICAL` is required at the independent invocation boundary;
5. exactly the fixed current-owner repair is executed;
6. post-repair hashes and service health pass;
7. Host Actions v2 can create the expected fresh Level-4 request;
8. replay/expiry/one-time semantics remain intact;
9. no generic root or arbitrary-input interface exists;
10. no application/database mutation occurred;
11. rollback is proven for injected failure cases;
12. temporary execution state is cleaned up;
13. Solo Company installation remains a separate later Gate.

## Next Gate

After this specification is reviewed and approved, the next step is to write the implementation plan.

No implementation, Root-of-Trust execution, current-owner repair, Solo Company installation or production mutation is authorized by approval of this specification alone.
