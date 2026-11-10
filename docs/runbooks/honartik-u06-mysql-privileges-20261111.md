# U06 MariaDB least-privilege identity — actual isolated integration

**2026-11-11. SOURCE + TEST ONLY.** This does not register U06, install
Root, create a Production DB account, or run a Production backup.

## Concrete scope enforced

The fixed \`honartik-u06-mysql-grants-v1.cjs\` verifier rejects any
grant set except:
- \`USAGE\` on \`*.*\` (may include only a limited MariaDB password hash or no auth suffix)
- exactly \`SELECT, SHOW VIEW, TRIGGER, EVENT\` on \`honartik_db.*\`
- principal exactly \`honartik_universal_backup\`@\`127.0.0.1\`

It fails closed on global or cross-schema rights, write/DDL privileges,
extra rows, duplicates, GRANT OPTION, host wildcard, unexpected auth
policies and control-character injection. No secret hashes are copied
to the returned report. Caller-provided grants are not a trusted
Production attestation: the future Root handler must query real
\`SHOW GRANTS\` itself and bind it to a one-use signed L4 receipt
and the fsynced U06 journal.

\`tests/u06/test_u06_mariadb_minimal_grants_integration.cjs\` creates
a throwaway pinned MariaDB 10.11 Docker container under \`--network none\`,
provisions the named account **inside that disposable database only**,
verifies live grants, queries a disposable finance-like row, proves
CREATE TABLE is denied and verifies that adding INSERT causes the U06
scope verifier to reject. Container is removed in \`finally\`.

This adds a real tested, non-Production MariaDB privilege boundary to the
existing native lease and adapter fixture. The installed Universal adapter
itself still needs independent Root authorization and direct on-host
backup/restore against the approved production source, with full finance
checks and Node1 recovery attestation. GitHub tests do not prove that.

**Production U06 remains OPEN.** No existing L3 Host Action grants this
work; do not use the generic installer action as an L4 shortcut.
