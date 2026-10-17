<?php
declare(strict_types=1);

namespace app\modules\finance\services;

/**
 * Conservative, read-only settlement gate for opt-in open-price reservations.
 *
 * A balanced collection ledger is not evidence that voluntary excess is owed
 * to the event producer. Until the excess-beneficiary policy has been audited,
 * an account settlement containing it MUST NOT be approved or marked paid.
 *
 * Pure PHP: no gateway calls, no writes, no account allocations.
 */
final class OpenPriceSettlementGuard
{
    public static function review(array $reservations): array
    {
        $reviewed = 0;
        $held = 0;
        $extraTotal = 0;

        foreach ($reservations as $row) {
            if (!is_array($row)) {
                return self::blocked('invalid_reservation_snapshot', $reviewed, $held, $extraTotal);
            }

            if ((string)($row['free_price_enabled_snapshot'] ?? '0') !== '1') {
                continue;
            }

            $reviewed++;
            $fields = [
                'free_price_original_amount',
                'free_price_minimum_amount',
                'free_price_proposed_amount',
                'free_price_gateway_amount',
                'free_price_extra_amount',
                'bank_transaction_amount',
                'bank_paying_amount',
            ];
            $amounts = [];
            foreach ($fields as $field) {
                $value = $row[$field] ?? null;
                if (!is_int($value) &&
                    (!is_string($value) || !preg_match('/^(?:0|[1-9][0-9]*)$/D', $value))) {
                    return self::blocked('incomplete_or_invalid_open_price_amount', $reviewed, $held, $extraTotal);
                }
                $amount = (int)$value;
                if ($amount < 0 || $amount > OpenPriceAmount::MAX_TOMAN ||
                    (string)$amount !== (string)$value) {
                    return self::blocked('out_of_range_open_price_amount', $reviewed, $held, $extraTotal);
                }
                $amounts[$field] = $amount;
            }

            $original = $amounts['free_price_original_amount'];
            $minimum = $amounts['free_price_minimum_amount'];
            $proposed = $amounts['free_price_proposed_amount'];
            $gateway = $amounts['free_price_gateway_amount'];
            $extra = $amounts['free_price_extra_amount'];
            if ($original > $minimum || $minimum > $gateway ||
                $gateway !== $proposed || $gateway - $minimum !== $extra ||
                $gateway !== $amounts['bank_transaction_amount'] ||
                $gateway !== $amounts['bank_paying_amount']) {
                return self::blocked('open_price_bank_and_reserve_mismatch', $reviewed, $held, $extraTotal);
            }

            if ($extra > 0) {
                $held++;
                if ($extraTotal > PHP_INT_MAX - $extra) {
                    return self::blocked('extra_total_overflow', $reviewed, $held, $extraTotal);
                }
                $extraTotal += $extra;
            }
        }

        return [
            'ok' => $held === 0,
            'reason' => $held === 0 ? 'no_unallocated_open_price_extra' : 'voluntary_extra_requires_allocation_review',
            'reviewed_count' => $reviewed,
            'held_count' => $held,
            'unallocated_extra_toman' => $extraTotal,
        ];
    }

    private static function blocked(string $reason, int $reviewed, int $held, int $extraTotal): array
    {
        return [
            'ok' => false,
            'reason' => $reason,
            'reviewed_count' => $reviewed,
            'held_count' => $held,
            'unallocated_extra_toman' => $extraTotal,
        ];
    }
}
