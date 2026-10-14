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

## 2026-10-13: Verified rollback and Honartik adapter source checkpoint

The shared registry gateway now REQUIRES `trustedRollback` and
`verifyOriginalState` before beginning any authorized registration.
After installer, MCP discovery, or audit failures, success is forbidden:
the executor must re-attest original owner and missing-asset state, invoke
its reviewed project rollback when needed, and re-attest restoration.
Unverifiable restoration yields a hard error, never a green status.
Tests cover success, installer failure, discovery failure, audit failure,
missing rollback callbacks and failed rollback in the mandatory main/PR CI.

Honartik adds `executeAfterSharedRegistryApproval` to the pre-existing atomic
installer, without new installer or CLI apply. This checks the actual consumed
shared-registry Ed25519 receipt, its canonical five fields, the pinned source
Git copy of the Honartik manifest, the complete original asset list, live
owner preimage pins and generated owner postimage SHA values before using
the reviewed atomic owner/asset transaction.

### Remaining mandatory runtime proof before any Level-4 request

A root-owned trusted Host Actions executor implementation must expose the
five-field typed request, confirm and authorize-consume path; supply a
dedicated out-of-process, persistent Honartik rollback capability plus
independent owner/asset/service preimage verifier; provide SHA-pinned Git
file readers; and install the shared and Honartik action in a single reviewed,
rollback-safe bootstrap. Do not use an in-memory rollback closure across
executor or MCP service restarts. Current code and CI DO NOT establish
a durable crash-safe bootstrap, and no Production mutation is authorized.

## Durable recovery milestone (2026-10-14 Git-only)

Reviewed source in PR #190 now includes `prhm-action-registry-durable-recovery-v1.cjs`
and `test-prhm-action-registry-durable-recovery-v1.cjs`. This is an isolated
recovery contract, not a live executor endpoint. An independent process can
recreate an exact recovery plan using a root-owned persistent `recovery.json`
plus four SHA-verified original backup blobs. All four owner locations, original
and reviewed post-image SHAs, owners/group/mode, and every new asset must match
the immutable attested release. It checks all nine paths BEFORE mutation,
refuses tampered backups, links, drift, another project's release/manifest
or a missing original consumed-approval binding. It verifies restored
state and service health before reporting success; restart-replay is idempotent.

The Honartik atomic installer now writes `recovery.json` with source/manifest
commits and SHA, request ID, four original SHA/owner/group/modes, before its
first mutation when invoked through the shared signed approval adapter.
Original *.bak files and the journal are individually fsynced; both the
transaction backup directory and its parent are fsynced for durable entries.

**Production hard stop remains:** No installed root-owned registrar exposes
the typed five-field Approval Center protocol. The recovery contract uses
injected trusted IO and a previously consumed receipt-bound callback; a
real executor must implement durable backup reads, host-action lock,
allowlisted restore operations, audit and service validation across restart.
Synthetic restart tests are NOT live crash/restart fault injection.
Before requesting Level 4, stage exact Git blobs; verify recovery with an
offline root-owned fixture and prove rollback after a real service failure.
Do not turn this module into a caller-controlled arbitrary file writer.

## 2026-10-14 security checkpoint — irreversible one-use install reservation

The Ed25519 Approval Center consumption ledger alone proves that a Level-4
token was consumed by Host Actions, not that a crashed/restarted executor
has never attempted the same approved install again. To prevent replay,
the reviewed shared gateway now REQUIRES a root-provided `trustedClaimOnce`
capability after checking the real signed+consumed token and before any
installer I/O. It validates an exact request ID, canonical arguments SHA,
and an exclusive, durable reservation receipt. Missing or invalid receipts
fail closed. A failed install must not release or reuse this reservation.

The source-only `prhm-action-registry-one-time-fence-v1.cjs` implements a
fixed-path POSIX O_CREAT|O_EXCL|O_NOFOLLOW claim under
`/var/lib/prhm-agent-selfmaint-exec/registry-one-time-v1`.
The PRE-EXISTING trusted root installer must provision this directory
as uid/gid 0:0 mode 0700; the fence MUST refuse to create it itself.
The claim is fsynced including its containing directory and is never
deleted after a partial write, sync failure, crash or failed installation.
Thus a consumed request is never silently re-applied. Recovery must use
the independently verified original request's durable recovery journal.

Honartik handoff now requires a direct passthrough of the ORIGINAL signed
token to the reviewed project atomic installer (not a fabricated approval
object), the exact fixed project manifest read from its pinned Git commit,
and the four allowlisted systemd restart/health callbacks. Any unknown
service, altered Git path, unsigned token or missing trusted adapter fails
closed. No dynamic shell or arbitrary target paths were added.

**Required trusted bootstrap before Level 4:** install one reviewed Git SHA
with the existing typed five-field request/authorize-consume route,
the permanent `claimOnce` callback mapping to the root-only fence,
the SHA-pinned source manifest reader, project-specific installer adapter,
durable trusted rollback, original-state verification and post-restart
service health. Prove an offline restart/partial-write fault-injection
using the same fixed root directory and retain evidence. Until then,
do not register either new live action or issue a Level-4 request.

Live read-only verification on 2026-10-14:
- PR #190 owner preimages still match all four root-owned SHA256 pins
- selfmaint_health healthy; shared/target action absent
- honartik `php console/yii config-center/check` is CONFIG_CENTER_READONLY_FAIL
- separate V19 current-baseline installer-stage preflight 17/17 PASS
  but that is NOT a shared-registry bootstrap
