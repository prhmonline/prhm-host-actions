# iMotion Target Registration V16 Design

## Goal
Register the real iMotion production surfaces as separate Agent/MCP targets without touching site content.

## Targets
- `imotion_marketing_front_prod`: static/Git root `/mnt/imotion-prod-vm/domains/imotion.ir/public_html`, remote `/home/imotion/domains/imotion.ir/public_html`. Validation requires directory, regular `index.html`, and `.git` directory.
- `imotion_sale_wordpress_prod`: WordPress root `/mnt/imotion-prod-vm/domains/sale.imotion.ir/public_html`, remote `/home/imotion/domains/sale.imotion.ir/public_html`. Validation requires regular `wp-config.php` without reading it and `wp-content` directory.

## Control-plane fixes
- Add fixed Level-4 action `imotion_marketing_targets_register_v2`; retain V15 action for audit history.
- Precreate `/var/backups/prhm-imotion-marketing-targets-v2` before `systemd-run` while retaining `ProtectSystem=strict`, `ProtectHome=read-only`, and other sandbox controls.
- Make `/v2/host-actions/status` pending-aware by checking persisted request evidence when no job exists; status does not delete expired requests.
- Keep MCP runtime refresh separate; install changes MCP source only and reports `mcp_refresh_required=true`.

## Safety
No iMotion production-root writes, WordPress DB/content/plugin mutations, redirects, canonicals, deploys, Git cleanup/reset/stash, external network, secret reads, or token reads. All control-plane source writes are SHA-bound, backed up, syntax-checked, and rolled back on failure.
