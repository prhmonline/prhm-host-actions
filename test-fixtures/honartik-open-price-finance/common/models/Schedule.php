<?php

namespace common\models;

use rabint\helpers\locality;
use Yii;
use common\models\User;

/**
 * This is the model class for table "schedule".
 *
 * @property integer $id
 * @property integer $gid
 * @property string $bid_proposal
 * @property integer $free_price_enabled
 * @property string|null $free_price_description
 * @property string $description
 * @property integer $event_id
 * @property integer $venue_id
 * @property integer $venue_template_id
 * @property integer $sales_start_at
 * @property integer $sales_end_at
 * @property string $date
 * @property string $prices
 * @property string $start_at
 * @property integer $status
 * @property integer $offer
 * @property integer $is_cancel_able
 * @property integer $created_at
 * @property integer $updated_at
 * @property integer $created_by
 * @property integer $updated_by
 *
 * @property Event $event
 * @property Reserve[] $reserves
 * @property ScheduleSeat[] $scheduleSeats
 * @property Venue $venue
 *  @property User $createdBy
 * @property User $updatedBy
 */
class Schedule extends \common\models\base\ActiveRecord     /* \yii\db\ActiveRecord */
{
    const SCENARIO_CUSTOM = 'custom';
    /* statuses */
    const STATUS_DRAFT = 0;
    const STATUS_PENDING = 1;
    const STATUS_PUBLISH = 2;

    public $place_id;

    public $start_sell_clock;
    public $end_sell_clock;
    public $start_sell_date;
    public $end_sell_date;
    public $count_repeat;

    /**
     * @inheritdoc
     */
    public static function tableName()
    {
        return 'schedule';
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
            //static::STATUS_PENDING => ['title' => \Yii::t('rabint', 'pending')],
            static::STATUS_PUBLISH => ['title' => \Yii::t('rabint', 'publish')],
        ];
    }

    /* ====================================================================== */

    /**
     * @inheritdoc
     */
    public function rules()
    {
        return [
            [
                [
                    'start_sell_clock',
                    'end_sell_clock',
                    'start_sell_date',
                    'end_sell_date',
                    'venue_template_id',
                    'event_id',
                    'venue_id',
                    'status',
                    'date',
                    'start_at'
                ],
                'required'
            ],
            [['gid', "offer", 'is_cancel_able', 'venue_template_id', 'event_id', 'venue_id', 'sales_start_at', 'sales_end_at', 'status', 'count_repeat', 'created_at', 'updated_at', 'created_by', 'updated_by', 'free_price_enabled'], 'integer'],
            [['date', 'place_id'], 'safe'],
            [['free_price_description'], 'string'],
            [['free_price_enabled'], 'default', 'value' => 0],
            [['free_price_enabled'], 'in', 'range' => [0, 1]],
            [['start_sell_clock', 'end_sell_clock', 'start_sell_date', 'end_sell_date'], 'safe'],
            [['description', 'start_at', 'bid_proposal'], 'string', 'max' => 255],
            [['start_at', 'start_sell_clock', 'end_sell_clock'], 'match', 'pattern' => '/[0-2][0-9]:[0-5][0-9]/i'],
            [['event_id'], 'exist', 'skipOnError' => true, 'targetClass' => Event::class, 'targetAttribute' => ['event_id' => 'id']],
            [['venue_id'], 'exist', 'skipOnError' => true, 'targetClass' => Venue::class, 'targetAttribute' => ['venue_id' => 'id']],
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
            'gid' => Yii::t('rabint', 'Gid'),
            'bid_proposal' => Yii::t('rabint', 'طرح بها'),
            'free_price_enabled' => 'قیمت آزاد',
            'free_price_description' => 'توضیحات قیمت آزاد',
            'is_cancel_able' => Yii::t('rabint', 'کنسل کردن بلیت'),
            'venue_template_id' => Yii::t('rabint', 'قالب سانس'),
            'description' => Yii::t('rabint', 'توضیحات'),
            'event_id' => Yii::t('rabint', 'برنامه'),
            'venue_id' => Yii::t('rabint', 'سالن'),
            'sales_start_at' => Yii::t('rabint', 'زمان شروع فروش اینترنتی'),
            'sales_end_at' => Yii::t('rabint', 'زمان پایان فروش اینترنتی'),
            'date' => Yii::t('rabint', 'تاریخ اکران'),
            'start_at' => Yii::t('rabint', 'ساعت اکران'),
            'status' => Yii::t('rabint', 'وضعیت'),
            'created_at' => Yii::t('rabint', 'ایجاد شده در'),
            'updated_at' => Yii::t('rabint', 'تاریخ آخرین بروزرسانی'),
            'created_by' => Yii::t('rabint', 'ایجاد شده توسط'),
            'updated_by' => Yii::t('rabint', 'بروزشده توسط'),
            'offer' => Yii::t('rabint', 'درصد تخفیف'),
            'from_date' => Yii::t('rabint', 'از تاریخ'),
            'to_date' => Yii::t('rabint', 'تا تاریخ'),
        ];
    }

    /**
     * @inheritdoc
     */
    public function beforeSave($insert)
    {
        if (!empty($this->date)) {
            $this->date = \rabint\helpers\locality::anyToGregorian($this->date);
            //    $this->publish_at = strtotime($this->publish_at);// if timestamp needs
        }
        if (!empty($this->start_sell_date) && !empty($this->start_sell_clock)) {
            $this->start_sell_date = \rabint\helpers\locality::anyToGregorian($this->start_sell_date, "Y-m-d");
            $this->sales_start_at = strtotime($this->start_sell_date . " " . $this->start_sell_clock);// if timestamp needs
        }
        if (!empty($this->end_sell_date) && !empty($this->end_sell_clock)) {
            $this->end_sell_date = \rabint\helpers\locality::anyToGregorian($this->end_sell_date, "Y-m-d");
            $this->sales_end_at = strtotime($this->end_sell_date . " " . $this->end_sell_clock);// if timestamp needs
        }

        return parent::beforeSave($insert);
    }

    public function afterSave($insert, $changedAttributes)
    {

        $template = VenueScheduleTemplate::findOne($this->venue_template_id);
        foreach ($template->venueScheduleTemplateSeats as $seat_template) {
            $ScheduleSeat = ScheduleSeat::find()
                ->where([
                    'schedule_id' => $this->id,
                    'seat_id' => $seat_template->seat_id
                ])
                ->one();
            if (empty($ScheduleSeat)) {
                $s = new ScheduleSeat();
                $s->schedule_id = $this->id;
                $s->seat_id = $seat_template->seat_id;
                $s->status = $seat_template->status;
                $s->price = $seat_template->price;
                $s->save();
            }


        }


        parent::afterSave($insert, $changedAttributes); // TODO: Change the autogenerated stub
    }
    public function afterFind()
    {
        $this->place_id = $this->venue->place_id;
        $this->start_sell_clock = locality::anyToJalali($this->sales_start_at, "H:i");
        $this->start_sell_date = locality::anyToJalali($this->sales_start_at, "Y-m-d");
        $this->end_sell_clock = locality::anyToJalali($this->sales_end_at, "H:i");
        $this->end_sell_date = locality::anyToJalali($this->sales_end_at, "Y-m-d");
        parent::afterFind(); // TODO: Change the autogenerated stub
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
    public function getReserves()
    {
        return $this->hasMany(Reserve::class, ['schedule_id' => 'id']);
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getScheduleSeats()
    {
        return $this->hasMany(ScheduleSeat::class, ['schedule_id' => 'id']);
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
    public function getPlace()
    {
        return $this->hasOne(Place::class, ['id' => 'place_id'])->viaTable("{{%venue}}", ["id" => "venue_id"]);
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

}
