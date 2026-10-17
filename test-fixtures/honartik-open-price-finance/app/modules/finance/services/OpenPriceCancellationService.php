<?php
declare(strict_types=1);

namespace app\modules\finance\services;

use Yii;
use app\modules\finance\models\FinanceTransactions;
use app\modules\finance\models\FinanceWallet;
use common\models\Reserve;
use yii\helpers\Json;

/**
 * Cancellations AFTER confirmed payment and ticket issuance only.
 *
 * This is a wallet credit, NOT a Saman bank reversal. All original allocation
 * rows are reversed symmetrically in the same SQL transaction as the seat/ticket
 * status change. Settlement-attached tickets are never automatically refunded.
 *
 * No external call is made. Legacy non-open-price cancellations remain unchanged.
 */
final class OpenPriceCancellationService
{
    public function cancelPublished(int $reserveId, int $buyerId): array
    {
        if ($reserveId <= 0 || $buyerId <= 0) {
            return $this->decline('invalid_request');
        }
        $db = Yii::$app->db;
        $transaction = $db->beginTransaction();
        try {
            $lock = $db->createCommand(
                'SELECT id FROM {{%reserve}} WHERE id=:id FOR UPDATE',
                [':id' => $reserveId]
            )->queryScalar();
            if (!$lock) {
                throw new \RuntimeException('reserve_missing');
            }

            /** @var Reserve|null $reserve */
            $reserve = Reserve::findOne($reserveId);
            if (!$reserve || (int)$reserve->user_id !== $buyerId ||
                (int)$reserve->free_price_enabled_snapshot !== 1 ||
                (int)$reserve->status !== Reserve::STATUS_PUBLISH) {
                throw new \RuntimeException('reserve_not_open_price_published');
            }
            if (!empty($reserve->gid)) {
                // External ticket cancellation is nontransactional. It needs
                // a separately reviewed, idempotent external cancellation flow.
                throw new \RuntimeException('external_ticket_requires_manual_review');
            }
            if (!empty($reserve->account_settlement_id)) {
                throw new \RuntimeException('seller_settlement_already_attached');
            }
            if (empty($reserve->code)) {
                throw new \RuntimeException('ticket_not_issued');
            }

            $schedule = $reserve->schedule;
            if (!$schedule || (int)$schedule->is_cancel_able === 0 ||
                time() + 1800 > strtotime((string)$schedule->date . ' ' . (string)$schedule->start_at)) {
                throw new \RuntimeException('cancellation_window_closed');
            }

            $tid = (int)$reserve->transaction_id;
            if ($tid <= 0) {
                throw new \RuntimeException('bank_transaction_missing');
            }
            $db->createCommand(
                'SELECT id FROM {{%finance_transactions}} WHERE id=:id FOR UPDATE',
                [':id' => $tid]
            )->queryScalar();
            $bank = FinanceTransactions::findOne($tid);
            if (!$bank || (int)$bank->status !== FinanceTransactions::TRANSACTION_COMPLETED ||
                (int)$bank->transactioner !== $buyerId ||
                trim((string)$bank->gateway_reciept) === '') {
                throw new \RuntimeException('bank_accounting_not_completed');
            }

            $values = [
                'free_price_enabled_snapshot' => $reserve->free_price_enabled_snapshot,
                'free_price_original_amount' => $reserve->free_price_original_amount,
                'free_price_minimum_amount' => $reserve->free_price_minimum_amount,
                'free_price_proposed_amount' => $reserve->free_price_proposed_amount,
                'free_price_gateway_amount' => $reserve->free_price_gateway_amount,
                'free_price_extra_amount' => $reserve->free_price_extra_amount,
                'bank_transaction_amount' => $bank->amount,
                'bank_paying_amount' => $bank->paying_amount,
            ];
            $review = OpenPriceSettlementGuard::review([$values]);
            if (!in_array($review['reason'], [
                'no_unallocated_open_price_extra',
                'voluntary_extra_requires_allocation_review',
            ], true)) {
                throw new \RuntimeException('open_price_snapshot_not_reconciled');
            }

            $minimum = (int)$reserve->free_price_minimum_amount;
            $chosen = (int)$reserve->free_price_gateway_amount;
            if ($chosen <= 0) {
                throw new \RuntimeException('nonpositive_paid_amount');
            }
            $ip = (string)$bank->transactioner_ip;
            if ($ip === '') {
                throw new \RuntimeException('transaction_ip_missing');
            }
            $expectedOriginal = OpenPriceLedger::rows(
                $minimum, $chosen, $buyerId, $ip, '', 1
            );
            $originalRows = json_decode((string)$bank->additional_rows, true);
            if (!is_array($originalRows) || count($originalRows) !== count($expectedOriginal)) {
                throw new \RuntimeException('original_ledger_shape_mismatch');
            }

            $primary = FinanceWallet::find()
                ->where(['bank_transaction_id' => $tid])->one();
            if (!$primary || (int)$primary->user_id !== $buyerId ||
                (int)$primary->amount !== $chosen) {
                throw new \RuntimeException('primary_bank_credit_mismatch');
            }

            // Reconcile every original balancing row before issuing any credit.
            foreach ($expectedOriginal as $index => $expected) {
                $r = $originalRows[$index] ?? null;
                if (!is_array($r) ||
                    (int)($r['amount'] ?? PHP_INT_MIN) !== $expected['amount'] ||
                    (int)($r['user_id'] ?? PHP_INT_MIN) !== $expected['user_id'] ||
                    ($r['metadata']['open_price_role'] ?? null) !==
                       $expected['metadata']['open_price_role']) {
                    throw new \RuntimeException('original_bank_ledger_modified');
                }

                $meta = Json::encode([
                    'payment_transaction_id' => $tid,
                    'payment_row_index' => $index,
                    'source_metadata' => $r['metadata'],
                ]);
                $existing = FinanceWallet::find()->where(['metadata' => $meta])->all();
                if (count($existing) !== 1 ||
                    (int)$existing[0]->amount !== $expected['amount'] ||
                    (int)$existing[0]->user_id !== $expected['user_id']) {
                    throw new \RuntimeException('original_wallet_rows_not_balanced');
                }
            }

            // Lock the actual ticket seats and require unambiguous ownership
            // before posting a wallet credit. Reserve::afterSave() only releases
            // seats in SOLD/PENDING status; an unrelated or re-assigned seat
            // must never result in a completed refund with a retained lock.
            $seatRows = $db->createCommand(
                'SELECT ss.id, ss.status, ss.schedule_id
                   FROM {{%reserve_item}} ri
                   INNER JOIN {{%schedule_seat}} ss
                      ON ss.id=ri.schedule_seats_id
                  WHERE ri.reserve_id=:rid
                  ORDER BY ss.id FOR UPDATE',
                [':rid' => $reserveId]
            )->queryAll();
            if (!$seatRows) {
                throw new \RuntimeException('no_ticket_seats_to_refund');
            }
            $ownedSeatIds = [];
            foreach ($seatRows as $seatRow) {
                $seatId = (int)$seatRow['id'];
                if (isset($ownedSeatIds[$seatId]) ||
                    (int)$seatRow['status'] !== \common\models\ScheduleSeat::STATUS_SOLED ||
                    (int)$seatRow['schedule_id'] !== (int)$reserve->schedule_id) {
                    throw new \RuntimeException('ticket_seat_state_not_refundable');
                }
                $ownedSeatIds[$seatId] = true;
            }
            $itemCount = (int)$db->createCommand(
                'SELECT COUNT(*) FROM {{%reserve_item}} WHERE reserve_id=:rid',
                [':rid' => $reserveId]
            )->queryScalar();
            if ($itemCount !== count($seatRows)) {
                throw new \RuntimeException('ticket_seat_item_missing_or_duplicate');
            }

            $refundRows = OpenPriceRefundLedger::rows(
                $minimum, $chosen, $buyerId, $ip, '', time()
            );
            $beforeAmount = 0;
            foreach ($refundRows as $index => $row) {
                $metadata = Json::encode([
                    'open_price_refund_transaction_id' => $tid,
                    'open_price_refund_row_index' => $index,
                    'open_price_refund_role' => $row['metadata']['open_price_refund_role'],
                ]);
                if (FinanceWallet::find()->where(['metadata' => $metadata])->exists()) {
                    throw new \RuntimeException('refund_row_already_present');
                }

                $wallet = new FinanceWallet();
                $wallet->created_at = time();
                $wallet->user_id = (int)$row['user_id'];
                $wallet->amount = (int)$row['amount'];
                $wallet->transactioner = $buyerId;
                $wallet->transactioner_ip = $ip;
                $wallet->bank_transaction_id = null;
                $wallet->description = 'اصلاح حساب لغو بلیت قیمت آزاد، تراکنش ' . $tid;
                $wallet->metadata = $metadata;
                if (!$wallet->save(false)) {
                    throw new \RuntimeException('atomic_refund_wallet_write_failed');
                }
                $beforeAmount += (int)$row['amount'];
            }
            if ($beforeAmount !== 0) {
                throw new \RuntimeException('refund_ledger_unbalanced');
            }

            $reserve->status = Reserve::STATUS_CANCEL;
            if (!$reserve->save(false)) {
                throw new \RuntimeException('reserve_status_save_failed');
            }
            // Keep the refund, cancellation and actual seat release one
            // transaction. A no-op/partial update in Reserve::afterSave()
            // is never treated as success.
            $released = $db->createCommand(
                'SELECT ss.id, ss.status, ss.user_lock, ss.last_lock_time
                   FROM {{%reserve_item}} ri
                   INNER JOIN {{%schedule_seat}} ss
                      ON ss.id=ri.schedule_seats_id
                  WHERE ri.reserve_id=:rid FOR UPDATE',
                [':rid' => $reserveId]
            )->queryAll();
            if (count($released) !== $itemCount) {
                throw new \RuntimeException('released_seat_count_mismatch');
            }
            foreach ($released as $seat) {
                if (!isset($ownedSeatIds[(int)$seat['id']]) ||
                    (int)$seat['status'] !== \common\models\ScheduleSeat::STATUS_SELECTABLE ||
                    $seat['user_lock'] !== null || $seat['last_lock_time'] !== null) {
                    throw new \RuntimeException('seat_release_incomplete_refund_rolled_back');
                }
            }
            $transaction->commit();
            return [
                'success' => true,
                'message' => 'رزرو لغو شد و کل مبلغ پرداختی در کیف پول شما ثبت شد.',
                'refund_amount_toman' => $chosen,
            ];
        } catch (\Throwable $e) {
            if ($transaction->isActive) {
                $transaction->rollBack();
            }
            Yii::warning([
                'reserve_id' => $reserveId,
                'reason' => $e->getMessage(),
            ], 'open_price.cancel.review_required');
            return $this->decline('manual_financial_review_required');
        }
    }

    private function decline(string $reason): array
    {
        return [
            'success' => false,
            'reason' => $reason,
            'message' => 'لغو خودکار این سفارش فعلاً امکان‌پذیر نیست؛ پرونده نیازمند بررسی مالی است.',
        ];
    }
}
