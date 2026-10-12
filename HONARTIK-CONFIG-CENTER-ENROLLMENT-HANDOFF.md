# Honartik Config Center: approved Host Action handoff

This branch is a **fixed-scope transaction contract and offline tests**, NOT an installed Agent 3 tool. It does not register an MCP tool, modify Production, or generate credentials.

## Fixed bindings

- Action ID: honartik_config_center_readonly_enroll_v1
- Policy operation: host_action.honartik_config_center_readonly_enroll_v1
- Signed, expiring, one-time authorization: Level 4, CONFIRM_LEVEL_4_CRITICAL
- Tenant: honartik; config revision: 1; scope: config:read only
- Backend SHA: 7ae8b99677ec13b3498b4a5425267a49fc87806e
- Config Center release: git-9b41e4534382
- Enrollment script local Git commit: 740827bc445d028bca285e20b13b8765c4d75f28
- Enrollment script SHA256: b9978bd782282ee385b487cc7d4614edc2b6f4f3b8c513797c657b32f0d50903
- Secure private token file: /home/honartik/.config/prhm/config-center/readonly-machine-token, owner honartik, mode 0600
- Consumer validation: php yii config-center/check, run as OS user honartik

## Integration gate (NOT DONE)

The actual Agent 3 tool, its fixed allowlist entry, Approval Center policy and Host Actions executor adapter have NOT been deployed. These must first be Git-committed, protected by immutable preimage SHAs and separately authorized.

The trusted executor adapter must implement all eight REQUIRED_ADAPTER methods:

1. An exclusive lock covering enrollment, verification and rollback.
2. Read-only preflight that independently attests actual SHA/clean state, tenant, revision, private path and zero active credentials.
3. Atomic one-time consumption of a verified signed Level-4 request with exact action and SHA binding.
4. Invocation of only the fixed PHP enrollment script without a shell interpolation interface or plaintext credentials in outputs.
5. Independent postcondition proof: one active config:read-only credential, correct private file owner/mode, config API 200, secrets API 403.
6. Exact CLI validation: CONFIG_CENTER_READONLY_PASS tenant=honartik revision=1 source=remote.
7. Owner-bound rollback using only the pinned PHP rollback operation; independently prove credential revocation and private file removal without deleting unrelated data.
8. Bounded metadata-only audit: timestamp, action, request reference, source SHA, tenant, result and rollback. No token, hashes, authorization headers or HTTP response bodies.

All failed/unverified rollbacks must block further attempts pending investigation. No booking, payments, SMS or seat routing changes are in this action's scope.

## Verification

The offline Node test suite contains 16 synthetic tests covering approval failure, wrong SHA, credential preexistence, dirty source, invalid input schema, privilege escalation, bad file mode, secret endpoint access, failed CLI check, audit failure and rollback failure. It does not perform any production mutation or create secrets.

Go-live is only complete after a separately approved adapter/policy registration and real server-side test. Do not claim this PR alone activates the Agent 3 action.
