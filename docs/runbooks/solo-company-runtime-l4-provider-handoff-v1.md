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

## Clarification: OpenAI Provider is NOT the Root signer

The unit `prhm-openai-provider.service` has description `PRHM OpenAI Responses Provider Adapter`. It is an OpenAI API integration and **not** the Provider Root-of-Trust signing service; its inactive status alone is irrelevant to Root bootstrap. The active `prhm-company-approval.service` and `prhm-root-scripts-stage-mediator-v1.service` are the relevant installed approval components. The mediator is deliberately fixed to the distinct operation `host_action.control_plane_installer_refresh_root_stage_v1` and does not authorize Solo Runtime registration. A real attempt to request `solo_company_runtime_registration_v1` through the existing Host Action v2 registry returned `host_action_v2_not_allowed`. Do not repurpose a receipt for another operation.

The Windows RDC computer visible in this environment runs under account `parham`. Its mere connectivity does not establish that it is a trusted independent signer controlled by the infrastructure owner; no private key should be generated on it without explicit ownership attestation and a signing policy.

The signed-to-native bridge `solo-company-runtime-native-registration-bridge-v1.js` is **source only**. It converts the exact pre/post SHA manifest into the already-tested native durable filesystem transaction and preflights a signature but cannot execute or mint authority. Final signoff still needs an out-of-band owned trust anchor and an independently validated signed, one-time operation-specific Root dispatcher. No API or user chat instruction can silently create that trust authority.

## 2026-11-03 verified status and separate Universal Installer admission gap

Operational Solo Company Runtime **IS installed** on `prhm-production`; its emergency deployment acceptance is in PR #233 at `docs/acceptance/solo-company-runtime-production-20261103.md`. Live unit remains active and enabled; health HTTP 200, original release SHA `0eb43d72aab3f10db22172c8be4c0411cf22d074`; production is deliberately dark with zero queues. The previous 'runtime not installed' status in some earlier comments is historical and superseded.

Read-only official registration preflight was repeated after the runtime install at this PR's HEAD `8c50d55883382db80e6dc4cd8d6763f5ae06ba9b`: **six live preimage hashes PASS**, exact postimage SHA plan PASS, in-memory fault injection and rollback PASS; 20 Node contract tests PASS. `PRODUCTION_CHANGED=FALSE`. All four registry/dispatcher targets are still unregistered and the official single-use signed L4 installation is **not** executed.

**Universal Installer and Host Actions V2 are distinct.** The installed Universal engine lives under `/usr/local/libexec/deploy-control/universal/current` and uses protected project profiles under `/etc/deploy-control/projects`. There is currently NO `solo_company.production.json` profile. Current engine config requires repository-backed service adapters `static/node/php/compose`, Node candidate unit/ports, and health entries with HTTPS URLs; the current Solo Runtime is a loopback-only, separately-owned stateful daemon on `127.0.0.1:8782`. Simply registering `solo_company_runtime_install_v1` in Host Actions V2 would NOT make Solo a managed Universal Installer deployment. A reviewed service-adoption adapter and an immutable Solo profile with explicit persistent data, health and rollback semantics are required. Do not invent a public route or expose Solo's loopback health endpoint just to satisfy the current public HTTPS requirement.

**Two independent outstanding gates:** (A) trusted Provider-owned signed L4 Root registration and independent security code review for PR #60 / PR #232; (B) Universal Installer architecture support and profile for adopting an already-running stateful Solo service, without destructive redeployment. Neither may be represented as complete by the successful emergency installation.

The correct production acceptance at this stage is **Operational Solo: PASS; signed Host Action registration: NO-GO; Universal managed adoption: NO-GO**. The user has already authorized the successful one-time emergency install; do not request a repeat emergency install just to make the registry look complete.
