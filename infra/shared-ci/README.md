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
- Local hash parity **does NOT establish authenticity**. Ubuntu publisher signature is not yet verified; `manifest.json` intentionally has null trusted signer/keyring and fail-closes.
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
- No firewall changes or bootstrap scripts are included in this review-only PR; a **subsequent exact SHA-bound reviewed change** must bundle libvirt XML, firewall rules, staged validate/apply, independent rollback and production-impact checks together.
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
