<?php

namespace common\models;

use Yii;
use common\models\User;

/**
 * This is the model class for table "reserve_item".
 *
 * @property integer $id
 * @property integer $reserve_id
 * @property integer $user_id
 * @property integer $schedule_seats_id
 * @property integer $current_price
 * @property integer $block_id
 * @property integer $row
 * @property integer $number
 * @property integer $created_at
 * @property integer $updated_at
 * @property integer $created_by
 * @property integer $updated_by
 *
 * @property Reserve $reserve
 * @property ScheduleSeat $schedule_seat
 * @property User $createdBy
 * @property User $updatedBy
 */
class ReserveItem extends \common\models\base\ActiveRecord     /* \yii\db\ActiveRecord */
{
    const SCENARIO_CUSTOM = 'custom';
    /* statuses */
    const STATUS_DRAFT = 0;
    const STATUS_PENDING = 1;
    const STATUS_PUBLISH = 2;

    /**
     * @inheritdoc
     */
    public static function tableName()
    {
        return 'reserve_item';
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
            static::STATUS_PENDING => ['title' => \Yii::t('rabint', 'pending')],
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
            [['reserve_id', 'user_id', 'schedule_seats_id', 'current_price', 'created_at', 'updated_at', 'created_by', 'updated_by', "block_id", "row", "number"], 'integer'],
            [['reserve_id'], 'exist', 'skipOnError' => true, 'targetClass' => Reserve::class, 'targetAttribute' => ['reserve_id' => 'id']],
            [['schedule_seats_id'], 'exist', 'skipOnError' => true, 'targetClass' => ScheduleSeat::class, 'targetAttribute' => ['schedule_seats_id' => 'id']],
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
            'reserve_id' => Yii::t('rabint', 'شناسه رزرو'),
            'user_id' => Yii::t('rabint', 'سالن'),
            'schedule_seats_id' => Yii::t('rabint', 'شناسه صندلی اکران'),
            'current_price' => Yii::t('rabint', 'قیمت لحظه رزرو'),
            'created_at' => Yii::t('app', 'Created At'),
            'updated_at' => Yii::t('app', 'Updated At'),
            'created_by' => Yii::t('app', 'Created By'),
            'updated_by' => Yii::t('app', 'Updated By'),
            "block_id" => Yii::t("rabint", "بلاک"),
            "row" => Yii::t("rabint", "ردیف"),
            "number" => Yii::t("rabint", "شماره صندلی"),
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
    public function getReserve()
    {
        return $this->hasOne(Reserve::class, ['id' => 'reserve_id']);
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getScheduleSeat()
    {
        return $this->hasOne(ScheduleSeat::class, ['id' => 'schedule_seats_id']);
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
