<?php
declare(strict_types=1);

namespace common\models;

/**
 * Isolated test-only event owner lookup. The actual AccountSettlement model
 * including beforeSave validation and SQL queries is used unchanged.
 * Event's remaining production business logic is outside this finance gate.
 */
final class Event extends \yii\db\ActiveRecord
{
    public static function tableName() { return 'event'; }
}
