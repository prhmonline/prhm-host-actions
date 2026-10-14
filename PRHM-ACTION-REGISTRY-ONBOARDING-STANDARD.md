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

## 2026-10-14: Shared Manifest producer — Git-only milestone

The existing Honartik `honartik-config-center-install-manifest-v1.json`
is intentionally `prhm.honartik.config-center-registration.v1`. It is NOT
a `prhm.action-registry.release.v1` and cannot be passed directly to the
generic shared registrar. Before this milestone there was no way to
derive the necessary four after-image SHA256 values without inventing them.

`honartik-config-center-shared-release-builder-v1.cjs` now provides a
side-effect-free producer. Its `buildFromAttestedOriginals()` calls the
existing SHA-bound Honartik `buildCandidates()` against four actual
root-owned source bytes supplied by a trusted read-only adapter. It derives
each after-image SHA from the actual generated source bytes and requires
all five immutable Git source files to match the already reviewed legacy
manifest's SHA. It then validates the output using the shared gateway's
strict generic schema, returning the manifest bytes and SHA256.

**Important:** This producer has NOT yet read the physical Production owner
bytes and has NOT published a new generic release manifest. Its resulting
`manifest_commit` is explicitly null until an immutable distinct Git
commit containing exactly those generated bytes is reviewed and published.
The produced manifest registers the Honartik target action AFTER the shared
registrar itself is already installed; it does not bootstrap its own
five-argument signed Host Actions v2 route.

Release remains NO-GO until: a separate trusted bootstrap activates the
five-field signed route and long-lived shared registrar, a real trusted
offline/sandbox source read calculates and verifies four exact post-image
SHA256 values, immutable source and manifest commits exist, one-use claim
and durable rollback are validated across process restart, and a fresh
specific Level-4 approval authorizes the exact SHA. No production deploy
or Level-4 request occurred in this milestone.

## 2026-10-14: Fixed zero-input SHA-only owner preflight source

The repo now contains `honartik-config-center-owner-sha-readonly-preflight-v1.cjs`
and `test-honartik-config-center-owner-sha-readonly-preflight-v1.cjs`.
This is a reviewed, read-only source module, NOT an installed Agent 3 action.
Once an independently authorized read-only runner loads the exact reviewed
Git commit, the zero-argument entrypoint reads only the four hard-coded
owner paths from the existing SHA-bound Honartik registration candidate.
Each file requires a safe nonsymlink parent, a regular nonsymlink inode,
unchanged stat/fstat metadata and the immutable original SHA256.
`buildCandidates()` generates after-image bytes only in memory, and all
four emitted SHA values are checked against the generated bytes.
The output is metadata only: before/after SHA256, project action, and
source-only/no-mutation/no-approval indicators; original file source text,
approval tokens, credentials and environment values are never printed.

The shared registry and Honartik CI workflows now both check syntax and
test fail-closed behavior (tampering, wrong owner hash, symlink,
unsafe permissions and inode replacement). The source-only CI does NOT
read Production files. The source-controlled runner has NOT been staged
or executed on the host, and no new postimage SHA values have been
observed, accepted or committed to a release manifest yet.

Next hard gate: provision or explicitly authorize a separately confined
READ-ONLY trusted runner bound to the Git SHA of this source module and
its registration candidate, execute the zero-arg preflight, attest
all four returned generated SHA values, and only then publish the
independent immutable release manifest. The live shared five-field
registrar and privileged install remain separate Level-4 work.

## 2026-10-14: Independent runner contract + OS-process crash recovery CI

An independently spawned transient root runner is required to avoid
self-restarting the long-lived Host Actions executor and to preserve
security isolation. The source-only
`prhm-action-registry-independent-runner-contract-v1.cjs` now fixes a
narrow directory write allowlist, systemd one-shot hardening properties,
the independently pinned SOURCE/MANIFEST commits and owner preimages,
and a deny-by-default readiness gate for missing signed five-field
approval, staged executable, cold-process verification, and discovery.
It NEVER invokes systemd, reads secrets, requests approval or mutates a
Production owner. It returns `can_execute:false` and
`runner_staged:false`; the runnable root bootstrap has NOT been installed.

Crucially, the new
`test-prhm-action-registry-cold-restart-v1.cjs` now exercises the
existing durable recovery implementation with REAL, independently
spawned OS processes, disk-backed backups and recovery JSON inside
the GitHub Actions ephemeral system temporary directory. The child
fsyncs four backups, four updated synthetic owners, five synthetic
assets, journal and a SIMULATED approval-consumption receipt, then
SIGKILLs itself. A fresh process reconstructs nine-path state using
the persisted journal, verifies and restores the four originals,
removes five installed synthetic assets, checks idempotence and
retains its claimed request. Corrupt backup and absent simulated
consumption deny recovery before mutation; a failed simulated
service-health check denies a success audit.

These tests are NOT a real Ed25519 Approval Center request, service
restart or privileged Production deployment. They establish offline
failure recovery semantics only. The remaining separately reviewed
work is the actual trusted standalone executable/transport, staging
and systemd unit launch tied to fresh Level-4 Authorization Center
approval. Do not treat green CI as installation readiness.

## 2026-10-14: Executable-boundary components implemented (not deployed)

Fixed root I/O sources now exist and are independently CI-tested:

- `prhm-action-registry-root-pinned-readers-v1.cjs` provides four real
  restricted read functions: exact SHA-pinned original four Production
  owners, reviewed five staged assets, immutable project Git source bytes
  and immutable generic release manifest. It enforces root file/parent
  ownership, `O_NOFOLLOW`, stat/fstat inode equality, byte ceilings and
  SHA256/Git blob checks. Source and manifest commit IDs are constants.
- `prhm-action-registry-fixed-systemd-bridge-v1.cjs` provides the exact
  four synchronous `restartService`/`checkServiceHealth` callbacks needed
  by the atomic installer. It refuses any service outside the fixed
  allowlist, insists on root and a separately named transient unit
  cgroup, never invokes a shell and verifies the service MainPID changes.
- Their immutable staged Git source commit, three reviewed helper files,
  two exact supporting JSON manifests and one staging duplicate are
  listed in `manifests/honartik-shared-registry-trusted-host-io-stage-v1.json`.
  This staging plan is explicitly `NOT_STAGED`. All relative module
  imports and file Git blob object IDs are checked by CI.

These callbacks are ACTUAL bounded I/O implementations, not booleans or
pretend approval. They are **not** an installed executable root runner.
Additional required work before any Production GO: a separately reviewed
root bootstrap entrypoint + full post-crash recovery connector, trusted
Host Actions v2 five-field signed request/consume routing, cryptographic
authentications and durable root-owned claim, fixed staging transaction,
actual MCP discovery probe and final integration/cold service restart
health. Every action requires its own legitimate approval boundary.

Do not mistake CI (mocked service restarts, original Git blobs and file
readers) for a real service restart or live registration. No Level-4 token
was requested or consumed for these source-only commits.

## 2026-10-14: Independent executable entrypoint — sealed credential boundary

New `prhm-action-registry-independent-runner-entry-v1.cjs` is a real
Node entrypoint whose strict input parser requires exactly one root-owned
regular 0400/0600-style systemd credential file named `registry-approval.json`
under `/run/credentials/<prhm-shared-registry-bootstrap-v1-*.service>/`.
It verifies that the process is root and belongs to the matching
independent systemd unit cgroup, checks the credential directory and file
for symlinks/unsafe permissions, uses `O_NOFOLLOW`, compares stat/fstat
metadata, and accepts ONLY the pinned action, project, SOURCE_COMMIT,
MANIFEST_COMMIT and manifest SHA. The signed JWS passes unchanged to
`prhm-action-registry-host-actions-v2-bridge-v1.cjs`, which alone
cryptographically checks Ed25519, consumed ledger and durable one-time
reservation after independently attested trusted capability wiring.

Executable byte identity is now bound to a fixed Git commit in
`manifests/honartik-shared-registry-independent-runner-entry-stage-v1.json`.
The imported modules are checked against the two existing reviewed
dependency staging plans. The new runner's CLI intentionally fails
closed (exit 78) without an independently reviewed root launcher and
trusted rollback/discovery/audit capabilities. No externally passed
CLI argument or approval token can activate it. This is NOT a working
stand-alone production installer, and must not be described as one.

CI now covers trusted systemd credential path, root/unit isolation,
malformed or stale SHA binding, symlink/permission/inode tampering,
absence of the complete 12-function trusted executor interface,
postcondition rejection and fail-closed standalone process launch.
CI fixtures use mock approval tokens ONLY to exercise parsing, never
to authenticate a real Approval Center request or perform installation.

**Unresolved hard gates:** reviewed and installed five-field signed
Approval Center route; complete root bridge with durable rollback,
discovery and audit adapters; safe source-to-stage transport; actual
independent systemd runner attestation; fresh Level-4 authorization.
These may not be bypassed via `--apply`, arbitrary files, a fake
`approved=true` receipt or replay of any prior request.

## 2026-10-14: Rollback also requires MCP unregistration (Git only)

The shared gateway rollback verdict now requires both the independently
verified original owner/asset state and **negative discovery** for the new
MCP action after an installer, discovery or audit failure. Restoring original
disk bytes does not establish rollback if an old MCP worker still advertises
the failed action. Discovery exceptions are treated as unverified, never
as successful recovery. Regression cases cover stuck/stale MCP discovery
and unavailable discovery after rollback.

Source commits: `a2876459bc3b7bf70af619a4452a554b414109ac`
(gateway) and `9e09a2215866e00a64140fd3b843e4f9e439c876`
(regression tests). No live MCP removal, restart or approval occurred.

**Immutable-release caveat:** the previously pinned SOURCE_COMMIT
`868ec0251688e30f30691c91390589e80d4f34f9` and its published
release manifest predate this hardening. Git branch HEAD is NOT equivalent
to the staged SHA-pinned artifact. A new reviewed two-commit source/release
pair and corresponding source-closure manifest must incorporate this exact
gateway update before any production bootstrap could rely on it.
The current original release remains NOT_STAGED and NO-GO.

## 2026-10-14: V2-only independent runtime and exact staged closure

The actual Host Actions source bridge was previously restricted to the V1
Honartik release path, so the separately published V2 manifest could not be
accepted by that bridge. The bridge now accepts V2 **only** when source
`aa267202d11784f0ac0a957e0d8ba911a6b07734`, manifest commit
`d1a8b26da238d1a86b7a5d96f69185e7d25f1430`, manifest SHA256
`9ff881e0d470da91aa26923b950589645613244d4b34d30b9e240d5277128f3b`,
and the exact V2 Git path all agree. Unknown V3 paths, substitutions, and
unsigned direct application are denied; the old V1 contract remains unchanged.

The **new**, isolated V2-only sources are:
- `prhm-action-registry-v2-root-pinned-readers-v1.cjs`
- `prhm-action-registry-v2-independent-runner-contract-v1.cjs`
- `prhm-action-registry-v2-fixed-systemd-bridge-v1.cjs`
- `prhm-action-registry-v2-independent-runner-entry-v1.cjs`

The effective 17-file staged-runtime candidate is **uniquely** defined by
`manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json`;
its runtime source commit is
`6b038d7618f2ec27ecb44e8fc92f3c4a5979836b`.
It supersedes the older **non-executable staging-plan** listing an unusable
V1 bridge byte: the final bridge Git blob is
`166d9253634df48624aaa75da719253dc1e21508`, not
`45d9aae3dd390a14053d6844b201f118ab2c5586`.
No destination is duplicated within the authoritative 17-file set.

CI validates Git file content IDs, fixed dependency closure, independently
pinned source/manifest identities, root-only reads, sealed credentials,
restricted transient systemd cgroup and unavailable unapproved CLI apply.
The offline source and simulated/cold-restart regression tests DO NOT
constitute live Host Actions bootstrap or a real post-crash rollback test
against the root-owned Production services.

**Remaining hard Production NO-GO:** existing signed five-field Approval
Center request/consume route is absent; the reviewed actual launcher and
safe stage transport are not installed; trusted persistent recovery,
post-install MCP discovery and metadata audit are not wired through a root
executor. No live staging/deploy, approval request or consumption has
occurred. Installation requires a separately approved immutable bootstrap
with actual owner SHA re-attestation and independent recovery fault
injection; never run a stale action-only v2 request or replay consumed L4.

## 2026-10-14 — V2 recovery verdict closes stale MCP discovery across both workers

Production remains NO-GO. Source-only V2 recovery now uses
`prhm-action-registry-v2-durable-recovery-v1.cjs`: a previously consumed
original signed Level-4 request, durable backup integrity, byte-identical
four-owner restore, five-asset removal and four healthy services are **not**
sufficient for a verified rollback unless the exact new tool is also absent
from both MCP workers. If any worker still exposes it, the discovery
probe fails, returns unknown/stale, or throws, the audit CANNOT report
successful restoration. No token is replayed or reservation released.

The root-executor-facing source module
`prhm-action-registry-v2-mcp-discovery-v1.cjs` adds a strict two-worker
negative/positive discovery contract: exactly the approved Honartik
target action and fixed blue/green MCP service names; live, bounded-age,
valid and unique tool lists are required from both independently
authenticated, uncached root-provided probes. A disagreement is an
ERROR, not false, so a partial deployment cannot masquerade as
successful registry discovery or rollback. The module does not itself
contact a Production MCP process or provide the trusted transport.

The authoritative V2 staged-runtime file list now contains 18 immutable
Git blob entries in
`manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json`;
the original V1 durable-recovery module has been replaced by the
reviewed V2 discovery-gated module. CI covers success, stale one-worker
discovery, partial registration, malformed and stale tool lists, missing
trusted callbacks, and real OS-process SIGKILL + durable journal
reconstruction against synthetic CI-only files.

Read-only 2026-10-14 confirmation: Agent 3 selfmaint health OK, but
`prhm_action_registry_install_v1` and
`honartik_config_center_readonly_enroll_v1` remain absent from the
installed action list, and the existing Honartik dashboard command
`php console/yii config-center/check` still reports
`CONFIG_CENTER_READONLY_FAIL`. This CI and metadata report does not
prove the live tool cache is consistent on both MCP workers.

**Hard blocker for Production:** provision the pre-existing trusted
five-field Approval Center request/consume route, SHA-attested independent
launcher, root-only live two-worker tools/list probes, privileged
owner/asset service recovery callbacks and durable metadata audit. Then
complete an isolated real-root restart/fault-injection preflight against
the exact reviewed release and obtain fresh explicit L4 approval.
Production, real credentials and approval ledgers were NOT modified.

## 2026-10-14 — Sealed V2 runner cannot substitute application callback

Security review found that `runWithCapabilities` exposed a caller-injectable
`apply` function. Although the standalone executable was not staged,
this source API allowed a fabricated success response in unit tests without
the real signed Ed25519 Approval Center ledger check. This callsite
is now fail-closed: the only allowed argument keys are `credential`
and `capabilities`, the credential must be the exact object returned
by `secureCredential` in this process (WeakSet identity), and the
only execution path is the fixed `bridge.applyAfterConsumption`. It
cannot be overridden with test or caller-provided callbacks. The bridge
still checks the immutable Git release, live consumption ledger, durable
one-time claim, reviewed atomic installer, and post-install discovery
before returning success.

The 18-file authoritative V2 source closure now pins the hardened entrypoint:
`prhm-action-registry-v2-independent-runner-entry-v1.cjs`
Git blob `8dd786829aad356c5d207365258cb4c9dd61b95d`,
source commit `0a8fca5bbe59c607c4f96c1f75e80979124afaa8`.
CI directly rejects extra apply/argv arguments, copied fabricated sealed
credentials, and forged green postconditions. The tests use synthetic
credentials only; no real Approval Center token was signed, issued or consumed.

This does **not** bootstrap Production: the fixed typed 5-field signed
route, independently launched root host runner, trustworthy reader/writer
transport, rollback/blue-green live discovery, and durable audit remain
uninstalled. Source-only CI does not supersede a real root preflight.

## 2026-10-14 — Immutable five-field Approval Center gate

The existing Host Actions v2 base route creates Approval Center requests
from `{action}` only; it CANNOT issue the five-field registry approval.
The separately reviewed, source-only contract
`prhm-action-registry-v2-five-field-approval-gate-v1.cjs` now enforces
`action`, `project`, `source_commit`, `manifest_commit` and
`manifest_sha256` throughout request, confirmation, validate-and-consume.
The canonical arguments SHA256 is pinned to
`d1f29c8f517ca787f88f61d218a5dde03ecee2be096a7aefd91c6c2865d394c3`.
A confirmation requires the real, pending and unexpired Approval Center
request with that exact hash, plus the explicit critical second
confirmation. Consumption has a fixed executor identity, not a generic
consumer. The actual Ed25519 token and persisted one-time consumption
ledger are independently verified by the existing gateway function.

The authoritative V2 staged-runtime manifest now contains **19** exact
Git blob pins, including this new contract. Tests check canonical
five-field SHA, cross-release rejection, signed Ed25519, expired or
forged token, policy mismatch and tampered ledger. No real token,
approval request, approval decision or consumption occurred.

**Important:** this is NOT a live registered HTTP route and does not
modify policy, host owner files, MCP registry, or Production. The installed
base API still uses action-only routing. The remaining bootstrap must
safely register dedicated fixed request/confirm/consume endpoints,
attach real Approval Center transport, install the root-owned runner,
re-attest live four-owner SHAs, and independently validate recovery and
MCP discovery before a new explicit L4 approval. Never reuse an older
consumed request or treat source-only CI as deployed success.

## 2026-10-14 — Read-only live baseline and bounded 5-field HTTP integration

Live control-plane `sha256sum` verified all four owner preimages for the
V2 release **exactly**: base
`4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406`,
executor `410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0`,
policy `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174`,
MCP `bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166`.
Read-only inspection of the existing base server verified the concrete
`/v2/host-actions/request`, `/v2/host-actions/confirm`, and
`/v2/host-actions/authorize-consume` routes still hash `{action}`.
Do NOT retrofit those general routes with an incompatible five-field hash.

Two new reviewed artifacts in this PR:

- `prhm-action-registry-v2-approval-http-adapter-v1.cjs` implements fixed,
  separately scoped `/v2/registry/honartik/request`,
  `/v2/registry/honartik/confirm`, and
  `/v2/registry/honartik/execute` handlers through trusted, injected,
  root-owned Approval Center transports only. The confirmed signed token
  is sealed in the executor vault instead of returned to the caller.
  Before a token may be consumed, the root-provided preflight must attest
  exact owner SHAs, staged immutable Git blobs, trusted runner binary,
  durable recovery, dual-worker MCP discovery and installed signed route.
  Consumption requires the real signed Approval Center validation and
  consumed ledger cryptographic verification before the exact pinned
  independent launcher; no token replay on failure.
- `prhm-action-registry-v2-base-http-patch-v1.cjs` is a **pure Buffer
  candidate builder** that requires the exact live base SHA above and a
  unique existing v2 route anchor, inserts only these distinct fixed routes,
  and rejects any base drift. It neither writes files nor starts services.
  Its route code expects a separately staged, SHA-attested trusted
  capabilities provider at
  `/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2/prhm-action-registry-v2-trusted-base-capabilities-v1.cjs`.

CI includes synthetic end-to-end Ed25519/consumption, missing-preflight,
mismatched-SHA, forged decision, stale consumed ledger, old endpoint
noninterference, missing capabilities and patch guard tests. The effective
staged runtime manifest pins **20 immutable blobs** with the HTTP adapter,
but NOT the base patcher (a separately approved bootstrap-only artifact).

Read-only `ls -ld /opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2`
currently returns **ENOENT**. Therefore the trusted module and root runner
are NOT staged, the HTTP routes are NOT mounted, and the new Host Action
is NOT registered. The new module must never be loaded by the existing base
until the independent root-owned capability provider is implemented,
source reviewed, hash pinned, staged and a fresh signed L4 bootstrap
has passed all preflight and rollback verifications.

**Current state: reviewed Git source + CI only; NO Production mutation,
NO token issuance/approval/consumption, NO route activation.**

## 2026-10-14 — Protected-owner SHA circularity: fixed by an isolated AF_UNIX route

A critical bootstrap ordering bug was confirmed **before Production mutation**.
The proposed `prhm-action-registry-v2-base-http-patch-v1.cjs` would
install new HTTP handlers by modifying
`/opt/prhm-agent-selfmaint/server.js` *before* the new five-field
Approval Center request can be issued. But the immutable release
manifest and `immutableManifest` require this exact file's
**original** SHA256
`4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406`.
The HTTP bootstrap would invalidate that preimage and make its own
registration permanently fail closed. Do not attempt this sequence.

**Corrected architecture:** `prhm-action-registry-v2-base-http-patch-v1.cjs`
now rejects even exact original owner bytes with
`protected_owner_preimage_circularity_use_isolated_socket`. The new
`prhm-action-registry-v2-isolated-socket-v1.cjs` is a separate
**source-only** root-owned AF_UNIX HTTP endpoint designed for a
dedicated `prhm-shared-registry-approval-v2.service` unit on
`/run/prhm-shared-registry-v2/registry.sock`. It requires root UID, the
exact dedicated systemd cgroup, an already provisioned 0700 root-owned
directory, no preexisting socket path, and a fixed compiled local
`prhm-action-registry-v2-trusted-base-capabilities-v1.cjs` provider.
It never binds a TCP port, never intercepts old
`/v2/host-actions/*` routes and preserves all four registry owner
preimages before the signed L4 install. The socket applies process
umask 0077 *before* listen, plus 0600 socket permissions.
Only `POST` to the three approved Honartik registry paths is accepted;
409/413/404 failure responses are fixed and secrets/error messages
are not reflected. Response schemas are strictly allowlisted,
including rejection of nested approval data.

**Regressions:** node:test creates a REAL Unix socket under a temporary
CI directory and verifies one fixed successful route, unsupported paths,
GET, oversized payload, failure redaction, nested secret rejection,
dedicated cgroup/root/permission checks, and the now-disabled on-base
patch. The test process does not access Production sockets, secrets,
service files or the real Approval Center. The sidecar is NOT part of
the current 20-file executable closure because its separately reviewed
root capabilities provider, signed stage transport and root systemd
unit have **not** been implemented or installed.

**Required order for any later L4-authorized bootstrap:**
1. Review and SHA-pin a real root-owned capabilities provider with
   strictly audited Approval Center request/decision/validate/consume,
   sealed credentials, immutable Git and four-owner attestation,
   durable recovery and authenticated blue/green MCP discovery.
2. Stage a complete, dependency-closed version of the sidecar,
   root provider and independent executable under a *separate*
   fresh signed bootstrap, without modifying four protected owners.
3. Prove socket-only preflight, actual owner SHA unchanged,
   root runner recovery fault injection, negative dual-MCP discovery
   and Approval Center request lookup with NO token issuance.
4. Obtain fresh explicitly scoped L4 approval and run exactly the
   pinned SHA. Only **after** cryptographic approval is consumed and
   the one-time fence is durable may the reviewed atomic installer
   modify original owners, restart services and check tool discovery.
   On failure use durable rollback; never replay a consumed token.

**Live stage status:** the
`/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2` directory
was verified absent (ENOENT). No sidecar socket or systemd unit was
created by this task. Production remains NO-GO; PR #190 is a draft.

## 2026-10-14 — Concrete root read-only attestation gate, not an approval authority

Review confirmed the exact on-host four protected preimage SHA256 values still
match the immutable Honartik V2 release, with all four files owned by root
(the MCP owner has mode `0600`). The separately authorized V2 runtime
directory `/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2`
remains absent, therefore a sidecar cannot be safely started yet.
Direct control-plane reads of Approval Center private requests/ledger
were blocked by the read-only agent's scope: no request-lookup API or
private-credential transport should be assumed to exist.

A new executable **read-only inspection API**,
`prhm-action-registry-v2-root-attestation-v1.cjs`, is implemented in Git
with `test-prhm-action-registry-v2-root-attestation-v1.cjs`.
`inspect()` verifies UID 0 and the locally compiled 20-file V2 staged
closure; it then checks the original four owner bytes for exact SHA256,
the root-owned private runtime directory and every staged Git blob
for exact Git blob SHA1 (including guarded `O_NOFOLLOW` read,
parent/file ownership, mode, inode and device race checks).
It does **not** create files, request a signed approval, install,
restart services, touch Production or report a false green runtime.
Missing Stage or drift fails before any installer call.

These checks are **one prerequisite** for a real root capability provider.
The module is source-only on PR #190, not installed or bound to
`prhm-action-registry-v2-isolated-socket-v1.cjs` yet. The root transport
must use separately provisioned SHA-pinned, root-owned staged code and
must still independently attest the Ed25519 consumed Approval Center
ledger and durable one-time fence; it must provide root-only sealed
credential storage, reviewed pinned installer/rollback callbacks and
fresh authenticated blue/green MCP tools/list probes. No way to
activate the HTTP adapter, sidecar or independent runner exists from
the present deployed tool inventory without a separately reviewed
bootstrap and a **fresh explicit** Level-4 approval.

This read-only module is deliberately **not added to the 20-file
Production closure** yet because its own closure-manifest dependency
must be staged in a separate, SHA-attested bootstrap layer; treating
a copied source as an installed Root adapter would create a new
unbound runtime path. PR remains Draft / Production NO-GO.
