# Control Plane Typed Bootstrap Transport V1 — Design

## Status
Design approved in chat for written-spec capture. Implementation is not yet authorized.

## Goal
Provide a permanent, tightly-scoped bootstrap primitive for the PRHM Control Plane that can install one pre-approved immutable package without exposing arbitrary code execution, arbitrary filesystem writes, arbitrary URLs, arbitrary repositories, arbitrary commands, or secret input.

## Action Contract
- action: `control_plane_typed_bootstrap_transport_v1`
- operation: `host_action.control_plane_typed_bootstrap_transport_v1`
- environment: `production`
- risk: `critical`
- execution requires a fresh, literal, single-use `CONFIRM_LEVEL_4_CRITICAL` bound to the specific persisted request.
- request schema accepts no free-form file path, URL, repository, commit, content, command, environment override, credential, token, secret, or shell input.

## Package Model
V1 supports exactly one manifest-bound package per installed transport build. The package identity is compiled into the transport and is not supplied by the request.

The initial package is:
- package_id: `deployhq_control_adapter_node1_recreate_v1`
- source_repo: `prhmonline/prhm-host-actions`
- source_commit: exact immutable Git commit SHA fixed at implementation time
- manifest_sha256: exact SHA-256 fixed at implementation time

The package manifest contains only fixed records with:
- `source_path`
- `destination_path`
- `sha256`
- `mode`
- `owner`
- `group`
- `replace_policy`

The manifest cannot reference another manifest, package, repository, URL, branch, tag, or runtime-supplied source.

## Initial Package Files
The initial package may contain only the already-reviewed DeployHQ adapter/node1 artifacts:
- `deployhq-control-adapter-v1.js`
- `bootstrap-deployhq-control-adapter-v1.js`
- `deployhq-node1-canonical-recreate-v1.js`
- `bootstrap-host-actions-deployhq-node1-recreate-v1.js`
- a fixed `prhm-deployhq-control.service` unit generated from reviewed source, if the implementation plan keeps the unit as a manifest-owned artifact.

No package file may contain credentials, tokens, private keys, authorization headers, or secret material.

## Destination Allowlist
Writes are allowed only to exact manifest-owned destinations under these roots:
- `/opt/prhm-deployhq-control/`
- `/opt/prhm-agent-selfmaint-exec/actions/`
- `/var/lib/prhm-agent-selfmaint-exec/`
- `/etc/systemd/system/prhm-deployhq-control.service`

The implementation must reject:
- any destination outside this allowlist;
- symlink destinations or symlink parents that would escape the allowed roots;
- relative paths, `..`, alternate path spellings, mount traversal, or path normalization ambiguity;
- runtime-supplied destination values.

## Source Integrity
The transport is SHA-bound at three levels:
1. exact source commit;
2. exact manifest SHA-256;
3. exact SHA-256 for every package artifact.

A mismatch at any level is a hard fail before mutation.

No `git pull`, `git checkout`, branch resolution, tag resolution, or mutable remote reference is permitted during apply. The implementation may stage already-pinned bytes from an approved package artifact or another immutable source mechanism defined in the implementation plan, but must not introduce a general network fetch primitive.

## Preflight
`--preflight-only` is strictly read-only and must verify at minimum:
- expected source commit identity;
- manifest SHA-256;
- every package artifact SHA-256;
- destination allowlist compliance;
- no unsafe symlink destination/parent;
- no secret-like material in package metadata/evidence;
- Node syntax for JavaScript artifacts;
- systemd unit validation for any unit artifact;
- current Control Plane baseline SHA bindings required by registration/install logic;
- no conflicting existing destination state outside approved replace policy.

Successful evidence includes:
- `ok=true`
- `preflight_only=true`
- `production_mutation=false`
- `source_commit_match=true`
- `manifest_sha_match=true`
- `all_file_sha_match=true`
- `destination_allowlist_pass=true`
- `symlink_guard_pass=true`
- `syntax_pass=true`
- `baseline_match=true`

Preflight must not write files, rename files, start/restart/reload services, call DeployHQ mutations, create credentials, or mutate any project/application content.

## Apply Transaction
After a fresh Level-4 confirmation, apply must:
1. reverify the exact package identity, manifest SHA, artifact SHAs, and live baseline;
2. capture pre-state for only manifest-owned destinations and relevant service state;
3. create a root-owned private staging directory;
4. stage only manifest-owned candidates;
5. verify candidate SHA, ownership/mode expectations, syntax, and unit validity again;
6. atomically install candidates only to allowlisted destinations;
7. run `systemctl daemon-reload` only when the fixed unit changed;
8. start/restart only `prhm-deployhq-control.service` when appropriate;
9. verify adapter localhost health/readiness without exposing credentials;
10. install the fixed Host Action registration artifacts required for `deployhq_node1_canonical_recreate_v1`;
11. restart only the explicitly required Approval/Base/Executor services;
12. update MCP source if required, but do not restart or cut over public MCP ad hoc;
13. persist bounded result evidence.

The public MCP runtime remains subject to a separate rolling-refresh gate.

## Credential Boundary
The transport never receives, creates, stores in repository content, prints, or forwards DeployHQ credentials.

DeployHQ authentication remains external to the package. The adapter uses systemd credentials:
- `deployhq_email`
- `deployhq_api_key`

The underlying root-owned credential sources must be provisioned independently from this transport and remain outside repository/package content.

Permitted credential evidence is limited to:
- `credential_present=true|false`
- length
- short SHA-256 prefix, maximum 12 hex characters

No credential value, Authorization header, Basic auth payload, private key, token, or password may appear in logs, result files, exceptions, chat output, or test fixtures intended for production evidence.

If credentials are absent, package installation may complete, but the adapter must remain fail-closed with readiness false and `deployhq_credentials_missing`. The node1 recreate action must remain non-executable until adapter readiness succeeds.

## Forbidden Capabilities
The transport must not expose or internally support:
- raw shell;
- arbitrary process execution supplied by request;
- arbitrary command strings;
- arbitrary URLs or API paths;
- arbitrary repository or commit inputs;
- arbitrary file content;
- arbitrary destination paths;
- environment overrides;
- secret or credential input;
- DeployHQ deployment execution;
- DeployHQ target mutation itself;
- Git checkout/pull;
- `curl | bash` or equivalent remote execution;
- package chaining or manifest chaining.

Any helper process execution required internally for fixed syntax/systemd verification must use fixed executable paths and fixed argument construction derived only from compiled manifest data.

## Rollback
Rollback is invocation-journal-bound.

Only changes made by the current invocation may be reversed. For every mutated manifest-owned path, apply records whether the path existed, its original SHA-256, mode, owner/group metadata needed for restoration, and a SHA-verified backup when replacement is allowed.

On failure after first mutation:
- newly created invocation-owned files are removed;
- replaced files are restored only from their own SHA-verified backups;
- relevant pre-existing service state is restored;
- no broad cleanup is attempted;
- Honartik, iMotion, WordPress, application data, and unrelated Control Plane files are untouched.

If rollback fails, return explicit critical evidence:
- `ok=false`
- `critical_failure=true`
- `rollback_failed=true`

No broader automatic remediation is attempted after rollback failure.

## Evidence Contract
Success evidence must include at minimum:
- `ok=true`
- `action=control_plane_typed_bootstrap_transport_v1`
- `package_id=deployhq_control_adapter_node1_recreate_v1`
- `source_commit_match=true`
- `manifest_sha_match=true`
- `installed=true|false` as appropriate
- `adapter_installed=true|false`
- `adapter_ready=true|false`
- `host_action_registration_installed=true|false`
- `mcp_refresh_required=true|false`
- `deployhq_mutation=false`
- `application_mutation=false`
- `honartik_mutation=false`
- `imotion_mutation=false`
- `rollback_performed=true|false`
- `rollback_failed=false` on normal success

## TDD Acceptance Cases
Implementation must cover at least:
1. valid exact manifest -> PASS;
2. wrong source commit -> FAIL_CLOSED;
3. wrong manifest SHA -> FAIL_CLOSED;
4. one artifact SHA mismatch -> FAIL_CLOSED;
5. destination outside allowlist -> FAIL_CLOSED;
6. symlink destination or unsafe symlink parent -> FAIL_CLOSED;
7. arbitrary path injection -> REJECT;
8. arbitrary command injection -> REJECT;
9. secret-like content/evidence leakage -> FAIL/REDACT;
10. preflight performs zero writes;
11. apply writes only manifest-owned paths;
12. post-write SHA mismatch -> rollback;
13. adapter health failure -> rollback or defined credentials-missing fail-closed state;
14. rollback restores only invocation-owned changes;
15. rollback failure -> explicit critical evidence;
16. public MCP runtime is not restarted directly;
17. Honartik and iMotion targets/state remain untouched;
18. DeployHQ API is never called by the transport itself;
19. request schema contains no arbitrary package/source/path/content/command fields;
20. repeated request after exact successful installation is idempotent or fails safely according to fixed replace policy.

## Separation of Gates
The following remain separate approval/execution gates:
1. install `control_plane_typed_bootstrap_transport_v1` itself;
2. use the transport to install the fixed DeployHQ adapter/node1 package;
3. perform the MCP rolling schema refresh;
4. create `deployhq_node1_canonical_recreate_v1` request;
5. apply the node1 recreate action;
6. resume Blue V4 MCP cutover.

A Level-4 confirmation is single-use and must never be reused across these gates.

## Out of Scope
- deleting or changing temporary Honartik DeployHQ targets;
- modifying active Honartik commands;
- executing Blue V4 cutover;
- registering iMotion targets;
- changing iMotion/WordPress content, redirects, canonicals, or databases;
- general-purpose package installation;
- general-purpose remote execution;
- arbitrary DeployHQ administration.
