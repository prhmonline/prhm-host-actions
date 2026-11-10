# U06 — immutable host preimage collection for native Root binding

This **read-only** audit is the missing precursor to a separately reviewed
exact-SHA Root registration package. It is NOT the installer, not a Host Action,
not an approval issuer and not a reason to deploy Backend.

Confirmed on live root console on Nov 10:
- Host: prhm-production.prhm.ir
- Production profile SHA: 79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698
- Installed Universal database adapter SHA: d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3
- offsite_required=false; native mysql.cnf absent; prhm-agent-selfmaint-exec.service active.

The script obtains metadata + SHA256 **only** from the four root-registration
owners: Agent API, Executor, MCP registry and Approval Center policy. It never
reads or emits MySQL secrets and cannot apply a change. Once pinned live owner
SHAs are collected, separately review an installer that:
(1) installs exactly the U06 dedicated root dispatch, (2) accepts only
direct owner GitHub-signed one-use OIDC, (3) journals before any mutation,
(4) registers exact typed action in the existing host framework, (5) verifies
restarts, rollback and four-owner integrity and (6) proves actual native
Production backup, offsite and independent finance/restore in a separate stage.

Strictly forbid shortcutting the existing gate through another registered
Host Action. Registration does not authorize Backend publish or migration.

Run on the user-controlled root console only after verifying the trusted
Git commit and file bytes. Command:

    python3 scripts/u06/u06_root_registration_preflight_v1.py --audit

No --install, --register or --apply entrypoint exists.
