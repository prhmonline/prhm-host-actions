# U06 concrete native Root L4 consumed receipt and fsynced replay fence

**Source developed 2026-11-11. Not installed to production.**

The live Host Action request for `honartik_u06_native_backup_register_v1` returned
`host_action_v2_not_allowed`; production selfmaint has 36 registered v2 actions
and U06 is **absent**. No existing Level 3 generic action may be substituted.

New `honartik-u06-native-root-l4-admission-v1.cjs` provides two **real**
native capabilities for the established 16-method U06 Root contract:
`verifyNativeConsumedSignedLevel4(F,journal)` and
`reserveNativeLevel4ReplayFence(F,journal,approval)`.

The live constructor requires root UID and the fixed host; reads **only**
the fixed root-owned Approval Center issuer key, exact SHA-pinned approved
policy `aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934`,
and a root-owned previously consumed ledger for a signature-verified exact U06
one-time Level 4 receipt. All parents and leaves are checked for symlinks,
owners/modes/inode races; the consumed ledger must be 0600. No untrusted
path or caller-selected issuer key is accepted in production.

The one-time replay record is created via `O_CREAT|O_EXCL|O_NOFOLLOW`, mode
0600, fsync(file) and fsync(directory); failed writes are not unlinked.
The test actually generates Ed25519 keys, seals real official-style receipts,
writes and reads actual consumed ledger files, rejects forged signatures,
wrong L3 scope, mutated ledger/symlink/receipt, and SIGKILLs a child immediately
after replay-fence fsync. A second invocation cannot reuse that approval.
All tests run with **disposable unprivileged /tmp** paths.

**Still required for executable U06:** installation and review of the
Root owned U06 L4 policy, trusted access to a sealed token from the existing
Root Executor (no arbitrary provider token), exact 4-owner registry patch
and real wiring, 14 other real native methods (including financial data and
fresh offsite Node1 restore), signed live approval and Production restore.
No app deploy or Yii migration.

Source-only GitHub CI does not authorize or prove a Production backup.
