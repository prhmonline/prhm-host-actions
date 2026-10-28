# Honartik #217 — Provider Root-of-Trust bootstrap acceptance (NO-GO until independent approval)

**Scope:** fixed `honartik_universal_installer_upgrade_v1` root registration only. Never bootstrap an arbitrary action. This is an operator handoff and **not** an executable root installer or an authorization.

## Immutable references

- Existing SOURCE-ONLY PR #224 head: `f914e8ac4e0bc3d7b9845907c651f8d1cf97e0ea`.
- Merged repository commit: `36ad096c630edc96dcc8daa96c77ae00f4767a94`.
- Existing root registration source Git closure: `honartik-universal-installer-registration-review-pack-v1.cjs`, `honartik-universal-installer-owner-bootstrap-plan-review-v1.cjs`, `honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs`.
- Expected policy SHA-256 preimage: `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174`.
- Expected candidate policy SHA-256: `981967b4ce770cd3aa89d27ae98552bbeb3ab31ed116d4e51aef91c0abf68358`.
- 36-file candidate archive SHA-256: `e49ed1ce6366f87fad8dc2e46fd69c323c3cafb3729e90cdaaebe5421898212c`.
- Native source artifacts: 13 pinned Git blobs plus the separately pinned trusted dispatch shim; the registration plan binds exactly those assets and the four owner postimages.

**Four owner preimages** (all observed by the operator on `prhm-production`; independently re-attest in provider-console immediately before an authorized transaction):

| Owner | Absolute path | SHA-256 preimage | uid:gid | mode |
|---|---|---|---|---|
| Agent API | `/opt/prhm-agent-selfmaint/server.js` | `4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406` | 0:0 | 0644 |
| Executor | `/opt/prhm-agent-selfmaint-exec/server.js` | `410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0` | 0:0 | 0755 |
| MCP plugin | `/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js` | `bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166` | 0:0 | 0600 |
| Policy | `/opt/prhm-company-control-plane/config/approval-policy.json` | `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174` | 0:0 | 0644 |

## Source-only isolated Linux gate

From the **checked-out exact Git-reviewed source**, in an unprivileged, disposable Linux runner:

```bash
python3 tools/honartik217-provider-readiness-v1.py --ci-source
node --test test-honartik-universal-installer-owner-bootstrap-linux-v1.cjs test-honartik-universal-installer-owner-bootstrap-plan-review-v1.cjs
```

This includes real temporary-filesystem atomic write, injected midflight failure, SIGKILL and recovery of the core; it does **not** prove the Provider root integration or real systemd restart/rollback.

On the production root console, the following is **read-only** and Python 3.6 compatible:

```bash
python3 tools/honartik217-provider-readiness-v1.py --host-readonly
```

The operator must first check that the script bytes came from the approved exact SHA and never pipe unreviewed network content to shell/root. `--host-readonly` does not issue/consume Level-4 approval, stage files or run an installer.

## Real isolated systemd Linux VM evidence — 2026-10-28

The separately-scoped GitHub-hosted Ubuntu **VM** exercised the four-owner transaction core against two actual **synthetic** systemd service units. Successful job:
[GitHub Actions run 40678086431](https://github.com/prhmonline/prhm-host-actions/actions/runs/40678086431), `isolated-real-systemd-vm-rollback`.

The test `test-honartik-universal-installer-owner-bootstrap-systemd-vm-v1.cjs` requires a root process **inside a disposable GitHub-hosted VM**, writes only synthetic fixture owner files/assets below its new `/tmp/prhm-honartik217-vm-*` root and transient fixture-only units in `/run/systemd/system`, and cleans up afterward. It does not accept arbitrary target paths. Scenarios asserted:

1. Four-owner + new asset atomic transaction followed by two actual systemd service restarts: durable `COMMITTED`.
2. Forced candidate service startup failure: rollback exact original four-owner bytes/modes and remove the created asset; restart and confirm both services active; durable `ROLLED_BACK`.
3. Independent child killed with `SIGKILL` after two owner renames: separate-process journal recovery, asset absent and both restored services active; durable `ROLLED_BACK`.
4. Independent child killed with `SIGKILL` after asset rename: restore original four owners, remove created asset, and restart healthy services; durable `ROLLED_BACK`.

**Strict scope limit:** this tests real systemd behavior on *synthetic service units* in an isolated GitHub VM. It is **not** a proof of trust-chain verification, Ed25519 approval, the authentic Provider Root entrypoint, exact 14 production root asset registration, or rollback of the real production service set. Those remain NO-GO until separately implemented, independently reviewed and attested in an authorized Provider-controlled VM and Production.


## Signed initial Provider Root-of-Trust bootstrap — source contract, NOT installed

The distinct bootstrap verifier is now in
`honartik-universal-installer-native-bootstrap-authorization-v1.cjs`.
It is a **different operation** from the existing post-registration Universal
Installer upgrade L4. It cannot authorize its own installation.

The review-only implementation:

- Verifies a separate Ed25519 compact signed receipt with a canonical header
  `PRHM-PROVIDER-ROOT-BOOTSTRAP`, distinct issuer
  `prhm-provider-root-of-trust`, exact audience/operation/environment,
  SHA-pinned source commit, plan manifest, UUID identity and ≤180-second TTL.
- Rejects a reused receipt through a durable O_EXCL + fsync approval lease;
  a rollback/failed restart does not erase a consumed lease.
- Before any transaction validates all **four exact root owner paths**, root
  UID/GID/mode, SHA-pinned before-images, fixed reviewed Git-blob identities
  and ordered destinations of the 14 registration assets, and the complete
  SHA-256 manifest built by the existing review-only plan.
- On valid authorization, the proposed Provider-owned adapter calls the
  **existing** `executeCore` transaction and independently provided real
  service-health/restart callbacks. No new independent installer is created.
- Denies live apply until the independently reviewed, immutable public key is
  installed by the **actual Provider Root-of-Trust** as a root-owned 0600 file
  at the fixed `KEY_PATH`, SHA-bound in code, with a pre-provisioned root-only
  transaction directory and a root-owned trusted dispatcher.

Current hard stops are intentional: `PINNED_PROVIDER_KEY_SHA256=null`,
`PROVIDER_DISPATCH_REGISTERED=false`,
`PRODUCTION_AUTHORIZED=false`, no standalone CLI, no signing-key material or
real approval token in Git/CI. The signer must be provisioned and the **specific
registration authorization** must be issued independently; merely having root
shell or an approval for the installer-upgrade operation is insufficient.

CI uses disposable, randomly generated **synthetic** Ed25519 keys and fixtures
to check signature/issuer/scope/expiry, manifest binding, nonreplay and
four-owner rollback. These tests do **not** prove Provider identity, trust
anchor provenance, authentic approval consumption or a real Provider VM apply.

Mandatory controlled deployment still requires:

1. Independent code security review of the exact **new** commit SHA and
   verified Provider registration signing policy/issuer identity.
2. Existing Provider-console trusted root owner to provision and attest the
   separate registration key anchor and SHA, root-owned transaction directory
   and fixed signed dispatch context, using an independently reviewed
   immutable source closure.
3. Real Provider-managed isolated VM test of the signed entrypoint, 4-owner
   transaction, asset installation, actual service restarts, SIGKILL crash
   recovery and non-reuse of the same receipt. Save signed attestation.
4. One separately issued, scoped and single-use **registration authorization**
   for Production; transactional apply and health proof, with recoverable
   journal and no silent replay.
5. Only after a registered and healthy Host Action: request a distinct,
   current-policy signed one-use L4 for the Universal Installer upgrade and
   subsequently a **separate** Honartik iTicket deployment.

NO_PROVIDER_SIGNATURE=NO_APPLY; NO_INDEPENDENT_REVIEW=NO_APPLY;
NO_PROVIDER_VM_PROOF=NO_APPLY.

## Independent security review gate — mandatory

The reviewer must be independent of the source author and confirm the **exact candidate commit**. If reviewing outside GitHub, retain a signed review attestation with subject SHA, reviewed artifact SHA-256 digests, signer identity, timestamp, critical findings/disposition and explicit `APPROVED` or `REJECTED`. An operator's chat confirmation, GitHub merge and green CI do **not** replace independent review.

The provider-controlled Root-of-Trust installer/dispatcher **does not yet exist** in the merged source. An infrastructure owner must implement and obtain an **independent security review** of the native provider-console invocation and root-owned authorization. Its trust boundary must independently verify the real signed registration authorization, full policy, Ed25519 issuer and replay ledger, fixed request identity and code integrity **before** calling any filesystem transaction. Injected callbacks, generic MCP `ops_execute`, an operator-provided `token`, or a copied approval token do not confer that authority.

## Minimum live authorization/transaction requirements

1. Provider-console exclusively authenticates a source SHA and a separately authorized, fixed-action Root bootstrap request; fail closed if an exact preimage, ownership, source Git blob, manifest, policy or authorization is missing/drifted.
2. One durable lock, fsynced journal, exact backups and postimages cover all four owners **and** the 14 fixed trusted root assets; any crash leaves a recoverable state. No arbitrary filesystem paths are accepted.
3. Rehearse on an isolated **Linux VM with real service units**: clean boot, four-owner+asset commit, injected failure after partial replacement, failed service restart, SIGKILL during replacement, interrupted recovery and durable `ROLLED_BACK` plus healthy original services. The existing temp-file Node tests are **not** a substitute for this live service rehearsal.
4. After success, inspect pre- and postimage SHA-256, uid:gid/mode, loaded action list, Policy exact candidate digest, consumed-approval ledger, journal and service states. Keep immutable evidence, no secrets.
5. Only after signed independent review, provider-bootstrap registration and verified rollback may the approval center issue a **fresh, one-use, 180-second critical Level 4** for `honartik_universal_installer_upgrade_v1`.
6. Apply only the fixed 36-file Universal Installer candidate through its newly registered native action. Backend, iTicket and Yii migrations are **separate releases** after installer health verification.

## NO-GO status as of last operator evidence

```text
ROOT_PREIMAGE_GATE=PASS
prhm-agent-selfmaint-exec.service=active
prhm-company-approval-bridge.service=active
LIVE_POLICY_ACTION=NO
LIVE_POLICY_SCOPE=NO
ROOT_DISPATCH_SHIM=NOT_INSTALLED
ROOT_NATIVE_TRANSACTION=NOT_INSTALLED
INDEPENDENT_REVIEW=NOT_EVIDENCED
PROVIDER_LINUX_RESTART_AND_CRASH_RECOVERY=NOT_ATTESTED
PRODUCTION_BOOTSTRAP=NOT_AUTHORIZED
UNIVERSAL_INSTALLER=NOT_UPGRADED
ITICKET=NOT_DEPLOYED
```

Do not merge source-only proofs as operational authority. Do not install a separate/universal replacement deployer or bypass the existing signed Approval Center.
