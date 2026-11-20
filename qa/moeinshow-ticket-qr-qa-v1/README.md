# MoeinShow ticket QR offline QA — fixed PRHM Host Action v1

**State:** Source candidate ONLY. **Not installed, registered, approved or run** on the server.

## Objective

Provide a single, no-argument, auditable execution path for the existing [MoeinShow PR #11](https://github.com/prhmonline/moeinshowback/pull/11) without GitHub-hosted Actions, foreign payments, a new VM, or another project's runner.

Action ID: `moeinshow_ticket_qr_offline_qa_v1`.

Source revision: `7e670bc6f11267d8b955f1b3671787adecc65c93`.

This package contains the **six strictly required source files** copied byte-for-byte from that revision, checked by their exact Git blob IDs in `manifest.json`. It is deliberately a minimal source snapshot rather than a full working-tree checkout; PHP contract paths remain identical. No source is fetched over the network during the QA run.

## Execution design

- Only the registered Host Actions v2 dispatcher may invoke `runFixed()`. Direct CLI allows `--selftest` only.
- Check six files against pinned Git blob SHA values and verify the installed Composer vendor dependencies.
- Read **only** `/home/moeinshow/domains/dashboard.moeinshow.com/public_html/vendor` for package code. Reject vendor symlinks, enforce an 850 MB byte cap, and copy dependencies into a MoeinShow-only temporary directory. Never copy the live application configuration, `_env`, uploads, DB, logs, secrets, payment credentials or customers.
- Reconstruct the six files in `/var/cache/prhm-moeinshow-ticket-qr-qa-v1/stage-*` plus a fixed synthetic artifact generator.
- Run the existing `scripts/verify-ticket-qr-offline.sh` and `EmitSyntheticArtifacts.php` within a **transient systemd sandbox**, with no network and `ProtectHome=tmpfs`; allow writes only to the temporary QA directory. Use `NoNewPrivileges=yes`, `ProtectSystem=strict`, private devices/tmp and excluded MariaDB sockets. Bound CPU to 25%, memory to 512 MB, task count to 32 and runtime to 120 seconds.
- Test `Da\\QrCode` PNG creation, actual QR decoding, `mPDF` output with an embedded QR, and syntactic/contracts; use the literal synthetic code `MOEINSHOW-QA-TICKET-0001` only.
- Persist only synthetic PNG/PDF and SHA-256 metadata in the root-owned QA result directory. Remove temporary source and dependency copies after the run, whether it passed or failed.

## Security boundary

**Prohibited:** arbitrary project/path/branch/command/SQL input, production code mutation, Git merge/deploy, DB sockets, SMS, bank API calls, HTTP/internet, untrusted tokens, other project runners and VM creation. The helper uses argument-array subprocess calls without shell interpolation for privileged commands.

If any file hash, dependency, permission, resource, process result, QR scan, PNG signature, PDF signature or required contract marker fails, return **NO-GO**. A source-only commit never constitutes runtime PASS.

## Registry installation gate — not yet executed

The installed PRHM Agent's live `host_actions_v2` registry does **not** list this operation as of the read-only check. Source changes to Git alone do not add a callable Agent operation.

A separately reviewed installer must bind this **specific action name with no caller parameters**, the exact reviewed host-action source SHA/asset manifest, and the normal approval/expiry/single-use/rollback semantics across the existing Host Actions v2 request, executor, MCP enum and policy registries. Use the trusted owner approval route; do not add a generic shell interface. Installation or alteration of Control Plane Production requires a distinct, explicit authorization and live rollback verification.

### Required evidence before activation

1. Independent source review of `moeinshow-ticket-qr-qa-v1.js`, the six pinned files, artifact emitter and test suite.
2. Run `node --check moeinshow-ticket-qr-qa-v1.js` and `node --test test-moeinshow-ticket-qr-qa-v1.js` in an authorized **development** environment. Do not use paid GitHub-hosted Actions.
3. Verify that the transient sandbox can start and access its fixed QA path while Production app/DB/credentials remain inaccessible.
4. Register via the existing approval-bound mechanism and verify **actual MCP discovery**, then run once. Keep the main site unmodified.
5. Collect real synthetic PNG/PDF SHA-256/QR decoding results; only then may the QR test gate become PASS.
6. Separate release approval still required: Production has ~488 modified tracked files and Git history differing from GitHub. Never directly merge/deploy PR #11 over it.

## Release status

**Delivery NO-GO; no publish**, even if the offline QR gate passes, until auth, OTP, reservation, payment sandbox, ticket delivery and source reconciliation gates pass.
