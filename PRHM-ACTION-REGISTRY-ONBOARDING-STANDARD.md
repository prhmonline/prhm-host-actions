# PRHM Agent 3 shared registry — deployment gate

Status (2026-10-13): SOURCE + CI only; NOT installed in Production.

## Shared root cause
The installed MCP enum, Self-Maintenance action specs, Host Actions executor, and Approval Center typed scopes have four separate hard-coded registries. The older installer is SHA-bound to a different action. The current v2 request API accepts only the action name; it cannot safely bind a generic project and manifest digest to an L4 approval.

## One-time bootstrap required
1. Extend the EXISTING Host Actions v2 request/confirm/authorize-consume/execute pipeline with the shared fixed action prhm_action_registry_install_v1. Preserve all existing action-only requests and approvals.
2. Bind canonical arguments {action,project,source_commit,manifest_commit,manifest_sha256} to Approval Center Ed25519, policy, 180s TTL, single-use receipt, and runtime request. Refuse caller-supplied keys or clocks.
3. Read the immutable manifest blob from prhmonline/prhm-host-actions at manifest_commit and check the exact manifest SHA; independently attest the four live owner SHAs and every root-owned action asset. Reuse prhm-action-registry-gateway-v1.cjs, never an arbitrary shell/SQL endpoint.
4. Reuse the project's existing atomic rollback-safe installer (for Honartik: honartik-config-center-atomic-registration-installer-v1.cjs). Do not add a second competing installer. Preflight must prove backup-root, existing state/dirty files, service health and byte-preserving rollback before requesting Level-4.
5. Readiness phases: preinstall checks source, trusted route and rollback; authorized additionally requires fresh consumed signed approval; active additionally requires new tool discovery and complete live health verification. Requiring target tool discovery at PREINSTALL creates a circular deadlock.
6. If rollout fails, restore exactly backed-up owner bytes/modes/ownership and action assets and recheck four services. Unverified rollback means STOP. Log metadata only, never token/JWS/bearer/customer content.

## Repeatable onboarding
For each project, review and commit a manifest and bounded handler to Git, run CI and real isolated DB tests when needed, then use the single trusted shared registration action with a fresh SHA-bound approval and verify live tool discovery. An Action being merged in Git does NOT mean installed in MCP. Per-operation critical authorization remains mandatory.

## Honartik checkpoint
PR #190 contains the already-reviewed Honartik five assets/four Control Plane owner registration installer and Laravel/MariaDB tests. The shared module tests Honartik and a synthetic MoeinShow manifest; MoeinShow Production is untouched. Neither the shared route nor the Honartik enrollment action is installed yet. No fresh executable Level-4 request should be created until an independently reviewed trust-boundary bootstrap exists and passes preflight. Do not reuse consumed authorization.

## Two-commit Git release identity (mandatory)

Do not embed the SHA of a Git commit in a manifest inside that same commit: this creates an impossible self-reference. First commit and review application/handler source (source_commit). Then commit the manifest referencing source_commit in a later commit (manifest_commit). The trusted runner retrieves the manifest at manifest_commit, proves its bytes match manifest_sha256, and independently checks all staged source/asset hashes against source_commit. All five canonical arguments are bound into a fresh, signed, once-only Level-4 approval. Updating only the manifest commit or any one SHA invalidates the approval.

## Asset provenance gate

Each manifest asset has an immutable source_path in the reviewed source_commit. The trusted executor must independently retrieve those Git bytes, compare to the staged root-owned asset bytes and the asset sha256, and reject mismatch BEFORE obtaining or consuming any Level-4 approval. Staged files alone are insufficient proof of source identity.

## Real Approval Center canonicalization (2026-10-13 verification)

Live `/opt/prhm-agent-selfmaint/server.js` uses recursively key-sorted JSON:
`canonicalJson(value) = objects sorted by key; arrays retain order`, then `SHA256(UTF8(canonicalJson(arguments)))`. Do **not** use raw `JSON.stringify` with caller-specified key insertion order. Regression pinned at `3ba6ec4fb870e6255228968e72a7d7876a389271f59a15e7f9b905d4ad87be9d` for the known Honartik five-field fixture. Both the fixed typed request and the later validate/consume MUST derive the hash from the identical five-field canonical object and use it as the JWS `arguments_sha256` / consumed-ledger request hash. This is a test contract and not a production approval receipt.

## Production blocker independently verified

Read-only Agent 3 preflight showed `installer_refresh_l4_state_file_sha_mismatch` on an unrelated historical repair helper (current file SHA `b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e`). Do not rebind or reuse its Level-4 action to install this shared gateway. The current preimage SHA values of the four control-plane owners match the Honartik contract. A trusted one-time **five-field-capable registrar bootstrap** with exact reviewed source SHA, rollback and fresh Level-4 consent is still required; source-only helper/CI cannot register live MCP tools.
