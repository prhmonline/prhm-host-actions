# Production Git Reconciliation V1 — Design

Date: 2026-09-16
Status: Design approved in chat; implementation not started
Repository: `prhmonline/prhm-host-actions`
Target capability: `production_git_reconciliation_v1`

## 1. Purpose

Provide a fixed, read-only Host Action that reports the deployed Git state for an allowlisted production project without modifying the repository, files, services, network configuration, database, or deployment state.

The action exists to reconcile deployed Production state with the authoritative GitHub repository state during Phase 3B of Git assurance. It must answer: which commit is deployed, whether the tree is dirty, what branch/upstream is configured, and whether the local tracking relationship indicates ahead/behind/diverged.

## 2. Non-goals

V1 must not perform any repair or synchronization. It must not run `git fetch`, `git pull`, `git checkout`, `git reset`, `git clean`, `git stash`, `git commit`, `git push`, `git merge`, `git rebase`, deployment commands, service restarts, file writes, package installation, migrations, or database operations.

It must not expose file contents, diffs, `.env` values, credentials, authenticated remote URLs, access tokens, SSH private data, database configuration, or secret-bearing environment variables.

## 3. Architectural choice

Use one fixed action with a hard-coded allowlist and a single enum input `project_id`.

The caller never supplies a filesystem path, repository URL, branch, shell fragment, command, host, user, or arbitrary argument. Each allowlisted target resolves internally to fixed metadata.

This keeps the interface reusable while remaining fail-closed and avoids both extremes: a dangerous generic shell/status action and an unmaintainable per-project action explosion.

## 4. Initial target registry

The first implementation should support these logical targets only after each target's exact production path and expected repository identity are verified during implementation preflight:

- `honartik_front_prod`
- `honartik_back_prod`
- `pbcinema_front_prod`
- `pbcinema_back_prod`
- `moeinshow_front_prod`
- `moeinshow_back_prod`
- `cfpark_front_prod`
- `cfpark_back_prod`

A target must not be enabled with an assumed path or guessed repository. If a canonical mapping is not proven, that target remains disabled/absent from the enum until proven.

## 5. Input contract

Input:

```json
{
  "project_id": "honartik_front_prod"
}
```

Rules:

- `project_id` is a closed enum.
- Unknown values fail before any Git command runs.
- No optional free-form input exists.
- No runtime path override exists.
- No runtime remote override exists.

## 6. Read-only command surface

Only the following fixed observations are permitted, or semantic equivalents that are equally read-only:

- repository existence / work-tree validation
- `git rev-parse HEAD`
- `git symbolic-ref --short HEAD`
- `git status --porcelain=v1 -z`
- `git rev-list --left-right --count <fixed-upstream>...HEAD`
- `git config --get remote.origin.url`
- upstream/ref existence checks required to safely interpret the result

`git fetch` is explicitly excluded from V1. Ahead/behind is therefore measured against the local remote-tracking ref only. GitHub HEAD is obtained independently through the GitHub connector and compared outside this Host Action.

## 7. Output contract

Successful output is structured JSON containing only sanitized metadata:

```json
{
  "ok": true,
  "project_id": "honartik_front_prod",
  "repository_root": "/fixed/registered/path",
  "is_git_repository": true,
  "branch": "main",
  "head_sha": "<40-char sha>",
  "origin_repo": "prhmonline/Honar-front-new",
  "upstream_branch": "origin/main",
  "dirty": false,
  "tracked_modified_count": 0,
  "untracked_count": 0,
  "ahead": 0,
  "behind": 0,
  "detached_head": false,
  "remote_tracking_freshness": "unknown",
  "classification": "MATCH_LOCAL_TRACKING"
}
```

Allowed high-level classifications inside the action:

- `MATCH_LOCAL_TRACKING`
- `BEHIND_LOCAL_TRACKING`
- `AHEAD_LOCAL_TRACKING`
- `DIVERGED_LOCAL_TRACKING`
- `DIRTY`
- `DETACHED`
- `UNKNOWN`

The final cross-system Phase 3B classification (`MATCH / BEHIND / AHEAD / DIVERGED / DIRTY / UNKNOWN`) is produced outside the action after comparing `head_sha` with GitHub's authoritative branch HEAD.

## 8. Remote URL sanitization

The raw value of `remote.origin.url` must never be returned directly.

The implementation may parse common SSH/HTTPS GitHub formats and emit only canonical repository identity such as:

`prhmonline/Honar-front-new`

Any remote form that cannot be safely sanitized, or whose canonical repository does not match the target registry expectation, must fail closed with an explicit error classification.

## 9. Dirty-tree accounting

The action must not return filenames or patch content.

It may return counts only:

- tracked modified/deleted/renamed entries
- untracked entries

If porcelain parsing fails, classify as `UNKNOWN`; do not attempt repair.

A non-clean tree takes precedence for risk reporting. For example, a tree whose HEAD matches the local tracking ref but contains modifications is `DIRTY`, not clean/matched.

## 10. Fail-closed conditions

The action must return a structured error/`UNKNOWN` and stop if any of these occur:

- unknown `project_id`
- configured root missing
- repository validation fails
- expected repository identity mismatch
- branch is detached when a branch is required
- configured upstream missing or invalid
- Git reports unsafe ownership / safe-directory failure
- command timeout
- output parsing ambiguity
- unexpected command exit status
- any condition that would require mutation to continue

The action must never auto-add `safe.directory`, alter Git config, chmod/chown files, or otherwise mutate state to make the probe succeed.

## 11. Security properties

The implementation must satisfy all of the following:

- no arbitrary shell input
- no arbitrary path input
- no arbitrary repository input
- no credential-bearing output
- no file-content output
- no write-capable Git command
- no network-changing command
- no service-control command
- bounded execution time
- bounded output size
- deterministic target registry
- fail-closed behavior

If the Host Actions framework supports approval level metadata, this runtime action should be classified as read-only. Installation/registration of the new capability remains a separate governed change and must not reuse an old approval.

## 12. GitHub-side reconciliation

The surrounding Phase 3B workflow is:

1. Read GitHub default branch and authoritative HEAD through the GitHub connector.
2. Run `production_git_reconciliation_v1` for one allowlisted target.
3. Compare Production `head_sha` with GitHub HEAD.
4. Combine GitHub comparison with Production dirty/detached state.
5. Produce a final reconciliation row.

No action is taken based solely on a mismatch. Mismatches proceed to Phase 3C Risk Classification before any sync/deploy proposal.

## 13. Final reconciliation semantics

Suggested external semantics:

- `MATCH`: Production HEAD equals GitHub authoritative HEAD and Production tree is clean.
- `DIRTY`: Production work tree has tracked or untracked changes, regardless of HEAD equality.
- `BEHIND`: Production HEAD is an ancestor of GitHub HEAD and tree is clean.
- `AHEAD`: GitHub HEAD is an ancestor of Production HEAD and tree is clean.
- `DIVERGED`: neither HEAD is an ancestor of the other and tree is clean.
- `UNKNOWN`: identity, ancestry, repository, or probe result cannot be proven safely.

Ancestry should be determined with GitHub-side commit comparison where possible rather than trusting stale local tracking refs.

## 14. Test requirements

Implementation must be test-driven and include at minimum:

- valid allowlisted clean repository
- dirty tracked file count without leaking filenames
- untracked file count without leaking filenames
- detached HEAD
- unknown project ID rejection
- missing repository root
- remote identity mismatch
- HTTPS remote sanitization
- SSH remote sanitization
- authenticated/token-bearing HTTPS URL sanitization without token leakage
- missing upstream
- ahead/behind/diverged local-tracking calculations
- command timeout handling
- unsafe ownership failure remains non-mutating
- assertion that forbidden command strings are absent from the executor surface
- assertion that no input can control a shell command or filesystem path

## 15. Implementation boundaries

Implementation should live in `prhm-host-actions` using the existing fixed-action/bootstrap conventions rather than adding a generic executor.

Exact filenames, registration mechanism, executor version bump, and deployment/approval mechanics are intentionally deferred to the implementation plan after this design is reviewed and approved.

No Production registration occurs as part of the design/spec phase.

## 16. Acceptance criteria

The design is successfully implemented only when:

1. The action accepts only allowlisted `project_id` values.
2. Every enabled target has a verified fixed path and expected repository identity.
3. Runtime execution is demonstrably read-only.
4. No secret, file body, diff, or raw credential-bearing remote is returned.
5. Clean/dirty, HEAD, branch, sanitized origin identity, upstream, and local ahead/behind are reported deterministically.
6. Failure cases are fail-closed and never self-repair.
7. Unit/contract tests pass.
8. Repository review confirms there is no arbitrary-shell or arbitrary-path escape hatch.
9. Installation/registration is separately approved before Production mutation.
10. Phase 3B can use the action to build the Production-vs-GitHub reconciliation table without manual SSH.

## 17. Explicit deferred work

The following are deliberately outside V1:

- automated Git synchronization
- production repair
- `git fetch`
- branch switching
- deploy triggering
- rollback execution
- repository cleanup
- stale PR cleanup
- automatic project discovery
- dynamic path registration
- support for non-Git deployments

Those may be designed later only after read-only reconciliation is proven reliable.
