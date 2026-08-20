# Control Plane Typed Bootstrap First-Install Bridge V1 — Design

## Status
Design approved in chat for written-spec capture. Implementation is not yet authorized.

## Purpose
Resolve the circular-bootstrap problem for `control_plane_typed_bootstrap_transport_v1` by introducing one fixed, zero-input, SHA-bound, self-retiring first-install bridge. The bridge exists only to make the already-reviewed transport candidate installable through the existing Level-4 control-plane approval boundary without raw shell, temporary DeployHQ targets, generic file-write primitives, or scope expansion of unrelated self-maintenance/ZDT actions.

## Fixed Identity
- Action: `control_plane_typed_bootstrap_first_install_bridge_v1`
- Operation: `host_action.control_plane_typed_bootstrap_first_install_bridge_v1`
- Environment: `production`
- Risk: `critical`
- Level-4 confirmation: required for apply
- Request fields: none (`[]`)

## Exact Candidate Binding
The bridge is permanently bound to one reviewed candidate lineage:
- Repository: `prhmonline/prhm-host-actions`
- Transport source branch dependency: `design/control-plane-typed-bootstrap-transport-v1`
- Transport source commit: `51027bc81f16840580b3ed5ca09d6c42f78dc044`
- Package id: `deployhq_control_adapter_node1_recreate_v1`
- Manifest SHA-256: `aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728`

Implementation must compute and compile the exact SHA-256 of:
1. `control-plane-typed-bootstrap-transport-v1.js`
2. `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`

No branch name, PR number, repository, URL, path, SHA, file content, command, environment value, token, credential, or package id may be supplied by the runtime request.

## Why Existing Primitives Are Not Reused
### Self-maintenance
Existing `selfmaint_request` is intentionally scoped to `agent_api` and `agent_mcp`. Expanding it to arbitrary Base/Executor/Policy/adapter paths would convert it into a generic privileged write primitive and is out of scope.

### `agent_zero_downtime_bootstrap_v1`
This action owns runtime topology/migration semantics. It must not be extended into a package installer because that would mix ZDT responsibilities with bootstrap/package deployment and enlarge its blast radius.

### Existing `host_action_v2_installer_v1`
The installed action is hard-bound to the Honartik fixed action flow and is not a generic bootstrap mechanism. It must not be repurposed.

## First-Install Bridge Scope
The bridge may only:
1. verify the immutable transport candidate bytes and registration bootstrap bytes;
2. verify live baseline SHA bindings;
3. stage the two fixed candidate artifacts under the private bridge staging root;
4. execute only the exact registration bootstrap candidate with the fixed `--apply` argument after Level-4 authorization;
5. verify the resulting Base/Executor/Policy/MCP/ZDT source state, relevant service health, and installed transport helper/source registration;
6. persist bounded evidence;
7. mark itself retired after successful first install.

### Fixed Staging Root
`/var/lib/prhm-agent-selfmaint-exec/bootstrap-first-install-v1/`

No caller-controlled subpath is permitted.

## Explicitly Forbidden Capabilities
The bridge must not:
- accept or execute arbitrary shell or command input;
- accept arbitrary path, destination, URL, repository, branch, commit, package, file content, environment, token, credential, or secret input;
- call the DeployHQ API;
- create, update, delete, or execute DeployHQ targets, commands, deployments, or config files;
- provision DeployHQ credentials;
- recreate canonical node1;
- install any package other than the fixed transport candidate;
- mutate Honartik or iMotion application content/targets;
- mutate redirects, canonicals, databases, WordPress content/plugins, or production site content;
- run `git pull`, `git checkout`, `curl | bash`, or equivalent generic fetch/execute flows;
- directly restart or cut over the public MCP runtime;
- weaken systemd sandboxing or approval policy controls.

## Baseline Binding
Before implementation, and again immediately before live preflight/apply, the bridge must capture and bind exact SHA-256 values for:
- `/opt/prhm-agent-selfmaint/server.js`
- `/opt/prhm-agent-selfmaint-exec/server.js`
- `/opt/prhm-company-control-plane/config/approval-policy.json`
- `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`
- `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js`

Last observed baseline at design time:
- Base: `c38bb88c5d7000eebedc5db758c7dd7d846b7b1a6df589c10f37237c3d1cce00`
- Executor: `edaf10ace464cb70ea1625cb7998b2bae0112b46b1d4f383334ceeaf5b6a5108`
- Policy: `162bfa045d9b600a48989dd88e4b367beff1272cbb9b83e1dbc5cf6bc8d6adad`
- MCP HostActions source: `c7be9c315319c893ee821268507577f10cb001440899f670659b2c3c7b26b722`
- ZDT helper: `04a1416e837b1ae47e0a0ae72b5c1547d03118022c6c9ff19f392572ff7d38b4`

These are evidence, not permanent assumptions. If any baseline drifts, implementation/preflight must stop, inspect compatibility, and rebase the candidate guard rather than disabling SHA checks.

## Preflight-Only Contract
Preflight performs zero production writes and returns bounded evidence including:
- exact source commit match;
- transport artifact SHA match;
- registration bootstrap SHA match;
- package manifest SHA match;
- all live baseline SHA matches;
- fixed staging-path contract pass;
- Node syntax pass using fixed/fileless verifier where possible;
- public/Blue/Green MCP health pass;
- Base/Executor/Approval health pass;
- `production_mutation=false`;
- `deployhq_mutation=false`;
- `honartik_mutation=false`;
- `imotion_mutation=false`;
- `mcp_cutover=false`.

A mismatch fails closed before mutation.

## Apply Contract
A fresh literal `CONFIRM_LEVEL_4_CRITICAL` is required and is bound to one persisted request. Apply must:
1. reverify all candidate and baseline SHA values;
2. verify the bridge has not already completed successfully;
3. create/use only the fixed private staging root;
4. stage only the exact transport and registration-bootstrap artifacts;
5. reverify staged byte SHA and syntax;
6. execute only `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js --apply` through a hardened fixed systemd-run invocation;
7. verify post-install Base/Executor/Policy/MCP/ZDT SHA values against candidate hashes produced by the registration bootstrap;
8. verify Base/Executor/Approval services are healthy;
9. verify the transport helper/source registration is present;
10. persist bounded result evidence;
11. set the bridge retirement marker only after all verification succeeds.

The bridge does not apply the DeployHQ adapter package itself. It only makes the typed transport available for its later, separately approved package-install request.

## Namespace/Sandbox Requirements
The bridge must preserve fail-closed systemd hardening. Required writable parents must be precreated before `systemd-run` so missing `ReadWritePaths` targets cannot recreate the historical `status=226/NAMESPACE` failure. The runner must use exact fixed paths and no request-derived arguments.

## Self-Retirement
After one verified successful first install:
- `bridge_state=retired`
- later request creation/execution for the same bridge must fail closed with an explicit `first_install_already_completed`-class result;
- retirement evidence must be immutable/bounded and include candidate identity and post-install SHA evidence;
- the bridge code may remain installed for auditability, but its execution guard is permanently closed for this V1 candidate.

No automatic deletion of the bridge code is required, because deleting the currently executing bootstrap primitive complicates reliable rollback and audit evidence.

## Transaction and Rollback
Rollback is invocation-bound only. Before first mutation, capture exact pre-state for every path/service the bridge or registration bootstrap can change. If apply fails after mutation begins:
- restore Base, Executor, Policy, MCP source, and ZDT source from SHA-verified invocation backups as applicable;
- remove only staging/helper artifacts created by the current invocation;
- restore original service state for only services touched by this invocation;
- do not clean unrelated files or services;
- do not mutate DeployHQ/Honartik/iMotion;
- do not perform a public MCP cutover.

If rollback fails, persist explicit critical evidence:
- `ok=false`
- `critical_failure=true`
- `rollback_failed=true`

No broad automatic remediation is permitted after rollback failure.

## Concurrency and Drift Preservation
The bridge must preserve concurrent Control Plane additions. SHA drift requires a compatibility inspection. Rebase may update only compiled guard/patch anchors proven compatible; it must never overwrite unrelated actions, status-handler fixes, or concurrent registry/dispatch additions. In particular, the V16 pending-request status behavior must remain intact.

## Result Contract
Successful evidence must include at least:
- `ok=true`
- `action=control_plane_typed_bootstrap_first_install_bridge_v1`
- schema version
- exact transport candidate identity
- exact manifest SHA
- `preflight_only=false`
- `production_mutation=true`
- `transport_registered=true`
- `bridge_state=retired`
- `deployhq_mutation=false`
- `honartik_mutation=false`
- `imotion_mutation=false`
- `mcp_cutover=false`
- `rollback_performed=false`
- bounded post-install SHA evidence.

No secret/token/credential value may appear in result, logs, exceptions, tests, or chat.

## TDD Acceptance Cases
At minimum:
1. exact fixed candidate passes;
2. wrong source commit fails closed;
3. transport artifact SHA mismatch fails;
4. registration bootstrap SHA mismatch fails;
5. package manifest mismatch fails;
6. baseline drift fails before mutation;
7. preflight performs zero writes;
8. request surface is zero-input;
9. path/staging injection is impossible;
10. only the exact fixed bootstrap executable and argument are permitted;
11. verified registration success retires the bridge;
12. second execution fails/idempotently reports already completed;
13. partial registration failure triggers invocation-bound rollback;
14. rollback failure produces explicit critical evidence;
15. bridge itself never calls DeployHQ API;
16. bridge never accesses credential values;
17. Honartik/iMotion remain untouched;
18. public MCP runtime is not directly restarted/cut over;
19. V16 pending-status behavior is preserved;
20. compatible concurrent Executor additions are preserved during rebase/patching;
21. missing required writable parent fails preflight or is precreated before namespace setup, preventing `226/NAMESPACE` regression;
22. retirement marker is written only after successful verification.

## Gate Sequence
1. Written spec approval.
2. Implementation plan.
3. TDD RED→GREEN.
4. Draft PR.
5. Fresh live read-only baseline capture/rebase as required.
6. Live `--preflight-only` through a permitted bootstrap path.
7. Fresh `CONFIRM_LEVEL_4_CRITICAL` for first-install bridge apply.
8. Verify transport registration and bridge retirement.
9. Refresh MCP schema through the separately approved rolling path when required.
10. Create the typed transport request.
11. Separate fresh Level-4 approval for transport package installation.
12. Only later proceed to DeployHQ adapter/node1 recreation gates.

## Out of Scope
- DeployHQ credential provisioning
- DeployHQ adapter package apply
- canonical node1 recreate
- Blue V4/public MCP cutover
- TEMP Honartik cleanup
- iMotion target registration
- any application/database/SEO content mutation

## Security Principle
This bridge is a single-purpose bootstrap exception with a closed-world candidate identity and one successful lifetime. It must not evolve into a reusable arbitrary installer. Future packages must use the typed transport after this bridge has retired.
