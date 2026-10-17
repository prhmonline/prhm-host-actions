<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/modules/finance/services/OpenPriceAmount.php';
require_once dirname(__DIR__, 2) . '/modules/finance/services/OpenPriceSettlementGuard.php';

use app\modules\finance\services\OpenPriceSettlementGuard;

$base = [
    'free_price_enabled_snapshot' => 1,
    'free_price_original_amount' => 400000,
    'free_price_minimum_amount' => 420000,
    'free_price_proposed_amount' => 420000,
    'free_price_gateway_amount' => 420000,
    'free_price_extra_amount' => 0,
    'bank_transaction_amount' => 420000,
    'bank_paying_amount' => 420000,
];
$withExtra = array_replace($base, [
    'free_price_proposed_amount' => 1000000,
    'free_price_gateway_amount' => 1000000,
    'free_price_extra_amount' => 580000,
    'bank_transaction_amount' => 1000000,
    'bank_paying_amount' => 1000000,
]);
$cases = [
    ['ordinary_order_not_affected', [['free_price_enabled_snapshot' => 0]], true, 'no_unallocated_open_price_extra', 0, 0],
    ['base_only_valid', [$base], true, 'no_unallocated_open_price_extra', 1, 0],
    ['string_valued_db_columns', [array_map('strval', $base)], true, 'no_unallocated_open_price_extra', 1, 0],
    ['voluntary_extra_held', [$withExtra], false, 'voluntary_extra_requires_allocation_review', 1, 580000],
    ['mixed_orders_held', [$base, $withExtra], false, 'voluntary_extra_requires_allocation_review', 2, 580000],
    ['two_extras_held_and_totaled', [$withExtra, $withExtra], false, 'voluntary_extra_requires_allocation_review', 2, 1160000],
    ['bank_amount_mismatch', [array_replace($base, ['bank_transaction_amount' => 419999])], false, 'open_price_bank_and_reserve_mismatch', 1, 0],
    ['bank_paying_amount_mismatch', [array_replace($base, ['bank_paying_amount' => 0])], false, 'open_price_bank_and_reserve_mismatch', 1, 0],
    ['extra_snapshot_mismatch', [array_replace($withExtra, ['free_price_extra_amount' => 1])], false, 'open_price_bank_and_reserve_mismatch', 1, 0],
    ['face_value_exceeds_minimum', [array_replace($base, ['free_price_original_amount' => 420001])], false, 'open_price_bank_and_reserve_mismatch', 1, 0],
    ['missing_amount', [array_replace($base, ['free_price_gateway_amount' => null])], false, 'incomplete_or_invalid_open_price_amount', 1, 0],
    ['scientific_notation', [array_replace($base, ['free_price_gateway_amount' => '4.2e5'])], false, 'incomplete_or_invalid_open_price_amount', 1, 0],
    ['negative_amount', [array_replace($base, ['free_price_gateway_amount' => -1])], false, 'out_of_range_open_price_amount', 1, 0],
    ['amount_over_maximum', [array_replace($base, ['free_price_gateway_amount' => '10000000000000'])], false, 'out_of_range_open_price_amount', 1, 0],
    ['non_row_fails_closed', [null], false, 'invalid_reservation_snapshot', 0, 0],
];
$passed = 0;
foreach ($cases as [$name, $rows, $ok, $reason, $reviewed, $unallocated]) {
    $actual = OpenPriceSettlementGuard::review($rows);
    if ($actual['ok'] !== $ok || $actual['reason'] !== $reason ||
        $actual['reviewed_count'] !== $reviewed ||
        $actual['unallocated_extra_toman'] !== $unallocated) {
        throw new RuntimeException('Open price seller settlement guard failed: ' . $name . ' ' . json_encode($actual));
    }
    $passed++;
}
// Structural coverage of the actual AR approval path (no DB required).
$modelPath = dirname(__DIR__, 3) . '/common/models/AccountSettlement.php';
$modelSource = file_get_contents($modelPath);
if ($modelSource === false
    || !str_contains($modelSource, 'if ((int)$this->status >= self::STATUS_PUBLISH)')
    || !str_contains($modelSource, 'reviewOpenPriceForApproval()')
    || !str_contains($modelSource, 'OpenPriceSettlementGuard::review($rows)')
    || !str_contains($modelSource, "addError('status',")) {
    throw new RuntimeException('Producer settlement approval guard is not wired into the ActiveRecord save path.');
}
$passed++;
echo "OPEN_PRICE_SETTLEMENT_GUARD={$passed}/{$passed} PASS\\n";
