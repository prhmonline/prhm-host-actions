#!/usr/bin/env bash
# MoeinShow QR offline acceptance: run in an isolated checkout, never on live Production.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
test -f app/tests/contract/TicketQrContract.php
test -f app/views/admin-reserve/print-ticket-new.php
test -f app/views/admin-reserve/_print-ticket-mpdf.php
echo "MOEINSHOW_QR_TEST_MODE=isolated-offline"
php -l app/views/admin-reserve/print-ticket-new.php
php -l app/views/admin-reserve/_print-ticket-mpdf.php
php -l app/modules/api/views/public/print-ticket-new.php
php -l app/tests/contract/TicketQrContract.php
php -d allow_url_fopen=0 -d display_errors=1 \
  -d disable_functions=curl_exec,fsockopen,pfsockopen,stream_socket_client,exec,shell_exec,system,passthru,proc_open \
  app/tests/contract/TicketQrContract.php
test -f vendor/autoload.php || { echo "MISSING_VENDOR: Run only in a sandbox checkout with installed dependencies" >&2; exit 21; }
php -d allow_url_fopen=0 -d display_errors=1 -d memory_limit=256M \
  -d disable_functions=curl_exec,fsockopen,pfsockopen,stream_socket_client,exec,shell_exec,system,passthru,proc_open \
  app/tests/contract/TicketQrContract.php --runtime
echo "MOEINSHOW_TICKET_QR_OFFLINE_PASS"
