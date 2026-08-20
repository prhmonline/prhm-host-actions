# Honartik iTicket Host Action V1 Design

**Status:** Approved

**Approval:** `SPEC_REVIEW_APPROVED_HONARTIK_ITICKET_HOST_ACTION_V1`

## Goal

Add one fixed, no-input Host Actions v2 action named `honartik_iticket_dark_backend_batch1_v1` that can safely write and verify the first dark iTicket backend batch only inside the existing isolated Honartik backend worktree. The action must not deploy Honartik, mutate a database, read a real iTicket token, or make an external iTicket request.

## Canonical repository and baseline

The installer is versioned in `prhmonline/prhm-host-actions` and is developed from GitHub `main` commit `1ce3714fbc3c531f3d0a04153bdcccdf8599614f`.

The live control-plane baselines observed during preflight are:

- Base: `/opt/prhm-agent-selfmaint/server.js` SHA-256 `b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877`, version `1.0.0-l4-fail-closed`.
- Executor: `/opt/prhm-agent-selfmaint-exec/server.js` SHA-256 `5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad`, health version `1.12.4-host-actions-v2-verified-economics-fixture`.
- MCP plugin: `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js` SHA-256 `ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34`.
- Approval policy: `/opt/prhm-company-control-plane/config/approval-policy.json` SHA-256 `c56f3f7c35e6ac22735f0689371e8ca4a7de6f8c375436a456798f8df0b7596a`, version `2026-08-19.1-agent-zero-downtime-bootstrap-v1`.

Any installer run against different live baselines must fail closed before mutation.

## Architecture

The change follows the existing fixed Host Actions bootstrap pattern used by V12/V12-2. A repository bootstrap script owns installation, backup, atomic writes, service restart, health verification, and rollback. The runtime Host Action remains fixed server-side and accepts no path, command, code, token, URL, SQL, or file-content arguments.

The bootstrap is `bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js`. It installs `honartik-iticket-dark-backend-batch1-v1.js` and registers the action in four existing control-plane surfaces:

1. `/opt/prhm-agent-selfmaint/server.js` — Base approval-request registry.
2. `/opt/prhm-agent-selfmaint-exec/server.js` — fixed action spec, dispatch, helper execution, and result validation.
3. `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js` — MCP enum/schema.
4. `/opt/prhm-company-control-plane/config/approval-policy.json` — Level-4 operation and typed scope.

The helper path is fixed as `/opt/prhm-agent-selfmaint-exec/actions/honartik-iticket-dark-backend-batch1-v1.js`.

## Host Action contract

Action: `honartik_iticket_dark_backend_batch1_v1`

Approval operation: `host_action.honartik_iticket_dark_backend_batch1_v1`

Risk: `critical`, Level 4, one-time approval via `host_action_v2_request` then `CONFIRM_LEVEL_4_CRITICAL` and `host_action_v2_apply`.

The action has no input other than the fixed action enum selected at request time.

## Honartik worktree bindings

Frontend production root: `/home/honartik/domains/honartik.ir/public_html`

Frontend isolated worktree: `/home/honartik/worktrees/iticket-dark-v1-front`

Frontend expected HEAD: `ecd3bfce8790b5cb3d32afbfbf45bc39839dba62`

Backend production root: `/home/honartik/domains/dashboard.honartik.ir/public_html`

Backend isolated worktree: `/home/honartik/worktrees/iticket-dark-v1-back`

Backend expected HEAD: `54d8038a64ce64e78c84dfeaffbb4cca36446108`

Both worktrees must be on `feature/iticket-dark-v1`. The backend worktree must be clean before Batch 1. The frontend worktree must remain clean throughout.

The production source overlays are immutable evidence. Their `git status --porcelain=v1` fingerprints are captured before mutation and must be identical after helper completion. Production HEADs must remain the fixed SHAs above.

## Batch 1 payload

The helper creates exactly these three previously absent files in the backend worktree:

- `app/components/iticket/IticketConfig.php`
- `app/components/iticket/IticketClient.php`
- `app/components/iticket/tests/DarkGateTest.php`

Their contents are embedded in the helper and SHA-bound. They implement the dark dual gate:

- `ITICKET_ENABLED` must be explicitly true.
- `ITICKET_API_ACCESS_TOKEN` must be non-empty.
- If either condition fails, iTicket is disabled.
- Disabled state makes zero transport calls.
- Enabled requests use `X-Api-Access-Token` only.
- `Authorization`/Bearer is prohibited.
- Public/debug status never exposes the token.
- Transport errors are normalized so secret-bearing exceptions are not retained.

No real token is loaded by the action and the test uses only a synthetic test token.

## Sandbox and side-effect boundaries

The executor launches the helper through a fixed `systemd-run` sandbox with `NoNewPrivileges`, `PrivateTmp`, `PrivateDevices`, read-only home/system protection, and `RestrictAddressFamilies=AF_UNIX`. The only writable application path is `/home/honartik/worktrees/iticket-dark-v1-back`; the result directory is also writable.

The action reports and validates all of these as false:

- `database_mutation`
- `deploy`
- `external_network`
- `token_read`
- `production_application_tree_mutation`
- `git_metadata_mutation`

The only permitted mutation is creation of the three Batch 1 files in the isolated backend worktree.

## Verification

Before writing, the helper verifies host identity, worktree existence, exact branch, exact HEAD, clean target state, production HEADs, and production overlay fingerprints.

After writing, it verifies exact file SHA-256 values, PHP syntax for all three files, `ITICKET_DARK_GATE_TEST=PASS`, the exact expected untracked-file set in the backend worktree, a clean frontend worktree, and unchanged production overlays.

A successful result uses schema `prhm.host-action-result.v1` and contains `ok:true`, the exact action name, the three file hashes, the PASS marker, and explicit no-side-effect booleans.

## Failure and rollback

If any helper check fails after one or more Batch 1 files are written, only files written by that invocation are removed. Existing unknown files are never overwritten or deleted. Empty Batch 1 directories created by the helper may be removed. Git branches, refs, indexes, worktree registrations, commits, production files, and databases are never mutated.

If bootstrap installation fails after control-plane mutation begins, the bootstrap restores all original control-plane files from a timestamped backup, removes the newly installed helper if it did not previously exist, restarts affected services, and verifies original SHA-256 values.

## Bootstrap installation behavior

The bootstrap supports `--preflight-only`. Preflight validates all live baseline SHAs, embedded helper SHA, policy shape, action absence/presence rules, helper syntax, and a no-mutation helper preflight contract without writing control-plane files.

Installation performs backup before the first write, atomic file replacement, JSON validation for the policy, Node syntax validation, controlled restarts of Approval, Base self-maintenance, Executor, and MCP, then health checks. It verifies that all four registries expose the new action and that policy binding remains restricted to principal `mohammad`, role `mcp-operator`, tool `host_action_v2_apply`, project `control_plane`, environment `production`, and risk `critical`.

The approval policy version becomes `2026-08-20.1-honartik-iticket-dark-backend-batch1-v1`. The Base semantic version remains `1.0.0-l4-fail-closed`; the Executor health version becomes `1.12.5-host-actions-v2-honartik-iticket-dark-backend-batch1`.

## Deployment boundary

GitHub branch/PR creation and repository tests are not production deployment. DeployHQ execution is a separate production mutation gate and must not occur as part of implementation without an explicit later production approval.

## Acceptance criteria

- Repository tests prove bootstrap registration, embedded helper integrity, no-input schema, Level-4 policy binding, rollback tokens, and helper side-effect constraints.
- `node --check` passes for bootstrap, helper, and test files.
- `node --test test-v14-honartik-iticket-dark-backend-batch1.js` passes.
- Bootstrap `--preflight-only` fails closed on baseline drift and performs no mutation.
- A draft PR is created from `design/honartik-iticket-host-action-v1` to `main`.
- No DeployHQ deployment is triggered during this implementation phase.
