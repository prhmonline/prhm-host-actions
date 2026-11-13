# U06: independently owner-signed first registration of the native Root action

**Status (13 November 2026): source-only, NOT installed, not authorized, U06 open.**

## Last live evidence

- Host: `prhm-production.prhm.ir`, Root via authorized Remote Desktop Commander.
- Exactly four existing owner SHA256 preimages match production:
  - Agent API: `57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530`
  - Root Executor: `4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169`
  - MCP: `0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef`
  - Approval Center: `26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5`
- Reviewed fixed U06 policy SHA256: `aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934`, size 32,036 bytes.
- Approved trusted owner **public** key on existing root authorized_keys, mode 0600, is uniquely `codex-windows` with fingerprint `SHA256:WEd6aCEVqn+FE6Yx8sTWBUfmsbKwNxz70M+x+HZsr0Q`.
- Actual signed-install dry review of Git SHA `8ffed3fe1ad8306f8ca207c5d2a7ae0a6904b020`: **PASS** for 22 verified source blobs, 15 native assets, 4 owner proposed SHA, JavaScript candidate syntax, policy JSON, Python3.11 worker syntax and unsigned request schema. The reviewed source commit is **provisional**; pin the actual merged Git SHA when releasing, never a mutable main/branch name.
- All four initial PR #288 CI workflows PASS. Any subsequent edit requires CI rerun.

## Procedure (only when owner is present and window for restart is approved)

**No installer or Root bridge may sign on behalf of the owner, synthesize a consent token or invoke the existing generic Level-3 installer.**

1. From the immutable **merged** Git SHA, stage the approved source tree and 15 native asset bytes in a root-owned private `/var/tmp/u06-owner-reviewed-<random>` (0700). Verify every staged file's Git blob against that exact commit and chmod each to 0600. Source must include `honartik-u06-signed-four-owner-installer-v1.cjs`, `honartik-u06-real-four-owner-registration-plan-v1.cjs`, `honartik-u06-owner-signed-bootstrap-proof-v1.cjs`, `honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs` and the preview dependencies. No changes to the four live owner files or database during staging.
2. Use the staged reviewer's `Installer.review({sourceCommit,stagedPath})`. Check 4 SHA preimages, 15 assets, absence of unclosed prior transactions, and review the 4 new SHA postimages.
3. Immediately before independent signing, generate canonical UTF-8 manifest bytes using `Installer.generateFreshOwnerSigningRequest({sourceCommit,stagedPath})`. Write them to a root-private 0600 `owner-manifest.json`; do not mutate the manifest after generation. The signed authorization **expires in under 3 minutes**.
4. Securely transfer **only** the unsigned `owner-manifest.json` to the owner's Windows machine. The owner should independently inspect source SHA, exact four owner SHA postimages, fifteen asset SHA digests, `host`, `action`, `level-4 policy postimage`, TTL and nonce. On the Windows system, the owner manually issues a detached OpenSSH Ed25519 signature with the **pre-existing** key whose public fingerprint matches the pinned root authorized key:

   ```powershell
   ssh-keygen -Y sign -f "<PATH_TO_EXISTING_OWNER_PRIVATE_KEY>" -n prhm-u06-owner-bootstrap-v1 .\owner-manifest.json
   ```

   This produces `owner-manifest.json.sig`. **Do not share the private key or copy it to the server/ChatGPT.** Do not run this automatically from the Root host, agent, or CI. The user must perform or explicitly authorize this independent step.
5. Return `owner-manifest.json.sig` to the same root-private staging folder using an authorized secure transfer and chmod to 0600. The trusted operator invokes the exact Git SHA-pinned `Installer.applyOwnerSigned({sourceCommit,stagedPath,manifestBytes,signatureArmor})` within the TTL. The source verifier checks SHA closure + existing owner public-key fingerprint and genuine OpenSSH SSHSIG before any bootstrap write.
6. Upon valid owner signature, code creates root-only `WORK_ROOT=/var/lib/prhm-agent-selfmaint-exec/honartik-u06-bootstrap`, burns the one-use signed nonce with `O_EXCL` + fsync, and uses the existing `honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs` to durably snapshot all four preimages and 15 asset preimages. It atomically swaps the exact reviewed four owner sources + new native assets, restarts exactly `prhm-company-approval`, `prhm-agent-selfmaint-exec`, `prhm-agent-selfmaint`, `prhm-agent-mcp-blue`, and `prhm-agent-mcp-green`, and confirms postimage SHA/service health and official U06 Level-4 policy registration. Any failed postflight invokes SHA-exact rollback and service recovery; unfinished crash journals remain for trusted `recoverInterruptedInstall({transaction})`, never silently overwritten or ignored.
7. Check registration from real Agent 3 via exact `host_action_v2_request` (previously `host_action_v2_not_allowed`) with a non-mutating request; absence of that denial proves registration but **not** permission to execute native backup.

**Important separate gate:** Owner SSHSIG above only bootstraps registration of the *new operation*. It is **not** the official one-time signed Level-4 `authorize-consume` approval for performing U06 itself. After registration, the real Root action must still obtain/consume the official Level-4 receipt, independently verify Ed25519 + consumed ledger, burn durable no-replay fence, and validate the separately sealed owner GitHub OIDC evidence. Only then may it provision the MariaDB backup account and perform native Production backup + 69/49 financial restore + fresh native Node1 restore. U06 remains OPEN until actual recovered evidence is verified.

## Fail-safe rules

- Never use Host Action Level-3 installer as alternative authorization.
- If 4 owner SHA, policy candidate SHA, asset blob SHA, signed manifest scope, expiry, public fingerprint or any postflight differs, fail closed.
- Do not generate a signing manifest days/hours ahead: TTL is deliberately very short.
- Never call Root apply using synthetic signed claims, test fixture credentials, hardcoded passwords, or an arbitrary caller-selected SQL/path.
- Never run Yii migrations, Apache cutover, backend deploy, or mutate user orders/financial rows.
- If the Windows owner machine remains offline, stop after the read-only reviewed package and green CI. Never claim Root installed.
