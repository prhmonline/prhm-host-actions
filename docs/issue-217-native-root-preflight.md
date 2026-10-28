# Issue 217: native Linux root preflight only

This is a READ-ONLY, SHA-pinned, root-gated preflight proposed as one building block for a future trusted Root Adapter. It is NOT the missing native execution/registration implementation, an approval issuer, or a deploy tool.

- Checks the existing central Installer symlink, bundle-byte digest, root-owned wrapper and manifest and expected registered Honartik config digest.
- SHA-pins the exact candidate archive, but does not independently attest the candidate's signed provenance or installed byte closure.
- SHA-pins the four live owner files; a changed owner file must fail closed rather than silently accept drift.
- Exports no installation or registration method and cannot mint, verify, consume, replay or approve Level-4 receipts.
- Contains negative tests for manifest mismatch, path re-routing and non-registration.

Tests: node --test test-honartik-universal-installer-native-root-preflight-v1.cjs

Critical remaining work for production: reviewed native registration and real privileged binding, signed independent Linux provenance, policy-vs-live SHA reconciliation, trusted Ed25519 Approval Center issuer anchor and one-time consumption fence, durable journal and post-commit rollback, installer-only execution and postimage attestations.

Do NOT merge or deploy the PR solely on the preflight passing. The previous approvals on PR 218 do not cover this new code; request a fresh independent review.
