# RahKomak web-only Host Action — fixed registration candidate

## Verified application binding

- Application: /home/prhm/projects/generated/rahekomak
- Branch: main, clean at last validation
- Exact app commit: c89241e415a093f9c07782ce156b51c7019368c5
- Exact helper: infra/docker/web-only-release-v1.cjs
- Helper SHA-256: bf901961635986ff917bade164610ecc80cd3e9ebb549ef79ecc9efecce41320
- Action: rahekomak_web_only_release_v1
- Registration operation: rahekomak_web_only_registry_install_v1

The earlier candidate pointed at pre-fix commit e628baa. Its binding has been replaced without broadening the target scope.

## Read-only live preflight

All four preimage SHA-256 values currently match the trusted installer:
- /opt/prhm-agent-selfmaint/server.js — 4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406
- /opt/prhm-agent-selfmaint-exec/server.js — 410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0
- /home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js — bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166
- /opt/prhm-company-control-plane/config/approval-policy.json — 148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174

The four target services were active at validation. The candidate's read-only preflight succeeded after updating application and helper SHA. No database, website, Apache or API changes are part of the registration.

## Remaining authorization boundary

The installer deliberately lacks a standalone --apply mode. The live Agent 3 action list does not currently contain rahekomak_web_only_registry_install_v1 or rahekomak_web_only_release_v1. This candidate cannot be applied simply by running it as root or by setting approval booleans: a separately authenticated native Level-4 installer/mediator must verify and atomically consume an explicit, signed, one-time scoped approval and preserve rollback. If no native registration bootstrap is available, STOP and report the blocked trusted boundary rather than bypassing it.

This first fixed release action is bound to one exact application commit; a future generic update workflow will need an independently reviewed per-request SHA-bound approval protocol, not replacement of application SHA constants or reinstallation of the registry for each routine web change.

## Safety acceptance

- The registry candidate updates only four pinned control-plane files.
- Exact backups and rollback-on-failure are part of the transaction.
- No generic command, path, SQL or URL input is accepted.
- Critical production registration has NOT been applied by this commit.
