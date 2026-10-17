<?php

namespace app\modules\finance\models;

use Yii;

/**
 * This is the model class for table "finance_wallet".
 *
 * @property integer $id
 * @property integer $created_at
 * @property integer $user_id
 * @property integer $amount
 * @property integer $transactioner
 * @property string $transactioner_ip
 * @property integer $bank_transaction_id
 * @property string $description
 * @property string $metadata
 */
class FinanceWallet extends \yii\db\ActiveRecord
{

    public $change_action;

    /**
     * @inheritdoc
     */
    public static function tableName()
    {
        return 'finance_wallet';
    }

    /**
     * @inheritdoc
     */
    public function rules()
    {
        return [
            [['created_at', 'user_id', 'amount', 'transactioner', 'transactioner_ip', 'description'], 'required'],
            [['created_at', 'user_id', 'transactioner', 'change_action', 'bank_transaction_id'], 'integer'],
            [['transactioner_ip', 'description', 'metadata'], 'string', 'max' => 255],
            ['amount', 'validateAmount'], // Custom validation for amount
        ];
    }

    /**
     * @inheritdoc
     */
    public function attributeLabels()
    {
        return [
            'id' => 'ID',
            'created_at' => 'زمان تراکنش',
            'user_id' => 'ذینفع',
            'amount' => 'مبلغ',
            'transactioner' => 'انجام دهنده',
            'transactioner_ip' => 'Ip انجام دهنده',
            'bank_transaction_id' => 'شناسه تراکنش بانکی',
            'description' => 'توضیحات',
            'metadata' => 'اطلاعات متا',
        ];
    }

    /**
     * اعتبار این کاربر که معادل موجودی حساب بعلاوه بر اعتباراین کاربر
     * @param type $user_id
     * @return int
     */
    public function validateAmount($attribute, $params)
    {
        // Remove commas from the amount field
        $value = str_replace(',', '', $this->$attribute);

        // Check if the value is a valid integer
        if (!is_numeric($value) || (int)$value != $value) {
            $this->addError($attribute, 'The amount must be a valid integer and can only contain commas for formatting.');
        }
    }

    static function credit($user_id)
    {
        $profile = \rabint\helpers\user::profile($user_id);
        $credit = $profile->credit ?? 0;
        $userCash = self::cash($user_id);
        return $credit + $userCash;
    }

    /**
     * موجودی حساب کاربر
     * @param type $user_id
     * @return int
     */
    static function cash($user_id)
    {
        $cash = FinanceWallet::find()->where(['user_id' => $user_id])->sum('amount');
        return intval($cash);
    }

    static function inc($user_id, $amount, $transactioner = '', $transactioner_ip = '::1', $description = '', $metadata = '', $bank_tid = null)
    {
        $wallet = new FinanceWallet();
        $wallet->created_at = time();
        $wallet->user_id = $user_id;
        $wallet->amount = $amount;
        $wallet->transactioner = $transactioner;
        $wallet->transactioner_ip = $transactioner_ip;
        $wallet->bank_transaction_id = $bank_tid;
        $wallet->description = $description;
        $wallet->metadata = json_encode($metadata);
//        $wallet->save();
        try {
            return ($wallet->save(false)) ? TRUE : FALSE;
        } catch (\yii\db\IntegrityException $e) {
            return false;
        }
    }

    static function dec($user_id, $amount, $transactioner = '', $transactioner_ip = '', $description = '', $metadata = '')
    {
        $userCredit = self::credit($user_id);
        if ($amount <= $userCredit) {
            $wallet = new FinanceWallet();
            $wallet->created_at = time();
            $wallet->user_id = $user_id;
            $wallet->amount = -1 * $amount;
            $wallet->transactioner = $transactioner;
            $wallet->transactioner_ip = $transactioner_ip;
            $wallet->description = $description;
            $wallet->metadata = json_encode($metadata);
            if ($wallet->save(false)) {
                if (self::credit($user_id) >= 0) {
                    return TRUE;
                } else {
                    $wallet->delete();
                }
            }
        }
        return FALSE;
    }

    static function validateAdditionalRows($aditionalData)
    {
        $err = 0;
        foreach ((array)$aditionalData as $row) {
            if (!isset($row['amount'])) {
                $err++;
            }
            if (!isset($row['description'])) {
                $err++;
            }
            if (!isset($row['user_id'])) {
                $err++;
            }
        }
        if ($err) {
            return false;
        }
        return true;
    }

    static function balancingPay($user_id, $aditionalData, $transactioner = '', $transactioner_ip = '', FinanceTransactions $transaction = null)
    {
        $allRows = [];
        foreach ((array)$aditionalData as $row) {
            if (!isset($row['amount'])) {
                continue;
            }

            $r_user_id = isset($row['user_id']) ? $row['user_id'] : $user_id;
            $amount=$transaction->paying_amount ?? $transaction->amount;
            if ($transaction && $amount !== null) {

                // Update additional_rows in the finance_transaction table
                $additionalRows = json_decode($transaction->additional_rows, true);
                if (is_array($additionalRows)) {
                    foreach ($additionalRows as &$additionalRow) {
                        if (isset($additionalRow['amount'])) {
                            $additionalRow['amount'] = $amount * getSign($additionalRow['amount']);
                        }
                    }
                    $transaction->additional_rows = json_encode($additionalRows);
                    $transaction->save(false);
                }
            }

            $allRows[] = [
                time(),
                $r_user_id,
                $row['amount'],
                $transactioner,
                $transactioner_ip,
                $row['description'],
                json_encode($row['metadata']),
            ];
        }

        if (empty($allRows)) {
            return false;
        }

        $tableName = 'finance_wallet';
        $connection = Yii::$app->db;
        $transaction = $connection->beginTransaction();
        try {
            $connection->createCommand()->batchInsert(
                $tableName,
                ['created_at', 'user_id', 'amount', 'transactioner', 'transactioner_ip', 'description', 'metadata'],
                $allRows
            )->execute();
            $transaction->commit();
            return true;
        } catch (\Exception $e) {
            $transaction->rollBack();
            return false;
        }
    }

    public function getTransactionerUser()
    {
        return $this->hasOne(\app\modules\user\models\User::className(), ['id' => 'transactioner']);
    }

    public function getUser()
    {
        return $this->hasOne(\app\modules\user\models\User::className(), ['id' => 'user_id']);
    }

}
