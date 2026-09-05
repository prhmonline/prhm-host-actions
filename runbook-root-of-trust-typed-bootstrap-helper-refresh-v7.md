# Root-of-Trust Typed Bootstrap Helper Refresh V7

Provider/VM Console only. Do not execute through SSH, MCP, Agent 2, DeployHQ, or application runtime.

Immutable seed commit: `76dd91aff09827dbd334d77fdb392de5375e1fc0`
Seed SHA-256: `b48b7b04f750aef13acac1fa390b1acc5cb8b7003e9c15887a78172e87a59358`
Expected preimage: `80ce1b2d3a53d45a750035a2ff5c8c67f1e31695e08fd41c8f980d7c7109725a`
Expected candidate: `3388ae690dcb3bf8b5fb2da8d9e489e5169f298d1bc4d74e7d6d66403eba9bf9`

The seed performs one SHA-bound helper replacement with backup, syntax/health verification, and rollback on failure. It does not restart services or mutate databases, applications, policy, or registry state.
