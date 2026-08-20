# Project Finalization Control Plane V1 Design

## Status
Review required. Architecture direction was approved in chat on 2026-08-20. Implementation must not begin until explicit approval of this written spec with `SPEC_REVIEW_APPROVED_PROJECT_FINALIZATION_CONTROL_PLANE_V1`.

## Goal
Create one central, fail-closed finalization control plane that makes Git synchronization and Project Status synchronization a required completion gate for technical work across many projects, regardless of whether the work starts in ChatGPT, Codex, SSH Agent, Host Actions, or another approved agent.

The system must prevent an agent from truthfully returning `COMPLETED` when the required Git and Project Status evidence is incomplete or inconsistent.

## Problem
Today, project work can finish in one surface while the operational record remains stale in another. Common divergence classes include:

- Production changed but Git was not updated.
- Git changed but the Google Sheet still points to an older SHA or status.
- Frontend and backend repositories are updated independently and only one SHA is recorded.
- A push succeeded but the live deployment corresponds to another commit.
- A chat outside a ChatGPT Project does not inherit project-specific instructions.
- Different repositories accumulate copies of the same policy that can drift over time.

The control plane must make synchronization an explicit invariant instead of a convention.

## Design Principles

1. **Central policy, distributed adapters.** The finalization rules are defined once. ChatGPT, Codex, SSH Agent, and Host Actions invoke the same logical finalizer rather than implementing independent completion rules.
2. **Fail closed.** Missing or unverifiable evidence produces `FINALIZE_PASS=NO`; the system never guesses.
3. **No blind staging.** The finalizer never runs `git add -A`, never chooses arbitrary files to commit, and never rewrites existing commits. A calling workflow must supply a reviewed expected commit SHA.
4. **Evidence over labels.** `COMPLETED` is derived from verified remote and sheet state, not from an agent's assertion.
5. **Idempotent reconciliation.** Re-running the finalizer for the same project/change identity must converge on the same state without duplicate sheet history entries or repeated destructive actions.
6. **Least secret exposure.** Secrets, credentials, tokens, env values, database dumps, backup archives, logs, and runtime state are never stored in the project registry or Project Status sheet.
7. **Project-scale operation.** Onboarding a new project must be a registry update, not a copy-paste of global policy into every chat or repository.

## Canonical Components

### 1. Global Finalization Policy

A versioned policy document is maintained in `prhm-host-actions` and defines the invariant:

> Technical work that changes code, configuration, infrastructure, deployment state, or other tracked project state is not complete until all required Git and Project Status synchronization gates pass.

The policy distinguishes read-only tasks from mutating tasks. Pure read-only audits may finish without Git or Sheet mutations, but their result must not falsely report a code/deployment change.

### 2. Project Registry

A machine-readable registry maps stable project keys to operational metadata. The first implementation should use JSON because the existing Host Actions runtime is Node.js and JSON supports deterministic schema validation without adding a parser dependency.

Proposed canonical path:

`config/project-registry-v1.json`

Each project record may include:

- stable `project_key`;
- display name;
- one or more repositories with role names such as `front`, `back`, `infra`, or `main`;
- permitted default/production branches;
- Project Status spreadsheet identifier reference and sheet/tab name;
- whether production SHA verification is required;
- optional staging tracking;
- whether multiple repositories must finalize atomically as one logical change;
- per-project verification adapter identifiers;
- approved source/runtime mapping references where required.

The registry must contain references and identifiers only. It must not contain Google credentials, GitHub credentials, SSH credentials, environment values, database passwords, API tokens, or other secrets.

### 3. `project_change_finalize_v1`

A fixed control-plane action coordinates verification and reconciliation. It accepts structured, bounded input rather than arbitrary commands.

Minimum logical input:

- `project_key`
- `change_id`
- `expected_repos[]`, each containing:
  - repository role
  - repository identity
  - branch
  - `expected_head_sha`
- `deploy_state`: `not_deployed`, `staging`, or `production`
- optional `expected_production_sha` when the production verifier already knows the expected value
- concise sanitized change summary

The action must reject repositories, branches, sheet tabs, or verification adapters not present in the registry.

## Finalization Sequence

### Gate 0 — Resolve Project

1. Load the pinned registry version.
2. Resolve `project_key` exactly.
3. Validate the requested repository set against the registered repository roles.
4. Validate the branch against the project's allowed branch policy.
5. Bind `change_id` to the normalized request payload for replay/idempotency tracking.

Unknown projects or ambiguous repository mappings fail before any write.

### Gate 1 — Local/Caller Evidence

The caller must provide an existing reviewed commit SHA for every repository that changed.

The finalizer verifies, through the approved Git adapter, that:

- the commit exists;
- the commit is reachable from the requested branch or is the exact candidate that is about to be pushed;
- the caller did not request an unrelated repository;
- required tests/verifications were reported PASS by the upstream workflow where policy requires them.

The finalizer does not stage files and does not manufacture the application commit.

### Gate 2 — Secret and Commit Safety

Before a push is authorized, the workflow must confirm that the candidate commit does not introduce prohibited secret material or disallowed generated/runtime artifacts.

The implementation may use repository-aware secret scanning plus deterministic path guards. A secret scan failure blocks push/finalization. Scanner findings must be sanitized and must never echo secret values.

### Gate 3 — Git Remote Synchronization

For each changed repository:

1. verify expected local/candidate SHA;
2. push only the intended branch/ref through the approved Git mechanism if push is part of the requested workflow;
3. read the remote branch after push;
4. require `remote_head_sha == expected_head_sha`.

If a remote branch moved unexpectedly, fail with a concurrency conflict instead of force-pushing.

The action must not force-push, amend commits, rebase shared branches, or delete refs.

### Gate 4 — Deployment Verification

For `deploy_state=not_deployed`, this gate returns `N/A`.

For staging or production, the project-specific verifier must determine the deployed identity using evidence appropriate to that project, for example:

- deployed release metadata;
- service build/version endpoint;
- immutable deployment manifest;
- checked-out Git SHA when the live source is a verified Git worktree;
- a canonical deployment record created by an approved deploy action.

Success for production requires a verified mapping to the expected Git SHA(s). HTTP health alone is insufficient because it cannot prove which commit is live.

If the project currently lacks a reliable production-SHA verifier, the registry must mark that capability unavailable and production finalization returns `FINALIZE_PASS=NO` until the verifier is established. It must not infer production SHA from the latest GitHub commit.

### Gate 5 — Project Status Update

After Git verification, the finalizer updates the registered Project Status tab with the normalized final state.

Required logical fields include:

- current project status;
- repository/branch identity where the sheet model provides those fields;
- Git HEAD SHA for each tracked repo role;
- production SHA for each relevant repo role when deployed;
- concise latest-change summary;
- last-updated timestamp;
- open blocker/risk when present;
- next gate/next step.

The existing human-readable sheet layout may differ by project. The implementation therefore requires a sheet adapter that maps normalized fields to each existing tab without blindly overwriting unrelated cells or formatting.

### Gate 6 — Sheet Read-Back Verification

A write response is not sufficient. The finalizer reads back the exact target fields and verifies that the stored values match the normalized desired state.

A successful Git push followed by failed sheet write/read-back produces a partial state:

`CHANGE_APPLIED=YES`

`FINALIZE_PASS=NO`

`BLOCKER=SHEET_SYNC_FAILED`

The system records the reconciliation requirement and may be safely retried with the same `change_id`.

### Gate 7 — Completion Decision

Only after all gates relevant to the requested deployment state pass may the action return:

`CHANGE_STATUS=COMPLETED`

`FINALIZE_PASS=YES`

Otherwise the result is `PARTIAL` or `BLOCKED`, with the first unresolved gate identified.

## Multi-Repository Projects

Projects such as separate frontend/backend applications need one logical finalization request containing all repositories changed by the task.

The system distinguishes:

- `required_repos`: repositories that must be present for every release of a project;
- `changed_repos`: repositories actually changed by this task;
- `observed_repos`: unchanged repositories whose current SHA may still be recorded for a complete project snapshot.

A backend-only change must not create a fake frontend commit. Instead, the finalizer verifies the unchanged frontend remote SHA and preserves it in the project snapshot.

For a coordinated release, all expected repository SHAs must verify before the Project Status row is advanced to the new release state.

## Staging and Production Semantics

The registry may define separate tracking for:

- `git_head_sha`
- `staging_sha`
- `production_sha`

Staging and production are never assumed equal. Promotion must be explicitly verified.

A project can therefore report, for example:

- Git HEAD: new commit
- Staging: new commit
- Production: previous commit

without being marked inconsistent when that state is intentional and accurately recorded.

## Idempotency and Concurrency

`change_id` is mandatory and unique per logical finalization operation.

The action persists a sanitized finalization record keyed by `change_id` and normalized payload hash.

Rules:

- same `change_id` + same normalized payload: return/reconcile the existing operation safely;
- same `change_id` + different payload: reject as an idempotency conflict;
- remote SHA changed since preflight: reject as concurrency conflict;
- sheet target changed in a way that conflicts with the expected prior state: fail rather than overwrite silently.

No retry may duplicate a project-history entry if history logging is enabled.

## Audit Trail

Persist only sanitized operational evidence:

- action/request ID;
- `change_id`;
- project key;
- registry version/hash;
- repository identities, branches, expected SHA and verified remote SHA;
- deployment state and verified staging/production SHA where applicable;
- sheet target identifiers and read-back PASS/FAIL;
- timestamps;
- actor/approval metadata already supported by the control plane;
- final gate statuses.

Never persist Authorization headers, access tokens, SSH keys, environment values, database credentials, credential-bearing URLs, or secret scanner match contents.

## Failure and Recovery Semantics

The finalizer is a reconciliation workflow, not a transaction pretending GitHub, production, and Google Sheets share one atomic commit.

Therefore:

- failures before Git push cause no finalization mutation;
- a successful Git push is not rolled back solely because the sheet update later fails;
- a successful production deployment is not automatically rolled back solely because sheet synchronization fails unless the upstream deployment action has its own rollback policy;
- partial outcomes are explicitly persisted and retried until converged;
- retries use observed evidence and never recreate commits merely to make states match.

This avoids destructive rollback of valid code simply because an administrative synchronization step is temporarily unavailable.

## Approval Boundary

The finalization action must reuse the existing Approval/Host Actions security model rather than inventing a parallel trust system.

The implementation plan must classify individual sub-actions by risk. Read-only Git/sheet checks should remain low-risk where existing policy permits. Git push, production verification that is truly read-only, and Google Sheet updates must use the existing approval model at the level justified by the actual mutation.

No arbitrary shell command, repository, branch, spreadsheet, tab, file path, or deploy command may be supplied through user-controlled free-form parameters.

## ChatGPT Integration

ChatGPT Project membership must not be required for policy enforcement.

A concise global instruction should tell ChatGPT:

1. mutating technical tasks are not complete until the central finalizer passes;
2. invoke the approved finalization workflow when available;
3. when it is unavailable, report `FINALIZE_PASS=NO` rather than pretending synchronization occurred;
4. project-specific context comes from the registry/source mapping, not assumptions from chat memory.

Project Instructions may add context but are not the canonical finalization policy.

## Codex Integration

A concise `$CODEX_HOME/AGENTS.md` policy should require Codex to:

- identify the registered project key before implementation;
- create/review/test the application commit using normal repository workflow;
- never call a task complete until `project_change_finalize_v1` passes when the task falls within finalization scope;
- never bypass the finalizer with manual `git push` + unverified completion unless an explicit break-glass procedure is approved;
- respect repository-specific `AGENTS.md` files for local testing/build instructions while the global finalization invariant remains in force.

The central registry and finalizer remain authoritative; `AGENTS.md` files do not duplicate the full registry.

## Per-Project Overrides

Overrides are data, not arbitrary executable instructions.

Allowed examples:

- project uses `master` instead of `main`;
- project has front/back repos;
- project tracks staging separately;
- project does not yet support production SHA verification;
- project has a custom sheet adapter because its tab layout differs;
- project requires an additional release verification gate.

Overrides cannot disable core safety invariants such as secret protection, remote SHA verification, or sheet read-back while still claiming `FINALIZE_PASS=YES` for in-scope mutations.

## New Project Onboarding

Adding a project follows a fixed workflow:

1. establish/verify Git repository ownership;
2. complete Source Mapping for canonical roots/runtime where server-backed;
3. register repository roles and allowed branches;
4. register Project Status tab mapping;
5. configure staging/production SHA verification capability;
6. run a read-only registry validation;
7. run a dry-run finalization against current unchanged state;
8. mark project `finalizer_ready=true` only after all required adapters verify.

Until ready, the project may be worked on, but mutating tasks must report the finalization limitation explicitly rather than claiming full synchronized completion.

## Registry Validation

The registry must have a schema and CI/static validator that rejects at minimum:

- duplicate project keys;
- duplicate/conflicting repository role assignments inside one project;
- malformed repository identities;
- unsupported branches;
- missing sheet mappings;
- credentials or credential-like URLs;
- unknown adapter names;
- production verification marked required without a configured verifier;
- incompatible multi-repo atomicity settings.

Registry changes require normal code review because a registry error can direct writes to the wrong project record.

## Required Result Contract

The final action result must include a stable machine-readable summary such as:

```text
PROJECT=<project_key>
CHANGE_ID=<change_id>
CHANGE_STATUS=<COMPLETED|PARTIAL|BLOCKED>
TEST_PASS=<YES|NO|N/A>
GIT_SYNC=<YES|NO|N/A>
REMOTE_SHA_VERIFIED=<YES|NO|N/A>
DEPLOY_STATE=<not_deployed|staging|production>
STAGING_SHA_VERIFIED=<YES|NO|N/A>
PRODUCTION_SHA_VERIFIED=<YES|NO|N/A>
SHEET_UPDATED=<YES|NO|N/A>
SHEET_READBACK_VERIFIED=<YES|NO|N/A>
FINALIZE_PASS=<YES|NO>
BLOCKER=<reason|NONE>
NEXT_GATE=<next_action|NONE>
```

For multi-repo projects, per-repository SHA evidence is returned in structured result data in addition to the compact summary.

## Break-Glass

V1 should not normalize bypass as a routine option. If a future emergency break-glass path is needed, it must be a separately reviewed, explicitly approved action with an audit trail and mandatory subsequent reconciliation. Absence of the finalizer is not itself permission to bypass it.

## Verification Gates for Implementation

### Static

- registry schema validation tests PASS;
- no secret material in registry/fixtures;
- action accepts no arbitrary command/path/repository/sheet target outside registry bindings;
- normalized result contract is stable;
- idempotency and concurrency conflict tests PASS.

### Integration

- single-repo Git + sheet synchronization test;
- multi-repo partial-change test;
- remote branch moved conflict test;
- secret-scan failure test;
- Git success + Sheet failure + retry reconciliation test;
- Sheet write success + read-back mismatch test;
- staging SHA differs from production SHA test;
- unavailable production verifier fails closed;
- duplicate `change_id` replay returns idempotent result;
- same `change_id` with different payload is rejected.

### Production Pilot

Pilot on one non-critical or controlled project before broad rollout. Success requires:

- expected Git SHA is verified remotely;
- Project Status write and read-back match;
- no unrelated cells/formatting are modified;
- retry produces no duplicate history;
- sanitized audit record is complete;
- ChatGPT/Codex caller can distinguish COMPLETE from PARTIAL/BLOCKED.

Only after the pilot should additional projects be enrolled in batches.

## Initial Rollout Recommendation

1. Implement registry schema + read-only registry resolver.
2. Implement read-only Git remote verification.
3. Implement Project Status adapter with write + read-back on a controlled pilot tab/project.
4. Implement finalization state machine and idempotency record.
5. Add bounded Git push support using expected SHA/ref guards.
6. Add staging/production SHA verifiers per project class.
7. Add global ChatGPT/Codex policy snippets.
8. Pilot one project, then onboard projects in batches.

This order intentionally proves read and reconciliation behavior before enabling broad write capabilities.

## Explicit Non-Goals

V1 does not:

- replace GitHub as source control;
- replace the Google Sheet with a new project-management product;
- automatically commit arbitrary dirty worktrees;
- infer project identity from domain names when registry identity is unavailable;
- assume the latest remote commit is deployed;
- store secrets in Git or Sheets;
- force every project into one repository layout;
- force every project into one deployment technology;
- automatically deploy application code merely because a commit was finalized;
- make ChatGPT Project membership mandatory;
- silently repair unrelated project state.

## Handoff Gate

This document is design-only. No production action, host-action registration, Google Sheet mutation, global Codex instruction, ChatGPT instruction, or project registry rollout is authorized by this spec alone.

Implementation planning begins only after explicit review approval:

`SPEC_REVIEW_APPROVED_PROJECT_FINALIZATION_CONTROL_PLANE_V1`
