<?php

use app\modules\finance\services\OpenPriceSchemaGuard;
use yii\db\Migration;

/**
 * Required predecessor of m261016_110000_open_price_schedules.
 *
 * SOURCE-ONLY candidate. Applying an ALTER TABLE to a production money ledger
 * requires a recent verified backup, isolated restore, current live-schema
 * inspection, a maintenance window and an approved SHA-bound release.
 * MySQL DDL is not reliably transactional.
 */
class m261016_105000_open_price_money_capacity extends Migration
{
    public function safeUp()
    {
        $schema = $this->db->getSchema();
        $tables = [];
        foreach (['finance_transactions', 'finance_wallet', 'schedule', 'reserve'] as $name) {
            $tables[$name] = $schema->getTableSchema('{{%' . $name . '}}', true);
            if ($tables[$name] === null) {
                throw new \RuntimeException('Open-price capacity: missing table ' . $name);
            }
        }

        // Never widen a ledger while a later open-price migration is partly
        // applied. Such states require a manual, audited recovery.
        foreach (OpenPriceSchemaGuard::NEW_COLUMNS as $key) {
            [$name, $column] = explode('.', $key, 2);
            if ($tables[$name]->getColumn($column) !== null) {
                throw new \RuntimeException('Open-price capacity: later migration has already started');
            }
        }

        $plan = [];
        foreach ([
            ['finance_transactions', 'amount', false],
            ['finance_wallet', 'amount', true],
        ] as [$table, $field, $needsSigned]) {
            $column = $tables[$table]->getColumn($field);
            if ($column === null) {
                throw new \RuntimeException('Open-price capacity: missing money column ' . $table . '.' . $field);
            }
            if (OpenPriceSchemaGuard::supportsAmount((string)$column->dbType, $needsSigned)) {
                continue;
            }
            if (!$this->isSignedInt($column)) {
                throw new \RuntimeException('Open-price capacity: unsupported money column ' . $table . '.' . $field);
            }
            $plan[] = ['alter', $table, $field, $this->sameOptionsAsSignedBigInt($column)];
        }

        $paying = $tables['finance_transactions']->getColumn('paying_amount');
        if ($paying === null) {
            // The 2024 legacy migration for this field is outside the current
            // canonical migration lookup. Old transactions keep NULL and
            // therefore use the existing amount fallback.
            $plan[] = ['add', 'finance_transactions', 'paying_amount', $this->bigInteger()->null()];
        } else {
            if (!$paying->allowNull) {
                throw new \RuntimeException('Open-price capacity: paying_amount must be nullable for legacy rows');
            }
            if (!OpenPriceSchemaGuard::supportsAmount((string)$paying->dbType, false)) {
                if (!$this->isSignedInt($paying)) {
                    throw new \RuntimeException('Open-price capacity: unsupported paying_amount type');
                }
                $plan[] = ['alter', 'finance_transactions', 'paying_amount', $this->sameOptionsAsSignedBigInt($paying)];
            }
        }

        // Preflight of every planned field has succeeded before the first
        // nontransactional MySQL DDL operation. Each step is safe to re-evaluate
        // after a partially completed execution, but no automatic rollback
        // truncates financial values.
        foreach ($plan as [$action, $table, $column, $definition]) {
            $tableName = '{{%' . $table . '}}';
            if ($action === 'add') {
                $this->addColumn($tableName, $column, $definition);
            } else {
                $this->alterColumn($tableName, $column, $definition);
            }
        }
        return true;
    }

    private function isSignedInt($column): bool
    {
        return preg_match('/^int(?:\(\d+\))?$/i', trim((string)$column->dbType)) === 1
            && empty($column->isPrimaryKey)
            && empty($column->autoIncrement);
    }

    /**
     * Preserve nullable/default/comment metadata. Unsupported defaults are
     * rejected rather than silently changing semantics of ordinary payments.
     */
    private function sameOptionsAsSignedBigInt($old)
    {
        $type = $this->bigInteger();
        if ($old->allowNull) {
            $type->null();
        } else {
            $type->notNull();
        }
        if ($old->defaultValue !== null) {
            $default = (string)$old->defaultValue;
            if (!preg_match('/^-?\d+$/D', $default)) {
                throw new \RuntimeException('Open-price capacity: unsupported money-column default');
            }
            $type->defaultValue($default);
        }
        if (property_exists($old, 'comment') && is_string($old->comment) && $old->comment !== '') {
            $type->comment($old->comment);
        }
        return $type;
    }

    public function safeDown()
    {
        // No downcast and no removal of paying_amount: both could destroy
        // bank/ledger evidence once a larger payment has been recorded.
        return false;
    }
}
