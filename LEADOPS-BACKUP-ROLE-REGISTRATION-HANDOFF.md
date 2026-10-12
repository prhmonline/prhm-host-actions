# LeadOps backup-role Host Action v1 — registration candidate

**State: source-only Git-first candidate, not installed.** No code in this PR changes an Agent 3 process, PostgreSQL role, service, or pending Outbox event.

## Fixed production target

- Action: `leadops_backup_role_provision_v1`
- Operation: `host_action.leadops_backup_role_provision_v1`
- Required authorization: critical Level 4, signed single-use, second confirmation, approver `mohammad`, 180-second policy limit, checked and consumed by the trusted Agent 3 execution layer before dispatch.
- Source SQL provenance: `prhmonline/prhm-company-control-plane` merge commit `325f8fcce1ee9289125d7cd08e495c331911f740`, file `ops/leadops/backup/backup-role-provision-v1.sql`, immutable Git blob `0ecbca4fd712f8a6e87595be526305763ad539d3`.
- Candidate helper provenance: `leadops-backup-role-provision-helper-v1.cjs`, Git blob `dc2551dc17e4e6cc975fc365128905adbed4b3bb`.
- Fixed database and container: `leadops` in `drtarjomeh-leadops-staging-postgres-1`. Database operator is `leadops_admin`. The operation is **role-only**; it never changes application rows, sends Telegram messages, performs a database backup, or enables the dispatcher.

## Actual registration surfaces

The `leadops-backup-role-registration-v1.cjs` module builds *full in-memory candidate owner contents*, not merely mocks:

1. Agent 3 executor allowlist + SHA-pinned dispatch helper in `/opt/prhm-agent-selfmaint-exec/server.js`.
2. MCP `HostActionV2` enum in `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`.
3. Level 4 `operations` **and** fixed typed principal scope in `/opt/prhm-company-control-plane/config/approval-policy.json`.
4. Reviewed helper as a new fixed file `/opt/prhm-agent-selfmaint-exec/actions/leadops-backup-role-provision-v1.cjs`.
5. Byte-for-byte approved SQL as a new fixed file `/opt/prhm-agent-selfmaint-exec/actions/leadops-backup-role-provision-v1.sql`.

The planner refuses any missing/duplicate anchor, existing operation, changed source owner SHA, mismatched helper/SQL Git blob, **non-canonical post-sync policy Git blob**, or policy no longer requiring signed Level 4. The old live policy and the new Git-first integrity requirement cannot satisfy registration simultaneously: policy-only sync PR #198 must be installed separately first. Once synchronized, the planner pins the exact canonical policy bytes from `leadops-backup-role-reviewed-policy-v1.json` and verifies their Git blob `7e7d22...`. A separate transaction module defines exclusive lock, independent approval/commit attestation, snapshots, backups, atomic SHA-bound writes, post-write verification, health checks, audit and reverse-order file rollback. The signed approval for registration must carry the exact SHA-256 of **all five** output files and the exact reviewed registration Git commit, and the trusted adapter must attest those values from the consumed request. The trusted registrar adapter is **not** bundled or authorized by this PR; this module must never be used as an alternate path around the registered action/approval authority.

## Live preimages observed 2026-10-12

| Owner | SHA-256 |
|---|---|
| Executor | `410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0` |
| MCP | `bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166` |
| Approval policy (current live, **blocked**) | `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174` |
| Approval policy (required post-sync, **not live**) | Canonical Git blob `7e7d22bee0156e4fa3def84b3739f84e8b614bcd`; SHA-256 computed only from that exact bundled file |

**Important:** the live policy repository is dirty: `config/approval-policy.json` and a stage mediator have unrelated changes. Do not replace that policy with GitHub `main`, reset its worktree, or ignore these changes. Reconcile the live current owner bytes with the Git source in a reviewed commit before any bootstrap; expected SHA mismatch stops registration.

## Go-live gates (pending)

1. Review this branch and CI. Record exact registration commit SHA and exact generated candidate SHA values.
2. First perform a separately signed Level-4 **live policy-only synchronization** from Host Actions merged PR #198. A green Git CI is not evidence that the live policy changed. Independently read back its canonical Git blob/SHA and the still-unchanged Mediator; do not reset the dirty worktree. Verify the three pinned preimages **after** this upgrade.
3. Use an authorized **already-existing** root bootstrap installer that independently verifies and consumes a fresh signed Level 4 approval. The `executeBoundRegistration` primitive cannot authorize or deploy itself. Verify strict paths, non-symlink targets, clean SHA binding, rollback and owner health before/after registration.
4. Independently verify live MCP exposes precisely the action and the Approval Center returns a signed, unconsumed, expiring Level 4 request. A mere string in a repo is not runtime registration.
5. Separately obtain explicit Level 4 confirmation **for role provisioning**, consume the one-time request, verify exactly the `leadops_backup` role and source privileges. Never replay a consumed or failed request.
6. Then execute a separately authorized actual Postgres backup and isolated/off-device restore test. Leave PR #7 queue cancellation **NO-GO** until backup evidence and Browser Dispatcher isolation both pass.

## Safety semantics

PostgreSQL role creation SQL is a single `BEGIN..COMMIT` transaction, with preconditions and read-only grants; failed precommit changes roll back. Once successfully committed, it is intentionally not auto-dropped as a reaction to a logging failure (rollback of an active role requires a separately approved, auditable revocation). The helper prints bounded verification only and must never expose any row data or credentials. Synthetic CI does not replace a real Production approval or runtime health attestation.
