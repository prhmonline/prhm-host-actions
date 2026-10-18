<?php

use yii\db\Migration;

/** Monetary columns use integer toman, consistent with finance_transactions.amount. */
class m261016_110000_open_price_schedules extends Migration
{
    public function safeUp()
    {
        // MySQL ALTER TABLE is not reliably rolled back with a transaction.
        // Validate every existing monetary column AND all new-column preimages
        // before the very first DDL statement.
        $this->assertSafePreimage();

        $this->addColumn('{{%schedule}}', 'free_price_enabled', $this->boolean()->notNull()->defaultValue(false));
        $this->addColumn('{{%schedule}}', 'free_price_description', $this->text()->null());
        $this->addColumn('{{%reserve}}', 'free_price_enabled_snapshot', $this->boolean()->notNull()->defaultValue(false));
        $this->addColumn('{{%reserve}}', 'free_price_original_amount', $this->bigInteger()->null());
        $this->addColumn('{{%reserve}}', 'free_price_minimum_amount', $this->bigInteger()->null());
        $this->addColumn('{{%reserve}}', 'free_price_proposed_amount', $this->bigInteger()->null());
        $this->addColumn('{{%reserve}}', 'free_price_gateway_amount', $this->bigInteger()->null());
        $this->addColumn('{{%reserve}}', 'free_price_extra_amount', $this->bigInteger()->null());
    }

    /**
     * Fail before any schema mutation when source tables are unknown, money
     * columns cannot store the allowed payment, or the migration has already
     * been partly applied. This deliberately does not repair partial DDL.
     */
    private function assertSafePreimage(): void
    {
        $guard = \app\modules\finance\services\OpenPriceSchemaGuard::class;
        $tables = [];
        foreach (['finance_transactions', 'finance_wallet', 'schedule', 'reserve'] as $tableName) {
            $tables[$tableName] = $this->db->getTableSchema('{{%' . $tableName . '}}', true);
            if ($tables[$tableName] === null) {
                throw new \RuntimeException('Open-price schema preflight: required table missing: ' . $tableName);
            }
        }

        foreach ($guard::MONEY_COLUMNS as $key) {
            [$tableName, $columnName] = explode('.', $key, 2);
            $column = $tables[$tableName]->getColumn($columnName);
            $dbType = $column === null ? '' : (string)$column->dbType;
            $needsSignedDebit = $tableName === 'finance_wallet';
            if (!$guard::supportsAmount($dbType, $needsSignedDebit)) {
                throw new \RuntimeException('Open-price schema preflight: unsafe money column: ' . $key);
            }
        }

        foreach ($guard::NEW_COLUMNS as $key) {
            [$tableName, $columnName] = explode('.', $key, 2);
            if ($tables[$tableName]->getColumn($columnName) !== null) {
                throw new \RuntimeException(
                    'Open-price schema preflight: preexisting migration column requires manual review: ' . $key
                );
            }
        }
    }

    public function safeDown()
    {
        // Do not discard financial audit snapshots during automated rollback.
        return false;
    }
}
