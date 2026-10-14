# PRHM Shared CI — reviewed infrastructure proposal (2026-10-14)

**Status: REVIEW ONLY — no VM, network, firewall change, runner enrollment or registration token created.**
This is an infrastructure design for **all** `prhmonline` repositories, not a DrTarjomeh-only runner. First test consumer: `prhmonline/drtarjomeh` PR #71.

## Observed Node1 state (owner read-only output)
- `server1.prhm.ir`: 48 logical CPUs, 62 GiB RAM (40 GiB available in owner snapshot).
- Active libvirt `vm-storage`: approximately 437 GiB free, target `/var/lib/libvirt/images`.
- Existing `prhm-production` running; `imotion-directadmin` stopped.
- Existing `prod-net` is active NAT on `virbr-prod`, subnet `10.71.0.0/24`; existing Production fixed lease `10.71.0.118`. NEVER attach a CI guest to `prod-net`.
- `virt-install`, `qemu-img`, `genisoimage`, `mkisofs` present; `cloud-localds` absent.
- Image SHA256 **locally matches** SHA256SUMS entry: `ffe6203da54deeb6db5d2a98a83f9ec8e55f149d3f7ba622e1abe5fa966ee3d6`.
- Local hash parity **does NOT establish authenticity**. The Ubuntu publisher signing fingerprint is pinned from Canonical documentation, but no validated root-owned keyring or matching `SHA256SUMS.gpg` is installed/verified on Node1; the signature gate **fails closed**.
- Existing firewalld zones: `public` on `eno1`, `libvirt` on `virbr-prod`. No evidence of an independent, isolated `ci-net` yet.

## Architecture
- One **shared capacity pool**, starting with 4 vCPU, 8 GiB RAM, 80 GiB disk and at most one concurrent job.
- **Repository-scoped ephemeral runner identity per job** (personal-account repositories cannot share a single organization-scoped GitHub runner). The base VM is **not** a reusable runner execution surface. Provision a disposable guest/disk or equivalent *hardware-level* isolation for each untrusted job. Destroy after one job and forward logs outside the guest.
- No untrusted pull-request code from public forks. Do not enable workflows on public fork PRs on self-hosted runners. Enforce least-privilege `GITHUB_TOKEN` and no production environment secrets.
- Production release is an **independent trusted path**, never a privilege available to generic CI jobs. Keep `production-security` environment and its keys off the common runner.
- Rootless worker account. No host mounts, Docker socket, libvirt socket, cloud host metadata, SSH agent, Production keys, or writable parent directories shared with workers.
- Keep owner/operator credentials outside VM. Register GitHub runners using short-lived repository-scoped tokens via a reviewed controller, **not** long-lived registration secrets committed to Git.

## Network invariant (P0 prerequisite)
- Proposed `ci-net` subnet `10.72.0.0/24`, bridge `virbr-ci` (not deployed). No connection to `virbr-prod`.
- **NAT alone is NOT isolation**. Before attaching any runner, install and verify deny-by-default forwarding/input policies on Node1. The rules must reject CI-origin connections to `10.71.0.0/24`, all RFC1918/private/localhost/link-local destinations and host administrative services, including IPv6 bypasses; permit only explicitly approved outbound public GitHub HTTPS plus strictly required DNS/DHCP via controlled resolver.
- Verify policy chains/priorities relative to firewalld/libvirt, with stateful connections and IPv6 considered. Do not merely inspect zones: prove with **negative connectivity tests from inside isolated throwaway VM**. No accepting SSH/SMB/DB/VM hypervisor interfaces on the host. Evaluate DNS and GitHub `*.actions.githubusercontent.com`, artifact endpoints carefully without broad unrestricted bypass.
- Reference libvirt XML and firewall configuration are committed with `.review` extensions and **are not installed**. A **subsequent exact SHA-bound reviewed change** must bundle validated libvirt/network/firewall apply, independent rollback and production-impact checks together.
- Mandatory rollback: delete ONLY resources created by the approved change (name/SHA preimage checks); NEVER delete or modify `prod-net`, `prhm-production`, or pre-existing firewall chains.

## Fail-closed gates
1. **This PR:** `python3 -m unittest discover -s infra/shared-ci -p 'test_*.py'`, `python3 infra/shared-ci/preflight.py` on Node1 (read-only). Capture output, no approval grant from a local PASS alone.
2. Verify image supplier's **authentic** signed `SHA256SUMS.gpg`, obtained from matching image release, with independently verified key fingerprint added in a reviewed commit; reject missing/invalid/untrusted signatures and wrong image hash.
3. Prove Node1 storage/CPU safety, no collisions with `ci-net`/`virbr-ci`/`10.72.0.0/24` or existing libvirt assets; record existing firewall / XML preimage digests.
4. Approve and stage `ci-net` and firewall policy in Git; test failure-safe apply and exact resource rollback in isolated lab. Require owner confirmation for Node1 host mutation.
5. Build isolated VM from verified immutable image; before GitHub registration prove public GitHub HTTPS egress and repeated **negative** TCP checks to host and `10.71.0.118:22`, HTTP(S) / service ports. Enforce outbound DNS, IPv6, and routing isolation.
6. Enroll one ephemeral repository-scoped worker for `drtarjomeh`; trigger a no-secrets smoke workflow. A GitHub Actions **billing/account block may still prevent scheduling a self-hosted job**; verify actual started/completed job instead of assuming bypass.
7. Expand enrollment to other allowlisted repositories only after one-job destruction, log collection, access control, cleanup, and offline tests are proven. Record tested commit SHA, job conclusion, worker id and teardown timestamp.

## Stop conditions
No GPG trust; network cannot be proven isolated; GitHub registration permission not granted; CI billing block persists; runner persists across jobs; production endpoints reachable; any target preexists or changed; no rollback proven => **STOP.**

Source of truth: `infra/shared-ci/manifest.json`; the read-only audit is `preflight.py`. All proposed infrastructure mutations are **future work**, not implicit permission to mutate Node1.

## Review-only network and image artifacts added in PR #205

- `ci-net.xml.review`: proposed NAT bridge `virbr-ci`, subnet `10.72.0.0/24` and DHCP leases; **not installed**.
- `ci-isolation.nft.review`: independent dedicated `inet prhm_ci_isolation` table; denies guest IPv6, non-public IPv4, all access to host services except local guest DNS/DHCP, and all guest-origin forwarding except TCP 443 to public destinations. Includes Node1 upstream `185.191.76.136/30` in deny list; blocks `10.71.0.0/24` via `10.0.0.0/8`. DHCPDISCOVER is allowed before anti-spoof validation because its source may be `0.0.0.0`. **Draft syntax and interactions with firewalld/libvirt must still be checked in an isolated test network.**
- `image-signature.py`: read-only `gpgv` validation of signed checksum file, requiring signer `D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81` documented by Canonical (https://ubuntu.com/docs/public-images/public-images-how-to/verify-image-checksum/), root-owned non-group-writable/non-world-writable trust material under `/etc/prhm-ci/trust/`. A matching signature **for this exact old image build** is required. The repository does not contain the keyring, signature, tokens or credentials.
- `preflight.py` now calls the signer gate rather than treating the local hash as publisher verification.
- Offline tests are `test_network_contract.py` and `test_image_signature.py`; they test static contracts and GPG status parsing, **not** live nftables behavior or the vendor's actual signature. Actual `gpgv` verification requires a separately authenticated root-owned keyring and matching published `SHA256SUMS.gpg`.

**Never run `nft -f` / `virsh net-define` directly from this proposal.** A later approved SHA-bound transaction must:
1. Compare current production VM XML, bridge, firewall chains and file SHA preimages; never flush a global ruleset, reload firewalld blindly, or alter existing libvirt networks.
2. Validate nft syntax with `nft -c -f` only in an **isolated lab**, verify hook priority/conntrack/NAT/DNS/DHCP behavior, and test service restarts, daemon reload, reboot persistence, and rollback. Do not assume an ACCEPT in the dedicated chain overrides other firewall chains.
3. Roll back only its own `prhm_ci_isolation` table, `ci-net` network and `prhm-shared-ci` resources **if exact ownership and preimages match**, with Production health verified before and after. Stop if another actor changed them.
4. Prove from an isolated guest: no access to `10.71.0.118`, `10.71.0.1`, Node1 public/mgmt addresses, all host services except DNS/DHCP, other private ranges and IPv6; positive permitted public GitHub HTTPS and artifact endpoint checks.
5. Limit concurrent workers to one until east-west guest isolation is independently reviewed. A clean ephemeral VM/volume is essential between projects. Do not treat persistent process/container separation as a secure boundary.
6. Start a no-secrets Actions smoke job on a separately enrolled repository runner and **verify it actually starts and completes** despite account budget restrictions. Otherwise stop; do not infer free runner bypass from a green unrelated workflow.

Manual GPG/key import, root filesystem writes, firewall edits, Runner registration and VM creation **remain blocked** here. Any future apply needs separate owner authorization and reviewed immutable Git SHA.


## Verified off-host evidence (2026-10-14)

- **Real dedicated workflow PASS:** [GitHub Actions run 38547738341](https://github.com/prhmonline/prhm-host-actions/actions/runs/38547738341) ran **15/15 offline contract tests** with no Production/Node1 keys or protected environments.
- **Official Ubuntu archival signature PASS:** `verify-ubuntu-archive.sh` retrieved the signed historical `noble/release-20260705` checksums and detached signature from Ubuntu, fetched the UEC signing public key, pinned signer fingerprint `D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81`, verified the detached GPG signature via `gpgv`, and confirmed the documented Ubuntu image's SHA256 exactly matches the owner-reported Node1 image SHA256 (`ffe6203da54deeb6db5d2a98a83f9ec8e55f149d3f7ba622e1abe5fa966ee3d6`). This is a vendor signature provenance check on the CI runner, **not** a fresh direct file read from Node1.
- **nftables grammar PASS:** the same disposable GitHub runner installed nftables and ran `sudo nft --check --file infra/shared-ci/ci-isolation.nft.review`; this did **not** install rules and does **not** prove that the draft policy correctly isolates live Node1 firewalld/libvirt traffic.
- **Host GPG keyring gate intentionally blocks:** `preflight.py` requires a root-owned trusted keyring under `/etc/prhm-ci/trust/` to run a separate local publisher-signature check; no keyring was installed on Node1. CI's separate verified provenance does not silently bypass that host gate.
- **Still NOT DONE:** Node1 existing-firewall preimage inventory, nft/firewalld NAT interoperability test, full negative guest connectivity, executable approved apply/rollback transaction, isolated VM, GitHub ephemeral Runner registration, successful self-hosted smoke job, and clean one-job worker teardown.

This evidence should not be summarized as a live Production/network guard being deployed. The signed hash, network file, root-owned keyring, policy and host identity must be rechecked immediately before any authorized apply.


## Node1 live baseline gate (added 2026-10-14)

The fixed `node1-network-snapshot.py` is **read-only** and emits only active nftables base-chain hooks, rule counts, normalized hashes, active firewalld zones, current bridge names and explicit collision checks. It does not print entire potentially sensitive firewall rules. It fails closed if the existing production bridge/route, nft forwarding hooks, network name or expected VM identity differ.

Offline, `test_node1_network_snapshot.py` mocks those reads and asserts existing-production integrity checks, collision rejection, counter/handle-normalized digest, no write commands, and forced stop on missing nft forward hooks or Production route.

**Execution gate:** check out the exact reviewed commit in an authorized *private* repository worktree on Node1, independently verify the SHA, then invoke `python3 infra/shared-ci/node1-network-snapshot.py` under an approved read-only operator session. The source is in a private GitHub repository; do NOT put a GitHub PAT in a pasted shell command, command-line argument, environment disclosure, or URL. Never curl an unpinned branch's shell/python from a public URL into a privileged interpreter. Capturing this snapshot does not grant permission to install `ci-net`, change nftables, install a Runner or create a VM.

If the reviewed file is not yet accessible on Node1, the minimal **read-only** human-visible baseline is:

```bash
echo "=== FIREWALL HOOKS ==="
nft -a list ruleset 2>/dev/null | awk '/^table / || /type (filter|nat) hook/ {print}' | head -n 100
echo "=== ACTIVE ZONES ==="
firewall-cmd --get-active-zones
echo "=== POLICIES ==="
firewall-cmd --get-policies 2>/dev/null || true
```

This limited baseline does not replace a full normalized hash snapshot, but can disclose whether the proposed pre-forward hook priority is compatible with current firewalld/libvirt chains. **Do not apply any firewall rule based only on this output.**

