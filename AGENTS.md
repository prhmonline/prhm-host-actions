# PRHM Git Fast Lane — repository agent instructions

This is the **source-only Git path**, not an authorization to deploy or change infrastructure. It supplements project-specific rules, which always take precedence when stricter.

- For ordinary code, configuration **in the repository**, documentation, and UI work: prefer the connected **GitHub** API to create/update blobs and produce a precise commit. Do not request Level-4, a signed host action, registry bootstrap, or an SSH file upload merely to record source in Git.
- Use the exact target repository and branch; read current content/SHAs; inspect the change, check for secrets, and test affected functionality before completion.
- Do not use a production server working tree as an editing surface. Existing uncommitted server changes are **not** implicitly approved for upload.
- Check branch protection, per-repo AGENTS.md, and external deployment triggers **before** writing to a default branch. As of 2026-10-13, GitHub Actions production dispatch in `prhmonline/aranob`, `prhmonline/Honar-front-new`, and `prhmonline/honar-back-new` is **manual-only** (`workflow_dispatch`, main ref, exact SHA, `DEPLOY PRODUCTION` confirmation); ordinary main pushes no longer trigger these three workflows. Aranob's stricter `codex/` branch, PR, CI, and explicit approval rules still take precedence. Never assume external CI/CD or deployment hooks are absent without checking.
- Keep any existing AGENTS.md, security gate, explicit review/PR requirement, and staging/production restriction in force. Never bypass secrets, database, host privilege, or access-control approvals.
- Git DONE means commit SHA, changed paths, and validated test/CI status are reported. Git DONE is **not** Production DONE.
- Production deploy is a separate SHA-pinned, verified, auditable, rollback-capable action with risk-appropriate authorization.
- Do not construct a new PR, host action, or approval request solely because a Git-only task has hit a privileged host-action blocker. Use direct GitHub source APIs where authorized.
- Avoid repeat «برو قدم بعدی» loops: do all safe Git-only work in one request and close with evidence.

Global inventory: [fast-git-global-registry.json](docs/fast-git-global-registry.json). Policy: [fast-git-delivery.md](docs/fast-git-delivery.md).
