# PRHM Host Actions

Private control-plane bootstrap repository for fixed, approval-bound host actions.

- No arbitrary root shell
- Level-4 approval required for critical host mutations
- Fixed allowlisted actions only
- Automatic verification and rollback required
- LeadOps language gate is a fixed no-input action; ambiguous translation directions fail closed to MANUAL_REVIEW
- MCP candidate schema compare is a fixed no-input Level-4 action; it compares ephemeral baseline/candidate MCP tool schemas on ports 8125/8124 with a temporary bearer token and never reads production MCP credentials
