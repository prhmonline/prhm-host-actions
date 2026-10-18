# iTicket worktree Level-4: reconcile against PRHM actual approval issuer protocol

**Date:** 2026-10-18  
**Status:** SOURCE-WIRE COMPATIBILITY TESTED; LIVE ISSUER IDENTITY AND CONSUMPTION NOT ATTESTED.  
**No new approval, service restart, database change, or production mutation.**

## Verified source discovery

Inspected the connected source repository **prhmonline/prhm-company-control-plane** on `main`:
- `approval/server.js` Git blob `62c4e3b565fb55c195efbde3b92a948fa68564bd`
- `config/approval-policy.json` Git blob `7e7d22bee0156e4fa3def84b3739f84e8b614bcd`.

The checked-in policy is **not identical to the separately on-host SHA-pinned live policy**. Specifically the Git policy version is `2026-10-12.1-policy-git-live-reconciliation-v1`, while the root-operated policy check reported `2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1`. A Git source read alone cannot attest the running service's binary or full policy.

Issuer Git source behavior:
1. `signClaims` uses a three-segment header.payload.signature token; header `alg=EdDSA,typ=PRHM-COMPANY-APPROVAL,kid=first16(sha256(SPKI-DER public key))`. It signs the **exact two base64url segments**, not canonicalized arbitrary JSON.
2. Typed request uses `arguments_sha256=SHA256(canonicalJson(input.arguments minus approval_token))`; input scope fields are principal/role/tool/project/environment/action/risk/operation, all allowlisted.
3. Approval claims contain `jti`, `approval_id`, `request_id`, `arguments_sha256`, operation/scope, `policy_version`, `policy_hash`, `iat/nbf/exp`, `one_time_use:true`, and `rollback_reference_hash`.
4. Level4 `second_confirmation='CONFIRM_LEVEL_4_CRITICAL'` is required during the decision, NOT independently authenticated in the signed claims as a boolean. Verify the authoritative issuer request and approval records for it.
5. `/v1/consume` uses `approval_token`, signature/claims and protected issuer records, checks policy drift/revocation/expiry/typed scope, and uniquely creates a consumed receipt with `wx`. Offline signature verification is **not** a one-time-consumption guarantee.

**Correction:** Earlier proposal `honartik-iticket-root-four-owner-signed-grant-contract-v1.cjs` verifies a *new proposed canonical JSON signature* and is not the issuer's on-wire token; **do not use it for deployment**. The new source-derived protocol verifier does not authorize production either.

## Read-only adapter and test evidence

- `honartik-iticket-real-issuer-jws-readonly-contract-v1.cjs`: source-based EdDSA wire verifier with pinned four owner pre/post SHA, critical Level4 operation, canonical arguments hash, rollback reference and expiry. [Offline synthetic-key tests 37/37 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39127477951). The test key is disposable, **not live trust root**.
- `honartik-iticket-approval-center-live-identity-readonly-v1.cjs`: fixed `GET http://127.0.0.1:18133/health` plus fixed PUBLIC Ed25519 SPKI key from `/var/lib/prhm-company-approval/ed25519-public.pem` and root-owned `/opt/prhm-company-control-plane/config/approval-policy.json`. Compares SHA256(SPKI-DER) `key_fingerprint`, SHA256(JSON.stringify(policy)) `policy_hash` and `policy_version`, with descriptor trust/no-follow checks. [Offline synthetic fixture tests 21/21 PASS](https://github.com/prhmonline/prhm-host-actions/actions/runs/39127739687); independent SHA of this inspector printed by CI: `afb869a0e5d5f4715142dcb609c0a1ac4dd0f5495f1e943de2c6050d14b8bddb`.
- The live identity inspector is designed for an explicitly **read-only** root-run check, and prints neither key PEM nor private secrets/tokens. It does **not** issue/validate/consume an approval.

## Gates still open

- Execute the independently SHA-verified read-only issuer identity inspector on the host, confirm current **public** key fingerprint + effective policy hash from health; don't read any private key/token.
- Attest actual **running** issuer source binary provenance, effective Level4 human decision + second confirmation + one-time replay rejection for the **exact bound worktree action** without consuming a real approval prematurely.
- Build and permission-equivalent-test a **trusted** signed four-owner privileged disk adapter. Existing scratch-only kernel flock/journal suites are GREEN, but no privileged signed adapter currently exists, and the legacy installer is P0 unsafe.
- The proposed worktree dispatcher remains inert. Even when registered it does not constitute Honartik iTicket payment release, migrations, Saman/SEP, wallet or SAMFA validation.

**No Production mutation; no approval created or consumed.**
