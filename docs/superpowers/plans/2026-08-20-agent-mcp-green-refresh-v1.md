# Agent MCP Green Refresh V1 Implementation Plan

**Goal:** Refresh only the already-migrated MCP backend by starting Green on 8125, atomically switching the stable router from Blue 8124 to Green 8125, preserving Blue as a live rollback backend, and requiring real connector validation before finalization.

**Approved design:** `docs/superpowers/specs/2026-08-20-agent-mcp-green-refresh-v1-design.md`

## Constraints

- No Agent API mutation.
- No router restart/reload.
- No Blue stop/restart during apply.
- No legacy 8130 mutation.
- No secrets, environment values, Bearer credentials, raw headers, or DSNs in output/evidence.
- Only fixed paths, ports and unit names.
- Production mutation modes require fresh external Level-4 confirmation.
- `--preflight-only` is strictly read-only.

## Task 1 — Contract tests (RED)

**Files**
- Create `test-agent-mcp-green-refresh-v1.js`
- Implementation target: `bootstrap-agent-mcp-green-refresh-v1.js`

Tests must prove:
1. implementation is initially absent;
2. only `--preflight-only`, `--apply`, `--rollback`, `--finalize` are accepted;
3. fixed MCP paths/ports/units and pinned source/router SHA identities are present;
4. no Agent API mutation units/ports/state paths appear in mutation logic;
5. preflight exposes bounded read-only result fields;
6. apply starts Green, never stops/restarts Blue or Router, and performs an atomic/fsync-backed pointer switch;
7. automatic apply rollback restores exact previous pointer bytes and Green pre-state;
8. explicit rollback/finalize require persisted apply evidence and current-state matching;
9. finalize enables Green and disables-but-does-not-stop Blue;
10. secret/environment output is absent.

Run: `node --test test-agent-mcp-green-refresh-v1.js`
Expected: RED because implementation is absent.

## Task 2 — Minimal bootstrap GREEN

Create `bootstrap-agent-mcp-green-refresh-v1.js` with exported pure helpers plus a production adapter.

Fixed identities:
- MCP source: `/home/agent/ssh-mcp-server/server.js` = `558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f`
- Source Mapping wrapper: `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js` = `87da44a939478786b9a48585c1cccacd862b683831dbba976d8b6a85869d2473`
- Router: `/opt/prhm-agent-zdt/router.mjs` = `53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78`
- public MCP: 8123
- Blue: 8124
- Green: 8125
- legacy untouched: 8130
- pointer: `/var/lib/prhm-agent-zdt/mcp-active`
- units: router/blue/green only.

Preflight verifies root/hostname, exact SHA identities, service contracts from `systemctl show`, router+Blue active/enabled, Green inactive/disabled, public+Blue health and ready, Green not listening, legacy 8130 still listening, pointer is a regular non-symlink file containing exact `8124` plus optional newline, disk threshold, and required binaries.

## Task 3 — Apply and automatic rollback

`--apply` reruns full preflight, creates a mode-0700 evidence directory under `/var/backups/prhm-agent-mcp-green-refresh/<timestamp>/`, records bounded pre-state/evidence, starts Green without enabling it, requires Green `/health` and `/ready`, atomically writes `8125\n` to the pointer with file+directory fsync, then requires public `/health` and `/ready`.

Blue remains active and enabled. Router is never restarted. Green remains active but disabled. Persist apply success evidence and a fixed latest-state record inside the same backup root.

If any failure occurs after first mutation, automatically restore the exact saved pointer bytes and Green active/enabled pre-state; verify public health on Blue; emit `rollback_performed=true`.

## Task 4 — Explicit rollback and finalize

`--rollback`:
- requires latest successful non-finalized apply evidence;
- verifies current pointer is 8125 and source/router SHA identities still match;
- atomically restores exact pre-apply pointer bytes;
- verifies public health/ready on Blue;
- stops Green only if apply had started it from inactive;
- restores Green enablement pre-state;
- never restarts/stops Blue or Router.

`--finalize`:
- requires latest successful non-rolled-back apply evidence;
- verifies pointer still 8125, Green/public health+ready, and pinned SHA identities;
- enables Green;
- disables Blue without stopping it;
- verifies public health remains good;
- persists `finalized=true`.

## Task 5 — Verification and rollout gate

Run fresh:
- `node --check bootstrap-agent-mcp-green-refresh-v1.js`
- `node --test test-agent-mcp-green-refresh-v1.js`

Then deploy the exact reviewed bootstrap bytes as a DeployHQ config-file artifact and execute only `--preflight-only` on Production. Restore the temporary DeployHQ command to `true` immediately after the deployment.

Production apply is a later gate and requires a fresh explicit `CONFIRM_LEVEL_4_CRITICAL`.

After apply, independently verify public/Green health and run the real connector sentinel:
- `safe_file_read(target="root_scripts", path="__PRHM_SOURCE_MAPPING_COMPAT_V2__")`

If the sentinel passes, request a fresh Level-4 confirmation for `--finalize`. If it fails, request a fresh Level-4 confirmation for `--rollback`.
