<?php



namespace app\modules\finance\models;



include_once dirname(__DIR__) . '/Config.php';



use Yii;

use app\modules\finance\models\FinanceWallet;

use app\modules\finance\Config;



use common\models\User;





class FinanceTransactions extends Config

{



    static $defaultPaymentGatewayId = 7;



    /**

     * @param $tid

     * @return array

     */

    static function getGatewayData($tid)

    {

        $model = FinanceTransactions::findOne($tid);

        if (empty($model))

            return FALSE;

        return json_decode($model->gateway_meta, 1);

    }



    static function setGatewayData($tid, $data)

    {

        $model = FinanceTransactions::findOne($tid);

        if (empty($model))

            return FALSE;

        $model->gateway_meta = json_encode($data);

        return ($model->save(false)) ? TRUE : FALSE;

    }



    static function setPayFailed($model)

    {

        $model->status = self::TRANSACTION_SKIPPED;

        return ($model->save(false)) ? TRUE : FALSE;

    }



    static function setPayPaid($model, $gateway_reciept, $gateway_meta)

    {

        $model->status = self::TRANSACTION_PAID;

        $model->gateway_reciept = (string)$gateway_reciept;

        $model->gateway_meta = \yii\helpers\Json::encode($gateway_meta);

        return ($model->save(false)) ? TRUE : FALSE;

    }



    static function setPayVerified($model)
    {
        if (!$model instanceof self || empty($model->id)) {
            return false;
        }

        $db = Yii::$app->db;
        $dbTransaction = $db->beginTransaction();

        try {
            $db->createCommand(
                'SELECT id FROM {{%finance_transactions}} WHERE id=:id FOR UPDATE',
                [':id' => (int)$model->id]
            )->queryScalar();

            /** @var self|null $lockedModel */
            $lockedModel = self::findOne((int)$model->id);
            if (!$lockedModel) {
                throw new \RuntimeException('Finance transaction not found while completing accounting.');
            }

            $transactionId = (int)$lockedModel->id;
            $transactioner = (int)$lockedModel->transactioner;
            $amount = (int)$lockedModel->amount;
            $transactionerIp = (string)$lockedModel->transactioner_ip;

            if ($amount < 0) {
                throw new \RuntimeException('Negative payment amount is not allowed.');
            }

            $primaryWallet = FinanceWallet::find()
                ->where(['bank_transaction_id' => $transactionId])
                ->one();

            if ($amount > 0) {
                if ($primaryWallet) {
                    if ((int)$primaryWallet->user_id !== $transactioner || (int)$primaryWallet->amount !== $amount) {
                        throw new \RuntimeException('Existing primary wallet row does not match the bank transaction.');
                    }
                } else {
                    $primaryWallet = new FinanceWallet();
                    $primaryWallet->created_at = time();
                    $primaryWallet->user_id = $transactioner;
                    $primaryWallet->amount = $amount;
                    $primaryWallet->transactioner = $transactioner;
                    $primaryWallet->transactioner_ip = $transactionerIp;
                    $primaryWallet->bank_transaction_id = $transactionId;
                    $primaryWallet->description = 'شارژ حساب کاربر بر اثر پرداخت شماره: ' . $transactionId;
                    $primaryWallet->metadata = \yii\helpers\Json::encode([
                        'payment_transaction_id' => $transactionId,
                        'payment_ledger_role' => 'primary_credit',
                    ]);

                    if (!$primaryWallet->save(false)) {
                        throw new \RuntimeException('Primary wallet row could not be saved.');
                    }
                }
            } elseif ($primaryWallet && (int)$primaryWallet->amount !== 0) {
                throw new \RuntimeException('A non-zero primary wallet row exists for a zero-amount transaction.');
            }

            $additionalRows = json_decode((string)$lockedModel->additional_rows, true);
            if (!is_array($additionalRows)) {
                $additionalRows = [];
            }

            foreach (array_values($additionalRows) as $index => $row) {
                if (!is_array($row) || !array_key_exists('amount', $row)) {
                    continue;
                }

                $beneficiary = array_key_exists('user_id', $row)
                    ? (int)$row['user_id']
                    : $transactioner;
                $rowAmount = (int)$row['amount'];

                // Zero-amount coupon transactions must not create meaningless ledger rows.
                if ($rowAmount === 0) {
                    continue;
                }

                $rowTransactioner = array_key_exists('transactioner', $row)
                    ? (int)$row['transactioner']
                    : $transactioner;
                $rowIp = !empty($row['transactioner_ip'])
                    ? (string)$row['transactioner_ip']
                    : $transactionerIp;
                $description = !empty($row['description'])
                    ? (string)$row['description']
                    : 'ثبت ردیف حسابداری پرداخت شماره: ' . $transactionId;

                $metadataPayload = [
                    'payment_transaction_id' => $transactionId,
                    'payment_row_index' => (int)$index,
                    'source_metadata' => $row['metadata'] ?? null,
                ];
                $metadata = \yii\helpers\Json::encode($metadataPayload);
                if (strlen($metadata) > 255) {
                    $metadata = \yii\helpers\Json::encode([
                        'payment_transaction_id' => $transactionId,
                        'payment_row_index' => (int)$index,
                    ]);
                }

                /** @var FinanceWallet|null $existingRow */
                $existingRow = FinanceWallet::find()
                    ->where(['metadata' => $metadata])
                    ->one();

                if ($existingRow) {
                    if ((int)$existingRow->user_id !== $beneficiary || (int)$existingRow->amount !== $rowAmount) {
                        throw new \RuntimeException('Existing balancing wallet row does not match the expected values.');
                    }
                    continue;
                }

                $walletRow = new FinanceWallet();
                $walletRow->created_at = time();
                $walletRow->user_id = $beneficiary;
                $walletRow->amount = $rowAmount;
                $walletRow->transactioner = $rowTransactioner;
                $walletRow->transactioner_ip = $rowIp;
                $walletRow->bank_transaction_id = null;
                $walletRow->description = $description;
                $walletRow->metadata = $metadata;

                if (!$walletRow->save(false)) {
                    throw new \RuntimeException('Balancing wallet row could not be saved. row_index=' . $index);
                }
            }

            $lockedModel->status = self::TRANSACTION_COMPLETED;
            if (!$lockedModel->save(false)) {
                throw new \RuntimeException('Finance transaction could not be marked completed.');
            }

            $couponRows = $db->createCommand(
                'UPDATE {{%coupon_use}} '
                . ' SET status=1, used_at=COALESCE(used_at,:now), expires_at=NULL, '
                . '     released_at=NULL, release_reason=NULL, is_current=1, updated_at=:now '
                . ' WHERE finance_transaction_id=:tid AND is_current=1 AND status IN (0,1)',
                [':now' => time(), ':tid' => $transactionId]
            )->execute();

            if ((int)$couponRows > 1) {
                throw new \RuntimeException('More than one current coupon row exists for the transaction.');
            }

            $dbTransaction->commit();
            $model->refresh();
            return true;
        } catch (\Throwable $e) {
            if ($dbTransaction->isActive) {
                $dbTransaction->rollBack();
            }

            Yii::error([
                'transaction_id' => (int)($model->id ?? 0),
                'exception' => get_class($e),
                'message' => $e->getMessage(),
            ], 'payment.accounting.atomic_completion');

            return false;
        }
    }



    /**

     * @return \common\models\base\ActiveQuery

     */

    public function getTransactionerUser()

    {

        return $this->hasOne(User::className(), ['id' => 'transactioner']);

    }

}

