<?php
declare(strict_types=1);

/**
 * Isolated MariaDB 10.6 transaction test for the REAL open-price cancellation
 * service and REAL finance models, but fixture-only Reserve/Schedule wrappers.
 * Never connect this file to a production database.
 */
if (getenv('HONARTIK_OPEN_PRICE_FIXTURE') !== 'YES') {
    fwrite(STDERR, "FAIL_CLOSED: fixture flag required\n"); exit(2);
}
$socket = getenv('HONARTIK_OPEN_PRICE_FIXTURE_SOCKET') ?: '/tmp/honartik-ledger.sock';
if (!preg_match('~^/tmp/honartik-ledger[a-zA-Z0-9._-]*\.sock$~D', $socket)
    || !file_exists($socket) || is_link($socket)) {
    fwrite(STDERR, "FAIL_CLOSED: isolated socket required\n"); exit(2);
}
$root = dirname(__DIR__, 2);
$vendor = getenv('HONARTIK_YII_FIXTURE_VENDOR') ?: $root . '/vendor';
require $vendor . '/autoload.php';
require $vendor . '/yiisoft/yii2/Yii.php';
require $root . '/modules/finance/Config.php';
require $root . '/modules/finance/models/FinanceTransactions.php';
require $root . '/modules/finance/models/FinanceWallet.php';
require $root . '/modules/finance/services/OpenPriceAmount.php';
require $root . '/modules/finance/services/OpenPriceLedger.php';
require $root . '/modules/finance/services/OpenPriceRefundLedger.php';
require $root . '/modules/finance/services/OpenPriceSettlementGuard.php';
require __DIR__ . '/fixtures/OpenPriceCancellationFixtureModels.php';
require $root . '/modules/finance/services/OpenPriceCancellationService.php';

use app\modules\finance\models\FinanceTransactions;
use app\modules\finance\models\FinanceWallet;
use app\modules\finance\services\OpenPriceLedger;
use app\modules\finance\services\OpenPriceCancellationService;
use common\models\Reserve;
use common\models\Schedule;

$db = new \yii\db\Connection([
    'dsn'=>'mysql:unix_socket='.$socket.';dbname=honartik_finance_fixture',
    'username'=>getenv('HONARTIK_OPEN_PRICE_FIXTURE_DB_USER') ?: 'root',
    'password'=>getenv('HONARTIK_OPEN_PRICE_FIXTURE_DB_PASS') ?: '',
    'charset'=>'utf8mb4',
]);
new \yii\console\Application([
    'id'=>'honartik-synthetic-refund-test',
    'basePath'=>$root,
    'components'=>['db'=>$db],
]);
$db->open();
if ($db->createCommand('SELECT DATABASE()')->queryScalar()!=='honartik_finance_fixture' ||
    (int)$db->createCommand('SELECT @@skip_networking')->queryScalar()!==1 ||
    !str_starts_with((string)$db->createCommand('SELECT VERSION()')->queryScalar(),'10.6.')) {
    throw new RuntimeException('Wrong DB/network/version for cancellation fixture');
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
    'CREATE TABLE IF NOT EXISTS schedule (
      id BIGINT PRIMARY KEY AUTO_INCREMENT, date DATE NOT NULL,
      start_at TIME NOT NULL, is_cancel_able TINYINT NOT NULL
    ) ENGINE=InnoDB',
    'CREATE TABLE IF NOT EXISTS reserve (
      id BIGINT PRIMARY KEY AUTO_INCREMENT, user_id BIGINT NOT NULL,
      schedule_id BIGINT NOT NULL, transaction_id BIGINT NOT NULL,
      status INT NOT NULL, free_price_enabled_snapshot TINYINT NOT NULL,
      free_price_original_amount BIGINT NULL,
      free_price_minimum_amount BIGINT NULL,
      free_price_proposed_amount BIGINT NULL,
      free_price_gateway_amount BIGINT NULL,
      free_price_extra_amount BIGINT NULL,
      account_settlement_id BIGINT NULL, code VARCHAR(64) NULL,
      gid VARCHAR(64) NULL
    ) ENGINE=InnoDB',
] as $sql) $db->createCommand($sql)->execute();
foreach (['reserve','schedule','coupon_use','finance_wallet','finance_transactions'] as $table)
    $db->createCommand('DELETE FROM '.$table)->execute();

$schedule = new Schedule();
$schedule->date = date('Y-m-d', time()+4*86400);
$schedule->start_at = '18:00:00';
$schedule->is_cancel_able = 1;
if (!$schedule->save(false)) throw new RuntimeException('Schedule setup failed');
$create = static function (int $extra, int $settlementId=0) use ($schedule): array {
    $chosen = 400000+$extra;
    $bank = new FinanceTransactions();
    $bank->created_at=time();
    $bank->transactioner=42;
    $bank->amount=$chosen;
    $bank->paying_amount=$chosen;
    $bank->status=FinanceTransactions::TRANSACTION_PAID;
    $bank->gateway=7;
    $bank->gateway_reciept='SYNTHETIC-NO-BANK';
    $bank->transactioner_ip='127.0.0.1';
    $bank->internal_reciept='synthetic';
    $bank->token='synthetic';
    $bank->return_url='/';
    $bank->metadata='[]';
    $bank->internal_meta='{}';
    $bank->additional_rows=json_encode(OpenPriceLedger::rows(
        400000,$chosen,42,'127.0.0.1','Synthetic Event',time()
    ), JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    if (!$bank->save(false)||!FinanceTransactions::setPayVerified($bank))
        throw new RuntimeException('Initial accounting setup failed');
    $reserve = new Reserve();
    $reserve->user_id=42;
    $reserve->schedule_id=$schedule->id;
    $reserve->transaction_id=$bank->id;
    $reserve->status=Reserve::STATUS_PUBLISH;
    $reserve->free_price_enabled_snapshot=1;
    $reserve->free_price_original_amount=400000;
    $reserve->free_price_minimum_amount=400000;
    $reserve->free_price_proposed_amount=$chosen;
    $reserve->free_price_gateway_amount=$chosen;
    $reserve->free_price_extra_amount=$extra;
    $reserve->account_settlement_id=$settlementId ?: null;
    $reserve->code='SYNTHETIC';
    $reserve->gid=null;
    if (!$reserve->save(false))throw new RuntimeException('Reserve setup failed');
    return [$bank,$reserve];
};

$totals=static function () use ($db): array {
    return [
      'count'=>(int)$db->createCommand('SELECT COUNT(*) FROM finance_wallet')->queryScalar(),
      'buyer'=>(int)$db->createCommand('SELECT COALESCE(SUM(amount),0) FROM finance_wallet WHERE user_id=42')->queryScalar(),
      'system'=>(int)$db->createCommand('SELECT COALESCE(SUM(amount),0) FROM finance_wallet WHERE user_id=0')->queryScalar(),
      'combined'=>(int)$db->createCommand('SELECT COALESCE(SUM(amount),0) FROM finance_wallet')->queryScalar(),
    ];
};
[$bank,$reserve]=$create(600000);
$service=new OpenPriceCancellationService();
$before=$totals();
$result=$service->cancelPublished((int)$reserve->id,42);
$after=$totals();
$reserve->refresh();
if ($result['success']!==true ||
    (int)$result['refund_amount_toman']!==1000000 ||
    (int)$reserve->status!==Reserve::STATUS_CANCEL ||
    $after['buyer']-$before['buyer']!==1000000 ||
    $after['system']-$before['system']!==-1000000 ||
    $after['combined']!==$before['combined'] ||
    $after['count']-$before['count']!==4) {
    throw new RuntimeException('Full refund or conservation failed: '.json_encode([$result,$before,$after]));
}
echo "ATOMIC_OPEN_PRICE_FULL_WALLET_REFUND=PASS\n";
if ($service->cancelPublished((int)$reserve->id,42)['success']!==false ||
    $totals()!==$after)throw new RuntimeException('Duplicate cancellation credited twice');
echo "DUPLICATE_CANCELLATION_REJECTED=PASS\n";
[$bank2,$reserve2]=$create(600000,12345);
$before=$totals();
if ($service->cancelPublished((int)$reserve2->id,42)['success']!==false ||
    $totals()!==$before || (int)$reserve2->status!==Reserve::STATUS_PUBLISH)
    throw new RuntimeException('Already settled reserve was refunded');
echo "ATTACHED_SELLER_SETTLEMENT_HELD=PASS\n";
[$bank3,$reserve3]=$create(600000);
$reserve3->free_price_extra_amount=555555;
$reserve3->save(false);
$before=$totals();
if ($service->cancelPublished((int)$reserve3->id,42)['success']!==false ||
    $totals()!==$before)throw new RuntimeException('Tampered refund changed money rows');
echo "TAMPERED_EXTRA_REFUND_HELD=PASS\n";
echo "ISOLATED_OPEN_PRICE_CANCELLATION_DB_CONTRACT=PASS\n";
