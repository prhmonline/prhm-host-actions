# Agent 3 universal backup / read broker installation gate

Status: **NOT INSTALLED**. This branch contains prototypes, not an approved production release.

## Prerequisites
1. Pin the exact Git commit and run all `universal-backup-*.test.js`, `agent3-read-broker.test.js`, and `agent3-read-broker-security-gates.test.js` tests.
2. Perform an isolated end-to-end backup and restore verification with a nonproduction fixture and independently compare file hashes.
3. Review TOCTOU resistance for all parent directories, destination and manifest writes, archive extraction and limits, file permissions, secrets exposure, and failure rollback. Tests passing does not imply these checks are satisfied.
4. Define a fixed, signed installation manifest with source SHA, target paths, service account, systemd sandbox, capability limits, rollback artifact, and health probes.
5. Register a dedicated fixed installer action in the approved Agent 3 control plane. Do not use unrelated installer actions, generic shell, project executor, or safe-files as an infrastructure bypass.
6. Obtain the exact approval required by that installer; perform preflight, install, post-install health and read-only smoke test, and rollback on failure.

## Acceptance
Only report INSTALLED after server-side action success, target SHA verification, registered capability discovery, and a passing live read-only smoke test. Do not change existing production backup jobs until separately approved.
