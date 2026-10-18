<?php
declare(strict_types=1);

/**
 * Read-only console inventory for the live pre-migration Honartik database.
 *
 * Usage from a verified checkout:
 *   php scripts/open-price-live-migration-inventory-v1.php
 *
 * No user inputs, no secret output, no DDL/DML, no migrations are applied.
 * This is NOT an approval to migrate or deploy.
 */
if (PHP_SAPI !== 'cli') {
    exit(2);
}
error_reporting(0);
ini_set('display_errors', '0');

$root = dirname(__DIR__);
$tx = null;
try {
    if (!is_file($root . '/env.php')) {
        throw new RuntimeException('ENV_UNAVAILABLE');
    }
    if (!defined('RABINT_BASE_DIR')) {
        define('RABINT_BASE_DIR', $root);
    }
    if (!defined('RABINT_APP_DIR')) {
        define('RABINT_APP_DIR', $root . '/console');
    }
    if (!defined('RABINT_ENV')) {
        define('RABINT_ENV', require $root . '/env.php');
    }
    if (!defined('YII_DEBUG')) {
        define('YII_DEBUG', false);
    }
    if (!defined('YII_ENV')) {
        define('YII_ENV', 'prod');
    }
    if (!defined('USER_CAN_DEBUG')) {
        define('USER_CAN_DEBUG', false);
    }

    require $root . '/common/_global_functions.php';
    require $root . '/vendor/autoload.php';
    require $root . '/vendor/yiisoft/yii2/Yii.php';
    require $root . '/common/config/bootstrap.php';
    require $root . '/console/config/bootstrap.php';
    $config = require $root . '/console/config/web.php';

    $app = new yii\console\Application($config);
    $db = $app->db;
    $db->createCommand('SET TRANSACTION READ ONLY')->execute();
    $tx = $db->beginTransaction();

    if ($db->createCommand('SELECT DATABASE()')->queryScalar() !== 'honartik_db') {
        throw new RuntimeException('DATABASE_MISMATCH');
    }
    echo "YII_DATABASE_CONNECTION=PASS\n";

    $money = [
        'finance_transactions.amount' => 'int(11)',
        'finance_wallet.amount' => 'int(11)',
    ];
    $columns = $db->createCommand(
        "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND (
            (TABLE_NAME IN ('finance_transactions','finance_wallet')
             AND COLUMN_NAME IN ('amount','paying_amount'))
            OR (TABLE_NAME='schedule' AND COLUMN_NAME IN
               ('free_price_enabled','free_price_description'))
            OR (TABLE_NAME='reserve' AND COLUMN_NAME LIKE 'free_price_%')
          )"
    )->queryAll();
    $map = [];
    foreach ($columns as $row) {
        $map[$row['TABLE_NAME'] . '.' . $row['COLUMN_NAME']] =
            strtolower((string)$row['COLUMN_TYPE']);
    }
    $capacityPending =
        ($map['finance_transactions.amount'] ?? '') === $money['finance_transactions.amount'] &&
        ($map['finance_wallet.amount'] ?? '') === $money['finance_wallet.amount'] &&
        !array_key_exists('finance_transactions.paying_amount', $map);

    $featureColumns = [
        'schedule.free_price_enabled', 'schedule.free_price_description',
        'reserve.free_price_enabled_snapshot','reserve.free_price_original_amount',
        'reserve.free_price_minimum_amount','reserve.free_price_proposed_amount',
        'reserve.free_price_gateway_amount','reserve.free_price_extra_amount'
    ];
    $present = count(array_filter(
        $featureColumns,
        static fn (string $key): bool => array_key_exists($key, $map)
    ));
    $featureState = $present === 0 ? 'PENDING' :
        ($present === count($featureColumns) ? 'APPLIED' : 'PARTIAL');

    $history = $db->createCommand('SELECT version FROM {{%system_db_migration}}')->queryColumn();
    $applied = array_fill_keys(array_map('strval', $history), true);
    $two = [
        'm261016_105000_open_price_money_capacity',
        'm261016_110000_open_price_schedules'
    ];
    $targetApplied = 0;
    foreach ($two as $version) {
        $targetApplied += isset($applied[$version]) ? 1 : 0;
    }

    $directory = $root . '/app/migrations/db';
    if (!is_dir($directory)) {
        throw new RuntimeException('MIGRATION_DIRECTORY_MISSING');
    }
    $localPending = 0;
    foreach (new DirectoryIterator($directory) as $file) {
        if (!$file->isFile() || !preg_match('/^(m\d{6}_\d{6}_[A-Za-z0-9_]+)\.php$/D', $file->getFilename(), $m)) {
            continue;
        }
        if (!isset($applied[$m[1]]) && !in_array($m[1], $two, true)) {
            $localPending++;
        }
    }
    echo 'MONEY_CAPACITY_PREIMAGE=' . ($capacityPending ? 'EXPECTED' : 'OTHER') . "\n";
    echo 'FEATURE_SCHEMA=' . $featureState . "\n";
    echo "FEATURE_COLUMNS=$present/8\n";
    echo "TARGET_MIGRATION_HISTORY=$targetApplied/2\n";
    echo "APP_DB_UNRELATED_PENDING_COUNT=$localPending\n";
    echo "APP_DB_LOOKUP_SCOPE_ONLY=YES\n";
    echo "DEPLOY_READY=NO\n";
    $tx->rollBack();
    $tx = null;
    echo "PRODUCTION_MUTATION=NO\n";
    echo "LIVE_MIGRATION_INVENTORY=PASS\n";
    // PENDING is a successful audit, not permission to deploy.
} catch (Throwable $e) {
    if ($tx !== null && $tx->isActive) {
        $tx->rollBack();
    }
    echo "LIVE_MIGRATION_INVENTORY=BLOCKED\n";
    echo 'ERROR_CLASS=' . get_class($e) . "\n";
    exit(2);
}
