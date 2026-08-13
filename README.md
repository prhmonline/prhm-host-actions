# PRHM Host Actions

Private control-plane bootstrap repository for fixed, approval-bound host actions.

- No arbitrary root shell
- Level-4 approval required for critical host mutations
- Fixed allowlisted actions only
- Automatic verification and rollback required
- LeadOps language gate is a fixed no-input action; ambiguous translation directions fail closed to MANUAL_REVIEW
