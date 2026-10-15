# Honartik iTicket: isolated node1 CI VM candidate

**2026-10-15 — Git SOURCE and read-only validation only. No installation.**
Associated project: `prhmonline/honar-back-new`, Draft PR #21,
Issue #20. Intended Host Actions action:
`honartik_iticket_ci_vm_provision_v1`.

## Git deliverables

- `honartik-iticket-ci-vm-candidate-v1.cjs`: pure candidate builder
  using fixed resources, no command executor or mutation interface.
  Generates an exact resource plan, SHA256 network XML digest and a
  restricted step/rollback contract.
- `test-honartik-iticket-ci-vm-candidate-v1.cjs`: six actual Node.js
  contract tests, including wrong hypervisor, no KVM, disabled firewall,
  wrong image SHA, insufficient RAM/disk, any existing VM/network/disk,
  injected caller commands, extra approval fields, NAT/IP, and
  `prod-net` connectivity — all fail closed.
- `honartik-iticket-ci-vm-node1-readonly-facts-v1.py`: collects
  strictly bounded system/libvirt facts. No CLI arguments, no host
  mutation and no secret or project-data access.
- `.github/workflows/honartik-iticket-ci-vm-candidate.yml`:
  read-only, non-deploy contract workflow with pinned checkout.

## Actual read-only checks

A SHA-verified source copy of the two JS files was tested in a
temporary, restricted Linux folder on the authorized connected
computer; six contract tests PASS, zero failures. Temporary files were
removed and **no VM, Docker, DB, service or network operation** ran.

The Python node1 facts collector was delivered **in memory**
through the existing strict-host-key SSH route and executed read-only
as `python3 -` (no disk installation on node1). It returned real
inventory that the Git SHA-verified Node candidate validated:

```text
ITICKET_VM_REAL_NODE1_FACTS_VALIDATION=PASS
ITICKET_VM_REAL_NODE1_FACTS_AVAIL_MEMORY_MIB=40840
ITICKET_VM_REAL_NODE1_FACTS_AVAIL_DISK_GIB=409
ITICKET_VM_NETWORK_XML_SHA256=8cd1097ed06d6058650cc3f961dc513be0ba64fa2273e01c4b1d6a21bdb46218
ITICKET_VM_INSTALL_ACTION=honartik_iticket_ci_vm_provision_v1
ITICKET_VM_PRIVILEGED_EXECUTION=DISABLED
ITICKET_VM_LEVEL4_APPROVAL=4
ITICKET_VM_GUEST_NETWORK_NO_ROUTABLE_IP=true
ITICKET_VM_FACTS_CLOUD_IMAGE_MATCH=TRUE
```

This read-only preflight has **no reservation or guarantee** that
the resources remain available at a future provisioning time.

## Exact intended resources

| Field | Fixed value |
| --- | --- |
| Hypervisor | `server1.prhm.ir` (node1) |
| Existing VMs | `prhm-production`, `imotion-directadmin` — untouched |
| New VM | `honartik-iticket-ci` |
| CPU | 4 vCPU |
| RAM | 8192 MiB |
| New disk | `/var/lib/libvirt/images/honartik-iticket-ci.qcow2`, 60 GiB |
| Source image | `/var/lib/libvirt/images/base/noble-server-cloudimg-amd64.img` |
| Image SHA256 | `ffe6203da54deeb6db5d2a98a83f9ec8e55f149d3f7ba622e1abe5fa966ee3d6` |
| New network | `honartik-iticket-ci-net` / `virbr-iticket-ci` |
| Forbidden network | `prod-net` |
| Guest egress | None in the candidate: no forward, IP, route or DNS |
| Authorization | New, single-use, exact-SHA-bound Level-4 approval |

The network XML deliberately contains no `forward`, `ip`, `route`
or `dns`. **This means the guest cannot yet download packages,
pull Docker images, or clone GitHub.** Provisioning the PHP 8.3 +
Docker + pinned MySQL 8 + Yii2 toolchain requires a **separately
reviewed offline dependency/image-delivery method**, not weakening
isolation by adding NAT or temporarily attaching to `prod-net`.

## Reviewable source-only transaction core (2026-10-15)

`honartik-iticket-ci-vm-transaction-v1.cjs` is now in this Draft PR.
It is **not** an installed root helper or a live Agent 3 action.
It builds exact offline `<domain>` and `<network>` XML, binds
five approval fields using recursively sorted-key canonical JSON
(in accordance with Approval Center), and defines a transaction
contract for a future, **separately signed and registered**
Host Actions v2 dispatcher.

The dispatcher must own and independently supply the following
non-user-input capabilities: verify immutable Git source and assets,
consume a genuine one-time Level-4 Ed25519 approval,
lock exactly this resource, read and recheck live host facts,
durably/fsync journal intents and results, create/check exactly the
new network/disk/non-booted VM, and roll back **only proven-owned**
creations. Unknown creation outcomes must remain in a
`MANUAL_RECOVERY_REQUIRED` journal for human inspection, not be
unconditionally deleted. Nothing uses arbitrary command strings
or accepts user-supplied paths, VM names, bank tokens or guest
credentials.

The candidate intentionally does **not** provide a CLI, invoke
`virsh`, register a tool, obtain approval, start the guest,
attach `prod-net`, create Docker containers or contact the bank.

`test-honartik-iticket-ci-vm-transaction-v1.cjs` uses only an
in-memory synthetic capability adapter; 10/10 tests PASS in a
temporary source-blob-SHA-verified Linux folder:

- canonical 5-field approval SHA and exact fixed guest XML,
- simulated signed receipt and immutable Git source validation,
- write-ahead ownership journal and exclusive resource lock,
- safe 3-step offline definition with VM not started,
- unauthenticated/replayed request and source mismatch refusal,
- ambiguous disk creation, isolation verification failure,
- rollback of only owned resources in reverse order,
- unacknowledged journal finalization and rollback error reporting.

An initial test caught a false-positive when a simulated journal
finalization returned `false` instead of throwing. The core was
fixed to treat missing durable acknowledgement as
`MANUAL_RECOVERY_REQUIRED` and all 10 tests rerun green.
This is **not** a real hypervisor apply test or recovery proof.

The GitHub Actions source-only workflow now exercises both the
6 existing fixed-resource candidate tests and 10 new transaction tests.
Any claim of live readiness requires separate signed Host Actions
registration, preflight, and a real isolated VM install after explicit
approval.

## Host image and storage read-only technical check

An additional **read-only SSH** inspection on node1
(`server1.prhm.ir`, port 22) verified the pinned Ubuntu base image
really is **QCOW2** (`qemu-img info --output=json`), with backing
virtual size 3.5 GiB and reported non-corrupt QCOW2 metadata.
The existing `vm-storage` pool is `running`; no storage pool
or VM was modified. The future host adapter must use a pinned,
explicit `qcow2` backing-image format, refuse target collision
and verify both new-disk provenance and read-back guest XML before
it may mark a resource owned.

The trusted root-owned command adapter and durable on-disk journal
implementation remain **unimplemented/unregistered**. The transaction
module exercises the invocation and recovery **contract** against
a synthetic I/O adapter and does not call QEMU/libvirt. This limitation
prevents a false claim that the installer can already create a VM.

## Critical trust-boundary blocker

This candidate does **not** install or register an Agent 3 action.
An authorized Host Actions v2 runner with a fixed VM and network
installer would still need to:

1. Register the immutable action and policy through the **existing**
   Host Actions v2 / Approval Center pipeline without replacing the
   security boundary. Bind fixed action, project, source_commit and
   immutable asset hashes to a **new**, expiring, signed, single-use
   Level-4 approval. Reused request IDs or user-supplied proof are not
   acceptable.
2. Fetch the exact reviewed source bytes from Git. Check owner/source
   SHAs, current policy, the pinned base-image SHA, fresh live node1
   inventory and all resource name/path collisions before using
   libvirt. Refuse on drift.
3. Stage a rollback-safe installer whose only potential creations are
   the new exact network, exact COW disk and exact new VM. Keep a
   durable journal of items actually created; rollback must remove
   only those, never any preexisting VM, disk or network. Failure to
   verify rollback must STOP, not report DONE.
4. Prove the network is not `prod-net` and has no connectivity to
   production VM, databases or control-plane services before any
   subsequent provisioning or mock-test execution.
5. Only after VM creation and offline dependency preparation, run
   `scripts/iticket-external-ci-gate.sh` from a clean exact SHA
   checkout **inside** the dedicated guest. Review the evidence
   verifier SHA256 and mock-only status separately.

The
`PRHM-ACTION-REGISTRY-ONBOARDING-STANDARD.md` in this repo states that
the common typed five-field registry bootstrap was **not live as of
2026-10-13**. A Git commit alone or an approval phrase alone is
therefore **not** installation or authority. Follow its two-commit
source/manifest convention once a vetted action-specific installer
and working trusted registration route exist; do not place the SHA
of a commit inside that same commit's manifest.

## Approval and release state

No fresh Level-4 provisioning request was created or consumed.
There is **no** registered `honartik_iticket_ci_vm_provision_v1` action,
no VM, no network, no newly executed MySQL8 CI, no real SEP/iTicket
financial E2E and no change to `prhm-production` or
`imotion-directadmin`. Candidate PR must remain Draft for external
review and a separately authorized trusted installer.

The Honartik buyer-payment PR #21 remains Draft and Issue #20 open;
bank buyer refunds, reseller-wallet transactions and real ticket
issuance remain blocked pending separately proven financial sandbox.
