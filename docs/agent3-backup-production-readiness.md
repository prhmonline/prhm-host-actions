# Agent 3 universal backup — production readiness gate

Verified CI: https://github.com/prhmonline/prhm-host-actions/actions/runs/38929860104 — six tests passed on the development branch.

## Blockers — do not deploy the prototype
- The prototype executor returns `atomic_commit_ok: false`; its two-file archive/manifest commit is not atomic or crash-durable.
- Backup data is not encrypted at rest. There is no key management, retention policy, disk quota or bounded parallelism.
- The manifest is not cryptographically authenticated; `verifyEvidence` trusts caller-supplied booleans and hashes instead of independently checking stored artifacts.
- `tar -tzf` checks archive readability and member names, but not all restored file bytes against the manifest. Add extraction into a safe sandbox and compare each file digest.
- Source file contents may change during snapshot; a file-by-file copy is not an atomic project snapshot.
- The prototype stages source contents in memory, up to 512 MiB per file; switch to streaming and enforce total bytes, file count and job runtime.
- Prevent symlink/TOCTOU races during path traversal with fd-based safe open, and verify destination remains a registered approved storage mount.
- Require secure temporary and final file permissions, fsync and atomic publication; ensure cleanup cannot remove an existing verified backup.
- Register a constrained Agent 3 action and run negative authorization tests. This branch must not grant general shell access.

## Acceptance evidence required
1. CI unit, integration, interruption, tampering and adversarial path tests pass.
2. Security review approves allowlist and privilege separation.
3. Staging backup and isolated restore both succeed with independent SHA-256 verification.
4. Signed production deployment approval is issued and verified.
5. iMotion 28-file manifest is independently captured and validated before the first production backup.
6. Production backup archive is readable and hashes match; original files and database unchanged.

Current state: CI prototype PASS, production gate NOT PASSED, no Agent 3 installation, no iMotion backup.
