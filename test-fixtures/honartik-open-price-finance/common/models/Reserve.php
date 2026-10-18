<?php

namespace common\models;

use app\components\external\base;
use app\modules\finance\addons\WalletGateway;
use rabint\helpers\locality;
use rabint\notify\models\Notification;
use Yii;
use common\models\User;
use app\modules\finance\models\FinanceTransactions;
use app\modules\finance\models\FinanceWallet;
use app\modules\finance\services\PaymentNotificationOutbox;
use app\modules\ticketing\adapters\HonartikReservationAdapter;
use app\modules\ticketing\adapters\HonartikReservationRecordWriter;
use Prhm\TicketingCore\Reservation\ReservationCommand;
use yii\helpers\ArrayHelper;
use yii\helpers\Url;

/**
 * This is the model class for table "reserve".
 *
 * @property integer $id
 * @property integer $gid
 * @property integer $user_id
 * @property integer $schedule_id
 * @property integer $transaction_id
 * @property integer $event_id
 * @property integer $place_id
 * @property integer $venue_id
 * @property integer $client
 * @property integer $account_settlement_id
 * @property string $date
 * @property string $start_at
 * @property integer $status
 * @property integer $is_print
 * @property integer $created_at
 * @property integer $updated_at
 * @property integer $created_by
 * @property integer $updated_by
 *
 * @property ReserveItem[] $reserveItems
 * @property Schedule $schedule
 * @property User $user
 * @property FinanceTransactions $transaction
 *  @property User $createdBy
 * @property User $updatedBy
 */
class Reserve extends \common\models\base\ActiveRecord     /* \yii\db\ActiveRecord */
{
    const SCENARIO_CUSTOM = 'custom';
    const SCENARIO_CONFIRM = 'confirm';
    /* statuses */
    const STATUS_CANCEL = 0;
    const STATUS_PENDING = 1;
    const STATUS_PUBLISH = 2;
    const STATUS_FAILED = 3;

    const CLIENT_SITE = 1;
    const CLIENT_GISHE = 2;

    public $ids;

    /**
     * @inheritdoc
     */
    public static function tableName()
    {
        return 'reserve';
    }

    private static function GenerateCode()
    {
        do {
            $code = random_int(10000000, 99999999);
            $e = Reserve::findOne(["code" => $code]);
        } while ($e);
        return $code;
    }


    public function behaviors()
    {
        return [
            [
                'class' => \yii\behaviors\TimestampBehavior::class,
                'createdAtAttribute' => 'created_at',
                'updatedAtAttribute' => 'updated_at',
                'value' => time(),
            ],
            [
                'class' => \yii\behaviors\BlameableBehavior::class,
                'createdByAttribute' => 'created_by',
                'updatedByAttribute' => 'updated_by',
            ],
            // [
//     'class' =>\rabint\behaviors\SoftDeleteBehavior::class,
//     'attribute' => 'deleted_at',
//     'attribute' => 'deleted_by',
// ],
            /*[
            'class' => \rabint\behaviors\Slug::class,
            'sourceAttributeName' => 'title', // If you want to make a slug from another attribute, set it here
            'slugAttributeName' => 'slug', // Name of the attribute containing a slug
            ],*/
        ];
    }

    public function scenarios()
    {
        $scenarios = parent::scenarios();
        // $scenarios[self::SCENARIO_CUSTOM] = ['status'];
        $scenarios[self::SCENARIO_CONFIRM] = ['status'];
        return $scenarios;
    }


    /* ====================================================================== */

    public static function statuses()
    {
        return [
            static::STATUS_CANCEL => ['title' => \Yii::t('rabint', 'کنسل شده'), "class" => "danger"],
            static::STATUS_PENDING => ['title' => \Yii::t('rabint', 'pending'), "class" => "warning"],
            static::STATUS_PUBLISH => ['title' => \Yii::t('rabint', 'فروخته شده'), "class" => "success"],
            static::STATUS_FAILED => ['title' => \Yii::t('app', 'Failed'), "class" => "danger"],
        ];
    }

    /* ====================================================================== */

    public static function clients()
    {
        return [
            static::CLIENT_GISHE => ['title' => \Yii::t('rabint', 'گیشه')],
            static::CLIENT_SITE => ['title' => \Yii::t('rabint', 'سایت')],
        ];
    }
    /* ====================================================================== */

    /**
     * @inheritdoc
     */
    public function rules()
    {
        return [
            [['gid', 'client', 'is_print', 'user_id', 'schedule_id', 'transaction_id', 'account_settlement_id', 'place_id', 'venue_id', 'event_id', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'code', 'free_price_enabled_snapshot', 'free_price_original_amount', 'free_price_minimum_amount', 'free_price_proposed_amount', 'free_price_gateway_amount', 'free_price_extra_amount'], 'integer'],
            [["date", "start_at"], "string", "max" => 255],
            [["ids"], "safe"],
            //            [['schedule_id'], 'exist', 'skipOnError' => true, 'targetClass' => Schedule::class, 'targetAttribute' => ['schedule_id' => 'id']],
            [['transaction_id'], 'exist', 'skipOnError' => true, 'targetClass' => FinanceTransactions::class, 'targetAttribute' => ['transaction_id' => 'id']],
            [['created_by'], 'exist', 'skipOnError' => true, 'targetClass' => User::class, 'targetAttribute' => ['created_by' => 'id']],
            [['updated_by'], 'exist', 'skipOnError' => true, 'targetClass' => User::class, 'targetAttribute' => ['updated_by' => 'id']],
        ];
    }

    /**
     * @inheritdoc
     */
    public function attributeLabels()
    {
        return [
            'id' => Yii::t('rabint', 'ID'),
            'gid' => Yii::t('rabint', 'شناسه خارجی'),
            'is_print' => Yii::t('rabint', 'وضعیت پرینت'),
            'user_id' => Yii::t('rabint', 'کاربر'),
            'venue_id' => Yii::t('rabint', 'سالن'),
            'code' => Yii::t('rabint', 'کد بلیت'),
            'schedule_id' => Yii::t('rabint', 'اکران'),
            'client' => Yii::t('rabint', 'کلاینت'),
            'transaction_id' => Yii::t('rabint', 'شناسه فاکتور'),
            'free_price_enabled_snapshot' => 'قیمت آزاد',
            'free_price_original_amount' => 'مجموع قیمت پایه بلیت‌ها (تومان)',
            'free_price_minimum_amount' => 'حداقل مبلغ نهایی (تومان)',
            'free_price_proposed_amount' => 'مبلغ پیشنهادی (تومان)',
            'free_price_gateway_amount' => 'مبلغ ارسالی به درگاه (تومان)',
            'free_price_extra_amount' => 'مبلغ مازاد (تومان)',
            'event_id' => Yii::t('rabint', 'برنامه'),
            'status' => Yii::t('rabint', 'وضعیت'),
            'account_settlement_id' => Yii::t('rabint', 'تسویه حساب تهیه کننده'),
            'created_at' => Yii::t('app', 'Created At'),
            'updated_at' => Yii::t('app', 'Updated At'),
            'created_by' => Yii::t('app', 'Created By'),
            'updated_by' => Yii::t('app', 'Updated By'),
        ];
    }

    public function fields()
    {
        return [
            'id',
            'gid',
            'user_id',
            'schedule_id',
            'transaction',
            'event',
            'status',
            'code',
            'place_id',
            'venue_id',
            'reserveItems',
            'is_print'
        ];
    }
    /**
     * @inheritdoc
     */
    public function beforeSave($insert)
    {

        //if(!empty($this->publish_at)){
//    $this->publish_at = \rabint\helpers\locality::anyToGregorian($this->publish_at);
//    $this->publish_at = strtotime($this->publish_at);// if timestamp needs
//}
        return parent::beforeSave($insert);
    }

    public function afterSave($insert, $changedAttributes)
    {
        if ($insert && $this->ids) {
            foreach ($this->ids as $id) {
                $schedule_seat = ScheduleSeat::findOne($id);

                if (empty($schedule_seat)) {
                    Yii::error("ScheduleSeat not found while creating reserve item. seat_id=" . $id . ", reserve_id=" . $this->id, __METHOD__);
                    continue;
                }

                $r = new ReserveItem();

                $values = [
                    'reserve_id' => $this->id,
                    'user_id' => $this->user_id,
                    'current_price' => $schedule_seat->price,
                    'schedule_seats_id' => $id,
                    'row' => $schedule_seat->seat ? $schedule_seat->seat->row : null,
                    'number' => $schedule_seat->seat ? $schedule_seat->seat->number : null,
                    'schedule_id' => $this->schedule_id,
                    'event_id' => $this->event_id,
                    'place_id' => $this->place_id,
                    'venue_id' => $this->venue_id,
                    'created_at' => time(),
                    'updated_at' => time(),
                    'created_by' => $this->user_id,
                    'updated_by' => $this->user_id,
                ];

                foreach ($values as $attr => $value) {
                    if ($r->hasAttribute($attr)) {
                        $r->$attr = $value;
                    }
                }

                try {
                    if (!$r->save(false)) {
                        Yii::error([
                            'reserve_id' => $this->id,
                            'schedule_seats_id' => $id,
                            'errors' => $r->errors,
                        ], __METHOD__);
                    }
                } catch (\Throwable $e) {
                    Yii::error([
                        'reserve_id' => $this->id,
                        'schedule_seats_id' => $id,
                        'exception' => get_class($e),
                        'message' => $e->getMessage(),
                    ], __METHOD__);

                    throw $e;
                }
            }
        }
        if ($this->status == Reserve::STATUS_PUBLISH) {
            $ids = ArrayHelper::getColumn($this->reserveItems, "schedule_seats_id");
            if (!empty($ids)) {
                // Safety guard: never overwrite unrelated/free seats as sold from afterSave.
                ScheduleSeat::updateAll(
                    ["status" => ScheduleSeat::STATUS_SOLED],
                    [
                        "and",
                        ["id" => $ids],
                        ["status" => ScheduleSeat::STATUS_PENDING],
                        ["user_lock" => $this->user_id],
                    ]
                );
            }
        } elseif ($this->status == Reserve::STATUS_CANCEL) {
            $ids = ArrayHelper::getColumn($this->reserveItems, "schedule_seats_id");
            if (!empty($ids)) {
                // Cancelled sold tickets must release their seats back to selectable.
                ScheduleSeat::updateAll(
                    ["status" => ScheduleSeat::STATUS_SELECTABLE, "last_lock_time" => null, "user_lock" => null],
                    [
                        "and",
                        ["id" => $ids],
                        ["status" => [ScheduleSeat::STATUS_PENDING, ScheduleSeat::STATUS_SOLED]],
                    ]
                );
            }
        } elseif ($this->status == Reserve::STATUS_FAILED) {
            $ids = ArrayHelper::getColumn($this->reserveItems, "schedule_seats_id");
            if (!empty($ids)) {
                // Failed reservations only release seats that are still temporarily locked by this reserve user.
                ScheduleSeat::updateAll(
                    ["status" => ScheduleSeat::STATUS_SELECTABLE, "last_lock_time" => null, "user_lock" => null],
                    [
                        "and",
                        ["id" => $ids],
                        ["status" => ScheduleSeat::STATUS_PENDING],
                        ["user_lock" => $this->user_id],
                    ]
                );
            }
        }
        parent::afterSave($insert, $changedAttributes); // TODO: Change the autogenerated stub
    }

    public static function setReserve($ids, $are_karmozd = true, $user_id = null)
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)$ids))));

        if (empty($ids)) {
            return false;
        }

        $userId = $user_id ?? Yii::$app->user->id;
        $now = time();
        $dbTransaction = Yii::$app->db->beginTransaction();

        try {
            /*
             * Do not release expired locks here. The centralized cleanup service
             * serializes with payment finalization and protects paid/manual-review
             * reservations. The cron/API cleanup will release genuinely abandoned
             * locks within at most one minute.
             */
            $schedules = ScheduleSeat::find()
                ->where(["id" => $ids, "status" => ScheduleSeat::STATUS_SELECTABLE])
                ->all();

            if (count($schedules) !== count($ids)) {
                throw new \RuntimeException("Some selected seats are not available anymore.");
            }

            $scheduleIds = array_unique(ArrayHelper::getColumn($schedules, "schedule_id"));
            if (count($scheduleIds) !== 1) {
                throw new \RuntimeException("Selected seats must belong to one schedule.");
            }

            // قفل اتمیک: فقط صندلی‌هایی lock می‌شوند که همین لحظه هنوز SELECTABLE باشند
            $locked = ScheduleSeat::updateAll(
                [
                    "status" => ScheduleSeat::STATUS_PENDING,
                    "last_lock_time" => $now,
                    "user_lock" => $userId,
                ],
                [
                    "and",
                    ["id" => $ids],
                    ["status" => ScheduleSeat::STATUS_SELECTABLE],
                ]
            );

            if ((int)$locked !== count($ids)) {
                throw new \RuntimeException("Seat lock failed because one or more seats were taken concurrently.");
            }

            /** @var ScheduleSeat $scheduleSeat */
            $scheduleSeat = $schedules[0];
            $reservationCommand = new ReservationCommand(
                'honartik',
                'honartik-reserve-' . $userId . '-' . $now,
                'honartik-reservation-' . $userId . '-' . $now . '-' . bin2hex(random_bytes(4)),
                (string)$scheduleSeat->schedule_id,
                array_map('strval', $ids),
                (string)$userId,
                $now,
                $now + 600,
            );

            $reservationId = (new HonartikReservationAdapter(new HonartikReservationRecordWriter()))
                ->createPending($reservationCommand);
            $reserve = \app\modules\api\models\Reserve::findOne((int)$reservationId);
            if ($reserve === null) {
                throw new \RuntimeException("Adapter-created reserve was not found: " . $reservationId);
            }

            $opts = \rabint\option\models\Option::get('general')[0];
            $amount = array_sum(ArrayHelper::getColumn($reserve->reserveItems, "current_price"));

            if ((int)$amount <= 0) {
                $amount = array_sum(ArrayHelper::getColumn($schedules, "price"));
                Yii::warning("Reserve amount fallback from schedule_seat. reserve_id=" . $reserve->id . ", amount=" . $amount, __METHOD__);
            }

            $karmozd = 0;
            $eventModel = Event::findOne($reserve->event_id);

            if (!empty($opts["karmozd"]) && !empty($eventModel) && $eventModel->need_karmozd == 1) {
                $karmozd = $are_karmozd ? $amount * ($opts["karmozd"] / 100) : 0;
            }

            $sum_amount = $amount + $karmozd;
            $event = $reserve->schedule->event->title;
            $token = md5($reserve->id . "fun");

            $additional_rows = [
                [
                    "requested_time" => $now,
                    "user_id" => $userId,
                    "amount" => $sum_amount * -1,
                    "transactioner" => $userId,
                    "transactioner_ip" => Yii::$app->request->userIP,
                    "description" => "پرداخت هزینه بلیت $event",
                    "metadata" => null
                ],
                [
                    "requested_time" => $now,
                    "user_id" => 0,
                    "amount" => $sum_amount * 1,
                    "transactioner" => $userId,
                    "transactioner_ip" => Yii::$app->request->userIP,
                    "description" => "دریافت هزینه صورت حساب بلیت $event",
                    "metadata" => null
                ]
            ];

            $meta = [];
            foreach (array_count_values(ArrayHelper::getColumn($reserve->reserveItems, "current_price")) as $key => $item) {
                $meta[] = ["هزینه بلیت $event", $item, $key, $key * $item];
            }

            if ($karmozd > 0) {
                $meta[] = ["هزینه کارمزد صورت حساب", 1, $karmozd, $karmozd];
            }

            $transaction = new FinanceTransactions;
            $transaction->created_at = $now;
            $transaction->transactioner = $userId;
            $transaction->amount = $sum_amount;
            $transaction->status = FinanceTransactions::TRANSACTION_PENDING;
            $transaction->gateway = 1;
            $transaction->gateway_reciept = null;
            $transaction->gateway_meta = null;
            $transaction->transactioner_ip = Yii::$app->getRequest()->getUserIP();
            $transaction->internal_reciept = 'reserve-' . $token;
            $transaction->settle_callback_function = json_encode([
                "model" => Reserve::className(),
                "method" => "settleReserve",
                "failure_method" => "failReservePayment",
                "params" => [
                    "reserve_id" => $reserve->id,
                    "final_price" => $sum_amount
                ]
            ]);
            $transaction->token = md5(uniqid('FinanceTransactions', true));
            $transaction->return_url = \yii\helpers\Url::to(['/reserve/success', 'id' => $reserve->id, "token" => $token]);
            $transaction->additional_rows = json_encode($additional_rows);
            $transaction->metadata = json_encode($meta);

            if (!$transaction->save()) {
                throw new \RuntimeException("Transaction save failed: " . json_encode($transaction->errors, JSON_UNESCAPED_UNICODE));
            }

            $reserve->transaction_id = $transaction->id;
            // Freeze schedule opt-in when the reservation is created.
            $reserve->free_price_enabled_snapshot = (int)$reserve->schedule->free_price_enabled;
            if ((int)$reserve->free_price_enabled_snapshot === 1) {
                $reserve->free_price_original_amount = (int)$amount;
                $reserve->free_price_minimum_amount = (int)$sum_amount;
            }

            if (!$reserve->save()) {
                throw new \RuntimeException("Reserve transaction attach failed: " . json_encode($reserve->errors, JSON_UNESCAPED_UNICODE));
            }

            $dbTransaction->commit();
            return $reserve;
        } catch (\Throwable $e) {
            $dbTransaction->rollBack();

            Yii::error([
                'ids' => $ids,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ], 'reserve.seat_lock');

            return false;
        }
    }


    public static function WalletPay($reserve)
    {
        $reserveId = $reserve instanceof self ? (int)$reserve->id : (int)$reserve;
        $db = Yii::$app->db;
        $lockName = null;
        $lockAcquired = false;
        $walletDebited = false;
        $reserveModel = null;
        $transaction = null;

        if ($reserveId <= 0) {
            Yii::error(['reserve_id' => $reserveId], 'reserve.admin_wallet_pay.invalid_reserve');
            return false;
        }

        try {
            $reserveModel = self::findOne($reserveId);
            if (!$reserveModel || empty($reserveModel->transaction)) {
                throw new \RuntimeException('Reserve or finance transaction was not found.');
            }

            $transaction = $reserveModel->transaction;
            $userId = (int)$transaction->transactioner;

            if ($userId <= 0 || $userId !== (int)$reserveModel->user_id) {
                throw new \RuntimeException('Reserve owner does not match the finance transaction owner.');
            }

            $lockName = 'honartik:wallet:user:' . $userId;
            $lockAcquired = (int)$db->createCommand(
                'SELECT GET_LOCK(:lock_name, 10)',
                [':lock_name' => $lockName]
            )->queryScalar() === 1;

            if (!$lockAcquired) {
                throw new \RuntimeException('Could not acquire the wallet payment lock.');
            }

            $reserveModel->refresh();
            $transaction = $reserveModel->transaction;

            if (
                (int)$transaction->status === FinanceTransactions::TRANSACTION_COMPLETED
                && (int)$reserveModel->status === self::STATUS_PUBLISH
                && !empty($reserveModel->code)
            ) {
                return true;
            }

            if ((int)$reserveModel->status !== self::STATUS_PENDING) {
                throw new \RuntimeException('Reserve is not pending.');
            }

            if ((int)$transaction->status !== FinanceTransactions::TRANSACTION_PENDING) {
                throw new \RuntimeException('Finance transaction is not pending.');
            }

            $amount = (int)$transaction->amount;
            if ($amount < 0) {
                throw new \RuntimeException('Negative wallet payment amount is not allowed.');
            }

            $additionalRows = json_decode((string)$transaction->additional_rows, true);
            if (!is_array($additionalRows)) {
                throw new \RuntimeException('Wallet accounting rows are invalid.');
            }

            $walletRows = [];
            $expectedRows = [];

            foreach (array_values($additionalRows) as $index => $row) {
                if (!is_array($row) || !array_key_exists('amount', $row)) {
                    continue;
                }

                $rowAmount = (int)$row['amount'];
                if ($rowAmount === 0) {
                    continue;
                }

                $marker = [
                    'admin_wallet_transaction_id' => (int)$transaction->id,
                    'row_index' => (int)$index,
                ];
                $markerJson = json_encode($marker);

                $row['metadata'] = $marker;
                $walletRows[] = $row;
                $expectedRows[] = [
                    'metadata' => $markerJson,
                    'user_id' => array_key_exists('user_id', $row) ? (int)$row['user_id'] : $userId,
                    'amount' => $rowAmount,
                ];
            }

            if ($amount > 0 && empty($walletRows)) {
                throw new \RuntimeException('Wallet accounting rows are empty.');
            }

            $existingCount = 0;
            foreach ($expectedRows as $expectedRow) {
                $existingRow = FinanceWallet::find()
                    ->where(['metadata' => $expectedRow['metadata']])
                    ->one();

                if (!$existingRow) {
                    continue;
                }

                if (
                    (int)$existingRow->user_id !== (int)$expectedRow['user_id']
                    || (int)$existingRow->amount !== (int)$expectedRow['amount']
                ) {
                    throw new \RuntimeException('Existing wallet accounting row does not match the expected values.');
                }

                $existingCount++;
            }

            if ($existingCount > 0 && $existingCount !== count($expectedRows)) {
                throw new \RuntimeException('Wallet payment has partially written accounting rows.');
            }

            if ($existingCount === 0 && !empty($walletRows)) {
                $cash = (int)FinanceWallet::cash($userId);
                if ($amount > $cash) {
                    self::failPendingWalletReserveBeforeDebit($reserveModel, $transaction, 'insufficient_wallet');
                    return false;
                }

                $walletDebited = FinanceWallet::balancingPay(
                    $userId,
                    $walletRows,
                    $userId,
                    (string)$transaction->transactioner_ip,
                    $transaction
                );

                if (!$walletDebited) {
                    throw new \RuntimeException('Wallet balancing operation failed.');
                }
            } elseif ($existingCount === count($expectedRows) && $existingCount > 0) {
                $walletDebited = true;
            }

            if (!FinanceTransactions::setGatewayData($transaction->id, [
                'ResCode' => 0,
                'RefId' => 'admin-wallet-' . $transaction->id,
            ])) {
                throw new \RuntimeException('Wallet gateway data could not be stored.');
            }

            $transaction->refresh();
            $gateway = new WalletGateway();
            $gateway->afterPay($transaction);

            $reserveModel->refresh();
            $transaction->refresh();

            $isCompleted =
                (int)$transaction->status === FinanceTransactions::TRANSACTION_COMPLETED
                && (int)$reserveModel->status === self::STATUS_PUBLISH
                && !empty($reserveModel->code);

            if (!$isCompleted) {
                Yii::error([
                    'reserve_id' => (int)$reserveModel->id,
                    'transaction_id' => (int)$transaction->id,
                    'reserve_status' => (int)$reserveModel->status,
                    'transaction_status' => (int)$transaction->status,
                    'wallet_debited' => $walletDebited,
                ], 'reserve.admin_wallet_pay.final_state_invalid');
            }

            return $isCompleted;
        } catch (\Throwable $e) {
            Yii::error([
                'reserve_id' => $reserveId,
                'transaction_id' => $transaction ? (int)$transaction->id : null,
                'wallet_debited' => $walletDebited,
                'exception' => get_class($e),
                'message' => $e->getMessage(),
            ], 'reserve.admin_wallet_pay.exception');

            return false;
        } finally {
            if ($lockAcquired && $lockName !== null) {
                try {
                    $db->createCommand(
                        'SELECT RELEASE_LOCK(:lock_name)',
                        [':lock_name' => $lockName]
                    )->queryScalar();
                } catch (\Throwable $e) {
                    Yii::error([
                        'reserve_id' => $reserveId,
                        'lock_name' => $lockName,
                        'message' => $e->getMessage(),
                    ], 'reserve.admin_wallet_pay.release_lock_failed');
                }
            }
        }
    }

    private static function failPendingWalletReserveBeforeDebit($reserveModel, $transaction, $reason)
    {
        $dbTransaction = Yii::$app->db->beginTransaction();

        try {
            Yii::$app->db->createCommand(
                'SELECT id FROM reserve WHERE id=:id FOR UPDATE',
                [':id' => (int)$reserveModel->id]
            )->queryScalar();
            Yii::$app->db->createCommand(
                'SELECT id FROM finance_transactions WHERE id=:id FOR UPDATE',
                [':id' => (int)$transaction->id]
            )->queryScalar();

            $lockedReserve = self::findOne((int)$reserveModel->id);
            $lockedTransaction = FinanceTransactions::findOne((int)$transaction->id);

            if (
                $lockedReserve
                && $lockedTransaction
                && (int)$lockedReserve->status === self::STATUS_PENDING
                && (int)$lockedTransaction->status === FinanceTransactions::TRANSACTION_PENDING
            ) {
                $lockedTransaction->status = FinanceTransactions::TRANSACTION_FAILED;
                $lockedTransaction->save(false);

                $lockedReserve->status = self::STATUS_FAILED;
                $lockedReserve->save(false);
            }

            $dbTransaction->commit();

            Yii::warning([
                'reserve_id' => (int)$reserveModel->id,
                'transaction_id' => (int)$transaction->id,
                'reason' => $reason,
            ], 'reserve.admin_wallet_pay.failed_before_debit');
        } catch (\Throwable $e) {
            if ($dbTransaction->isActive) {
                $dbTransaction->rollBack();
            }

            Yii::error([
                'reserve_id' => (int)$reserveModel->id,
                'transaction_id' => (int)$transaction->id,
                'reason' => $reason,
                'message' => $e->getMessage(),
            ], 'reserve.admin_wallet_pay.fail_cleanup_exception');
        }
    }

    public function failReservePayment($params)
    {
        $reserveId = (int)($params['reserve_id'] ?? 0);
        if ($reserveId <= 0) {
            return false;
        }

        $dbTransaction = Yii::$app->db->beginTransaction();
        try {
            Yii::$app->db->createCommand('SELECT id FROM reserve WHERE id=:id FOR UPDATE', [':id' => $reserveId])->queryScalar();
            $reserveModel = self::findOne($reserveId);
            if (!$reserveModel || empty($reserveModel->transaction_id)) {
                $dbTransaction->rollBack();
                return false;
            }

            Yii::$app->db->createCommand('SELECT id FROM finance_transactions WHERE id=:id FOR UPDATE', [':id' => (int)$reserveModel->transaction_id])->queryScalar();
            $transactionModel = FinanceTransactions::findOne((int)$reserveModel->transaction_id);
            $terminalFailureStatuses = [
                FinanceTransactions::TRANSACTION_SKIPPED,
                FinanceTransactions::TRANSACTION_FAILED,
                FinanceTransactions::TRANSACTION_REVERSED,
            ];

            if ($transactionModel && (int)$reserveModel->status === self::STATUS_PENDING && in_array((int)$transactionModel->status, $terminalFailureStatuses, true)) {
                $reserveModel->status = self::STATUS_FAILED;
                $reserveModel->save(false);
            }

            $dbTransaction->commit();
            return true;
        } catch (\Throwable $e) {
            if ($dbTransaction->isActive) {
                $dbTransaction->rollBack();
            }
            Yii::error(['reserve_id' => $reserveId, 'exception_class' => get_class($e), 'message' => $e->getMessage()], 'reserve.payment_failure.finalize');
            return false;
        }
    }

    public function settleReserve($params)
    {
        $reserveId = (int)($params['reserve_id'] ?? 0);
        if ($reserveId <= 0) {
            Yii::error(['params' => $params], 'reserve.settle.invalid_params');
            return false;
        }

        $dbTransaction = Yii::$app->db->beginTransaction();

        try {
            // Lock reserve row to make ticket issuance idempotent under concurrent callbacks.
            Yii::$app->db->createCommand(
                'SELECT id FROM reserve WHERE id = :id FOR UPDATE',
                [':id' => $reserveId]
            )->queryScalar();

            $reserveModel = \common\models\Reserve::findOne($reserveId);
            if (empty($reserveModel)) {
                Yii::error(['reserve_id' => $reserveId], 'reserve.settle.not_found');
                $dbTransaction->rollBack();
                return false;
            }

            // Idempotency: if ticket was already issued, do not run the settlement again.
            if (!empty($reserveModel->code) && (int)$reserveModel->status === self::STATUS_PUBLISH) {
                $dbTransaction->commit();
                return true;
            }

            $transctionIsOk = false;
            $tries = 3;

            while ($tries > 0) {
                $reserveModel->refresh();
                $transactionModel = $reserveModel->transaction;

                if (!empty($transactionModel) && $transactionModel->status == FinanceTransactions::TRANSACTION_COMPLETED) {
                    $transctionIsOk = true;
                    break;
                } elseif (!empty($transactionModel) && $transactionModel->status == FinanceTransactions::TRANSACTION_PAID) {
                    if (strlen($transactionModel->gateway_reciept) > 0 && strlen($transactionModel->gateway_meta) > 0) {
                        if (strpos($transactionModel->gateway_meta, $transactionModel->gateway_reciept) !== false) {
                            $transctionIsOk = true;
                            break;
                        }
                    }
                }

                usleep(200000);
                $tries--;
            }

            if (!$transctionIsOk) {
                Yii::error([
                    'reserve_id' => $reserveModel->id,
                    'transaction_id' => $reserveModel->transaction_id,
                    'message' => 'Transaction is not completed, settlement skipped.',
                ], 'reserve.settle.payment_not_completed');

                $dbTransaction->rollBack();
                return false;
            }

            $ids = array_values(array_unique(array_filter(array_map('intval', ArrayHelper::getColumn($reserveModel->reserveItems, "schedule_seats_id")))));

            if (empty($ids)) {
                $reserveModel->status = self::STATUS_FAILED;
                $reserveModel->save(false);
                Yii::error(['reserve_id' => $reserveModel->id], 'reserve.settle.no_items');
                $dbTransaction->commit();
                return false;
            }

            $placeholders = [];
            $binds = [];
            foreach ($ids as $i => $seatId) {
                $key = ':sid' . $i;
                $placeholders[] = $key;
                $binds[$key] = $seatId;
            }

            // Lock all selected schedule seats for this settlement.
            $seatRows = Yii::$app->db->createCommand(
                'SELECT id, status, user_lock FROM schedule_seat WHERE id IN (' . implode(',', $placeholders) . ') FOR UPDATE',
                $binds
            )->queryAll();

            if (count($seatRows) !== count($ids)) {
                $reserveModel->status = self::STATUS_FAILED;
                $reserveModel->save(false);
                Yii::error([
                    'reserve_id' => $reserveModel->id,
                    'expected_ids' => $ids,
                    'found_rows' => $seatRows,
                ], 'reserve.settle.seat_rows_missing');

                $dbTransaction->commit();
                return false;
            }

            $validPendingCount = 0;
            foreach ($seatRows as $row) {
                if ((int)$row['status'] === ScheduleSeat::STATUS_PENDING && (int)$row['user_lock'] === (int)$reserveModel->user_id) {
                    $validPendingCount++;
                }
            }

            if ($validPendingCount !== count($ids)) {
                // Do not sell SELECTABLE seats after payment; if lock expired/lost, mark as failed for refund/support flow.
                ScheduleSeat::updateAll(
                    ["status" => ScheduleSeat::STATUS_SELECTABLE, "last_lock_time" => null, "user_lock" => null],
                    [
                        "and",
                        ["id" => $ids],
                        ["status" => ScheduleSeat::STATUS_PENDING],
                        ["user_lock" => $reserveModel->user_id],
                    ]
                );

                $reserveModel->status = self::STATUS_FAILED;
                $reserveModel->save(false);

                Yii::error([
                    'reserve_id' => $reserveModel->id,
                    'expected_ids' => count($ids),
                    'valid_pending_count' => $validPendingCount,
                    'seat_rows' => $seatRows,
                    'message' => 'Seat lock was lost or expired before settlement.',
                ], 'reserve.settle.seat_lock_lost');

                $dbTransaction->commit();
                return false;
            }

            $updated = ScheduleSeat::updateAll(
                ["status" => ScheduleSeat::STATUS_SOLED],
                [
                    "and",
                    ["id" => $ids],
                    ["status" => ScheduleSeat::STATUS_PENDING],
                    ["user_lock" => $reserveModel->user_id],
                ]
            );

            if ((int)$updated !== count($ids)) {
                $reserveModel->status = self::STATUS_FAILED;
                $reserveModel->save(false);

                Yii::error([
                    'reserve_id' => $reserveModel->id,
                    'expected_update' => count($ids),
                    'updated' => $updated,
                    'message' => 'Atomic seat finalization failed.',
                ], 'reserve.settle.finalize_failed');

                $dbTransaction->commit();
                return false;
            }

            if (empty($reserveModel->code)) {
                $reserveModel->code = self::GenerateCode();
            }

            $reserveModel->status = self::STATUS_PUBLISH;
            $saveResult = $reserveModel->save(false);
            if ($saveResult !== true) {
                throw new \RuntimeException('reserve_publish_save_failed');
            }

            $dbTransaction->commit();

            /*
             * Notification delivery is deliberately outside the critical ticket transaction.
             * A failed/slow SMS must never roll back the issued ticket or the sold seats.
             */
            try {
                PaymentNotificationOutbox::enqueueReserveTicket(
                    (int)$reserveModel->transaction_id,
                    (int)$reserveModel->id,
                    (int)$reserveModel->user_id
                );
            } catch (\Throwable $e) {
                Yii::error([
                    'reserve_id' => (int)$reserveModel->id,
                    'transaction_id' => (int)$reserveModel->transaction_id,
                    'exception_class' => get_class($e),
                    'exception_message' => $e->getMessage(),
                ], 'payment.notification.enqueue_after_ticket');
            }

            return true;
        } catch (\Throwable $e) {
            if ($dbTransaction->isActive) {
                $dbTransaction->rollBack();
            }

            Yii::error([
                'reserve_id' => $reserveId,
                'exception' => get_class($e),
                'message' => $e->getMessage(),
            ], 'reserve.settle.exception');

            return false;
        }
    }


    public function getReserveItems()
    {
        return $this->hasMany(ReserveItem::class, ['reserve_id' => 'id']);
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getSchedule()
    {
        return $this->hasOne(Schedule::class, ['id' => 'schedule_id']);
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getTransaction()
    {
        return $this->hasOne(FinanceTransactions::class, ['id' => 'transaction_id']);
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getPlace()
    {
        return $this->hasOne(Place::class, ['id' => 'place_id']);
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getEvent()
    {
        return $this->hasOne(Event::class, ['id' => 'event_id']);
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getVenue()
    {
        return $this->hasOne(Venue::class, ['id' => 'venue_id']);
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getUser()
    {
        return $this->hasOne(User::class, ['id' => 'user_id']);
    }
    /**
     * Gets query for [[CreatedBy]].
     *
     * @return \common\models\base\ActiveQuery
     */
    public function getCreatedBy()
    {
        return $this->hasOne(User::class, ['id' => 'created_by']);
    }

    /**
     * Gets query for [[UpdatedBy]].
     *
     * @return \common\models\base\ActiveQuery
     */
    public function getUpdatedBy()
    {
        return $this->hasOne(User::class, ['id' => 'updated_by']);
    }
    /**
     * @inheritdoc
     * @return \rabint\models\query\PublishQuery the active query used by this AR class.
     */
    //public static function find()
    //{
    //    $publishQuery = new \rabint\models\query\PublishQuery(get_called_class());
    //    $publishQuery->statusField="status";
    //    $publishQuery->activeStatusValue=self::STATUS_PUBLISH;
    //    $publishQuery->ownerField="creator_id";
    //    $publishQuery->showNotActiveToOwners=true;
    //    return $publishQuery;
    //}

}
