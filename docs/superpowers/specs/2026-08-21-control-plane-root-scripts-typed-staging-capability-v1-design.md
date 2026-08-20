# Control Plane Root Scripts Typed Staging Capability V1 — Design

## Status
Architecture amendment review **approved** (Amendment ID: `CONTROL_PLANE_ROOT_SCRIPTS_APPROVAL_MEDIATED_STAGING_ARCHITECTURE_V1`).  
Written specification **awaiting explicit `SPEC_APPROVED` gate** before any implementation planning.

## Purpose
Provide a narrowly‑fixed MCP capability that can stage exactly the two immutable artifacts required by the Control Plane Bootstrap Root‑of‑Trust ceremony and execute only their fixed host `--preflight-only` path. The design must not create a reusable root‑file writer, generic script runner, arbitrary package installer, shell bridge, or application deployment primitive.

## Existing Trust Path
The capability is installed only by replacing the already‑existing MCP source file `src/plugins/safeFiles.js` through the existing SHA‑bound `selfmaint_request(target=agent_mcp)` / `selfmaint_apply` flow. Self‑maintenance may replace existing files only; this design intentionally creates no new bootstrap helper for installing itself.

**Live safeFiles baseline evidence** (captured before any change):  
- `src/plugins/safeFiles.js`: **20090 bytes**, SHA‑256 `9f291891673806e34d2681ba7b8227ddd4470f73cec12f69a7c3e9035808caa2`  
- Self‑maintenance replacement ceiling: **120 000 bytes**  
- MCP runs under `ProtectHome=read-only` and `ProtectSystem=full` (no explicit `User=` assignment)

Immediately before any implementation request, the live source SHA and service topology must be captured again. Drift fails closed until the candidate is explicitly rebased and retested.

## Candidate Artifact Boundary Amendment V1
Development tasks run only in `prhmonline/prhm-host-actions`. The live MCP repository is not a development work‑tree for this change.

- **Development candidate artifact:** `candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js`  
- **Production deployment target (later):** `/home/agent/ssh-mcp-server/src/plugins/safeFiles.js`  
- The candidate **must begin** from the freshly captured live baseline bytes and then contain only the reviewed capability change.  
- Tasks 1‑6 **must not** edit, commit, upload, or self‑maintain the live MCP file.  
- **Task 7**, under a separate production gate, binds `selfmaint_request(target=agent_mcp, path=src/plugins/safeFiles.js)` to the fresh live old SHA and the exact immutable candidate bytes.  
- The candidate artifact itself is never executed from the `prhm-host-actions` repository and is not a generic deployment script.  

The amendment updates the boundary to state that the **MCP façade** remains based on the verified live `safeFiles` baseline, while the **privileged approval mediator** is a separate development artifact/boundary to be specified in the implementation plan.

## Capability Identity
- **Capability id:** `control_plane_root_scripts_typed_staging_capability_v1`  
- **Operation identity (fixed):** `host_action.control_plane_root_scripts_stage_transport_v1`  
- No caller‑controlled command/path/URL/repository/commit/content/environment/credential fields are accepted.

## Fixed Artifact Identity
The candidate bytes are bound to an immutable repository commit:

- **Repository:** `prhmonline/prhm-host-actions`  
- **Source commit:** `51027bc81f16840580b3ed5ca09d6c42f78dc044`

### Artifact 1
- **Name:** `control-plane-typed-bootstrap-transport-v1.js`  
- **Bytes:** `72854`  
- **SHA‑256:** `049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335`

### Artifact 2
- **Name:** `bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`  
- **Bytes:** `109634`  
- **SHA‑256:** `d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e`

**Embedded transport package identity**  
- **Package id:** `deployhq_control_adapter_node1_recreate_v1`  
- **Manifest SHA‑256:** `aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728`

No mutable `HEAD`, branch tip, tag, external URL argument, or caller‑provided SHA is accepted at runtime.

## Fixed Staging Root
The capability writes only under:

```
/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/
```

Fixed staged filenames (exact, immutable):

- `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/control-plane-typed-bootstrap-transport-v1.js`  
- `/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js`

No request field may alter either destination.

- **MCP candidate payload ceiling:** the complete replacement `safeFiles.js` must remain `<=120000` bytes; if exceeded, implementation fails closed and no fallback transport is permitted.

## Privileged Approval Mediator Boundary
A **separate privileged mediator** owns all Approval Center request/decision credentials and single-use approval-token handling. The MCP facade has no Approval Center credentials.  

- The mediator creates a fixed Level‑4 Approval Center request (tool 1) and returns only a `request_id` plus bounded non‑secret binding metadata.  
- The mediator validates, decides, authorizes, and consumes the request when the apply tool (tool 2) is invoked.  
- **MCP safeFiles** (the façade) **must never** read, mint, accept, return, log, or persist any approval‑token secrets.  
- The mediator may be implemented as its own narrowly scoped action/route; it is **not** a safeFiles‑only privilege escalation. Its implementation artifact is outside the safeFiles payload ceiling and will be reviewed separately.

### Fixed Approval Binding
The mediator binds every request and apply to immutable metadata selected by code, never by the caller:

- `action=control_plane_root_scripts_stage_transport_v1`
- `operation=host_action.control_plane_root_scripts_stage_transport_v1`
- `project=control_plane`
- `environment=production`
- `risk=critical`
- fixed principal/role/tool identities defined by the mediator contract
- deterministic fixed action arguments and their exact `arguments_sha256`
- bounded TTL
- fixed rollback reference
- request/apply correlation by `request_id`

No MCP input may override any binding field. The Approval Center is the only authority that issues an approval token. The mediator may only receive, validate, consume, and discard that single-use token inside its privileged boundary.

## Tool Surface (Exactly Four Fixed MCP‑Facing Tools)

### 1. `control_plane_root_scripts_stage_transport_request_v1`
- **Purpose:** Create a fixed Level‑4 Approval Center request via the privileged mediator.  
- **Input:** *EMPTY* (no caller‑provided fields).  
- **Output:** `{ request_id: <string>, binding_metadata: { … } }` – only non‑secret, bounded metadata.  
- **Behavior:** The Approval Center issues the single-use approval token only as part of the governed decision flow; the privileged mediator receives, validates, consumes, and discards it internally. The mediator does not mint tokens, and the token never crosses the mediator boundary.

### 2. `control_plane_root_scripts_stage_transport_apply_v1`
- **Purpose:** Consume a previously created request and perform the exact two‑file staging mutation.  
- **Input:**  
  - `request_id` (string, returned by tool 1)  
  - `second_confirmation` (literal string `CONFIRM_LEVEL_4_CRITICAL`)  
- **Output:** Success/failure status with bounded evidence; no secrets returned.  
- **Behavior:**  
  1. Calls the privileged mediator to **validate**, **decide**, **authorize**, and **consume** the request.  
  2. The mediator must confirm the request matches the fixed action/operation, `project=control_plane`, `environment=production`, `risk=critical`, exact `arguments_sha256` for the deterministic fixed action arguments, TTL, rollback reference, and the supplied `request_id`.  
  3. If any validation fails (missing/expired/mismatched/replayed request, wrong confirmation, decision failure, validation failure, consume failure, or binding mismatch) the tool **fails closed** **before** any filesystem mutation.  
  4. Executes the exact two‑file staging mutation (see “Staging Mutation” below).  
  5. MCP caller never sees or handles an approval token.

### 3. `control_plane_root_scripts_stage_transport_status_v1`
- **Purpose:** Query bounded persisted state/evidence for a given request.  
- **Input:** `request_id` (string).  
- **Output:** Metadata only (e.g., request state, timestamps, decision outcome). No file content, secrets, or token data.

### 4. `control_plane_root_scripts_transport_preflight_v1`
- **Purpose:** Run the staged bootstrap in its read‑only `--preflight-only` mode after independently re‑validating the staged artifacts.  
- **Input:** *EMPTY*.  
- **Behavior:**  
  - Re‑validates both staged files (path, regular‑file status, non‑symlink, byte length, SHA‑256, ownership `root:root`, mode `0600`).  
  - Executes **exactly**:  
    ```
    /usr/local/bin/prhm-node /var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js --preflight-only
    ```  
  - Uses a fixed executable and fixed argv; `--apply` is structurally unreachable.  
  - Returns bounded evidence of preflight success; no secrets.

## Staging Mutation (Apply Tool)
The apply tool must perform **exactly** the following atomic two‑file mutation under the fixed staging root:

1. Write each artifact to a temporary file **in the same staging directory**.  
2. Set temporary file ownership `root:root` and mode `0600`.  
3. Verify temporary file byte length and SHA‑256 against the fixed artifact identities.  
4. Atomically rename each temporary file to its final destination filename.  
5. Re‑read each final file and verify length and SHA‑256 again.  
6. Record bounded rollback reference tied to this invocation; on any failure, restore the pre‑invocation state for the two files only.  
7. All operations are confined to the staging directory; symlinks or path escapes cause immediate failure.

## Explicit Forbidden Behaviors
- Caller‑visible `approval_token` fields or any token handling inside the MCP plugin.  
- Any token minting, logging, persisting, or returning by safeFiles.  
- Arbitrary path, content, command, URL, repository, branch, tag, or SHA inputs.  
- Network fetches, shell execution, `eval`, `exec`, `curl|bash`, `wget|sh`, or similar streaming execution.  
- Generic root‑script widening, `/root` writes, or weakening of `ProtectHome=read-only` / `ProtectSystem=full`.  
- Service restarts, `systemctl` mutations, DeployHQ interactions, or any application/database changes.  
- Public schema refresh or self‑maintain request/apply from within these tools.

## Authorization Boundary
This design document authorizes no implementation, no production mutation, no service restart, no self-maintenance request/apply, no MCP public schema refresh, and no Root-of-Trust apply. After this written amendment is reviewed, implementation planning starts only after the explicit gate `SPEC_APPROVED_CONTROL_PLANE_ROOT_SCRIPTS_APPROVAL_MEDIATED_STAGING_ARCHITECTURE_V1`.

## Acceptance Criteria
The implementation is acceptable only if **all** of the following are independently verified:

1. Candidate modifies only intended existing MCP source/test/spec/plan surfaces.  
2. Final `safeFiles.js` payload ≤ 120 000 bytes.  
3. Live `safeFiles.js` baseline is freshly captured and exact before creating any self‑maintain request.  
4. Self‑maintenance replacement is bound to the exact old SHA and exact new content.  
5. No new generic privileged writer exists.  
6. All four tools exist with the exact names and fixed schemas described above.  
7. Tools accept **no** caller‑controlled path/content/command/URL/repository/SHA/role/project/environment/risk fields.  
8. Tool 1 creates a Level‑4 request via the privileged mediator; only `request_id` and non‑secret metadata are returned.  
9. Tool 2 requires the exact `request_id` and literal `CONFIRM_LEVEL_4_CRITICAL`; it fails closed on any mismatch, replay, expiry, or binding error **before** any filesystem mutation.  
10. The privileged mediator validates the fixed action/operation, project, environment, risk, exact `arguments_sha256` for the deterministic fixed action arguments, TTL, rollback reference, and correlates the `request_id`.  
11. Approval token handling remains entirely inside the mediator; MCP never sees the token.  
12. Both staged artifacts exactly match the fixed byte lengths and SHA‑256 values.  
13. Staging root and destination files reject symlinks, path escapes, or non‑regular files.  
14. Writes use same‑directory temporary files plus atomic rename; ownership `root:root`, mode `0600`.  
15. Post‑write byte length and SHA‑256 verification passes.  
16. Tool 3 (`status`) returns only bounded metadata; no file content or secrets.  
17. Tool 4 (`preflight`) uses the fixed executable and fixed `--preflight-only` argv; `--apply` is structurally unreachable.  
18. Preflight independently re‑validates both staged files before execution.  
19. No service restart, DeployHQ, Honartik, iMotion, database, or application mutation occurs from any tool.  
20. Rollback is invocation‑bound only and limited to the two staged files; failure produces bounded evidence (`critical_failure=true`, `rollback_failed=true`).  
21. Each major gate (source installation, MCP schema exposure, staging request, staging mutation, preflight, Root‑of‑Trust apply) requires its own governed approval/confirmation.  
22. All implementation tests and syntax checks pass with zero skipped security cases.

## Required Test Classes
The implementation plan must include tests for at minimum:

- Presence and exact naming of the four fixed tools.  
- Zero arbitrary input surface for each tool (empty or fixed literals only).  
- Priv
