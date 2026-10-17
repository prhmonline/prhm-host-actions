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
}
