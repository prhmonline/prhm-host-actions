<?php

namespace common\models;

use Yii;
use app\modules\finance\services\OpenPriceSettlementGuard;

/**
 * This is the model class for table "sold_event".
 *
 * @property int $id
 * @property string $jalali_date Jalali date of calculating
 * @property string $date Date of calculating
 * @property int|null $event_id Event ID
 * @property string $event_name Event Name
 * @property int $count_schedule Count of Schedule Sold
 * @property int $count_ticket Count of Tickets Sold
 * @property int $amount Total Amount
 * @property int $income_amount Income Amount
 * @property int $fee Fee Amount
 * @property int $fee_additional Fee Additional Amount
 * @property float $fee_percent Fee Percentage
 * @property float $fee_additional_percent Fee Additional Percentage
 * @property int|null $account_settlement_id Account Settlement ID
 * @property int $settlement_status
 * @property int|null $requested_at Requested At
 * @property int|null $settled_at Settled At
 * @property int|null $created_at Created At
 * @property int|null $updated_at Updated At
 *
 * @property AccountSettlement $accountSettlement
 * @property Event $event
 * @property SoldEventSchedule[] $soldEventSchedules
 */
class SoldEvent extends \common\models\base\ActiveRecord
{
    const STATUS_NOT_SETTLED = 0;
    const STATUS_REQUESTED = 1;
    const STATUS_SETTLED = 2;

    /**
     * {@inheritdoc}
     */
    public static function tableName()
    {
        return 'sold_event';
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
//           [
//               'class' => \yii\behaviors\BlameableBehavior::class,
//               'createdByAttribute' => 'created_by',
//               'updatedByAttribute' => 'updated_by',
//           ],
//           [
//               'class' => \rabint\behaviors\SoftDeleteBehavior::class,
//               'attribute' => 'deleted_at',
//               'attribute' => 'deleted_by',
//           ],
            /*[
            'class' => \rabint\behaviors\Slug::class,
            'sourceAttributeName' => 'title', // If you want to make a slug from another attribute, set it here
            'slugAttributeName' => 'slug', // Name of the attribute containing a slug
            ],*/
        ];
    }

    public static function statuses()
    {
        return [
            static::STATUS_NOT_SETTLED => ['title' => \Yii::t('app', 'Not settled'), 'class' => 'success'],
            static::STATUS_REQUESTED => ['title' => \Yii::t('app', 'Requested'), 'class' => 'warning'],
            static::STATUS_SETTLED => ['title' => \Yii::t('app', 'Settled'), 'class' => 'default'],
        ];
    }

    /**
     * {@inheritdoc}
     */
    public function rules()
    {
        return [
            [['jalali_date', 'date', 'event_name', 'count_schedule', 'count_ticket', 'amount', 'income_amount', 'fee', 'fee_additional', 'fee_percent', 'fee_additional_percent'], 'required'],
            [['date'], 'safe'],
            [['event_id', 'count_schedule', 'count_ticket', 'amount', 'income_amount', 'fee', 'fee_additional', 'account_settlement_id', 'settlement_status', 'requested_at', 'settled_at', 'created_at', 'updated_at'], 'integer'],
            [['fee_percent', 'fee_additional_percent'], 'number'],
            [['jalali_date'], 'string', 'max' => 10],
            [['event_name'], 'string', 'max' => 255],
            [['date', 'event_id'], 'unique', 'targetAttribute' => ['date', 'event_id']],
            [['account_settlement_id'], 'exist', 'skipOnError' => true, 'targetClass' => AccountSettlement::class, 'targetAttribute' => ['account_settlement_id' => 'id']],
            [['event_id'], 'exist', 'skipOnError' => true, 'targetClass' => Event::class, 'targetAttribute' => ['event_id' => 'id']],
        ];
    }

    /**
     * {@inheritdoc}
     */
    public function attributeLabels()
    {
        return [
            'id' => Yii::t('app', 'ID'),
            'jalali_date' => Yii::t('app', 'Jalali Date'),
            'date' => Yii::t('app', 'Date'),
            'event_id' => Yii::t('app', 'Event ID'),
            'event_name' => Yii::t('app', 'Event Name'),
            'count_schedule' => Yii::t('app', 'Count Schedule'),
            'count_ticket' => Yii::t('app', 'Count Ticket'),
            'amount' => Yii::t('app', 'Amount'),
            'income_amount' => Yii::t('app', 'Income Amount'),
            'fee' => Yii::t('app', 'Fee'),
            'fee_additional' => Yii::t('app', 'Fee Additional'),
            'fee_percent' => Yii::t('app', 'Fee Percent'),
            'fee_additional_percent' => Yii::t('app', 'Fee Additional Percent'),
            'account_settlement_id' => Yii::t('app', 'Account Settlement ID'),
            'settlement_status' => Yii::t('app', 'Settlement Status'),
            'requested_at' => Yii::t('app', 'Requested At'),
            'settled_at' => Yii::t('app', 'Settled At'),
            'created_at' => Yii::t('app', 'Created At'),
            'updated_at' => Yii::t('app', 'Updated At'),
        ];
    }

    /**
     * Gets query for [[AccountSettlement]].
     *
     * @return \yii\db\ActiveQuery
     */
    public function getAccountSettlement()
    {
        return $this->hasOne(AccountSettlement::class, ['id' => 'account_settlement_id']);
    }

    /**
     * Gets query for [[Event]].
     *
     * @return \yii\db\ActiveQuery
     */
    public function getEvent()
    {
        return $this->hasOne(Event::class, ['id' => 'event_id']);
    }

    /**
     * Gets query for [[SoldEventSchedules]].
     *
     * @return \yii\db\ActiveQuery
     */
    public function getSoldEventSchedules()
    {
        return $this->hasMany(SoldEventSchedule::class, ['sold_event_id' => 'id']);
    }

    /**
     * A second producer settlement entry point, historically calling updateAll
     * directly (and therefore bypassing AccountSettlement::beforeSave).
     * Fail closed for any published open-price reserve with unallocated excess
     * or inconsistent original/bank snapshot. This does NOT assign ownership
     * of voluntary contributions or execute an actual bank payout.
     */
    public static function markAsSettledByEventIds(array $eventIds)
    {
        if (!$eventIds) {
            return 0;
        }
        $ids = [];
        foreach ($eventIds as $id) {
            if ((!is_int($id) && (!is_string($id) || !ctype_digit($id))) ||
                (int)$id <= 0 || (string)(int)$id !== (string)$id) {
                Yii::warning('Producer settlement event scope rejected', 'open_price.sold_event_scope');
                return 0;
            }
            $ids[(int)$id] = (int)$id;
        }
        $ids = array_values($ids);
        try {
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
                ->where([
                    's.event_id' => $ids,
                    'r.status' => Reserve::STATUS_PUBLISH,
                    'r.free_price_enabled_snapshot' => 1,
                ])
                ->asArray()->all();
            $review = OpenPriceSettlementGuard::review($rows);
            if (!$review['ok']) {
                Yii::warning([
                    'review_reason' => $review['reason'],
                    'reviewed_count' => $review['reviewed_count'],
                    'held_count' => $review['held_count'],
                ], 'open_price.sold_event_approval_held');
                return 0;
            }
        } catch (\Throwable $e) {
            Yii::error([
                'exception_class' => get_class($e),
            ], 'open_price.sold_event_review_failed');
            return 0;
        }
        return self::updateAll(
            ['settlement_status' => self::STATUS_REQUESTED],
            ['event_id' => $ids, 'settlement_status' => self::STATUS_NOT_SETTLED]
        );
    }
}
