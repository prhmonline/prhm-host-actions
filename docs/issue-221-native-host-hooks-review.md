# Issue 221 — Native Root Hooks and Four-systemd CI Review Handoff

**Review scope: SOURCE + isolated Linux VM proof only. No Production apply or signed L4.**

## Immutable contracts

The existing root-owned, four-file service owners are not replaced by new standalone services. The private deterministic owner builders in this PR require exact before-SHA256 values:

| Owner | Before SHA256 | Private candidate SHA256 |
|---|---|---|
| Base | `4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406` | `d28dc9b45a6ca97a9c8aed0f1b22c684c34b5740a9f116ec7cec12efa22ee5bf` |
| Executor | `410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0` | `16dc7df45c8d6dbcf1501a9bdae3445e516faf7b8bef3be2d812263b2869940c` |
| MCP | `bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166` | `aceea9d7d53bbe58c164dbacb731fdcec1fd423eea563a37db5edd4983cbfb3c` |
| Policy | `148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174` | `eb9c2becba1e65033cde46eceef5f8e76e4545a35f99cb4e45a316277680bda0` |

Private candidate attestation SHA256: `6a734bea291f95305181d6f46b0a5f4b822d12aa2383fa340c7ddba1da18005e`. Private baseline and candidate bytes are restricted to the connected Windows account's ACL-protected PRHM workspace and **not posted into this PR**.

## Root hooks provided

`shared-registrar-native-host-hooks-v1.cjs` supplies source-owned fixed capabilities for the existing registrar root dispatcher:

- Exactly pinned 40-hex-character Git commits; local, offline root-owned Git object store, no arbitrary CLI/HTTP URL or branch aliases.
- Fixed per-project manifest paths; local immutable Git object reads and matching candidate builder bytes, not caller-supplied code.
- Protected root-only staged asset reads with no traversal or symlinks.
- Exact before/after SHA checks for all four original/private candidates. Changes outside the reviewed owner set fail closed.
- Fixed service list with existing Approval Center issuer reload, restart and systemd health checks. No generic user-supplied service, path or shell.
- **Fail-closed dependency:** an independently reviewed, root-owned MCP discovery probe must positively observe the expected tool. A missing probe or unobserved tool denies completion.
- No new installer engine, signer or standalone service. The existing native filesystem transaction and one-time Ed25519 Approval Center remain the only proposed execution path.

### Controlled prerequisites NOT included as successful installation

- The protected fixed-path Git object store and staged-asset tree must be provisioned by the authenticated Provider Root-of-Trust bootstrap; the hook constructor fails if absent.
- The separate `shared-registrar-mcp-discovery-probe-v1.cjs` and pinned release manifest/asset list are NOT YET provided or tested with a real MCP runtime; no tool discovery can be declared.
- Real four-systemd tests below use **mock PRHM service processes**, not genuine private service binaries/dependencies or a cloned production config. They prove systemd restart, AF_UNIX health, exact bytes and recovery semantics on a hosted VM, not live provider restart/operation.
- No independent approval of this final source SHA, no signed action-specific Level-4, no Provider-console transaction, and no Production changes.

## Reproducible verification

- GitHub workflow `.github/workflows/issue-221-root-trust-registrar-gate-ci.yml` runs `test-shared-registrar-native-host-hooks-v1.cjs` with exact-SHA and negative trust-store gates.
- Ubuntu Linux CI executes `test-shared-registrar-four-systemd-vm-v1.cjs` **as root only on a GitHub-hosted VM**, refusing production paths. It registers four disposable real systemd units, validates four independent process IDs and Unix sockets, injects a bad candidate, and verifies rollback of all four files, owner file mode, healthy service restarts, and `ROLLED_BACK` journal. Cleanup stops and removes test units.
- Existing tests verify SIGKILL recovery, asset transaction journaling and no retry after unverified rollback.
- The private Windows test `test-registrar-private-four-owner-package-v1.cjs` passed all four real candidate SHA checks. This private test is not run in public CI because the owner bytes are not in the repository.

## Exact independent review gate

Reviewer `mohammadyours` should inspect **the final SHA of this PR**, pin all source/builder/manifest object IDs and review the full private owner diffs through the trusted workspace. This PR should remain **Draft / NO-GO** until a complete immutable manifest, bound signed L4 path, real MCP discovery and Provider VM evidence exist. A change to source after approval invalidates approval for a later release commit. GitHub CI PASS is not a security approval.
