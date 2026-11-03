# Owner recovery without VM console — external GitHub OIDC (SOURCE-ONLY)

Purpose: replace the unavailable **Provider VM-console identity ceremony** with
an externally authenticated, observable GitHub protected-environment decision,
without using a root shell to self-approve its own trust-policy changes.

This is **NOT** a deployment path, signed PRHM Level-4 receipt, privileged
registrar, or an already authorized Universal upgrade. No server secrets are
copied into GitHub and no alternate Universal Installer is created.

## Exact immutable scope

- Repo: prhmonline/prhm-host-actions, ID 1332133091, owner ID 193396069.
- Trigger account: prhmonline (GitHub account ID 193396069).
- Required external reviewer: mohammadyours (GitHub ID 74255800).
  Both accounts are controlled by the same human, **so this is owner decision
  separation, not independent-person source security review**.
- Protected GitHub environment: prhm-universal-root-enrollment.
- Branch policy: **only** main; branch wildcard forbidden.
- Workflow: .github/workflows/universal-owner-recovery-oidc-v1.yml.
- Previous Universal digest: 47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181
- Candidate digest: 77c3615ef73faae847008665b683fe2cf63191faca215f46724097051b6b2c29
- Candidate archive SHA256: c3655739d104721ec8866a3e3762982fe43efacf4d3645dcd58b0bfbe8f0f5ec

## External identity flow (no enrollment has been executed)

1. On the root-controlled server, generate a fresh random 32-byte nonce and
   ephemeral X25519 transport keypair. Keep the private key and nonce in a
   root-owned 0700 temporary directory. This key only **decrypts** the
   externally issued credential; it is NOT a bootstrap signer.
2. Trigger the workflow on main using prhmonline with nonce hex and **public**
   X25519 DER/SPKI base64 (neither input is a secret). The workflow cannot
   execute before GitHub environment deployment review.
3. Using the distinct mohammadyours account, explicitly approve the pending
   environment deployment. This is an owner approval, **not** independent-human
   code security review, even though GitHub prevent_self_review is enabled.
4. GitHub Actions obtains a short-lived OIDC JWT. The workflow binds audience to
   exactly the nonce + candidate digest, encrypts it to the host transport
   key with X25519/HKDF/AES-256-GCM and uploads only **encrypted** bytes
   (one-day retention; no plaintext JWT in job output or artifacts).
5. Host decrypts the artifact and verifies GitHub's actual RSA signature
   against the current official OIDC JWKS, the expected immutable workflow SHA,
   repository/owner IDs, triggering actor, environment, exact audience and
   TTL. It independently fetches current GitHub environment reviewer/branch
   rules and the matching workflow run's recorded approvals. Admin-bypassed
   runs without an explicit mohammadyours APPROVED record must fail closed.
6. An independently reviewed, authorized native root-enrollment adapter must
   DURABLY CONSUME the nonce and JWT jti, pin exact installed owner SHA
   preimages and immutable archive bytes, then transactionally register the
   fixed action in the existing Agent API / executor / MCP / Policy.
   Require full service health and crash-safe four-owner restore/recovery.
   Neither this PR nor the OIDC JWT alone implements this native step.
7. **Only after** registered Host Action is discoverable should the official
   Approval Center issue a distinct fresh, one-use, signed Level-4 consent
   for universal_installer_backup_only_upgrade_v1. The actual installation must
   use the existing Universal Installer and verify rollback.

## Security gates / deliberate NO-GO

- No real native root registration implementation or independent-person security
  attestation is included. GitHub OIDC signature is a proof of *job identity*,
  not a PRHM Level-4 signature.
- GitHub environment currently reports can_admins_bypass=true. The verifier
  therefore REQUIRES a recorded APPROVED environment-deployment review, not
  merely a successful workflow and an environment name.
- If the environment is not configured, if any protected rule drifts, or if
  GitHub's public API/JWKS is unavailable, the gate rejects.
- GitHub OIDC JWT is short-lived. An expired token cannot be replayed; retry
  requires a fresh server nonce and a fresh GitHub protected approval.
- Do not commit transport private keys, JWS bearer tokens, Approval Center
  signing secrets, or root registration public-key replacement values.
- A root shell alone cannot mint external GitHub OIDC or a signed PRHM Level-4
  approval. Do not treat GitHub merge, ChatGPT approval, synthetics or
  callback-returned true as Production authorization.
- Use built-in unit tests:
  node --test test-universal-owner-oidc-recovery-gate-v1.cjs test-universal-owner-oidc-sealed-transport-v1.cjs
