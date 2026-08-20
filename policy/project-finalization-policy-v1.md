# Project Finalization Policy V1

## Invariant

Technical work that changes code, configuration, infrastructure, deployment state, or other tracked project state is not complete until every finalization gate required for that change is verified.

`COMPLETED` is an evidence-derived state. It must not be inferred from an agent statement, a successful command alone, or the latest Git commit.

## Scope

This policy applies to mutating technical work initiated from ChatGPT, Codex, SSH Agent, Host Actions, or another approved agent.

Pure read-only audits may finish without Git or Project Status mutations, but they must not claim that code, deployment, Git, or Sheet state changed.

## Fail-Closed Rule

Missing, conflicting, unavailable, or unverifiable evidence must produce:

```text
FINALIZE_PASS=NO
```

The system must never guess a repository, branch, deployment SHA, spreadsheet target, adapter, verifier, or production state.

## Git Rules

- The caller must provide a reviewed expected commit SHA for every changed repository.
- The finalizer must never run `git add -A`.
- The finalizer must never choose arbitrary files to stage or commit.
- The finalizer must never amend commits, force-push, rebase shared history, or delete refs.
- Remote state must be read after synchronization and must equal the expected SHA.
- Unexpected remote movement is a concurrency conflict, not permission to overwrite.
- An unchanged repository in a multi-repo project must keep its observed SHA; no synthetic commit is created.

## Secret and Artifact Rules

The registry, Project Status sheet, audit records, reports, and chat output must not contain:

- passwords;
- API keys or access tokens;
- Authorization headers;
- SSH/private keys;
- environment values;
- database credentials;
- credential-bearing URLs;
- database dumps;
- backup archives;
- logs, caches, or runtime state;
- secret-scanner match contents.

Scanner and validation failures may expose only sanitized reason codes and non-secret metadata.

## Deployment Identity

Git HEAD, staging SHA, and production SHA are separate facts.

A staging or production SHA must come from a registered verifier such as immutable release metadata, a verified Git worktree, or an approved release manifest. HTTP health alone is not proof of deployed commit identity.

If production tracking is required and no trustworthy verifier exists, production finalization must fail closed. The latest GitHub SHA must never be substituted for production evidence.

## Project Status Synchronization

After Git evidence is verified, the finalizer updates only the registry-bound Project Status target and normalized fields permitted by the selected adapter.

A successful write response is not sufficient. The exact written fields must be read back and compared with the normalized desired state.

If Git or deployment state changed successfully but Sheet synchronization or read-back fails:

```text
CHANGE_STATUS=PARTIAL
FINALIZE_PASS=NO
BLOCKER=SHEET_SYNC_FAILED
```

Valid Git or production changes are not rolled back solely because administrative Sheet synchronization failed. The same logical change is reconciled on retry.

## Idempotency and Concurrency

Every finalization request requires a stable `change_id`.

- same `change_id` + same normalized payload: resume or return the existing operation safely;
- same `change_id` + different normalized payload: reject with an idempotency conflict;
- unexpected remote SHA movement: reject with a concurrency conflict;
- conflicting prior Sheet state: fail rather than silently overwrite.

Retries must not duplicate history records or manufacture new commits.

## Registry Binding

Repository identities, repository roles, allowed branches, spreadsheet IDs, sheet/tab names, adapters, and deployment verifiers are resolved from the versioned project registry.

Free-form caller input must not redirect writes outside those bindings.

Projects with incomplete source mapping, missing deployment verification, or unverified Sheet binding remain `finalizer_ready=false`.

## Required Result Contract

The finalizer returns a stable machine-readable summary containing exactly these logical keys:

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

`FINALIZE_PASS=YES` is allowed only when every gate relevant to the requested change and deployment state has passed.

## Completion Boundary

If finalization infrastructure itself is unavailable, the caller may report the technical work as applied or partial, but must not claim synchronized completion.

Absence of the finalizer is not a bypass authorization. Any future break-glass path requires a separately reviewed action, explicit approval, an audit trail, and mandatory reconciliation.