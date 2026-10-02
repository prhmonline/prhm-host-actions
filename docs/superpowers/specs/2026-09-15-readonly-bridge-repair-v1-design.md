# readonly_bridge_repair_v1 Design

## Goal
Repair the restart loop of `prhm-readonly-http.service` without weakening the independent Recovery Agent or expanding arbitrary production execution capability.

## Confirmed production facts
- `prhm-readonly-http.service` is enabled and currently enters an auto-restart loop.
- `prhm-recovery-agent.service` is active and owns `10.71.0.118:8140`.
- Recovery health on `http://10.71.0.118:8140/health` identifies `prhm-recovery-agent` version `1.1`.
- `127.0.0.1:8140` is not listening.
- `8141` and `8142` were observed free during diagnosis.
- Agent API health on `8099` and MCP health on `8123/8124/8125` are healthy.
- The bridge environment file is `/etc/prhm-readonly-http.env`, mode `0600`, root-owned.
- No bridge environment value or credential has been exposed.

## Scope
Create a fixed, no-input Host Action named `readonly_bridge_repair_v1`.

The action may mutate only:
- `/etc/prhm-readonly-http.env`
- `prhm-readonly-http.service` runtime state
- its own root-only backup/result directories

It must not mutate:
- `prhm-recovery-agent.service` or `/etc/prhm-recovery-agent.env`
- Agent API or MCP configuration/runtime except read-only health probes
- databases
- firewall/DNS/network policy
- unrelated systemd units

## Preflight contract
The action fails closed before mutation unless all checks pass:
1. `/etc/prhm-readonly-http.env` is a regular, non-symlink file owned by root, mode `0600`.
2. The bridge environment resolves to exactly one listen-port assignment whose numeric value is `8140`.
3. No second unrelated assignment to `8140` exists inside the bridge env.
4. `10.71.0.118:8140` answers `/health` with `service=prhm-recovery-agent`.
5. `127.0.0.1:8141` and `10.71.0.118:8141` are both unavailable/free before mutation.
6. `prhm-readonly-http.service` is the expected unit and uses `/etc/prhm-readonly-http.env` plus `/opt/prhm-readonly-http/server.js`.
7. Agent API `8099` and MCP `8123/8124/8125` are healthy.
8. The current env SHA-256 is captured and bound to the apply transaction.

The helper must never print env values. It may report only env key names, SHA-256 values, ports, service identities, booleans, and status metadata.

## Mutation
- Create a root-only backup directory under `/var/backups/prhm-readonly-bridge-repair-v1/<timestamp>/`.
- Copy the exact preimage to `prhm-readonly-http.env.bak`, mode `0600`.
- Re-read the target and require its SHA-256 to still equal the preflight SHA before write.
- Replace only the single numeric listen-port value `8140` with `8141`, preserving every other byte where practical and preserving file owner/mode.
- Write via a same-directory temporary file, fsync, chmod/chown to original metadata, then atomic rename.
- Restart only `prhm-readonly-http.service`.

## Success verification
Success requires all of the following:
1. `prhm-readonly-http.service` is `active/running`.
2. Bridge `/health` on port `8141` returns HTTP 200 and identifies `service=prhm-readonly-http`; Recovery identity must never be accepted as the bridge.
3. Recovery remains HTTP 200 on `10.71.0.118:8140/health` with `service=prhm-recovery-agent`.
4. Agent API remains healthy on `8099`.
5. MCP remains healthy on `8123`, `8124`, and `8125`.
6. `NRestarts` for the bridge does not increase during a stability sample of at least 5 seconds after health becomes good.
7. Post-write env SHA differs from preimage SHA and a structural parser confirms the one allowed port change only.

## Rollback
On any failure after mutation:
- Restore the exact backup atomically.
- Restart only `prhm-readonly-http.service`.
- Verify Recovery, Agent API, and MCP remain healthy.
- Report `rollback_performed=true`.
- If rollback or rollback verification fails, return a distinct `failed_and_rollback_failed` error and retain the backup.

## Approval and execution model
- Fixed action only; no arbitrary path, command, service, host, or port input.
- Production execution must be bound to a one-time typed approval for `mohammad` / `mcp-operator`.
- Required policy level is Level 3 (`high`) unless control-plane installation itself requires Level 4 under the current policy. If installation requires Level 4, stop at that gate and request `CONFIRM_LEVEL_4_CRITICAL`; do not reuse the Level-3 confirmation for a higher-risk control-plane mutation.
- The eventual Level-3 execution confirmation is exactly `CONFIRM_LEVEL_3_PRODUCTION`.

## Implementation shape
Repository deliverables:
- `readonly-bridge-repair-v1.js`: pure/fixed repair helper with `--preflight-only` and `--apply` only.
- `readonly-bridge-repair-v1.test.js`: unit tests around env parsing, single-change enforcement, fail-closed guards, output redaction guarantees, and rollback planning.
- `bootstrap-host-actions-readonly-bridge-repair-v1.js`: installer/registration bootstrap that SHA-binds the helper and adds only this action to executor/policy typed scopes.
- CI workflow or existing test integration to run Node syntax/tests without production mutation.

## Non-goals
- Moving or restarting the Recovery Agent.
- General port-repair framework.
- General systemd editor.
- Arbitrary environment-file patching.
- Exposing privileged shell through GitHub Actions or Desktop Commander.
