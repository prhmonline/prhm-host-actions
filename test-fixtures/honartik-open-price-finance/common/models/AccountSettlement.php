<?php

namespace common\models;

use rabint\option\models\Option;
use Yii;
use common\models\User;
use yii\helpers\ArrayHelper;
use app\modules\finance\services\OpenPriceSettlementGuard;

/**
 * This is the model class for table "account_settlement".
 *
 * @property integer $id
 * @property integer $user_id
 * @property integer $event_id
 * @property integer $net_amount
 * @property integer $gross_amount
 * @property integer $fee
 * @property integer $fee_additional
 * @property double $fee_percent
 * @property double $fee_additional_percent
 * @property string $min_date
 * @property string $max_date
 * @property integer $count_bench
 * @property integer $status
 * @property string $shaba_number
 * @property string $detail
 * @property string $description_owner
 * @property string $description
 * @property integer $account_user_id
 * @property integer $requested_at
 * @property integer $settled_at
 * @property integer $created_at
 * @property integer $updated_at
 * @property integer $created_by
 * @property integer $updated_by
 *
 * @property Reserve[] $reserves
 * @property SoldEvent[] $soldEvents
 */
class AccountSettlement extends \common\models\base\ActiveRecord     /* \yii\db\ActiveRecord */
{
    const SCENARIO_CUSTOM = 'custom';
    /* statuses */
    const STATUS_DRAFT = 0;
    const STATUS_PENDING = 1;
    const STATUS_PUBLISH = 2;
    const STATUS_PAYED = 3;


    /**
     * @inheritdoc
     */
    public static function tableName()
    {
        return 'account_settlement';
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
        return $scenarios;
    }


    /* ====================================================================== */

    public static function statuses()
    {
        return [
            static::STATUS_DRAFT => ['title' => \Yii::t('rabint', 'draft')],
            static::STATUS_PENDING => ['title' => \Yii::t('rabint', 'در انتظار'), "class" => "warning"],
            static::STATUS_PUBLISH => ['title' => \Yii::t('rabint', 'تایید شده'), "class" => "info"],
            static::STATUS_PAYED => ['title' => \Yii::t('rabint', 'پرداخت شده'), "class" => "success"],
        ];
    }

    /* ====================================================================== */

    /**
     * @inheritdoc
     */
    public function rules()
    {
        return [
            [['user_id', 'event_id', 'net_amount', 'gross_amount', 'fee', 'fee_additional', 'count_bench', 'status', 'account_user_id', 'requested_at', 'settled_at', 'created_at', 'updated_at', 'created_by', 'updated_by'], 'integer'],
            [['fee_percent', 'fee_additional_percent'], 'number'],
            [['detail', 'description_owner', 'description'], 'string'],
            [['min_date', 'max_date', 'shaba_number'], 'string', 'max' => 255],
            [['event_id'], 'exist', 'skipOnError' => true, 'targetClass' => Event::class, 'targetAttribute' => ['event_id' => 'id']],
        ];
    }

    /**
     * @inheritdoc
     */
    public function attributeLabels()
    {
        return [
            'id' => Yii::t('rabint', 'ID'),
            'user_id' => Yii::t('rabint', 'تهیه کننده'),
            'event_id' => Yii::t('app', 'Event ID'),
            'net_amount' => Yii::t('app', 'Net Amount'),
            'gross_amount' => Yii::t('app', 'Gross Amount'),
            'fee' => Yii::t('app', 'Fee'),
            'fee_additional' => Yii::t('app', 'Fee Additional'),
            'fee_percent' => Yii::t('app', 'Fee Percent'),
            'fee_additional_percent' => Yii::t('app', 'Fee Additional Percent'),
            'min_date' => Yii::t('rabint', 'از تاریخ'),
            'max_date' => Yii::t('rabint', 'تا تاریخ'),
            'count_bench' => Yii::t('rabint', 'تعداد بلیت'),
            'status' => Yii::t('rabint', 'وضعیت'),
            'shaba_number' => Yii::t('app', 'Shaba Number'),
            'detail' => Yii::t('app', 'Detail'),
            'description_owner' => Yii::t('rabint', 'توضیحات تهیه کننده'),
            'description' => Yii::t('rabint', 'شماره پیگیری پرداخت و توضیحات کاربر پرداخت کننده'),
            'account_user_id' => Yii::t('rabint', 'کاربر پرداخت کننده'),
            'requested_at' => Yii::t('app', 'Requested At'),
            'settled_at' => Yii::t('app', 'Settled At'),
            'created_at' => Yii::t('app', 'Created At'),
            'updated_at' => Yii::t('app', 'Updated At'),
            'created_by' => Yii::t('app', 'Created By'),
            'updated_by' => Yii::t('app', 'Updated By'),
        ];
    }

    /**
     * @inheritdoc
     */
    //    public function beforeSave($insert)
//    {
//        if ($this->isNewRecord && !Yii::$app->user->can("manager"))
//            $this->user_id = Yii::$app->user->id;
//        if (!Yii::$app->user->can("manager") && $this->user_id != Yii::$app->user->id) {
//            return false;
//        }
//        if (!empty($this->max_date)) {
//            $this->max_date = \rabint\helpers\locality::anyToGregorian($this->max_date, "Y-m-d");
//        }
//        if (!empty($this->min_date)) {
//            $this->min_date = \rabint\helpers\locality::anyToGregorian($this->min_date, "Y-m-d");
//        }
//        if ($this->min_date >= date("Y-m-d")) {
//            $this->addError("min_date", "بازه تاریخ باید برای روزهای گذشته باشد.");
//        }
//        if ($this->max_date >= date("Y-m-d")) {
//            $this->addError("max_date", "بازه تاریخ باید برای روزهای گذشته باشد.");
//        }
//        if ($this->isNewRecord) {
//            $percentage = Option::get("general")[0];
//            $event_id = ArrayHelper::getColumn(Event::find()->select(["id"])->where(["manager_id" => $this->user_id])->all(), "id");
//            $reserve = Reserve::find()->joinWith("reserveItems")->joinWith("transaction")->joinWith("schedule")
//                ->where(["and", ["schedule.event_id" => $event_id, "reserve.status" => Reserve::STATUS_PUBLISH, "account_settlement_id" => null], ["<=", "schedule.date", $this->max_date], [">=", "schedule.date", $this->min_date]]);
//            $amount = $reserve->sum("amount");
//            $karmod_sell = $percentage['karmozd'] ?: 0;
//            $karmod_owner = $percentage['karmozd_owner'] ?: 0;
//            $amount = ($amount * 100) / (100 + $karmod_sell);
//            if (empty($this->status))
//                $this->status = Reserve::STATUS_PENDING;
//            if ($amount == 0) {
//                $this->addError("max_date", "میزان طلب شما در این بازه تاریخ صفر است.");
//            }
//
//            $this->count_bench = $reserve->count("reserve_item.id");
//            $this->amount = $amount * (100 - $karmod_owner) / 100;
//            $this->fee = $amount * $karmod_owner / 100;
//            $this->percentage = $karmod_owner;
//            if ($this->hasErrors()) {
//                return false;
//            }
//        }
//
//
//        return parent::beforeSave($insert);
//    }

    /**
     * Fail closed when approving/paying a producer settlement containing an
     * open-price excess with no approved beneficiary-allocation policy.
     * Legacy (non-opt-in) settlements take the existing path untouched.
     *
     * NOTE: This protects ActiveRecord save() transitions, not direct updateAll
     * or external settlements. Final payout UAT remains a release requirement.
     */
    public function beforeSave($insert)
    {
        if ((int)$this->status >= self::STATUS_PUBLISH) {
            try {
                $review = $this->reviewOpenPriceForApproval();
            } catch (\Throwable $e) {
                Yii::error([
                    'settlement_id' => (int)$this->id,
                    'exception_class' => get_class($e),
                ], 'open_price.settlement.review_failed');
                $this->addError('status', 'بررسی مالی سفارش‌های قیمت آزاد در دسترس نیست؛ تأیید تسویه متوقف شد.');
                return false;
            }

            if (!$review['ok']) {
                Yii::warning([
                    'settlement_id' => (int)$this->id,
                    'review_reason' => $review['reason'],
                    'reviewed_count' => $review['reviewed_count'],
                    'held_count' => $review['held_count'],
                ], 'open_price.settlement.approval_held');
                $this->addError('status', 'این تسویه شامل مبلغ مازاد قیمت آزاد یا مغایرت مالی است و نیاز به بررسی تخصیص وجه دارد.');
                return false;
            }
        }

        return parent::beforeSave($insert);
    }

    private function reviewOpenPriceForApproval(): array
    {
        $ownerEventIds = ArrayHelper::getColumn(
            Event::find()->select(['id'])->where(['manager_id' => $this->user_id])->asArray()->all(),
            'id'
        );

        $candidateConditions = null;
        if ($ownerEventIds && $this->min_date && $this->max_date) {
            $candidateConditions = [
                'and',
                ['r.account_settlement_id' => null],
                ['s.event_id' => $ownerEventIds],
                ['between', 's.date', $this->min_date, $this->max_date],
            ];
        }

        if (!$this->isNewRecord && $this->id !== null) {
            // Evaluate reservations already attached to this settlement too.
            $attached = ['r.account_settlement_id' => (int)$this->id];
            $candidateConditions = $candidateConditions
                ? ['or', $attached, $candidateConditions]
                : $attached;
        }

        if (!$candidateConditions) {
            return OpenPriceSettlementGuard::review([]);
        }

        $rows = Reserve::find()->alias('r')
            ->select([
                'r.free_price_enabled_snapshot',
                'r.free_price_original_amount',
                'r.free_price_minimum_amount',
                'r.free_price_proposed_amount',
                'r.free_price_gateway_amount',
                'r.free_price_extra_amount',
                'ft.amount AS bank_transaction_amount',
                'ft.paying_amount AS bank_paying_amount',
            ])
            ->innerJoin('{{%schedule}} s', 's.id = r.schedule_id')
            ->leftJoin('{{%finance_transactions}} ft', 'ft.id = r.transaction_id')
            ->where(['r.status' => Reserve::STATUS_PUBLISH, 'r.free_price_enabled_snapshot' => 1])
            ->andWhere($candidateConditions)
            ->asArray()
            ->all();

        return OpenPriceSettlementGuard::review($rows);
    }

    public function afterSave($insert, $changedAttributes)
    {
        if ($insert) {
            $event_id = ArrayHelper::getColumn(Event::find()->select(["id"])->where(["manager_id" => $this->user_id])->all(), "id");
            $reserve = Reserve::find()->joinWith("reserveItems")->joinWith("transaction")->joinWith("schedule")
                ->where(["and", ["schedule.event_id" => $event_id, "reserve.status" => Reserve::STATUS_PUBLISH, "account_settlement_id" => null], ["<=", "schedule.date", $this->max_date], [">=", "schedule.date", $this->min_date]])
                ->all();
            foreach ($reserve as $item) {
                $item->account_settlement_id = $this->id;
                $item->save();
            }
        }
        parent::afterSave($insert, $changedAttributes); // TODO: Change the autogenerated stub
    }


    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getReserves()
    {
        return $this->hasMany(Reserve::class, ['account_settlement_id' => 'id']);
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
    public function delete()
    {
        if ($this->status >= AccountSettlement::STATUS_PUBLISH)
            return false;
        if (!Yii::$app->user->can("manager") && $this->user_id != Yii::$app->user->id) {
            return false;
        }
        Reserve::updateAll(["account_settlement_id" => null], ["account_settlement_id" => $this->id]);
        return parent::delete(); // TODO: Change the autogenerated stub
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getSoldEvents()
    {
        return $this->hasMany(SoldEvent::class, ['account_settlement_id' => 'id']);
    }

    public function getEvent()
    {
        return $this->hasOne(Event::class, ['id' => 'event_id']);
    }

}
