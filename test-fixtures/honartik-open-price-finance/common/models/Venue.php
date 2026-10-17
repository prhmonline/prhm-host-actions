<?php

namespace common\models;

use Yii;
use common\models\User;

/**
 * This is the model class for table "venue".
 *
 * @property integer $id
 * @property integer $gid
 * @property integer $place_id
 * @property string $title
 * @property integer $row_direction
 * @property integer $col_direction
 * @property integer $first_block_id
 * @property integer $created_at
 * @property integer $updated_at
 * @property integer $created_by
 * @property integer $updated_by
 *
 * @property Place $place
 * @property Schedule[] $schedules
 * @property Seat[] $seats
 * @property User $createdBy
 * @property User $updatedBy
 */
class Venue extends \common\models\base\ActiveRecord     /* \yii\db\ActiveRecord */
{
    const SCENARIO_CUSTOM = 'custom';

    const ROW_DIRECTION_LEFT_TO_RIGHT = 0;
    const ROW_DIRECTION_RIGHT_TO_LEFT = 1;

    const COL_DIRECTION_UP_TO_DOWN = 0;
    const COL_DIRECTION_DOWN_TO_UP = 1;
    /* statuses */
    const STATUS_DRAFT = 0;
    const STATUS_PENDING = 1;
    const STATUS_PUBLISH = 2;

    /**
     * @inheritdoc
     */
    public static function tableName()
    {
        return 'venue';
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
            [['gid', 'place_id', 'first_block_id','row_direction', 'col_direction', 'created_at', 'updated_at', 'created_by', 'updated_by'], 'integer'],
            [['title'], 'string', 'max' => 255],
            [['place_id'], 'exist', 'skipOnError' => true, 'targetClass' => Place::class, 'targetAttribute' => ['place_id' => 'id']],
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
            'place_id' => Yii::t('rabint', 'مکان اجرا'),
            'title' => Yii::t('rabint', 'عنوان'),
            'row_direction' =>Yii::t('rabint', 'جهت نمایش ردیفی شماره صندلی ها'),
            'col_direction' => Yii::t('rabint','جهت نمایش ستونی برچسب کنار صندلی ها'),
            'first_block_id' => Yii::t('rabint', 'شناسه اولین بلاک سالن'),
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


    /** @return array */
    public static function rowDirections()
    {
        return [
            static::ROW_DIRECTION_LEFT_TO_RIGHT => 'چپ به راست',
            static::ROW_DIRECTION_RIGHT_TO_LEFT => 'راست به چپ',
        ];
    }

    /** @return array */
    public static function colDirections()
    {
        return [
            static::COL_DIRECTION_UP_TO_DOWN => 'بالا به پایین',
            static::COL_DIRECTION_DOWN_TO_UP => 'پایین به بالا',
        ];
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
    public function getSchedules()
    {
        return $this->hasMany(Schedule::class, ['venue_id' => 'id']);
    }

    /**
     * @return \common\models\base\ActiveQuery
     */
    public function getSeats()
    {
        return $this->hasMany(Seat::class, ['venue_id' => 'id']);
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
