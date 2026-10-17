<?php

namespace app\modules\finance\services;

use app\modules\finance\addons\GatewayAbstract;
use app\modules\finance\addons\SamanGateway;
use app\modules\finance\models\FinanceTransactions;
use app\modules\finance\models\FinanceWallet;
use common\models\CouponUse;
use common\models\Reserve;
use common\models\ScheduleSeat;
use Yii;

final class ReservePaymentFinalizer
{
    public const STATE_CREATED = 'created';
    public const STATE_VERIFYING = 'verifying';
    public const STATE_BANK_VERIFIED = 'bank_verified';
    public const STATE_ISSUING = 'issuing';
    public const STATE_TICKET_ISSUED = 'ticket_issued';
    public const STATE_COMPLETED = 'completed';
    public const STATE_ACCOUNTING_REVIEW = 'accounting_review';
    public const STATE_FAILED_BEFORE_VERIFY = 'failed_before_verify';
    public const STATE_REVERSING = 'reversing';
    public const STATE_REVERSED = 'reversed';
    public const STATE_MANUAL_REVIEW = 'manual_review';

    private const PROCESSING_STALE_SECONDS = 180;
    private const MAX_ISSUE_ATTEMPTS = 3;

    public function finalize(FinanceTransactions $transaction, GatewayAbstract $gateway, array $callback): array
    {
        $lockName = 'honartik_payment_' . (int)$transaction->id;
        $lockAcquired = false;

        try {
            $lockAcquired = (int)Yii::$app->db->createCommand(
                'SELECT GET_LOCK(:lock_name, 0)',
                [':lock_name' => $lockName]
            )->queryScalar() === 1;

            if (!$lockAcquired) {
                return $this->result(false, self::STATE_ISSUING, 'processing_in_progress');
            }

            return $this->finalizeLocked($transaction, $gateway, $callback);
        } finally {
            if ($lockAcquired) {
                try {
                    Yii::$app->db->createCommand(
                        'SELECT RELEASE_LOCK(:lock_name)',
                        [':lock_name' => $lockName]
                    )->queryScalar();
                } catch (\Throwable $e) {
                    Yii::error([
                        'transaction_id' => (int)$transaction->id,
                        'error' => $e->getMessage(),
                    ], 'payment.finalization.release_lock');
                }
            }
        }
    }

    private function finalizeLocked(FinanceTransactions $transaction, GatewayAbstract $gateway, array $callback): array
    {
        $reserve = Reserve::findOne(['transaction_id' => (int)$transaction->id]);
        if (!$reserve) {
            return $this->result(false, self::STATE_MANUAL_REVIEW, 'reserve_not_found');
        }

        $state = $this->loadOrCreateState((int)$transaction->id, (int)$reserve->id);
        if (!$state['ok']) {
            return $this->result(false, self::STATE_MANUAL_REVIEW, $state['reason']);
        }

        // A bank callback must never finalize a different amount from the
        // opt-in amount frozen on the reservation, even after retries.
        if ((int)$reserve->free_price_enabled_snapshot === 1
            && ($reserve->free_price_gateway_amount === null
                || $reserve->free_price_proposed_amount === null
                || $reserve->free_price_minimum_amount === null
                || $reserve->free_price_extra_amount === null
                || (int)$reserve->free_price_gateway_amount !== (int)$transaction->amount
                || (int)$reserve->free_price_proposed_amount !== (int)$transaction->amount
                || (int)$reserve->free_price_extra_amount !==
                   ((int)$reserve->free_price_gateway_amount - (int)$reserve->free_price_minimum_amount)
                || (int)$reserve->free_price_extra_amount < 0
                || $transaction->paying_amount === null
                || (int)$transaction->paying_amount !== (int)$transaction->amount)) {
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'open_price_snapshot_amount_mismatch'
            );
        }

        $current = (string)$state['state'];

        if ($current === self::STATE_CREATED
            && (int)$transaction->status === FinanceTransactions::TRANSACTION_COMPLETED) {
            $snapshot = $this->ticketSnapshot((int)$reserve->id);
            if ($snapshot['valid_ticket']) {
                $this->markCouponUsed((int)$transaction->id);
                $this->setState((int)$transaction->id, self::STATE_COMPLETED, null, $snapshot, true);
                return $this->result(true, self::STATE_COMPLETED, 'legacy_completed_transaction_with_valid_ticket');
            }

            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'legacy_completed_transaction_without_valid_ticket',
                $snapshot
            );
        }

        if ($current === self::STATE_CREATED
            && (int)$transaction->status === FinanceTransactions::TRANSACTION_PAID
            && !empty($transaction->gateway_reciept)) {
            $seed = $this->seedBankVerifiedFromTransaction($transaction, $reserve);
            if (!$seed['ok']) {
                return $seed;
            }
            return $this->issueTicketWithRetries($transaction, $reserve, $gateway);
        }

        if ($current === self::STATE_COMPLETED) {
            return $this->result(true, self::STATE_COMPLETED, 'already_finalized');
        }
        if ($current === self::STATE_ACCOUNTING_REVIEW) {
            return $this->completeAccounting($transaction, $reserve);
        }
        if ($current === self::STATE_REVERSED) {
            return $this->result(false, self::STATE_REVERSED, 'already_reversed');
        }
        if ($current === self::STATE_MANUAL_REVIEW) {
            return $this->result(false, self::STATE_MANUAL_REVIEW, 'manual_review_required');
        }
        if ($current === self::STATE_TICKET_ISSUED) {
            return $this->completeAccounting($transaction, $reserve);
        }
        if ($current === self::STATE_BANK_VERIFIED || $current === self::STATE_ISSUING) {
            return $this->issueTicketWithRetries($transaction, $reserve, $gateway);
        }
        if ($current === self::STATE_VERIFYING || $current === self::STATE_REVERSING) {
            $updatedAt = (int)($state['updated_at'] ?? 0);
            if ($updatedAt > 0 && $updatedAt >= time() - self::PROCESSING_STALE_SECONDS) {
                return $this->result(false, $current, 'processing_in_progress');
            }

            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'stale_' . $current . '_external_result_unknown'
            );
        }
        if ($current === self::STATE_FAILED_BEFORE_VERIFY) {
            return $this->result(false, self::STATE_FAILED_BEFORE_VERIFY, 'payment_not_verified');
        }

        $callbackState = (string)($callback['State'] ?? $callback['state'] ?? '');
        $callbackRef = trim((string)($callback['RefNum'] ?? ''));
        if ($callbackState !== 'OK' || $callbackRef === '') {
            return $this->failBeforeVerify(
                $transaction,
                $reserve,
                'invalid_or_cancelled_gateway_callback'
            );
        }

        $claim = $this->prepareAndClaimVerification($transaction, $reserve, $callback);
        if (!$claim['ok']) {
            if (($claim['state'] ?? '') === self::STATE_MANUAL_REVIEW) {
                return $claim;
            }
            return $this->failBeforeVerify($transaction, $reserve, $claim['reason'] ?? 'seat_prepare_failed');
        }
        if (($claim['state'] ?? '') === self::STATE_TICKET_ISSUED) {
            return $this->completeAccounting($transaction, $reserve);
        }
        if (in_array(($claim['state'] ?? ''), [self::STATE_COMPLETED, self::STATE_ACCOUNTING_REVIEW], true)) {
            return $claim;
        }

        $payStatus = $gateway->payStatus((int)$transaction->id, ['callback' => $callback]);
        $status = (int)($payStatus['status'] ?? 1004);
        $bankVerified = !empty($payStatus['bank_verified']);
        $ambiguous = !empty($payStatus['ambiguous']);

        if ($ambiguous) {
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'gateway_verification_ambiguous',
                $payStatus
            );
        }

        // SEP payStatus() itself can CONFIRM a bank reversal after an amount
        // mismatch or exhausted verification response. Never call rollback
        // again for the same RefNum: reconcile the confirmed reversal locally.
        if (!empty($payStatus['reversed'])) {
            if (!self::isConfirmedPriorSamanReversal(
                $payStatus,
                $gateway instanceof SamanGateway,
                (int)$gateway->gatewaySuccessStatus
            )) {
                return $this->markManualReview(
                    (int)$transaction->id,
                    (int)$reserve->id,
                    'unexpected_preconfirmed_gateway_reverse',
                    $payStatus
                );
            }

            $persist = $this->persistBankVerified($transaction, $reserve, $payStatus);
            if (!$persist['ok']) {
                return $persist;
            }

            return $this->reverseSafely(
                $transaction,
                $reserve,
                $gateway,
                'gateway_already_confirmed_reverse',
                true
            );
        }

        if ($status !== (int)$gateway->gatewaySuccessStatus) {
            if ($bankVerified) {
                $persist = $this->persistBankVerified($transaction, $reserve, $payStatus);
                if (!$persist['ok']) {
                    return $persist;
                }

                return $this->reverseSafely(
                    $transaction,
                    $reserve,
                    $gateway,
                    'bank_verified_but_gateway_validation_failed'
                );
            }

            return $this->failBeforeVerify(
                $transaction,
                $reserve,
                (string)($payStatus['reason'] ?? 'gateway_verification_failed'),
                $payStatus
            );
        }

        $persist = $this->persistBankVerified($transaction, $reserve, $payStatus);
        if (!$persist['ok']) {
            return $persist;
        }

        $transaction->refresh();
        $reserve->refresh();

        return $this->issueTicketWithRetries($transaction, $reserve, $gateway);
    }

    /** Only a specific, locally confirmed SEP response may skip a second bank call. */
    private static function isConfirmedPriorSamanReversal(
        array $payStatus,
        bool $isSamanGateway,
        int $gatewaySuccessStatus
    ): bool {
        return $isSamanGateway
            && !empty($payStatus['reversed'])
            && empty($payStatus['ambiguous'])
            && empty($payStatus['manual_review'])
            && (int)($payStatus['status'] ?? $gatewaySuccessStatus) !== $gatewaySuccessStatus
            && trim((string)($payStatus['gateway_reciept'] ?? '')) !== ''
            && in_array(
                (string)($payStatus['reason'] ?? ''),
                ['verified_amount_mismatch_reversed', 'verify_no_response_reversed'],
                true
            );
    }

    private function loadOrCreateState(int $transactionId, int $reserveId): array
    {
        $now = time();
        try {
            Yii::$app->db->createCommand(
                'INSERT IGNORE INTO {{%payment_finalization}}
                    (transaction_id, reserve_id, state, attempt_count, created_at, updated_at)
                 VALUES (:tid, :rid, :state, 0, :now, :now)',
                [
                    ':tid' => $transactionId,
                    ':rid' => $reserveId,
                    ':state' => self::STATE_CREATED,
                    ':now' => $now,
                ]
            )->execute();

            $row = Yii::$app->db->createCommand(
                'SELECT * FROM {{%payment_finalization}} WHERE transaction_id=:tid LIMIT 1',
                [':tid' => $transactionId]
            )->queryOne();

            if (!$row) {
                return ['ok' => false, 'reason' => 'finalization_state_not_created'];
            }

            return ['ok' => true] + $row;
        } catch (\Throwable $e) {
            Yii::error([
                'transaction_id' => $transactionId,
                'reserve_id' => $reserveId,
                'error' => $e->getMessage(),
            ], 'payment.finalization.state_init');

            return ['ok' => false, 'reason' => 'finalization_state_init_exception'];
        }
    }

    private function prepareAndClaimVerification(
        FinanceTransactions $transaction,
        Reserve $reserve,
        array $callback
    ): array {
        $db = Yii::$app->db;
        $tx = $db->beginTransaction();
        try {
            $state = $db->createCommand(
                'SELECT * FROM {{%payment_finalization}} WHERE transaction_id=:tid LIMIT 1 FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryOne();
            $db->createCommand(
                'SELECT id FROM {{%finance_transactions}} WHERE id=:tid FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryScalar();
            $db->createCommand(
                'SELECT id FROM {{%reserve}} WHERE id=:rid FOR UPDATE',
                [':rid' => (int)$reserve->id]
            )->queryScalar();

            if (!$state) {
                throw new \RuntimeException('finalization_state_missing');
            }

            $current = (string)$state['state'];
            if ($current === self::STATE_COMPLETED || $current === self::STATE_ACCOUNTING_REVIEW) {
                $tx->commit();
                return $this->result(true, $current, 'already_finalized');
            }
            if ($current === self::STATE_REVERSED) {
                $tx->commit();
                return $this->result(false, self::STATE_REVERSED, 'already_reversed');
            }
            if ($current === self::STATE_MANUAL_REVIEW) {
                $tx->commit();
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'manual_review_required');
            }
            if ($current === self::STATE_VERIFYING) {
                $tx->commit();
                return $this->result(false, self::STATE_VERIFYING, 'verification_already_claimed');
            }

            $snapshot = $this->ticketSnapshotLocked((int)$reserve->id);
            if ($snapshot['valid_ticket']) {
                $db->createCommand(
                    'UPDATE {{%payment_finalization}}
                     SET state=:state, ticket_issued_at=COALESCE(ticket_issued_at,:now), updated_at=:now
                     WHERE transaction_id=:tid',
                    [
                        ':state' => self::STATE_TICKET_ISSUED,
                        ':now' => time(),
                        ':tid' => (int)$transaction->id,
                    ]
                )->execute();
                $tx->commit();
                return $this->result(true, self::STATE_TICKET_ISSUED, 'ticket_already_exists');
            }
            if ($snapshot['ticket_evidence']) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'ticket_evidence_before_gateway_verification',
                    $snapshot
                );
                $tx->commit();
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'ticket_evidence_before_verify');
            }

            $prepare = $this->prepareSeatsLocked($reserve);
            if (!$prepare['ok']) {
                if (($prepare['state'] ?? '') === self::STATE_MANUAL_REVIEW) {
                    $this->setManualReviewLocked(
                        (int)$transaction->id,
                        $prepare['reason'] ?? 'seat_prepare_manual_review',
                        ['phase' => 'before_gateway_verification']
                    );
                    $tx->commit();
                    return $prepare;
                }
                $tx->rollBack();
                return $prepare;
            }

            $callbackHash = hash('sha256', json_encode([
                'transaction_id' => (int)$transaction->id,
                'state' => $callback['State'] ?? null,
                'ref_num' => $callback['RefNum'] ?? null,
                'token' => $callback['Token'] ?? null,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            $db->createCommand(
                'UPDATE {{%payment_finalization}}
                 SET state=:state, callback_hash=:hash, last_error=NULL, updated_at=:now
                 WHERE transaction_id=:tid',
                [
                    ':state' => self::STATE_VERIFYING,
                    ':hash' => $callbackHash,
                    ':now' => time(),
                    ':tid' => (int)$transaction->id,
                ]
            )->execute();

            $tx->commit();
            return $this->result(true, self::STATE_VERIFYING, 'verification_claimed');
        } catch (\Throwable $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }
            Yii::error([
                'transaction_id' => (int)$transaction->id,
                'reserve_id' => (int)$reserve->id,
                'error' => $e->getMessage(),
            ], 'payment.finalization.prepare_verify');

            return $this->result(false, self::STATE_MANUAL_REVIEW, 'prepare_verify_exception');
        }
    }

    private function seedBankVerifiedFromTransaction(
        FinanceTransactions $transaction,
        Reserve $reserve
    ): array {
        $ref = trim((string)$transaction->gateway_reciept);
        if ($ref === '') {
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'paid_transaction_without_gateway_ref'
            );
        }

        $db = Yii::$app->db;
        $tx = $db->beginTransaction();
        try {
            $db->createCommand(
                'SELECT id FROM {{%payment_finalization}} WHERE transaction_id=:tid FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryScalar();

            $duplicate = $db->createCommand(
                'SELECT transaction_id FROM {{%payment_finalization}}
                 WHERE gateway_ref=:ref AND transaction_id<>:tid LIMIT 1 FOR UPDATE',
                [':ref' => $ref, ':tid' => (int)$transaction->id]
            )->queryScalar();

            if ($duplicate) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'duplicate_gateway_ref_while_seeding_paid_transaction',
                    ['duplicate_transaction_id' => (int)$duplicate]
                );
                $tx->commit();
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'duplicate_gateway_ref');
            }

            $db->createCommand(
                'UPDATE {{%payment_finalization}}
                 SET gateway_ref=:ref, state=:state,
                     bank_verified_at=COALESCE(bank_verified_at,:now), updated_at=:now
                 WHERE transaction_id=:tid',
                [
                    ':ref' => $ref,
                    ':state' => self::STATE_BANK_VERIFIED,
                    ':now' => time(),
                    ':tid' => (int)$transaction->id,
                ]
            )->execute();
            $tx->commit();

            return $this->result(true, self::STATE_BANK_VERIFIED, 'paid_transaction_seeded');
        } catch (\Throwable $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'seed_bank_verified_exception',
                ['error' => $e->getMessage()]
            );
        }
    }

    private function persistBankVerified(
        FinanceTransactions $transaction,
        Reserve $reserve,
        array $payStatus
    ): array {
        $ref = trim((string)($payStatus['gateway_reciept'] ?? ''));
        if ($ref === '') {
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'verified_gateway_response_without_refnum',
                $payStatus
            );
        }

        $db = Yii::$app->db;
        $tx = $db->beginTransaction();
        try {
            $state = $db->createCommand(
                'SELECT * FROM {{%payment_finalization}} WHERE transaction_id=:tid LIMIT 1 FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryOne();
            $db->createCommand(
                'SELECT id FROM {{%finance_transactions}} WHERE id=:tid FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryScalar();

            if (!$state) {
                throw new \RuntimeException('finalization_state_missing');
            }

            $duplicate = $db->createCommand(
                'SELECT transaction_id FROM {{%payment_finalization}}
                 WHERE gateway_ref=:ref AND transaction_id<>:tid LIMIT 1 FOR UPDATE',
                [':ref' => $ref, ':tid' => (int)$transaction->id]
            )->queryScalar();

            if ($duplicate) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'duplicate_gateway_ref_in_finalization',
                    ['duplicate_transaction_id' => (int)$duplicate]
                );
                $tx->commit();
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'duplicate_gateway_ref');
            }

            $meta = (string)($payStatus['gateway_meta'] ?? '');
            $rawResult = json_encode($payStatus, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

            $db->createCommand(
                'UPDATE {{%finance_transactions}}
                 SET status=:status, gateway_reciept=:ref, gateway_meta=:meta
                 WHERE id=:tid AND status<>:completed',
                [
                    ':status' => FinanceTransactions::TRANSACTION_PAID,
                    ':ref' => $ref,
                    ':meta' => $meta,
                    ':tid' => (int)$transaction->id,
                    ':completed' => FinanceTransactions::TRANSACTION_COMPLETED,
                ]
            )->execute();

            $db->createCommand(
                'UPDATE {{%payment_finalization}}
                 SET gateway_ref=:ref, state=:state, bank_verified_at=COALESCE(bank_verified_at,:now),
                     gateway_result=:result, last_error=NULL, updated_at=:now
                 WHERE transaction_id=:tid',
                [
                    ':ref' => $ref,
                    ':state' => self::STATE_BANK_VERIFIED,
                    ':now' => time(),
                    ':result' => $rawResult,
                    ':tid' => (int)$transaction->id,
                ]
            )->execute();

            $tx->commit();
            return $this->result(true, self::STATE_BANK_VERIFIED, 'bank_verified_persisted');
        } catch (\yii\db\IntegrityException $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'gateway_ref_unique_constraint_failed',
                ['error' => $e->getMessage(), 'gateway_ref' => $ref]
            );
        } catch (\Throwable $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'persist_bank_verified_exception',
                ['error' => $e->getMessage(), 'gateway_ref' => $ref]
            );
        }
    }

    private function issueTicketWithRetries(
        FinanceTransactions $transaction,
        Reserve $reserve,
        GatewayAbstract $gateway
    ): array {
        for ($attempt = 1; $attempt <= self::MAX_ISSUE_ATTEMPTS; $attempt++) {
            $prepare = $this->prepareIssuanceAttempt($transaction, $reserve, $attempt);
            if (($prepare['state'] ?? '') === self::STATE_TICKET_ISSUED) {
                return $this->completeAccounting($transaction, $reserve);
            }
            if (in_array(($prepare['state'] ?? ''), [self::STATE_COMPLETED, self::STATE_ACCOUNTING_REVIEW], true)) {
                return $prepare;
            }
            if (!$prepare['ok']) {
                if (($prepare['state'] ?? '') === self::STATE_MANUAL_REVIEW) {
                    return $prepare;
                }
                break;
            }

            try {
                $issuer = new Reserve();
                $issuer->settleReserve([
                    'reserve_id' => (int)$reserve->id,
                    'final_price' => (int)$transaction->amount,
                ]);
            } catch (\Throwable $e) {
                Yii::error([
                    'transaction_id' => (int)$transaction->id,
                    'reserve_id' => (int)$reserve->id,
                    'attempt' => $attempt,
                    'error' => $e->getMessage(),
                ], 'payment.finalization.issue_exception');
            }

            $snapshot = $this->ticketSnapshot((int)$reserve->id);
            if ($snapshot['valid_ticket']) {
                $this->markTicketIssued((int)$transaction->id, $snapshot);
                return $this->completeAccounting($transaction, $reserve);
            }
            if ($snapshot['ticket_evidence']) {
                return $this->markManualReview(
                    (int)$transaction->id,
                    (int)$reserve->id,
                    'partial_ticket_evidence_after_issue_attempt_' . $attempt,
                    $snapshot
                );
            }

            $this->recordAttemptError(
                (int)$transaction->id,
                'ticket_issue_attempt_' . $attempt . '_failed_without_ticket_evidence'
            );

            if ($attempt < self::MAX_ISSUE_ATTEMPTS) {
                usleep(200000 * $attempt);
            }
        }

        return $this->reverseSafely(
            $transaction,
            $reserve,
            $gateway,
            'ticket_issue_failed_after_' . self::MAX_ISSUE_ATTEMPTS . '_attempts'
        );
    }

    private function prepareIssuanceAttempt(
        FinanceTransactions $transaction,
        Reserve $reserve,
        int $attempt
    ): array {
        $db = Yii::$app->db;
        $tx = $db->beginTransaction();
        try {
            $state = $db->createCommand(
                'SELECT * FROM {{%payment_finalization}} WHERE transaction_id=:tid LIMIT 1 FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryOne();
            $db->createCommand(
                'SELECT id FROM {{%reserve}} WHERE id=:rid FOR UPDATE',
                [':rid' => (int)$reserve->id]
            )->queryScalar();

            if (!$state) {
                throw new \RuntimeException('finalization_state_missing');
            }

            $current = (string)$state['state'];
            if ($current === self::STATE_COMPLETED || $current === self::STATE_ACCOUNTING_REVIEW) {
                $tx->commit();
                return $this->result(true, $current, 'already_finalized');
            }
            if ($current === self::STATE_REVERSED) {
                $tx->commit();
                return $this->result(false, self::STATE_REVERSED, 'already_reversed');
            }
            if ($current === self::STATE_MANUAL_REVIEW) {
                $tx->commit();
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'manual_review_required');
            }

            $snapshot = $this->ticketSnapshotLocked((int)$reserve->id);
            if ($snapshot['valid_ticket']) {
                $db->createCommand(
                    'UPDATE {{%payment_finalization}}
                     SET state=:state, ticket_issued_at=COALESCE(ticket_issued_at,:now), updated_at=:now
                     WHERE transaction_id=:tid',
                    [
                        ':state' => self::STATE_TICKET_ISSUED,
                        ':now' => time(),
                        ':tid' => (int)$transaction->id,
                    ]
                )->execute();
                $tx->commit();
                return $this->result(true, self::STATE_TICKET_ISSUED, 'ticket_already_exists');
            }
            if ($snapshot['ticket_evidence']) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'partial_ticket_evidence_before_issue_attempt_' . $attempt,
                    $snapshot
                );
                $tx->commit();
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'partial_ticket_evidence');
            }

            $prepare = $this->prepareSeatsLocked($reserve);
            if (!$prepare['ok']) {
                if (($prepare['state'] ?? '') === self::STATE_MANUAL_REVIEW) {
                    $this->setManualReviewLocked(
                        (int)$transaction->id,
                        $prepare['reason'] ?? 'seat_prepare_manual_review',
                        ['phase' => 'ticket_issue_attempt', 'attempt' => $attempt]
                    );
                    $tx->commit();
                    return $prepare;
                }
                $tx->rollBack();
                return $prepare;
            }

            $db->createCommand(
                'UPDATE {{%payment_finalization}}
                 SET state=:state, attempt_count=:attempt, last_error=NULL, updated_at=:now
                 WHERE transaction_id=:tid',
                [
                    ':state' => self::STATE_ISSUING,
                    ':attempt' => $attempt,
                    ':now' => time(),
                    ':tid' => (int)$transaction->id,
                ]
            )->execute();

            $tx->commit();
            return $this->result(true, self::STATE_ISSUING, 'issue_attempt_prepared');
        } catch (\Throwable $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }
            Yii::error([
                'transaction_id' => (int)$transaction->id,
                'reserve_id' => (int)$reserve->id,
                'attempt' => $attempt,
                'error' => $e->getMessage(),
            ], 'payment.finalization.prepare_issue');

            return $this->result(false, self::STATE_BANK_VERIFIED, 'prepare_issue_exception');
        }
    }

    private function prepareSeatsLocked(Reserve $reserve): array
    {
        $rows = Yii::$app->db->createCommand(
            'SELECT ri.schedule_seats_id, ss.id, ss.status, ss.user_lock, ss.last_lock_time
             FROM {{%reserve_item}} ri
             INNER JOIN {{%schedule_seat}} ss ON ss.id=ri.schedule_seats_id
             WHERE ri.reserve_id=:rid
             ORDER BY ss.id
             FOR UPDATE',
            [':rid' => (int)$reserve->id]
        )->queryAll();

        if (!$rows) {
            return $this->result(false, self::STATE_FAILED_BEFORE_VERIFY, 'reserve_has_no_seats');
        }

        $unique = [];
        foreach ($rows as $row) {
            $sid = (int)$row['id'];
            $unique[$sid] = $row;
        }

        if (count($unique) !== count($rows)) {
            return $this->result(false, self::STATE_MANUAL_REVIEW, 'duplicate_seat_in_reserve_items');
        }

        $userId = (int)$reserve->user_id;
        $now = time();
        foreach ($unique as $sid => $row) {
            $status = (int)$row['status'];
            $userLock = (int)($row['user_lock'] ?? 0);

            if ($status === ScheduleSeat::STATUS_SOLED || $status === ScheduleSeat::STATUS_SOLD_SITE) {
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'seat_already_sold_or_partial_ticket');
            }

            $allowed = $status === ScheduleSeat::STATUS_SELECTABLE
                || ($status === ScheduleSeat::STATUS_PENDING && $userLock === $userId);

            if (!$allowed) {
                return $this->result(false, self::STATE_FAILED_BEFORE_VERIFY, 'seat_unavailable_or_locked_by_other');
            }

            Yii::$app->db->createCommand(
                'UPDATE {{%schedule_seat}}
                 SET status=:pending, user_lock=:uid, last_lock_time=:now, updated_at=:now
                 WHERE id=:sid',
                [
                    ':pending' => ScheduleSeat::STATUS_PENDING,
                    ':uid' => $userId,
                    ':now' => $now,
                    ':sid' => $sid,
                ]
            )->execute();
        }

        Yii::$app->db->createCommand(
            'UPDATE {{%reserve}}
             SET status=:pending, updated_at=:now
             WHERE id=:rid AND status<>:publish',
            [
                ':pending' => Reserve::STATUS_PENDING,
                ':publish' => Reserve::STATUS_PUBLISH,
                ':now' => $now,
                ':rid' => (int)$reserve->id,
            ]
        )->execute();

        return $this->result(true, self::STATE_ISSUING, 'seats_prepared');
    }

    private function completeAccounting(FinanceTransactions $transaction, Reserve $reserve): array
    {
        $snapshot = $this->ticketSnapshot((int)$reserve->id);
        if (!$snapshot['valid_ticket']) {
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'ticket_not_valid_during_accounting_completion',
                $snapshot
            );
        }

        $this->markTicketIssued((int)$transaction->id, $snapshot);

        try {
            // setPayVerified is atomic and idempotent. Calling it again also repairs a
            // previous partial accounting attempt where the primary wallet row exists
            // but balancing rows were not committed.
            $accountingResult = FinanceTransactions::setPayVerified($transaction);
            $transaction->refresh();

            if ($accountingResult && (int)$transaction->status === FinanceTransactions::TRANSACTION_COMPLETED) {
                $this->markCouponUsed((int)$transaction->id);
                $this->setState((int)$transaction->id, self::STATE_COMPLETED, null, $snapshot);
                return $this->result(true, self::STATE_COMPLETED, 'ticket_and_accounting_completed');
            }

            $walletExists = FinanceWallet::find()
                ->where(['bank_transaction_id' => (int)$transaction->id])
                ->exists();

            $this->setState(
                (int)$transaction->id,
                self::STATE_ACCOUNTING_REVIEW,
                'ticket_issued_but_atomic_accounting_incomplete',
                ['wallet_row_exists' => $walletExists, 'snapshot' => $snapshot]
            );

            $this->markCouponUsed((int)$transaction->id);
            return $this->result(true, self::STATE_ACCOUNTING_REVIEW, 'ticket_valid_accounting_review');
        } catch (\Throwable $e) {
            $this->setState(
                (int)$transaction->id,
                self::STATE_ACCOUNTING_REVIEW,
                'accounting_exception:' . $e->getMessage(),
                $snapshot
            );
            $this->markCouponUsed((int)$transaction->id);
            return $this->result(true, self::STATE_ACCOUNTING_REVIEW, 'ticket_valid_accounting_exception');
        }
    }

    private function reverseSafely(
        FinanceTransactions $transaction,
        Reserve $reserve,
        GatewayAbstract $gateway,
        string $reason,
        bool $alreadyReversedByGateway = false
    ): array {
        $prepared = $this->prepareReverseState($transaction, $reserve, $reason);
        if (!$prepared['ok']) {
            if (($prepared['state'] ?? '') === self::STATE_TICKET_ISSUED) {
                return $this->completeAccounting($transaction, $reserve);
            }
            return $prepared;
        }

        $db = Yii::$app->db;
        $gatewayRef = null;

        /*
         * Preflight is a short database transaction. The external SEP call is
         * deliberately performed after commit so no InnoDB row lock is held
         * during network I/O.
         */
        $preflightTx = $db->beginTransaction();
        try {
            $state = $db->createCommand(
                'SELECT * FROM {{%payment_finalization}}
                  WHERE transaction_id=:tid
                  LIMIT 1
                  FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryOne();

            $db->createCommand(
                'SELECT id FROM {{%finance_transactions}} WHERE id=:tid FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryScalar();

            $db->createCommand(
                'SELECT id FROM {{%reserve}} WHERE id=:rid FOR UPDATE',
                [':rid' => (int)$reserve->id]
            )->queryScalar();

            if (!$state || (string)$state['state'] !== self::STATE_REVERSING) {
                $preflightTx->rollBack();
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'reverse_state_not_claimed');
            }

            $snapshot = $this->ticketSnapshotLocked((int)$reserve->id);
            if ($snapshot['valid_ticket']) {
                $db->createCommand(
                    'UPDATE {{%payment_finalization}}
                        SET state=:state,
                            ticket_issued_at=COALESCE(ticket_issued_at,:now),
                            updated_at=:now
                      WHERE transaction_id=:tid',
                    [
                        ':state' => self::STATE_TICKET_ISSUED,
                        ':now' => time(),
                        ':tid' => (int)$transaction->id,
                    ]
                )->execute();

                $preflightTx->commit();
                return $this->completeAccounting($transaction, $reserve);
            }

            if ($snapshot['ticket_evidence']) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'ticket_evidence_blocks_reverse_preflight',
                    $snapshot
                );
                $preflightTx->commit();

                return $this->result(false, self::STATE_MANUAL_REVIEW, 'ticket_evidence_blocks_reverse');
            }

            $gatewayRef = trim((string)($state['gateway_ref'] ?? ''));
            if ($gatewayRef === '') {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'reverse_gateway_ref_missing',
                    ['reason' => $reason]
                );
                $preflightTx->commit();

                return $this->result(false, self::STATE_MANUAL_REVIEW, 'reverse_gateway_ref_missing');
            }

            /*
             * Refresh the temporary seat lock before leaving the database
             * transaction. Cleanup jobs must not release it while SEP is called.
             */
            $db->createCommand(
                'UPDATE {{%schedule_seat}} ss
                  INNER JOIN {{%reserve_item}} ri ON ri.schedule_seats_id=ss.id
                     SET ss.last_lock_time=:now, ss.updated_at=:now
                   WHERE ri.reserve_id=:rid
                     AND ss.status=:pending
                     AND ss.user_lock=:uid',
                [
                    ':now' => time(),
                    ':rid' => (int)$reserve->id,
                    ':pending' => ScheduleSeat::STATUS_PENDING,
                    ':uid' => (int)$reserve->user_id,
                ]
            )->execute();

            $preflightTx->commit();
        } catch (\Throwable $e) {
            if ($preflightTx->isActive) {
                $preflightTx->rollBack();
            }

            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'reverse_preflight_exception',
                ['error' => $e->getMessage(), 'reason' => $reason]
            );
        }

        /*
         * External financial action: exactly one call, outside any DB
         * transaction. A timeout/unknown response is never retried blindly.
         */
        if ($alreadyReversedByGateway) {
            // This was already confirmed inside SamanGateway::payStatus().
            // Repeating the bank call can produce duplicate/ambiguous refunds.
            $reverseResult = [
                'ok' => true,
                'ambiguous' => false,
                'reason' => 'confirmed_by_saman_before_local_finalization',
                'gateway_ref' => $gatewayRef,
            ];
        } else {
            try {
                $reverseResult = $gateway->rollBack((int)$transaction->id, [
                    'gateway_ref' => $gatewayRef,
                ]);
            } catch (\Throwable $e) {
                $reverseResult = [
                    'ok' => false,
                    'ambiguous' => true,
                    'reason' => 'reverse_gateway_exception',
                    'error' => get_class($e) . ':' . $e->getMessage(),
                ];
            }
        }

        $reverseOk = is_array($reverseResult) && !empty($reverseResult['ok']);
        $raw = json_encode($reverseResult, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $postflightTx = $db->beginTransaction();
        try {
            $state = $db->createCommand(
                'SELECT * FROM {{%payment_finalization}}
                  WHERE transaction_id=:tid
                  LIMIT 1
                  FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryOne();

            $db->createCommand(
                'SELECT id FROM {{%finance_transactions}} WHERE id=:tid FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryScalar();

            $db->createCommand(
                'SELECT id FROM {{%reserve}} WHERE id=:rid FOR UPDATE',
                [':rid' => (int)$reserve->id]
            )->queryScalar();

            $snapshot = $this->ticketSnapshotLocked((int)$reserve->id);

            /*
             * If any ticket evidence appeared while SEP was called, never
             * normalize the result automatically. This is the critical
             * "ticket and refund may both exist" alarm.
             */
            if ($snapshot['ticket_evidence']) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    $reverseOk
                        ? 'critical_reverse_confirmed_but_ticket_evidence_exists'
                        : 'reverse_attempted_and_ticket_evidence_exists',
                    [
                        'reverse_result' => $reverseResult,
                        'snapshot' => $snapshot,
                        'reason' => $reason,
                    ]
                );

                $db->createCommand(
                    'UPDATE {{%finance_transactions}}
                        SET status=:status
                      WHERE id=:tid
                        AND status<>:completed',
                    [
                        ':status' => FinanceTransactions::TRANSACTION_MANUAL_REVIEW,
                        ':tid' => (int)$transaction->id,
                        ':completed' => FinanceTransactions::TRANSACTION_COMPLETED,
                    ]
                )->execute();

                $postflightTx->commit();

                return $this->result(
                    false,
                    self::STATE_MANUAL_REVIEW,
                    $reverseOk
                        ? 'critical_reverse_and_ticket_manual_review'
                        : 'reverse_unknown_and_ticket_manual_review'
                );
            }

            if (!$state || (string)$state['state'] !== self::STATE_REVERSING) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'reverse_postflight_state_changed',
                    [
                        'reverse_result' => $reverseResult,
                        'state' => $state,
                        'reason' => $reason,
                    ]
                );
                $postflightTx->commit();

                return $this->result(false, self::STATE_MANUAL_REVIEW, 'reverse_postflight_state_changed');
            }

            if (!$reverseOk) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'reverse_result_ambiguous_or_failed',
                    ['reverse_result' => $reverseResult, 'reason' => $reason]
                );

                $db->createCommand(
                    'UPDATE {{%finance_transactions}}
                        SET status=:status
                      WHERE id=:tid
                        AND status<>:completed',
                    [
                        ':status' => FinanceTransactions::TRANSACTION_MANUAL_REVIEW,
                        ':tid' => (int)$transaction->id,
                        ':completed' => FinanceTransactions::TRANSACTION_COMPLETED,
                    ]
                )->execute();

                $postflightTx->commit();

                return $this->result(false, self::STATE_MANUAL_REVIEW, 'reverse_ambiguous_manual_review');
            }

            $now = time();

            $db->createCommand(
                'UPDATE {{%payment_finalization}}
                    SET state=:state,
                        reversed_at=:now,
                        gateway_result=:result,
                        last_error=:reason,
                        updated_at=:now
                  WHERE transaction_id=:tid',
                [
                    ':state' => self::STATE_REVERSED,
                    ':now' => $now,
                    ':result' => $raw,
                    ':reason' => $reason,
                    ':tid' => (int)$transaction->id,
                ]
            )->execute();

            $db->createCommand(
                'UPDATE {{%finance_transactions}}
                    SET status=:status
                  WHERE id=:tid
                    AND status<>:completed',
                [
                    ':status' => FinanceTransactions::TRANSACTION_REVERSED,
                    ':tid' => (int)$transaction->id,
                    ':completed' => FinanceTransactions::TRANSACTION_COMPLETED,
                ]
            )->execute();

            $db->createCommand(
                'UPDATE {{%reserve}}
                    SET status=:status, updated_at=:now
                  WHERE id=:rid
                    AND status<>:publish',
                [
                    ':status' => Reserve::STATUS_FAILED,
                    ':now' => $now,
                    ':rid' => (int)$reserve->id,
                    ':publish' => Reserve::STATUS_PUBLISH,
                ]
            )->execute();

            $db->createCommand(
                'UPDATE {{%schedule_seat}} ss
                  INNER JOIN {{%reserve_item}} ri ON ri.schedule_seats_id=ss.id
                     SET ss.status=:selectable,
                         ss.user_lock=NULL,
                         ss.last_lock_time=NULL,
                         ss.updated_at=:now
                   WHERE ri.reserve_id=:rid
                     AND ss.status=:pending
                     AND ss.user_lock=:uid',
                [
                    ':selectable' => ScheduleSeat::STATUS_SELECTABLE,
                    ':pending' => ScheduleSeat::STATUS_PENDING,
                    ':now' => $now,
                    ':rid' => (int)$reserve->id,
                    ':uid' => (int)$reserve->user_id,
                ]
            )->execute();

            CouponService::releaseCurrentByTransactionLocked(
                (int)$transaction->id,
                'payment_reversed_no_ticket'
            );

            $postflightTx->commit();

            return $this->result(false, self::STATE_REVERSED, 'payment_reversed_no_ticket');
        } catch (\Throwable $e) {
            if ($postflightTx->isActive) {
                $postflightTx->rollBack();
            }

            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'reverse_postflight_exception_external_result_unknown',
                [
                    'error' => $e->getMessage(),
                    'reason' => $reason,
                    'reverse_result' => $reverseResult,
                ]
            );
        }
    }

    private function prepareReverseState(
        FinanceTransactions $transaction,
        Reserve $reserve,
        string $reason
    ): array {
        $db = Yii::$app->db;
        $tx = $db->beginTransaction();
        try {
            $state = $db->createCommand(
                'SELECT * FROM {{%payment_finalization}} WHERE transaction_id=:tid LIMIT 1 FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryOne();
            $db->createCommand(
                'SELECT id FROM {{%reserve}} WHERE id=:rid FOR UPDATE',
                [':rid' => (int)$reserve->id]
            )->queryScalar();

            if (!$state) {
                throw new \RuntimeException('finalization_state_missing');
            }

            $current = (string)$state['state'];
            if ($current === self::STATE_COMPLETED || $current === self::STATE_ACCOUNTING_REVIEW) {
                $tx->commit();
                return $this->result(true, $current, 'already_finalized');
            }
            if ($current === self::STATE_REVERSED) {
                $tx->commit();
                return $this->result(false, self::STATE_REVERSED, 'already_reversed');
            }
            if ($current === self::STATE_MANUAL_REVIEW) {
                $tx->commit();
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'manual_review_required');
            }

            $snapshot = $this->ticketSnapshotLocked((int)$reserve->id);
            if ($snapshot['valid_ticket']) {
                $db->createCommand(
                    'UPDATE {{%payment_finalization}}
                     SET state=:state, ticket_issued_at=COALESCE(ticket_issued_at,:now), updated_at=:now
                     WHERE transaction_id=:tid',
                    [
                        ':state' => self::STATE_TICKET_ISSUED,
                        ':now' => time(),
                        ':tid' => (int)$transaction->id,
                    ]
                )->execute();
                $tx->commit();
                return $this->result(false, self::STATE_TICKET_ISSUED, 'ticket_exists_reverse_forbidden');
            }
            if ($snapshot['ticket_evidence']) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'partial_ticket_evidence_blocks_reverse',
                    $snapshot
                );
                $tx->commit();
                return $this->result(false, self::STATE_MANUAL_REVIEW, 'partial_ticket_evidence_blocks_reverse');
            }

            /*
             * SEP v3.6 documents a limited post-verify reversal window.
             * Do not fire an automatic financial action after that window.
             */
            $createdAt = (int)($transaction->created_at ?? 0);
            if ($createdAt > 0 && $createdAt < time() - (50 * 60)) {
                $this->setManualReviewLocked(
                    (int)$transaction->id,
                    'automatic_reverse_window_expired',
                    [
                        'transaction_created_at' => $createdAt,
                        'age_seconds' => time() - $createdAt,
                        'reason' => $reason,
                    ]
                );
                $db->createCommand(
                    'UPDATE {{%finance_transactions}}
                        SET status=:status
                      WHERE id=:tid
                        AND status<>:completed',
                    [
                        ':status' => FinanceTransactions::TRANSACTION_MANUAL_REVIEW,
                        ':tid' => (int)$transaction->id,
                        ':completed' => FinanceTransactions::TRANSACTION_COMPLETED,
                    ]
                )->execute();
                $tx->commit();

                return $this->result(false, self::STATE_MANUAL_REVIEW, 'automatic_reverse_window_expired');
            }

            $db->createCommand(
                'UPDATE {{%payment_finalization}}
                 SET state=:state, reverse_requested_at=COALESCE(reverse_requested_at,:now),
                     last_error=:reason, updated_at=:now
                 WHERE transaction_id=:tid',
                [
                    ':state' => self::STATE_REVERSING,
                    ':now' => time(),
                    ':reason' => $reason,
                    ':tid' => (int)$transaction->id,
                ]
            )->execute();

            $tx->commit();
            return $this->result(true, self::STATE_REVERSING, 'reverse_claimed');
        } catch (\Throwable $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'prepare_reverse_exception',
                ['error' => $e->getMessage(), 'reason' => $reason]
            );
        }
    }

    private function failBeforeVerify(
        FinanceTransactions $transaction,
        Reserve $reserve,
        string $reason,
        array $details = []
    ): array {
        $db = Yii::$app->db;
        $tx = $db->beginTransaction();
        try {
            $state = $db->createCommand(
                'SELECT * FROM {{%payment_finalization}} WHERE transaction_id=:tid LIMIT 1 FOR UPDATE',
                [':tid' => (int)$transaction->id]
            )->queryOne();
            $db->createCommand(
                'SELECT id FROM {{%reserve}} WHERE id=:rid FOR UPDATE',
                [':rid' => (int)$reserve->id]
            )->queryScalar();

            if ($state && in_array((string)$state['state'], [
                self::STATE_BANK_VERIFIED,
                self::STATE_ISSUING,
                self::STATE_TICKET_ISSUED,
                self::STATE_COMPLETED,
                self::STATE_ACCOUNTING_REVIEW,
                self::STATE_REVERSING,
                self::STATE_REVERSED,
            ], true)) {
                $tx->rollBack();
                return $this->markManualReview(
                    (int)$transaction->id,
                    (int)$reserve->id,
                    'fail_before_verify_called_after_bank_or_ticket_state',
                    ['reason' => $reason, 'details' => $details, 'state' => $state]
                );
            }

            $now = time();
            $db->createCommand(
                'UPDATE {{%payment_finalization}}
                 SET state=:state, last_error=:reason, gateway_result=:result, updated_at=:now
                 WHERE transaction_id=:tid',
                [
                    ':state' => self::STATE_FAILED_BEFORE_VERIFY,
                    ':reason' => $reason,
                    ':result' => json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    ':now' => $now,
                    ':tid' => (int)$transaction->id,
                ]
            )->execute();
            $db->createCommand(
                'UPDATE {{%finance_transactions}}
                 SET status=:status WHERE id=:tid AND status NOT IN (:paid,:completed)',
                [
                    ':status' => FinanceTransactions::TRANSACTION_SKIPPED,
                    ':tid' => (int)$transaction->id,
                    ':paid' => FinanceTransactions::TRANSACTION_PAID,
                    ':completed' => FinanceTransactions::TRANSACTION_COMPLETED,
                ]
            )->execute();
            $db->createCommand(
                'UPDATE {{%reserve}}
                 SET status=:status, updated_at=:now
                 WHERE id=:rid AND status<>:publish',
                [
                    ':status' => Reserve::STATUS_FAILED,
                    ':now' => $now,
                    ':rid' => (int)$reserve->id,
                    ':publish' => Reserve::STATUS_PUBLISH,
                ]
            )->execute();
            $db->createCommand(
                'UPDATE {{%schedule_seat}} ss
                 INNER JOIN {{%reserve_item}} ri ON ri.schedule_seats_id=ss.id
                 SET ss.status=:selectable, ss.user_lock=NULL, ss.last_lock_time=NULL, ss.updated_at=:now
                 WHERE ri.reserve_id=:rid
                   AND ss.status=:pending
                   AND ss.user_lock=:uid',
                [
                    ':selectable' => ScheduleSeat::STATUS_SELECTABLE,
                    ':pending' => ScheduleSeat::STATUS_PENDING,
                    ':now' => $now,
                    ':rid' => (int)$reserve->id,
                    ':uid' => (int)$reserve->user_id,
                ]
            )->execute();

            CouponService::releaseCurrentByTransactionLocked(
                (int)$transaction->id,
                'payment_failed_before_verify'
            );

            $tx->commit();
            return $this->result(false, self::STATE_FAILED_BEFORE_VERIFY, $reason);
        } catch (\Throwable $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }
            return $this->markManualReview(
                (int)$transaction->id,
                (int)$reserve->id,
                'fail_before_verify_exception',
                ['error' => $e->getMessage(), 'reason' => $reason]
            );
        }
    }

    private function markManualReview(
        int $transactionId,
        int $reserveId,
        string $reason,
        array $details = []
    ): array {
        $db = Yii::$app->db;
        $tx = $db->beginTransaction();
        try {
            $db->createCommand(
                'SELECT id FROM {{%payment_finalization}} WHERE transaction_id=:tid FOR UPDATE',
                [':tid' => $transactionId]
            )->queryScalar();
            $this->setManualReviewLocked($transactionId, $reason, $details);
            $db->createCommand(
                'UPDATE {{%finance_transactions}}
                 SET status=:status
                 WHERE id=:tid AND status<>:completed',
                [
                    ':status' => FinanceTransactions::TRANSACTION_MANUAL_REVIEW,
                    ':tid' => $transactionId,
                    ':completed' => FinanceTransactions::TRANSACTION_COMPLETED,
                ]
            )->execute();
            $tx->commit();
        } catch (\Throwable $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }
            Yii::error([
                'transaction_id' => $transactionId,
                'reserve_id' => $reserveId,
                'reason' => $reason,
                'details' => $details,
                'error' => $e->getMessage(),
            ], 'payment.finalization.manual_review');
        }

        return $this->result(false, self::STATE_MANUAL_REVIEW, $reason);
    }

    private function setManualReviewLocked(int $transactionId, string $reason, array $details = []): void
    {
        $now = time();

        Yii::$app->db->createCommand(
            'UPDATE {{%payment_finalization}}
                SET state=:state,
                    manual_review_at=COALESCE(manual_review_at,:now),
                    last_error=:reason,
                    gateway_result=:details,
                    updated_at=:now
              WHERE transaction_id=:tid',
            [
                ':state' => self::STATE_MANUAL_REVIEW,
                ':now' => $now,
                ':reason' => $reason,
                ':details' => json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ':tid' => $transactionId,
            ]
        )->execute();

        /*
         * Keep unresolved paid seats protected from the generic 10-minute
         * cleanup until a human or reconciliation process resolves them.
         */
        Yii::$app->db->createCommand(
            'UPDATE {{%schedule_seat}} ss
              INNER JOIN {{%reserve_item}} ri ON ri.schedule_seats_id=ss.id
              INNER JOIN {{%payment_finalization}} pf ON pf.reserve_id=ri.reserve_id
                 SET ss.last_lock_time=:now, ss.updated_at=:now
               WHERE pf.transaction_id=:tid
                 AND ss.status=:pending',
            [
                ':now' => $now,
                ':tid' => $transactionId,
                ':pending' => ScheduleSeat::STATUS_PENDING,
            ]
        )->execute();
    }

    private function markTicketIssued(int $transactionId, array $snapshot): void
    {
        $this->setState($transactionId, self::STATE_TICKET_ISSUED, null, $snapshot, true);
    }

    private function setState(
        int $transactionId,
        string $state,
        ?string $error = null,
        array $details = [],
        bool $ticketIssued = false
    ): void {
        $sql = 'UPDATE {{%payment_finalization}}
                SET state=:state, last_error=:error, gateway_result=:details,
                    updated_at=:now';
        if ($ticketIssued) {
            $sql .= ', ticket_issued_at=COALESCE(ticket_issued_at,:now)';
        }
        $sql .= ' WHERE transaction_id=:tid';

        Yii::$app->db->createCommand($sql, [
            ':state' => $state,
            ':error' => $error,
            ':details' => json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':now' => time(),
            ':tid' => $transactionId,
        ])->execute();
    }

    private function recordAttemptError(int $transactionId, string $error): void
    {
        Yii::$app->db->createCommand(
            'UPDATE {{%payment_finalization}}
             SET last_error=:error, updated_at=:now WHERE transaction_id=:tid',
            [':error' => $error, ':now' => time(), ':tid' => $transactionId]
        )->execute();
    }

    private function markCouponUsed(int $transactionId): void
    {
        try {
            CouponService::markUsedByTransaction($transactionId);
        } catch (\Throwable $e) {
            Yii::error([
                'transaction_id' => $transactionId,
                'error' => $e->getMessage(),
            ], 'payment.finalization.coupon');
        }
    }


    private function ticketSnapshot(int $reserveId): array
    {
        $db = Yii::$app->db;
        $tx = $db->beginTransaction();
        try {
            $db->createCommand(
                'SELECT id FROM {{%reserve}} WHERE id=:rid FOR UPDATE',
                [':rid' => $reserveId]
            )->queryScalar();
            $snapshot = $this->ticketSnapshotLocked($reserveId);
            $tx->commit();
            return $snapshot;
        } catch (\Throwable $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }
            return [
                'valid_ticket' => false,
                'ticket_evidence' => true,
                'error' => $e->getMessage(),
            ];
        }
    }

    private function ticketSnapshotLocked(int $reserveId): array
    {
        $reserve = Yii::$app->db->createCommand(
            'SELECT id, status, code, user_id FROM {{%reserve}} WHERE id=:rid LIMIT 1 FOR UPDATE',
            [':rid' => $reserveId]
        )->queryOne();

        if (!$reserve) {
            return [
                'valid_ticket' => false,
                'ticket_evidence' => false,
                'reason' => 'reserve_not_found',
            ];
        }

        $rows = Yii::$app->db->createCommand(
            'SELECT ss.id, ss.status, ss.user_lock
             FROM {{%reserve_item}} ri
             INNER JOIN {{%schedule_seat}} ss ON ss.id=ri.schedule_seats_id
             WHERE ri.reserve_id=:rid
             ORDER BY ss.id
             FOR UPDATE',
            [':rid' => $reserveId]
        )->queryAll();

        $unique = [];
        foreach ($rows as $row) {
            $unique[(int)$row['id']] = $row;
        }

        $expected = count($unique);
        $sold = 0;
        $soldOrExternallySold = 0;
        foreach ($unique as $row) {
            $seatStatus = (int)$row['status'];
            if ($seatStatus === ScheduleSeat::STATUS_SOLED) {
                $sold++;
            }
            if (in_array($seatStatus, [ScheduleSeat::STATUS_SOLED, ScheduleSeat::STATUS_SOLD_SITE], true)) {
                $soldOrExternallySold++;
            }
        }

        $hasCode = !empty($reserve['code']);
        $isPublished = (int)$reserve['status'] === Reserve::STATUS_PUBLISH;
        $valid = $expected > 0 && $hasCode && $isPublished && $sold === $expected;
        $evidence = $hasCode || $isPublished || $soldOrExternallySold > 0;

        return [
            'reserve_id' => $reserveId,
            'reserve_status' => (int)$reserve['status'],
            'code' => $reserve['code'],
            'expected_seat_count' => $expected,
            'sold_seat_count' => $sold,
            'sold_or_external_sold_count' => $soldOrExternallySold,
            'valid_ticket' => $valid,
            'ticket_evidence' => $evidence,
        ];
    }

    private function result(bool $ok, string $state, string $reason): array
    {
        return [
            'ok' => $ok,
            'state' => $state,
            'reason' => $reason,
        ];
    }
}
