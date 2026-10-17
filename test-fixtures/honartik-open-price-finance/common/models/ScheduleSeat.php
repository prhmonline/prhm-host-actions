<?php

namespace common\models;

use Yii;
use common\models\User;

/**
 * This is the model class for table "schedule_seat".
 *
 * @property integer $id
 * @property integer $seat_id
 * @property integer $schedule_id
 * @property integer $price
 * @property integer $type
 * @property integer $last_lock_time
 * @property integer $user_lock
 * @property integer $status
 * @property integer $created_at
 * @property integer $updated_at
 * @property integer $created_by
 * @property integer $updated_by
 *
 * @property Schedule $schedule
 * @property Seat $seat
 * @property User $createdBy
 * @property User $updatedBy
 */
class ScheduleSeat extends \common\models\base\ActiveRecord     /* \yii\db\ActiveRecord */
{
    const SCENARIO_CUSTOM = 'custom';
    /* statuses */
    const STATUS_PENDING = 1;
    const STATUS_SOLED = 3;

    const STATUS_SELECTABLE = 0; /* قابل خرید(برای سایت و اپ باز)سفید */
    const STATUS_LOCKED = 2; /* قفل شده */
    const STATUS_SOLD_SITE = 4; /* فروخته شده توسط سایت بنفش */
    const STATUS_FAMILY = 5; /* خانوادگی(برای سایت بسته) زرد */

    /**
     * @inheritdoc
     */
    public static function tableName()
    {
        return 'schedule_seat';
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
            static::STATUS_SELECTABLE => ['title' => \Yii::t('rabint', 'آزاد')],
            static::STATUS_PENDING => ['title' => \Yii::t('rabint', 'pending')],
            static::STATUS_LOCKED => ['title' => \Yii::t('rabint', 'قفل')],
            static::STATUS_SOLED => ['title' => \Yii::t('rabint', 'فروخته شده')],
            static::STATUS_FAMILY => ['title' => \Yii::t('rabint', 'خانوادگی')],
            static::STATUS_SOLD_SITE => ['title' => \Yii::t('rabint', 'فروخته شده توسط سایت')],
        ];
    }

    /* ====================================================================== */

    /**
     * @inheritdoc
     */
    public function rules()
    {
        return [
            [['seat_id', 'schedule_id', 'price', 'type', 'last_lock_time', 'user_lock', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by'], 'integer'],
            [['seat_id'], 'exist', 'skipOnError' => true, 'targetClass' => Seat::class, 'targetAttribute' => ['seat_id' => 'id']],
            [['schedule_id'], 'exist', 'skipOnError' => true, 'targetClass' => Schedule::class, 'targetAttribute' => ['schedule_id' => 'id']],
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
            'seat_id' => Yii::t('rabint', 'سالن'),
            'schedule_id' => Yii::t('rabint', 'شناسه اکران'),
            'price' => Yii::t('rabint', 'قیمت صندلی'),
            'type' => Yii::t('rabint', 'نوع صندلی'),
            'last_lock_time' => Yii::t('rabint', 'لحظه ثبت لاک برای کاربر'),
            'user_lock' => Yii::t('rabint', 'کاربر لاک'),
            'status' => Yii::t('rabint', 'وضعیت'),
            'created_at' => Yii::t('app', 'Created At'),
            'updated_at' => Yii::t('app', 'Updated At'),
            'created_by' => Yii::t('app', 'Created By'),
            'updated_by' => Yii::t('app', 'Updated By'),
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
    public function getSeat()
    {
        return $this->hasOne(Seat::class, ['id' => 'seat_id']);
    }

    public function afterFind()
    {
        parent::afterFind(); // TODO: Change the autogenerated stub
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
