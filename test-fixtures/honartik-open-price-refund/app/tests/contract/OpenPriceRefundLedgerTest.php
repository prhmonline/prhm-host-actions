<?php
declare(strict_types=1);
require_once dirname(__DIR__, 2) . '/modules/finance/services/OpenPriceAmount.php';
require_once dirname(__DIR__, 2) . '/modules/finance/services/OpenPriceLedger.php';
require_once dirname(__DIR__, 2) . '/modules/finance/services/OpenPriceRefundLedger.php';

use app\modules\finance\services\OpenPriceLedger;
use app\modules\finance\services\OpenPriceRefundLedger;

$cases = [
    ['base_only', 400000, 400000, 2, 400000, 0],
    ['base_and_extra', 400000, 1000000, 4, 400000, 600000],
    ['zero_base_extra_only', 0, 1000000, 2, 0, 1000000],
    ['zero_total', 0, 0, 0, 0, 0],
    ['max_toman', 1, 9999999999999, 4, 1, 9999999999998],
];
$passed = 0;
foreach ($cases as [$name, $minimum, $chosen, $rowCount, $base, $extra]) {
    $collected = OpenPriceLedger::rows($minimum, $chosen, 42, '127.0.0.1', 'Event', 123456);
    $refunded = OpenPriceRefundLedger::rows($minimum, $chosen, 42, '127.0.0.1', 'Event', 123456);
    if (count($collected) !== $rowCount || count($refunded) !== $rowCount) {
        throw new RuntimeException('Refund rows count mismatch: ' . $name);
    }
    $refundedUser = $refundedHouse = 0;
    $roles = [];
    foreach ($collected as $i => $row) {
        $refund = $refunded[$i];
        if ($refund['amount'] !== -$row['amount'] ||
            $refund['user_id'] !== $row['user_id'] ||
            $refund['metadata']['open_price_refund_role'] !== $row['metadata']['open_price_role']) {
            throw new RuntimeException('Refund fails exact reversal: ' . $name);
        }
        if ($refund['user_id'] === 42) {
            $refundedUser += $refund['amount'];
        } elseif ($refund['user_id'] === 0) {
            $refundedHouse += $refund['amount'];
        } else {
            throw new RuntimeException('Unexpected recipient: ' . $name);
        }
        $roles[$refund['metadata']['open_price_refund_role']][] = $refund['amount'];
    }
    if ($refundedUser !== $chosen || $refundedHouse !== -$chosen ||
        $refundedUser + $refundedHouse !== 0 ||
        ($base > 0 && $roles['ticket_base'] !== [$base, -$base]) ||
        ($extra > 0 && $roles['voluntary_extra'] !== [$extra, -$extra])) {
        throw new RuntimeException('Refund conservation failure: ' . $name);
    }
    $passed++;
}
foreach ([[-1, 1], [400, 399], [0, 10000000000000]] as [$minimum, $chosen]) {
    try {
        OpenPriceRefundLedger::rows($minimum, $chosen, 42, '127.0.0.1', 'Test', 1);
        throw new RuntimeException('Invalid refund values were accepted');
    } catch (InvalidArgumentException $expected) {
        $passed++;
    }
}

// Separate structural safety checks assert this exact feature opt-in branch is
// routed away from the legacy non-atomic FinanceWallet::inc cancellation path.
// They do NOT prove a production DB integration or actual SEP refund.
$src = file_get_contents(dirname(__DIR__, 2) . '/modules/api/controllers/ReserveController.php');
$service = file_get_contents(dirname(__DIR__, 2) . '/modules/finance/services/OpenPriceCancellationService.php');
if ($src === false || $service === false ||
    !str_contains($src, 'new OpenPriceCancellationService()') ||
    !str_contains($src, 'open_price.confirm.ticket_missing_review') ||
    !str_contains($service, 'FOR UPDATE') ||
    !str_contains($service, 'OpenPriceRefundLedger::rows(') ||
    !str_contains($service, 'seller_settlement_already_attached') ||
    !str_contains($service, 'original_wallet_rows_not_balanced') ||
    !str_contains($service, '$transaction->rollBack()') ||
    !str_contains($service, '$transaction->commit()') ||
    !str_contains($service, 'refund_row_already_present') ||
    str_contains($service, 'FinanceWallet::inc(') ||
    str_contains($service, '->rollBack(' . '$tid')) {
    throw new RuntimeException('Open-price atomic-cancel feature routing contract failed');
}
$passed++;
echo "OPEN_PRICE_REFUND_LEDGER={$passed}/{$passed} PASS\n";
