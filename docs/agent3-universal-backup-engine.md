# Agent 3 Universal Backup Engine — implementation contract (draft)

## Objective
Allow reusable, policy-governed, non-destructive backups of registered projects, without enabling arbitrary shell commands. Production installation is a separate approved operation.

## Operations
- `backup.create`: `{project_id, profile_id, idempotency_key}` — only registered project/profile identifiers; no user-supplied paths, shell, SQL, destinations, or command fragments.
- `backup.status`: `{job_id}`.
- `backup.verify`: `{job_id}` — archive integrity, SHA-256 manifest, source item count and snapshot consistency.
- `backup.list`: `{project_id}`.
No restore, delete, retention override, offsite destination change, or privileged deployment in this API.

## Security requirements
1. Fail closed on unknown projects/profiles. Admin-managed allowlist maps project IDs to canonical source roots, permitted backup profiles, database identities, and destination roots. Resolve realpaths and reject symlink escapes, traversal, special files, sockets, and unapproved mount points.
2. Use execFile/spawn with fixed executable and argument arrays; never shell interpolation. Separate unprivileged service account, least privilege, restrictive umask 077, destination ownership and quotas.
3. Output only into pre-approved dedicated backup storage, never source tree. Atomic temporary file + fsync + rename; protect against collisions and TOCTOU; restrict parallel jobs, I/O and disk usage.
4. Encrypt archives and manifests at rest; keys outside archive and logs. Redact secrets from logs; never send data offsite without explicit destination approval.
5. Produce SHA-256 archive digest, file manifest with hashes and counts, timestamp, project/profile, tool version, job ID, and verification outcome. Verify archive can be read and compare manifest to captured contents; distinguish this from an actual restore test.
6. Database profiles must use consistent snapshots/dumps, least-privileged credentials, bounded timeout, and separate policy. Never silently include DB when profile is code-only.
7. Authorization: approved routine backups may run without per-run human confirmation, but onboarding new roots/destinations, expanding privileges, restores, deletions, and policy changes require elevated approval and audit trail.
8. Enforce idempotency, per-project lock, timeout, bounded retries, retention quotas, monitoring and alerts. Fail on incomplete or unverifiable backup; never report success from archive creation alone.

## Initial iMotion acceptance test
- Register a code-only `imotion_admin_prod` profile after authoritative source-root and exact 28-file manifest have been confirmed on the server.
- Back up the 28 source files without changing source files or databases.
- Verify 28/28 captured, manifest and archive SHA-256, durable backup location, and read-back integrity.
- Preserve original working tree and document accepted Git drift only after successful backup evidence.
- Exercise denied cases: arbitrary path, traversal, symlink escape, arbitrary command, unregistered destination, DB access, restore/delete, insufficient disk, interrupted write.
- CI test suite and code review must pass before installation. Production enablement requires the existing Agent 3 approval workflow.

## State
Specification only. No implementation, deployment, or iMotion backup has been performed by this document.
