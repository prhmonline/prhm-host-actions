# PRHM Agent 3 shared registry — deployment gate

Status (2026-10-13): SOURCE + CI only; NOT installed in Production.

## Shared root cause
The installed MCP enum, Self-Maintenance action specs, Host Actions executor, and Approval Center typed scopes have four separate hard-coded registries. The older installer is SHA-bound to a different action. The current v2 request API accepts only the action name; it cannot safely bind a generic project and manifest digest to an L4 approval.

## One-time bootstrap required
1. Extend the EXISTING Host Actions v2 request/confirm/authorize-consume/execute pipeline with the shared fixed action prhm_action_registry_install_v1. Preserve all existing action-only requests and approvals.
2. Bind canonical arguments {action,project,source_commit,manifest_sha256} to Approval Center Ed25519, policy, 180s TTL, single-use receipt, and runtime request. Refuse caller-supplied keys or clocks.
3. Read the immutable manifest blob from prhmonline/prhm-host-actions at source_commit and check the exact manifest SHA; independently attest the four live owner SHAs and every root-owned action asset. Reuse prhm-action-registry-gateway-v1.cjs, never an arbitrary shell/SQL endpoint.
4. Reuse the project's existing atomic rollback-safe installer (for Honartik: honartik-config-center-atomic-registration-installer-v1.cjs). Do not add a second competing installer. Preflight must prove backup-root, existing state/dirty files, service health and byte-preserving rollback before requesting Level-4.
5. Readiness phases: preinstall checks source, trusted route and rollback; authorized additionally requires fresh consumed signed approval; active additionally requires new tool discovery and complete live health verification. Requiring target tool discovery at PREINSTALL creates a circular deadlock.
6. If rollout fails, restore exactly backed-up owner bytes/modes/ownership and action assets and recheck four services. Unverified rollback means STOP. Log metadata only, never token/JWS/bearer/customer content.

## Repeatable onboarding
For each project, review and commit a manifest and bounded handler to Git, run CI and real isolated DB tests when needed, then use the single trusted shared registration action with a fresh SHA-bound approval and verify live tool discovery. An Action being merged in Git does NOT mean installed in MCP. Per-operation critical authorization remains mandatory.

## Honartik checkpoint
PR #190 contains the already-reviewed Honartik five assets/four Control Plane owner registration installer and Laravel/MariaDB tests. The shared module tests Honartik and a synthetic MoeinShow manifest; MoeinShow Production is untouched. Neither the shared route nor the Honartik enrollment action is installed yet. No fresh executable Level-4 request should be created until an independently reviewed trust-boundary bootstrap exists and passes preflight. Do not reuse consumed authorization.
