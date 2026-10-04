# WAHA Student Bridge Registration V1

Register six fixed WAHA Student Bridge Host Action v2 operations against the current PRHM Agent 3 control-plane owners.

## Fixed artifact

- Source commit: `483c1bf3ff23dea62c6512d6d374fb3dc0ec5676`
- Helper: `waha-student-bridge-install-v1.js`
- Helper SHA-256: `9907f6df0a34151a6068c2c046b39b6943c6d816ff21520352e5a658c7523e96`
- Helper target: `/opt/prhm-agent-selfmaint-exec/actions/waha-student-bridge-install-v1.js`

## Registered operations

- `waha_student_bridge_preflight_v1` — Level 3 / high — fixed `--preflight-only`
- `waha_student_bridge_install_v1` — Level 4 / critical — fixed sequence `--apply`, `--session-ensure`, `--qr`
- `waha_student_bridge_status_v1` — Level 3 / high — fixed `--status`
- `waha_student_bridge_session_ensure_v1` — Level 3 / high — fixed `--session-ensure`
- `waha_student_bridge_qr_v1` — Level 3 / high — fixed `--qr`
- `waha_student_bridge_rollback_v1` — Level 4 / critical — fixed `--rollback`

No action accepts a caller-supplied command, path, host, mode, session, credential, SQL, Docker image, phone number, or arbitrary payload.

## Registration owners

The installer is bound to four exact live preimages captured on 2026-10-04:

- self-maintenance base: `ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f`
- self-maintenance executor: `a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4`
- approval policy: `aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c`
- MCP HostActionsV2 plugin: `8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075`

The registration installer performs no database mutation and no direct service restart. It returns `requires_zdt_refresh: true`; activation must use the existing approved ZDT refresh surface after registration.

Any mismatch is fail-closed. Partial write failure triggers restoration of the exact captured preimages and removal of the newly created helper.
