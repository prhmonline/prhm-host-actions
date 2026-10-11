# Shifa Git-only SSH identity repair — 2026-10-10

Scope: only Git metadata and per-repository deploy-key identity for `/home/prhm/projects/shifa-platform`. No application, databases, services, cron, deploy, or production code writes.

Evidence: server HEAD `98594d1`; the live `infra/docker/compose.infrastructure.yml` local change is already committed on GitHub main. `.git/config` has `core.sshCommand=ssh -i /root/.ssh/id_ed25519_prhmonline_account -o IdentitiesOnly=yes -o IdentityAgent=none`. `.git/FETCH_HEAD`, `.git/index`, `.git/config` and remote refs have root ownership and are not user-writable. Existing per-user keys have no access to this repository.

Remediation:
1. Preflight: verify owner, HEAD, exact SSH preimage, Git status, existing deploy keys, and `/home/prhm/.ssh` mode 0700. Refuse if preconditions drift.
2. Generate an **Ed25519 deploy key only for this repo** as uid `prhm`, to `/home/prhm/.ssh/shifa_deploy_ed25519`, mode 0600; never show or export the private key. Public key may be sent to GitHub via authenticated connector.
3. Register **read-only** deploy key in `prhmonline/shifa-platform`, verify it with a non-mutating `git ls-remote origin main` using `-c core.sshCommand` and that specific key.
4. Back up `.git/config` (0600 root-only evidence). Change only `core.sshCommand` to a key under `/home/prhm/.ssh`, and normalize ownership of **root-owned Git metadata only** inside the exact `.git` directory. Do not change app tree permissions. No chmod 777, no root private key copy, no force push, no resets or stashes.
5. Run `git fetch origin main` as `prhm`; verify remote SHA and branch ahead/behind and that the live application files remain byte-unchanged. Do not merge/checkout while compose file is dirty.
6. Log repository/branch/local SHA/remote SHA/timestamp/result and any rollback. On failure, restore config from its backup. If a repository-specific host action exists, prefer its approval-bound execution.

Important: a fetched remote is **not** a production deployment. Promote only a reviewed SHA with separate health checks, preflight, deploy and rollback.
