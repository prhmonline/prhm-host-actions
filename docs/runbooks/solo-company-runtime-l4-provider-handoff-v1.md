# Solo Runtime – signed registration production acceptance

Status: **NO-GO / source reviewed, not installed**. This is not a root installer, approval receipt or signing authority.

## Immutable identities

- First registration: host_action.solo_company_runtime_registration_v1
- Distinct runtime install after registration: host_action.solo_company_runtime_install_v1
- Dark release SHA: 0eb43d72aab3f10db22172c8be4c0411cf22d074
- Source: sshagent PR #60, commit 02966549a751c16b582ce17d15a1e2cf8a22f0fb
- Registration/helper source: prhm-host-actions PR #232
- Six exact source and destination SHA pairs: solo-company-runtime-l4-registration-manifest-v1.json

## Verified and not verified

- Real production six-preimage read-only SHA check: PASS.
- Real server, in-memory simulated midflight fault/rollback: PASS.
- Real Linux filesystem, disposable six-file atomic commit and two rollback scenarios: PASS.
- Real Provider-signed receipt verification, real production six-file registration, service restart, and real production Runtime install: **NOT PERFORMED**.

## Blocking trust prerequisite

Provider must independently pin and install the legitimate production Ed25519 trust anchor for THIS registration action; never invent a test signer or reuse a receipt from another action. The reviewed server had an inactive prhm-openai-provider.service and no public key at /var/lib/prhm-agent-selfmaint-exec/root-of-trust/provider-bootstrap-ed25519-public.pem. This verifies only that checked trust route; Provider must attest its canonical one.

## Exact authorized installer contract

1. Independent security review of PR #60, PR #232, manifest and existing native filesystem transaction implementation.
2. Provider issues an authenticated, canonical, critical Level-4 one-time signed receipt binding the six pre/post SHA values and both pinned Git source commits; consume receipt durably before any file mutation.
3. Trusted root installer verifies all source identities, file types, owners, modes and exact live preimages, then fsyncs all six snapshots, journal and backups.
4. Write all six exact postimages atomically; restart/reload only through audited allowed service controls, and require healthy Approval, Executor, MCP router, and policy.
5. Before COMMITTED, re-verify every postimage. On failure or restart interruption restore all before-images and absent worker state, then independently reverify service health.
6. Only after registration succeeds, create a NEW one-time critical approval specifically for solo_company_runtime_install_v1. Invoke the SHA-pinned worker, not the old MCP /etc write flow.
7. Verify Runtime port 8782 health, active/enabled, dark-mode zero queue and scheduled jobs, no exposed credentials, restart/persistence, and isolated recovery/rollback evidence.

Do NOT copy the candidate files over live /opt or /etc paths or weaken ProtectSystem as a workaround. Provider signing is an external trust boundary that this source package cannot bootstrap by itself.

## Provider receipt reference and acceptance evidence

Source-only verifier: solo-company-runtime-provider-signed-receipt-v1.js. The verifier requires an independently pinned Ed25519 public key, canonical compact signature, exact root registration operation, exact six-file plan hash, two immutable source commits, release SHA, a valid UUID request ID, a critical Level-4 receipt with a maximum 180-second lifetime and a durable, consumed-once marker. It contains no production signer or CLI. Tests generate only disposable synthetic Ed25519 keys and verify tampering rejection, expiry and replay rejection. This is not production trust provisioning.

Provider must make available its canonical trusted key fingerprint and separately authenticated, authorized Provider bootstrap dispatcher. Neither should be provisioned by the MCP process, this candidate generator or a shell command supplied from ChatGPT. The role of the provider is a distinct security boundary; an active company approval service does not establish authorization for Provider Root-of-Trust registration.
