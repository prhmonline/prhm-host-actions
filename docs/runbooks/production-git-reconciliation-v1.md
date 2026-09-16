# Production Git Reconciliation V1 Runbook

## Purpose
`production_git_reconciliation_v1` is a fixed, read-only Host Action for observing deployed Git state on explicitly allowlisted Production repositories. It does not repair, sync, deploy, fetch, or mutate repositories.

## Allowed project IDs
The runtime enum is generated from the source registry and includes only mappings proven by read-only Production evidence. At the current implementation SHA the only enabled target is `cfpark_front_prod`.

All other candidate targets remain disabled until their exact Production root and canonical repository identity are proven. In particular, PBCinema must not be inferred from CF Park repository history, and Honartik local bare repositories are not sufficient by themselves to prove canonical GitHub identity.

## Read-only guarantees
The executor accepts only `project_id`. Caller-controlled host, path, repository, branch, shell, command, token, or revision inputs are not accepted. Git observations are fixed argv operations only. Runtime returns bounded structured fields and never returns filenames, diffs, raw stderr/stdout, `.env` contents, credentials, or authenticated remote URLs.

V1 intentionally excludes `git fetch`. Therefore local ahead/behind values describe the existing local remote-tracking ref only and `remote_tracking_freshness` is reported as `unknown`.

## Output fields
Expected successful output fields are: `ok`, `project_id`, `repository_root`, `is_git_repository`, `branch`, `head_sha`, `origin_repo`, `upstream_branch`, `dirty`, `tracked_modified_count`, `untracked_count`, `ahead`, `behind`, `detached_head`, `remote_tracking_freshness`, and `classification`.

## Local classifications
`DIRTY` takes precedence when tracked or untracked changes exist. `DETACHED` means HEAD is detached. `UNKNOWN` means local comparison evidence is insufficient or invalid. `DIVERGED_LOCAL_TRACKING`, `AHEAD_LOCAL_TRACKING`, `BEHIND_LOCAL_TRACKING`, and `MATCH_LOCAL_TRACKING` compare only with the existing local remote-tracking ref.

## GitHub authoritative comparison
GitHub HEAD is obtained independently through the GitHub connector for the canonical repository/default branch. The Host Action does not contact GitHub and does not fetch remotes.

External Phase 3B classification compares deployed `head_sha` with independently observed GitHub HEAD. A dirty tree remains `DIRTY` even when HEAD SHAs match. Clean equal SHAs may be classified `MATCH`; unequal SHAs require ancestry/evidence before choosing `BEHIND`, `AHEAD`, or `DIVERGED`; insufficient evidence is `UNKNOWN`.

## Failure handling
Unknown or disabled project IDs, invalid repositories, unexpected branch/origin, detached HEAD, missing upstream, unsafe remote forms, timeout, ownership/access problems, or malformed Git output fail closed. No failure triggers repair, checkout, reset, pull, fetch, clean, deploy, or service restart.

## Installation / registration approval boundary
Repository implementation and CI are not Production approval. Installation or registration of this capability in the Production control plane is a separate mutation and requires a fresh governed approval bound to the reviewed executor/bootstrap SHA. Old approvals must not be reused.

## Capability rollback / removal
Rollback of the capability itself must use the control-plane installation mechanism's captured preimage/backup and remove only the registered reconciliation capability and its bounded adapter artifacts. It must not modify application repositories or databases. Post-removal verification must confirm the tool is absent and existing Agent/MCP health remains green.

## Example sanitized output
```json
{
  "ok": true,
  "project_id": "example_front_prod",
  "repository_root": "/verified/example/root",
  "is_git_repository": true,
  "branch": "main",
  "head_sha": "0123456789abcdef0123456789abcdef01234567",
  "origin_repo": "example/example-repo",
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

A mismatch or dirty state is evidence only. It never triggers automatic repair, sync, merge, or deployment.
