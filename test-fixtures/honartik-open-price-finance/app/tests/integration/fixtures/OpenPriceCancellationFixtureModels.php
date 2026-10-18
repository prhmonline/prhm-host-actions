<?php
declare(strict_types=1);

namespace common\models;

/**
 * Fixture-only substitutes for the two ActiveRecord wrappers. The real
 * cancellation service and finance models are used; full production seat
 * afterSave behavior is NOT covered by this isolated finance fixture.
 */
final class Schedule extends \yii\db\ActiveRecord
{
    public static function tableName() { return 'schedule'; }
}
final class Reserve extends \yii\db\ActiveRecord
{
    public const STATUS_CANCEL = 0;
    public const STATUS_PUBLISH = 2;
    public static function tableName() { return 'reserve'; }
    public function getSchedule()
    {
        return $this->hasOne(Schedule::class, ['id' => 'schedule_id']);
    }
    public function afterSave($insert, $changedAttributes)
    {
        if ((int)$this->status === self::STATUS_CANCEL) {
            $seatIds = array_map(static fn($r) => (int)$r->schedule_seats_id, $this->reserveItems);
            if ($seatIds) {
                ScheduleSeat::updateAll(
                    ['status'=>ScheduleSeat::STATUS_SELECTABLE,
                     'user_lock'=>null,'last_lock_time'=>null],
                    ['and',['id'=>$seatIds],
                     ['status'=>[ScheduleSeat::STATUS_PENDING,ScheduleSeat::STATUS_SOLED]]]
                );
            }
        }
        parent::afterSave($insert,$changedAttributes);
    }
    public function getReserveItems()
    {
        return $this->hasMany(ReserveItem::class,['reserve_id'=>'id']);
    }
}

final class ReserveItem extends \yii\db\ActiveRecord
{
    public static function tableName() { return 'reserve_item'; }
}
final class ScheduleSeat extends \yii\db\ActiveRecord
{
    public const STATUS_SELECTABLE=0;
    public const STATUS_PENDING=1;
    public const STATUS_SOLED=3;
    public static function tableName() { return 'schedule_seat'; }
}
