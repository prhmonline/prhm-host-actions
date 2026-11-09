# U01 — Universal Root-of-Trust: current-baseline independent-review handoff

Date: 2026-11-09 (+03:30). Status: **SOURCE ONLY — NO PRODUCTION APPLY — NO L4 PERMIT**.

This attestation is from read-only RDC inspection of prhm-production, corroborated against Agent 3 Primary live Host Actions inventory. Its purpose is to provide independent review with exact observed preimages, not to self-enroll a new trust root. A root shell cannot authorize its own root trust upgrade.

## Current installed engine

- Prefix: /usr/local/libexec/deploy-control/universal
- Current bundle: 08889c18a570cc2bff408dfbe78b7e5f4f8da24f465b4fdd445640cd7f89d17d
- Previous bundle: 47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181
- Installation record modified: 2026-11-06T21:49:43+03:30
- Current symlink points to versions/08889c18a570cc2bff408dfbe78b7e5f4f8da24f465b4fdd445640cd7f89d17d
- Current backup.py SHA256: c61de39ba53aa41d6b1619c2991a944d0dcace16ae720497625a7bd8af0de052
- Current package: 28 Python source files
- Independent signed provenance of the November 6 privileged engine installation: **not established by this inspection**.

## Current authority-owner SHA256 preimages

| Authority file | SHA256 | uid/mode |
| --- | --- | --- |
| /opt/prhm-agent-selfmaint/server.js | 57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530 | 0/0644 |
| /opt/prhm-agent-selfmaint-exec/server.js | 4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169 | 0/0755 |
| /home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js | 0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef | 0/0600 |
| /opt/prhm-company-control-plane/config/approval-policy.json | 26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5 | 0/0644 |
| /opt/prhm-company-control-plane/approval/server.js | de2569e481cd57b105b6a778cee7b32b2575fc88957d993c70760101ba39d13b | 0/0644 |
| /opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js | 26ec21a51e3b0cb5e5aafd8a70531efb84243409557f2af186d16e90b673b3ee | 0/0640 |

The server Control Plane worktree has two uncommitted authority-file changes and is behind origin/main. It cannot be blindly deployed or used as a trusted source closure.

## Live blockers

1. The independent Provider public key is absent at /var/lib/prhm-agent-selfmaint-exec/root-of-trust/provider-bootstrap-ed25519-public.pem. Approval Center's own Ed25519 public key and consumed ledger are present, but are not a substitute.
2. A reviewed root-owned native registrar at /opt/prhm-agent-selfmaint-exec/actions/prhm-action-registry-install-native-v1.cjs is not present.
3. The fixed prhm_action_registry_install_v1 action is absent from API, Executor, MCP, typed policy and actual Host Actions v2 inventory.
4. The legacy backup-only 47e248... to 77c361... contract and any associated old approval are **obsolete for the current 08889c... preimage**; no replay or version substitution.
5. Existing GitHub OIDC workflow from PR #241 produces external identity evidence only, **not** an independent Provider registration receipt or valid PRHM Level-4 authorization. Previously protected run 41631178284 failed. Distinct GitHub accounts operated by one human are not independent-person security review.

## Source-only check in this PR

u01-universal-root-trust-current-preflight-v1.cjs pins the observed baseline and reports each missing gate. All authorization and mutation indicators are hard-coded false. No writer, registrar, approval issuer, service restart or Production deploy is exposed. Synthetic negative tests cover owner drift, wrong engine, wrong pointer, incomplete registration and forbidden conflation of passing tests with trust authorization.

## Valid next independent security transaction

1. The security reviewer independently verifies exact currently installed engine source closure, signer provenance, six owner preimages, ownership, modes, trust key custody, and policy/service health.
2. Independently review a *new* immutable fixed registrar transaction bound to this exact current preimage, with no generic command/path arguments and independent Provider signing key custody.
3. Obtain an authentic external, short-lived, replay-resistant, action-bound Provider bootstrap decision; do not let an on-host root process self-sign or bootstrap its own trust anchor. The OIDC flow can support external identity but is not, by itself, Level-4 or Provider attestation.
4. Through the existing authorized native Root-of-Trust mechanism, register API, Executor, MCP and Policy atomically, with byte-for-byte rollback, preserved ownership, modes, SELinux metadata, service health checks, crash/partial-commit recovery and a durable journal.
5. After verified live action registration, obtain a **fresh** once-only Ed25519 Level-4 Approval Center receipt bound to exact operation/request/source/current digests; verify expiry and replay rejection.
6. Review any separately needed Universal engine upgrade for current 08889c... and test rollback before deploying applications. Old candidate digests cannot be relabeled as current.

**STOP:** absent independent security reviewer, Provider trust anchor, signed registration, valid L4 receipt, or durable rollback proof means U01 stays BLOCKED. Neither GitHub merge, owner-chat permission, successful CI nor RDC-root access is proof of Root-of-Trust activation.

Tracker: https://github.com/prhmonline/prhm-host-actions/issues/214
Historical obsolete candidate: https://github.com/prhmonline/prhm-host-actions/issues/227
