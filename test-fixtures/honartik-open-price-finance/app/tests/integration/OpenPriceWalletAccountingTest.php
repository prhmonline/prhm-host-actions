<?php
declare(strict_types=1);

/**
 * Execute the real FinanceTransactions::setPayVerified() against a private
 * no-network MariaDB fixture. Never point this script at live Honartik.
 *
 * Required setup: a disposable MariaDB instance started with --skip-networking,
 * using a Unix socket under /tmp/honartik-ledger*.sock.
 * HONARTIK_OPEN_PRICE_FIXTURE=YES php app/tests/integration/OpenPriceWalletAccountingTest.php
 *
 * The test creates/clears tables only inside honartik_finance_fixture.
 */
if (getenv('HONARTIK_OPEN_PRICE_FIXTURE') !== 'YES') {
    fwrite(STDERR, "FAIL_CLOSED: explicit fixture opt-in required\n");
    exit(2);
}

$socket = getenv('HONARTIK_OPEN_PRICE_FIXTURE_SOCKET') ?: '/tmp/honartik-ledger.sock';
if (!preg_match('~^/tmp/honartik-ledger[a-zA-Z0-9._-]*\.sock$~D', $socket)
    || !file_exists($socket) || is_link($socket)) {
    fwrite(STDERR, "FAIL_CLOSED: local isolated socket required\n");
    exit(2);
}

$root = dirname(__DIR__, 2);
$yiiVendor = getenv('HONARTIK_YII_FIXTURE_VENDOR') ?: $root . '/vendor';
require $yiiVendor . '/autoload.php';
require $yiiVendor . '/yiisoft/yii2/Yii.php';
require $root . '/modules/finance/Config.php';
require $root . '/modules/finance/models/FinanceTransactions.php';
require $root . '/modules/finance/models/FinanceWallet.php';
require $root . '/modules/finance/services/OpenPriceAmount.php';
require $root . '/modules/finance/services/OpenPriceLedger.php';

$db = new \yii\db\Connection([
    'dsn' => 'mysql:unix_socket=' . $socket . ';dbname=honartik_finance_fixture',
    'username' => getenv('HONARTIK_OPEN_PRICE_FIXTURE_DB_USER') ?: 'root',
    'password' => getenv('HONARTIK_OPEN_PRICE_FIXTURE_DB_PASS') ?: '',
    'charset' => 'utf8mb4',
]);
$app = new \yii\console\Application([
    'id' => 'honartik-isolated-wallet-test',
    'basePath' => $root,
    'components' => ['db' => $db],
]);
$db->open();

if ($db->createCommand('SELECT DATABASE()')->queryScalar() !== 'honartik_finance_fixture'
    || !in_array(strtolower((string)$db->createCommand('SELECT @@skip_networking')->queryScalar()), ['1', 'on'], true)) {
    throw new \RuntimeException('FAIL_CLOSED: database is not the isolated fixture');
}

foreach ([
    'CREATE TABLE IF NOT EXISTS finance_transactions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT, created_at INT NOT NULL DEFAULT 0,
      transactioner BIGINT NOT NULL, amount BIGINT NOT NULL, paying_amount BIGINT NULL,
      status INT NOT NULL, gateway INT NOT NULL DEFAULT 7,
      gateway_reciept VARCHAR(255) DEFAULT NULL, gateway_meta TEXT NULL,
      transactioner_ip VARCHAR(255) NOT NULL DEFAULT \'127.0.0.1\',
      internal_reciept VARCHAR(255) DEFAULT NULL, token VARCHAR(255) DEFAULT NULL,
      return_url VARCHAR(255) DEFAULT NULL, additional_rows LONGTEXT NULL,
      internal_meta LONGTEXT NULL, metadata LONGTEXT NULL,
      settle_callback_function LONGTEXT NULL) ENGINE=InnoDB',
    'CREATE TABLE IF NOT EXISTS finance_wallet (
      id BIGINT PRIMARY KEY AUTO_INCREMENT, created_at INT NOT NULL,
      user_id BIGINT NOT NULL, amount BIGINT NOT NULL,
      transactioner BIGINT NOT NULL, transactioner_ip VARCHAR(255),
      bank_transaction_id BIGINT NULL, description VARCHAR(255), metadata VARCHAR(255)
    ) ENGINE=InnoDB',
    'CREATE TABLE IF NOT EXISTS coupon_use (
      id BIGINT AUTO_INCREMENT PRIMARY KEY, finance_transaction_id BIGINT NOT NULL,
      status INT NOT NULL, used_at INT NULL, expires_at INT NULL,
      released_at INT NULL, release_reason VARCHAR(255) NULL,
      is_current TINYINT NOT NULL, updated_at INT NOT NULL
    ) ENGINE=InnoDB',
] as $sql) {
    $db->createCommand($sql)->execute();
}
foreach (['coupon_use', 'finance_wallet', 'finance_transactions'] as $table) {
    $db->createCommand('DELETE FROM ' . $table)->execute();
}

$tx = new \app\modules\finance\models\FinanceTransactions();
$tx->created_at = time();
$tx->transactioner = 42;
$tx->amount = 1000000;
$tx->paying_amount = 1000000;
$tx->status = $tx::TRANSACTION_PAID;
$tx->gateway = 7;
$tx->transactioner_ip = '127.0.0.1';
$tx->internal_reciept = 'synthetic';
$tx->token = 'synthetic';
$tx->return_url = '/';
$rows = \app\modules\finance\services\OpenPriceLedger::rows(
    400000, 1000000, 42, '127.0.0.1', 'Synthetic Event', time()
);
$tx->additional_rows = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$tx->metadata = '[]';
$tx->internal_meta = '{}';
if (!$tx->save(false)) {
    throw new \RuntimeException('Test transaction insert failed');
}

$accounting = \app\modules\finance\models\FinanceTransactions::class;
if ($accounting::setPayVerified($tx) !== true) {
    throw new \RuntimeException('Initial bank ledger commit failed');
}
echo "INITIAL_BANK_ACCOUNTING=PASS\n";

$stats = static function () use ($db, $tx): array {
    return [
        $db->createCommand('SELECT COUNT(*) n, CAST(COALESCE(SUM(amount),0) AS CHAR) s FROM finance_wallet WHERE user_id=42')->queryOne(),
        $db->createCommand('SELECT COUNT(*) n, CAST(COALESCE(SUM(amount),0) AS CHAR) s FROM finance_wallet WHERE user_id=0')->queryOne(),
        $db->createCommand('SELECT COUNT(*) n, CAST(COALESCE(SUM(amount),0) AS CHAR) s FROM finance_wallet')->queryOne(),
        (int)$db->createCommand('SELECT COUNT(*) FROM finance_wallet WHERE bank_transaction_id=:tid', [':tid' => $tx->id])->queryScalar(),
    ];
};
$before = $stats();
if ((int)$before[0]['s'] !== 0 || (int)$before[1]['s'] !== 1000000
    || (int)$before[2]['s'] !== 1000000 || (int)$before[2]['n'] !== 5
    || $before[3] !== 1) {
    throw new \RuntimeException('Ledger conservation failed');
}
echo "OPEN_PRICE_BASE_EXTRA_LEDGER_CONSERVATION=PASS\n";

if ($accounting::setPayVerified($tx) !== true || $stats() !== $before) {
    throw new \RuntimeException('Duplicate callback created ledger entries');
}
echo "DUPLICATE_CALLBACK_IDEMPOTENT=PASS\n";

$rows[0]['amount']--;
$tx->additional_rows = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$tx->save(false);
if ($accounting::setPayVerified($tx) !== false || $stats() !== $before) {
    throw new \RuntimeException('Tampered callback changed ledger');
}
echo "TAMPERED_AMOUNT_ROLLBACK=PASS\n";
echo "REAL_WALLET_ACCOUNTING_ISOLATED_FIXTURE=PASS\n";
