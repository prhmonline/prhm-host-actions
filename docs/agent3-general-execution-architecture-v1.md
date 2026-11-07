# Agent 3 general execution architecture v1 — implementation baseline

Status: DESIGN ONLY; NOT DEPLOYED. No production permission changes authorized by this document.

## Verified baseline (2026-10-16)
- Agent API health: ok, version 2.9.2-titan-front-isolated-npm; max concurrent SSH requests 6.
- Self-maintenance executor: ok, version 1.12.5-host-actions-v2-honartik-iticket-dark-backend-batch1.
- Registered Host Actions v2 are fixed named operations; generic universal backup installer was rejected as not allowed.
- An ops_execute control-plane read request returned an empty tool payload; do not assume generic executor works until a read result is verified.
- Existing universal backup executor is a prototype; production readiness gate remains red.

## Design decision
Implement a *generic constrained execution broker* in parallel with current actions. Never replace current policy checks with unrestricted SSH, root shell, sudo, arbitrary command execution, or blanket permanent approval.

## Risk tiers
1. Read: canonical approved project roots, bounded file and log reads, metadata and health; no secrets, no network exfiltration. Policy-authorized, audited.
2. Development: isolated worktrees, diff/patch, test/build in sandbox, time/CPU/disk/network limits, rollback to clean worktree; no production secrets or writable production mounts.
3. Routine operations: approved project backups, verification and staging deployments with fixed capability templates, dedicated service identities, signed evidence and rate limits. Onboard roots and destinations with elevated review.
4. Production writes: immutable proposed change set, expected SHA preimage, verified backup, approval bound to exact target/revision/action, staged deployment and automatic rollback.
5. Critical: identity/permissions/financial data, credential changes, restores/deletes and policy expansion require explicit short-lived critical approval and independent verification.

## Broker contract
- Input: actor identity, project ID, operation class, structured parameters, expected revision, idempotency key, deadline.
- Policy engine: deny-by-default capability grant derived from project registration + identity + environment + operation risk; policy version and decision reason in audit record.
- Execution: no shell string from model; typed operations executed under least-privileged identities and filesystem/network confinement.
- Evidence: request ID, policy decision, resolved target, preimage hash, changeset hash, stdout/stderr bounds, resulting hashes, verification and rollback status.
- Concurrency: per-project lock, global capacity limit, timeout, cancellation and retry policy.
- Approval: explicit per-action for production/critical; generic standing authorization never overrides approval center.

## Delivery gates
G0 inventory current capabilities, policies, routes, identities and permission failures with redaction.
G1 generic read-only broker + negative authorization tests in staging.
G2 isolated development write/test with resource limits and audit.
G3 reusable routine backup capability with atomic, encrypted, independently restored artifacts.
G4 production deployment adapter with approval, canary and rollback.
G5 migrate individual fixed actions incrementally; keep old routes as fallback until parity tests pass.

## Acceptance
- Three representative tasks (read diagnostic, isolated code fix/test, verified 28-file iMotion backup) require zero newly authored per-task MCP tools.
- Unknown project, traversal, symlink, secrets, unauthorized network, unapproved production write and replay attempts are denied.
- Existing Agent 3 functions continue to work; rollback path tested.
- No production rollout before security and staging evidence.

## Next concrete implementation
Implement typed read-only broker in a new isolated development module and test denial cases before registering any production action.
