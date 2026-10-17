<?php
declare(strict_types=1);

namespace app\modules\finance\services;

/** Pure, symmetric refund rows for an already completed open-price wallet ledger.
 * Amounts are integer toman. No bank reversal is performed by this class.
 */
final class OpenPriceRefundLedger
{
    public static function rows(
        int $minimum,
        int $chosen,
        int $buyerId,
        string $buyerIp,
        string $eventTitle,
        int $requestedAt
    ): array {
        $collected = OpenPriceLedger::rows(
            $minimum, $chosen, $buyerId, $buyerIp, $eventTitle, $requestedAt
        );
        $result = [];
        foreach ($collected as $row) {
            $row['amount'] = -$row['amount'];
            $row['description'] = 'استرداد ' . $row['description'];
            $row['metadata'] = [
                'open_price_refund_role' => (string)$row['metadata']['open_price_role'],
            ];
            $result[] = $row;
        }
        return $result;
    }
}
