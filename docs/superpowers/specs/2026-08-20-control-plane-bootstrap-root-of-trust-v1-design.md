# Control Plane Bootstrap Root of Trust V1 — Design

## Status
Design approved in chat for written-spec capture. No operator command, staging, service restart, or production mutation is authorized by this document.

## Purpose
Break the circular bootstrap dependency for `control_plane_typed_bootstrap_transport_v1` by using one external, human-operated root-console ceremony. This ceremony is not a reusable installer, Host Action, self-maintenance extension, DeployHQ workflow, or generic privileged write primitive.

## Root of Trust
- Root-of-trust authority: authenticated operator root console/SSH session on the Control Plane host.
- Lifetime: one successful bootstrap ceremony only.
- Request surface: none.
- Caller-controlled path, command, URL, repository, branch, commit, content, environment, token, credential, secret, or package fields: forbidden.
- After verified success, this operator bootstrap path is retired for future package installs. Future packages must use `control_plane_typed_bootstrap_transport_v1`.

## Immutable Candidate Identity
- Repository: `prhmonline/prhm-host-actions`
- Reviewed transport PR: `#57`
- Source commit: `51027bc81f16840580b3ed5ca09d6c42f78dc044`
- Transport artifact: `control-plane-typed-bootstrap-transport-v1.js`
- Transport artifact size: `72854` bytes
- Transport SHA-256: `049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335`
- Registration bootstrap artifact: `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`
- Registration bootstrap size: `109634` bytes
- Registration bootstrap SHA-256: `d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e`
- Package id embedded by transport: `deployhq_control_adapter_node1_recreate_v1`
- Package manifest SHA-256: `aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728`

No HEAD/latest reference is acceptable at ceremony time. Candidate bytes must resolve to this exact commit and these exact byte hashes.

## Last Observed Live Baseline
Evidence only, not a permanent assumption:
- Base `/opt/prhm-agent-selfmaint/server.js`: `c38bb88c5d7000eebedc5db758c7dd7d846b7b1a6df589c10f37237c3d1cce00`
- Executor `/opt/prhm-agent-selfmaint-exec/server.js`: `edaf10ace464cb70ea1625cb7998b2bae0112b46b1d4f383334ceeaf5b6a5108`
- Approval policy `/opt/prhm-company-control-plane/config/approval-policy.json`: `162bfa045d9b600a48989dd88e4b367beff1272cbb9b83e1dbc5cf6bc8d6adad`
- MCP Host Actions source `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js`: `c7be9c315319c893ee821268507577f10cb001440899f670659b2c3c7b26b722`
- ZDT helper `/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js`: `04a1416e837b1ae47e0a0ae72b5c1547d03118022c6c9ff19f392572ff7d38b4`

Immediately before ceremony preflight and again before apply, all five hashes must be freshly captured. Drift fails closed until compatibility is inspected and candidate guards are explicitly rebased; guards may never be disabled.

## Ceremony Phase A — Operator Preflight
Preflight is read-only with respect to production destinations and services.

Required sequence:
1. Verify authenticated root-console identity and correct Control Plane host.
2. Freshly capture all five live baseline SHA-256 values.
3. Obtain the two candidate artifacts from the immutable source commit without executing streamed content.
4. Verify exact byte lengths and SHA-256 values against this spec.
5. Verify package manifest identity embedded in the transport.
6. Run Node syntax validation on both artifacts.
7. Run the registration bootstrap only in its supported `--preflight-only` mode from a private, root-owned staging directory.
8. Verify public MCP, Blue, Green, Base, Executor, and Approval health without restart/cutover.
9. Persist bounded evidence containing hashes/status only; no secret values.

Preflight success evidence must include:
- `ROOT_OF_TRUST_PREFLIGHT=PASS`
- `SOURCE_COMMIT_MATCH=YES`
- `TRANSPORT_SHA_MATCH=YES`
- `REGISTRATION_BOOTSTRAP_SHA_MATCH=YES`
- `MANIFEST_SHA_MATCH=YES`
- `LIVE_BASELINES_MATCH=YES`
- `NODE_SYNTAX=PASS`
- `PRODUCTION_MUTATION=false`
- `SERVICE_RESTART=false`
- `DEPLOYHQ_MUTATION=false`
- `HONARTIK_MUTATION=false`
- `IMOTION_MUTATION=false`
- `MCP_CUTOVER=false`

Any mismatch fails closed before mutation.

## Ceremony Phase B — Operator Apply
Apply requires a fresh literal `CONFIRM_LEVEL_4_CRITICAL` scoped only to this one ceremony. A prior confirmation from another action chain cannot be reused.

Apply sequence:
1. Reverify the exact staged artifact SHA-256 values and byte lengths.
2. Reverify the five live baseline SHA-256 values.
3. Confirm no baseline or artifact changed since Phase A.
4. Execute only the exact registration bootstrap artifact with the fixed `--apply` argument.
5. Allow only the destinations/services already encoded and tested by the registration bootstrap.
6. Verify post-install Base/Executor/Policy/MCP/ZDT hashes against bootstrap-produced candidate hashes.
7. Verify Base, Executor, and Approval health.
8. Verify transport registration/helper presence.
9. Verify V16 pending-request status behavior remains intact.
10. Verify Honartik and iMotion state were not mutated by the ceremony.
11. Verify DeployHQ was not called or mutated.
12. Verify public MCP was not directly restarted or cut over by this ceremony.
13. Persist bounded result evidence.

This ceremony does not install/apply the DeployHQ adapter package itself and does not recreate canonical node1. It only makes the typed transport available for later separately-approved execution.

## Staging Constraints
- Staging must be root-owned and mode `0700` or stricter.
- Candidate files must be regular files, not symlinks.
- The ceremony must never execute directly from a pipe, URL, Git working tree with unverified state, or mutable `HEAD` reference.
- Staged bytes must be verified before every execution.
- No secret, credential, `.env`, SSH key, or authorization header may be written into staging or evidence.

## Explicitly Forbidden
- `curl ... | bash`, `wget ... | sh`, or equivalents.
- `git pull` / executing a mutable branch tip.
- TEMP Honartik DeployHQ targets as bootstrap transport.
- Direct DeployHQ node1 target creation during this ceremony.
- Generic raw command/path/content parameters.
- Extending self-maintenance target scope beyond its existing design.
- Repurposing `host_action_v2_installer_v1` away from its fixed Honartik contract.
- Repurposing `agent_zero_downtime_bootstrap_v1` as a package installer.
- Credential provisioning or reading DeployHQ credential values.
- Database/application/SEO content mutation.
- Public MCP cutover.

## Failure and Rollback
The registration bootstrap's invocation-bound transactional rollback remains authoritative for mutations it performs. The operator ceremony must not add broad cleanup logic.

If apply fails:
- capture the bootstrap result/rollback evidence;
- verify whether rollback completed;
- stop further execution;
- do not proceed to transport package install;
- do not attempt unrelated remediation.

If rollback fails, classify as critical and persist explicit evidence (`critical_failure=true`, `rollback_failed=true`).

## Retirement
After verified successful transport registration:
- `ROOT_OF_TRUST_STATE=RETIRED`
- this operator bootstrap ceremony must not be used for future packages;
- all subsequent bootstrap packages use `control_plane_typed_bootstrap_transport_v1` with their own typed request and fresh Level-4 approval;
- operator root console remains an administrative break-glass capability, not an application-level generic installer interface.

## Acceptance Criteria
1. Exact commit/artifact/manifest identity is fully pinned with no placeholder.
2. Preflight is zero production mutation.
3. Baseline drift fails closed.
4. No arbitrary input surface exists.
5. Only the fixed registration bootstrap plus fixed mode argument is executable.
6. Artifact delivery and execution are separated; streamed execution is impossible.
7. Apply requires a fresh single-use Level-4 confirmation.
8. Bootstrap rollback remains invocation-bound.
9. DeployHQ is untouched.
10. Honartik and iMotion are untouched.
11. Public MCP is not directly cut over.
12. V16 pending-status semantics are preserved.
13. Transport registration is verified before retirement.
14. The ceremony retires after one verified successful bootstrap.
15. Future package installs must use the typed transport, not this root ceremony.

## Gate Sequence
1. Written spec approval.
2. Implementation/ceremony plan documenting exact preflight/apply commands and evidence checks.
3. Independent syntax/hash validation of the plan against commit `51027bc81f16840580b3ed5ca09d6c42f78dc044`.
4. Live read-only baseline/topology capture.
5. Operator preflight only.
6. Fresh `CONFIRM_LEVEL_4_CRITICAL`.
7. Operator apply.
8. Post-install verification and retirement evidence.
9. Separate MCP rolling schema refresh if required.
10. Separate typed transport request and fresh Level-4 for DeployHQ adapter package installation.
11. Only later proceed to canonical node1 recreation and Blue V4 continuation.

## Out of Scope
- DeployHQ credential provisioning.
- DeployHQ adapter package apply.
- Canonical node1 recreation.
- Blue V4/public MCP cutover.
- TEMP Honartik cleanup.
- iMotion target registration.
- Any production application, database, redirect, canonical, or SEO mutation.
