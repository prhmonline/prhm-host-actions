# Honartik U06 — Root recovery lease and ambiguous commit control

**2026-11-11 — source implementation and actual Linux SIGKILL test; NO live Root installation.**

## Critical correction

The previous `honartik-u06-owner-native-transaction-v1.cjs` called
`releaseU06Lock()` in `finally` even when the rollback journal could not
be verified. That could permit re-entry after a failed/ambiguous transaction.

The coordinator now keeps the lease when:
- journal preparation / durability has an unknown result;
- rollback fails or its exact preimage cannot be verified;
- `commitDurableJournal()` throws or returns false (commit might already be durable).

A *verified* rollback or a verified successful commit may unlock. If owner
identity fails before journal preparation it may also unlock. If a previously
used owner receipt is rejected after the journal is durable but before
mutation, it requires verified rollback of the prepared journal before unlock.

An ambiguous commit MUST NEVER trigger a speculative rollback of a
possibly committed MySQL/offsite transaction.

## Real on-disk primitive

`honartik-u06-native-root-lease-v1.cjs` provides actual OS operations:
O_EXCL/O_NOFOLLOW lease creation, root-private 0700 directory enforcement,
0600 files, O_RDONLY fsync on parent, SHA-pinned profile and installed
adapter reads, durable PREPARED journal with original profile bytes, verified
ROLLED_BACK journal, and refusal to unlock PREPARED or drifted states.

The Linux test `test-honartik-u06-native-root-lease-v1.cjs` executes
a **real SIGKILL** after journal fsync: a separate process observes the
retained lease and cannot restart the same U06 work. All work happens in
unprivileged /tmp/u06-root-lease-test-* directories, not Production.

The live constructor requires the correct root host and an existing 0700
root-owned directory. **No directory is installed by importing the module.**

## Remaining gate

This is a concrete FS lease/journal implementation, not all 14 native
capabilities. In particular it cannot create a MySQL account, run the
installed Universal backup, verify real finance/offsite restore, or authorize
commit/deploy. It has `ROOT_ACTION_REGISTERED=false` and
`COMMIT_IMPLEMENTED=false`. The future trusted Root handler must supply
a separate exact-scope signed L4 authorization and actual native MariaDB +
Restic recovery capabilities before any U06 production mutation.

Do not install this package via an unrelated Level 3 Host Action, or
mistake GitHub OIDC identity for a consumed Approval Center L4 receipt.
Separate U03/U05 release gates remain untouched.
