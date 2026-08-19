# Source Mapping Compat V3 Design

Date: 2026-08-20
Status: Design / review gate
Scope: MCP Source Mapping compatibility layer and safe reverse-slot refresh only

## Context

The MCP Green refresh completed successfully and the public router now serves Green on 127.0.0.1:8125 while Blue on 8124 remains active as the rollback backend. The compatibility sentinel now loads correctly, proving the stale-process problem is resolved.

Current Source Mapping Compat V2 live evidence:

- sentinel loads and returns structured `source_mapping_compat_v2` output;
- Gisheh database name-only succeeds;
- CF Park/Gisheh Git status and sanitized remote identity fail with `source_mapping_git_failed`;
- CF Park database name-only fails with `source_mapping_db_name_not_found`;
- no credential, remote URL, DSN, env value, password or arbitrary path/command is exposed.

Current source identities relevant to this remediation:

- `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js`
  SHA-256: `87da44a939478786b9a48585c1cccacd862b683831dbba976d8b6a85869d2473`
- `/home/agent/ssh-mcp-server/server.js`
  SHA-256: `558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f`
- `/opt/prhm-agent-zdt/router.mjs`
  SHA-256: `53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78`

## Root Cause 1: Git safe.directory

`fixedGit()` invokes `/usr/bin/git` with a deliberately restricted environment. This is correct for credential isolation, but the command currently does not supply a deterministic repository ownership override. On these fixed production roots Git therefore fails before status/remote metadata can be collected.

### Required remediation

For each fixed target only, invoke Git as:

`git -c safe.directory=<FIXED_CANONICAL_ROOT> -C <FIXED_CANONICAL_ROOT> ...`

Constraints:

- no HOME restoration;
- no reading global/user Git configuration for credentials;
- no arbitrary path input;
- no arbitrary Git arguments from the client;
- existing fixed target enum remains unchanged;
- sanitized remote output remains only `host` and `owner_repo`;
- changed file paths remain hidden; only changed-path count is returned.

## Root Cause 2: CF Park database config shape

The canonical CF Park backend uses `config('DB.dsn')` for the Yii DB component. The tracked configuration shape defines the DB DSN in `common/config/base_env.php`.

Compat V2 scans only these fixed candidates:

- `common/config/main-local.php`
- `common/config/db.php`
- `config/db.php`
- `backend/config/main-local.php`
- `common/config/main.php`

This does not match the real project layout.

### Required remediation

Add exactly this fixed candidate:

- `common/config/base_env.php`

The existing name-only extraction remains limited to the `dbname` segment. Output may contain only:

- `database_name`
- read-only/target flags
- no DSN
- no host
- no username
- no password
- no source content

Do not evaluate PHP, include application bootstrap files, connect to the database, or return the matched source line.

## Compat V3 sentinel

Add a new exact sentinel:

`__PRHM_SOURCE_MAPPING_COMPAT_V3__`

V2 must remain supported for compatibility. V3 returns the same bounded structure with operation name `source_mapping_compat_v3` and includes no new caller-controlled path/command surface.

Native typed tool names remain unchanged:

- `source_mapping_git_status_readonly`
- `source_mapping_git_remote_identity_sanitized`
- `source_mapping_database_name_only`

## Source patch delivery

The `safeFiles.js` source patch must use the existing MCP self-maintenance path because `agent_mcp/src/plugins/safeFiles.js` is already an approved fixed self-maintenance target.

Requirements:

1. exact current SHA guard = `87da44a939478786b9a48585c1cccacd862b683831dbba976d8b6a85869d2473`;
2. staged candidate content only;
3. candidate SHA recorded before approval;
4. syntax/import verification before apply;
5. backup and rollback handled by existing self-maintenance mechanism;
6. fresh Level-4 confirmation required for apply;
7. no manual direct write to `/home/agent/ssh-mcp-server`.

Applying the source patch is not sufficient to change the already-running Blue/Green Node processes.

## Reverse-slot refresh: Blue candidate

After the V3 source patch is committed on disk, Green continues serving public traffic on 8125. Blue on 8124 is the safe candidate to reload the new source.

A separate fixed bootstrap, `bootstrap-agent-mcp-blue-refresh-v1.js`, must implement:

### `--preflight-only`

Read-only and fail-closed. Must verify:

- current public backend is Green/8125;
- Green is active and healthy;
- public 8123 is healthy;
- Blue is active or safely restartable on fixed 8124;
- source `server.js`, `safeFiles.js` V3 candidate SHA and router SHA match pinned values;
- no API slot or API service is in scope;
- no Router restart/reload is required;
- rollback state can be persisted;
- no production mutation occurs.

### `--apply`

Fresh Level-4 confirmation required. Fixed sequence:

1. capture exact Blue pre-state and active router pointer;
2. restart only `prhm-agent-mcp-blue.service` so it loads the V3 source;
3. require Blue 8124 health;
4. atomically write router MCP active pointer `8125 -> 8124` with fsync-backed temp+rename;
5. require public 8123 health;
6. keep Green active as rollback backend;
7. persist bounded evidence;
8. on any post-mutation failure automatically restore pointer to 8125 and restore Blue pre-state where possible.

Explicit non-actions:

- do not restart/reload Router;
- do not stop/restart Green during apply;
- do not touch Agent API or ports 8099/8100/8101/8102/8110;
- do not mutate databases;
- do not expose credentials/secrets/env values.

### External validation gate

After apply, use the real connected ChatGPT tool path:

`safe_file_read(target="root_scripts", path="__PRHM_SOURCE_MAPPING_COMPAT_V3__")`

Acceptance requires:

- operation = `source_mapping_compat_v3`;
- Park front Git status succeeds;
- Park back Git status succeeds;
- Park front sanitized remote succeeds;
- Park back sanitized remote succeeds;
- Park DB name-only succeeds;
- Gisheh Git status succeeds;
- Gisheh sanitized remote succeeds and proves the exact owner/repo identity;
- Gisheh DB name-only remains successful;
- credentials_exposed = false everywhere;
- public MCP health remains 200.

If any item fails, do not finalize; Green remains rollback backend and explicit rollback is available.

### `--rollback`

Fresh Level-4 confirmation required. Restore the saved pointer to 8125 before restoring Blue pre-state. Require public health after rollback.

### `--finalize`

Fresh Level-4 confirmation required and only after real connector V3 validation passes. Preferred steady state after reverse cutover:

- Blue 8124 active and enabled;
- Green no longer preferred for boot; may remain running until final evidence is captured, but finalizer must not create a traffic interruption;
- Router remains active without restart/reload;
- public 8123 remains healthy.

## TDD requirements

Tests must cover at minimum:

1. Git command includes fixed per-root `-c safe.directory=` and accepts no caller path;
2. remote sanitization never returns raw URL/userinfo/token;
3. CF Park candidate list includes `common/config/base_env.php` and still outputs database name only;
4. V3 sentinel exact-match behavior while preserving V2;
5. Blue refresh preflight is mutation-free;
6. Blue refresh apply order is restart Blue -> Blue health -> atomic pointer -> public health;
7. Green is not stopped/restarted during apply;
8. Router is never restarted/reloaded;
9. automatic rollback restores pointer first;
10. evidence redaction removes sensitive keys/values.

## Approval boundaries

The following are materially separate critical actions and require separate fresh Level-4 confirmations:

1. apply the V3 `safeFiles.js` source patch through self-maintenance;
2. execute Blue refresh `--apply` and cut public MCP back to 8124;
3. execute explicit `--rollback`, if needed;
4. execute `--finalize` after external validation.

No Level-4 confirmation may be reused across these actions.

## Success condition

Source Mapping Gate V2/V3 may be finalized only after Park Bazar and Gisheh fixed diagnostics return complete typed evidence. Solo Company remains independently mapped and must not be mutated by this remediation.
