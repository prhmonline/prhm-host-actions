# Root-of-Trust Typed Bootstrap Helper Refresh V6

Provider/VM console only. Do not execute through SSH, MCP, Agent 2, DeployHQ, cron, or application code.

Immutable seed commit: `d2d069e83d08f376741b4711d6590c2aec97538d`
Seed SHA-256: `802703e1ecec146848c9cc4b678d8e54ac5167b0dbc0dad3a0b4391dac3a25b1`
Expected preimage: `c29846353a4f6e1bdff04cdc213e4db062238e418da6db5a276fb56188939618`
Expected candidate: `80ce1b2d3a53d45a750035a2ff5c8c67f1e31695e08fd41c8f980d7c7109725a`

The seed changes only `/opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js`, verifies exact preimage, syntax, executor health, backup, atomic replacement, post-SHA, and rollback.
