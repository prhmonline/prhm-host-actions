# Agent ZDT Baseline Refresh Host Action V1 — Design

## Goal
Add one fixed Level-4 Host Actions v2 action, `agent_zdt_baseline_refresh_v1`, that refreshes only the stale SHA bindings inside `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js` after legitimate reviewed source changes. The action must not perform ZDT cutover itself.

## Scope
The mutation target is exactly one file: `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js`.

The action replaces exactly five reviewed old SHA literals with these current live SHA values:

1. `hostActionsV2.js`: `ebe988...cc34` -> `7362fc...c5b85`
2. `selfmaint.js`: `fcf442...b2d0` -> `b1f618...7a80`
3. `ssh-agent-api/server.js`: `5c6ffd...1102` -> `70368f...999c`
4. `/opt/prhm-agent-selfmaint/server.js`: `b084b5...2877` -> `b0ada3...4ae`
5. `/opt/prhm-agent-selfmaint-exec/server.js`: `5346b2...acad` -> `6b945f...961ba`

The four unchanged source bindings remain pinned to their current reviewed values.

## Preflight contract
Before any write, the helper must:

- require root and zero user arguments;
- require the target to be a regular non-symlink file;
- require target SHA `a54e2890eb455c078a4e09e92e007d71545f834dfec7d8d62bb232e1c91406b4`;
- verify all nine current source SHA values exactly;
- require every old SHA literal exactly once and every replacement SHA absent from the target before transformation;
- derive the candidate in memory only;
- run `/usr/local/bin/prhm-node --check` on the candidate before mutation.

Any mismatch fails closed with zero target mutation.

## Mutation and verification
The helper creates a mode-0600 backup, atomically writes the deterministic candidate while preserving owner/mode, then verifies:

- post-write SHA equals the in-memory candidate SHA;
- all five old literals are absent;
- all five new literals occur exactly once in the target;
- all nine live source SHA values still match;
- syntax check passes.

The result must include:

- `ok=true`
- `action=agent_zdt_baseline_refresh_v1`
- `target_file_match=true`
- `source_hashes_verified=9`
- `replacements_applied=5`
- `unexpected_changes=0`
- `rollback_performed=false`

If verification fails after mutation, restore the backup atomically and fail.

## Host Actions v2 integration
A separate installer, `bootstrap-host-actions-v14-agent-zdt-baseline-refresh.js`, registers the fixed action in exactly four control-plane layers:

1. `/opt/prhm-agent-selfmaint/server.js`
2. `/opt/prhm-agent-selfmaint-exec/server.js`
3. `/opt/prhm-company-control-plane/config/approval-policy.json`
4. `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`

It also installs the reviewed helper at `/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-baseline-refresh-v1.js`.

The installer is pinned to the reviewed live pre-install hashes:

- Base: `b0ada3809307005d7715a1c7c970687b65ace82e765c8dfaeb5408061477b4ae`
- Executor: `6b945fcb3afe8ef3e074b07745912c5183f28826728bf4d14ed93c1161c961ba`
- Policy: `139e5571086b5ead1805e959d9a66866bd9ef3be19ead760a6281c63956a0e18`
- MCP: `7362fcf00bff04e46287df574f875110603d8c7da8b1bb207e9e609dc86c5b85`

The policy entry is Level-4 and scoped to `mohammad` with role `mcp-operator`, tool `host_action_v2_apply`, project `control_plane`, environment `production`, risk `critical`.

## Installer safety
The installer accepts only `--preflight-only` or `--apply`.

`--preflight-only` verifies the four baseline hashes, exact patch anchors, helper absence, helper syntax, candidate syntax and policy JSON without writing.

`--apply` backs up the four live control-plane files, writes the four deterministic candidates and helper, restarts only approval/selfmaint/executor/MCP, verifies services active and exact post-install hashes, and rolls all five paths back on failure.

The installer does not run `agent_zdt_baseline_refresh_v1` and does not run `agent_zero_downtime_bootstrap_v1`.

## Explicit non-goals
No DB change. No SEO change. No ZDT cutover. No generic path/command arguments. No service topology change beyond restarting the four control-plane services after registration. No redirect/noindex/content change.

## Rollout sequence
1. Merge/review branch artifacts.
2. Run installer preflight against the exact live baseline.
3. Apply installer through the approved root deployment path.
4. Verify refreshed MCP schema exposes `agent_zdt_baseline_refresh_v1`.
5. Create a new Level-4 request for `agent_zdt_baseline_refresh_v1`.
6. Execute the action and verify its evidence.
7. Create a new Level-4 request for `agent_zero_downtime_bootstrap_v1`.
8. Execute ZDT bootstrap and verify stable public API/MCP health and updated schema.
