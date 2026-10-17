<?php
namespace app\modules\finance\services;

/** Pure, balanced accounting rows for an opt-in open-price bank payment. Toman only. */
final class OpenPriceLedger
{
    public static function rows(
        int $minimum,
        int $chosen,
        int $buyerId,
        string $buyerIp,
        string $eventTitle,
        int $requestedAt
    ): array {
        if ($minimum < 0 || $chosen < $minimum || $chosen > OpenPriceAmount::MAX_TOMAN
            || $buyerId <= 0 || $requestedAt <= 0) {
            throw new \InvalidArgumentException('Invalid open-price ledger snapshot.');
        }

        $rows = [];
        $parts = [
            ['amount' => $minimum, 'role' => 'ticket_base', 'label' => 'هزینه بلیت ' . $eventTitle],
            ['amount' => $chosen - $minimum, 'role' => 'voluntary_extra', 'label' => 'مشارکت مازاد بر بلیت ' . $eventTitle],
        ];
        foreach ($parts as $part) {
            if ($part['amount'] === 0) {
                continue;
            }
            // Do not conflate the voluntary contribution with the seller ticket base.
            foreach ([$buyerId, 0] as $beneficiary) {
                $rows[] = [
                    'requested_time' => $requestedAt,
                    'user_id' => $beneficiary,
                    'amount' => $beneficiary === $buyerId ? -$part['amount'] : $part['amount'],
                    'transactioner' => $buyerId,
                    'transactioner_ip' => $buyerIp,
                    'description' => $part['label'],
                    'metadata' => ['open_price_role' => $part['role']],
                ];
            }
        }
        return $rows;
    }
}
