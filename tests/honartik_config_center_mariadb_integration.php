<?php
declare(strict_types=1);
/**
 * Isolated MariaDB/Laravel Eloquent test of the verbatim reviewed PHP issuance
 * transaction and revocation functions. Fixture models/schema mirror required
 * predicates; no Production network, DB, token file, or live credential.
 */
namespace {
    $autoload = getenv('HONARTIK_TEST_VENDOR_AUTOLOAD');
    if (!$autoload || !is_file($autoload)) throw new \RuntimeException('Isolated Composer autoload unavailable');
    require $autoload;
}
namespace App\Models {
    class Site extends \Illuminate\Database\Eloquent\Model {
        protected $table = 'sites'; public $timestamps = false; protected $guarded = [];
    }
    class MachineCredential extends \Illuminate\Database\Eloquent\Model {
        protected $table = 'machine_credentials'; public $timestamps = false;
        protected $guarded = []; protected $casts = ['scopes' => 'array', 'revoked_at' => 'datetime'];
    }
    class AuditLog extends \Illuminate\Database\Eloquent\Model {
        protected $table = 'audit_logs'; public $timestamps = false;
        protected $guarded = []; protected $casts = ['after_json' => 'array'];
    }
}
namespace {
    use Illuminate\Database\Capsule\Manager as Capsule;
    use Illuminate\Database\Schema\Blueprint;
    use App\Models\Site;
    use App\Models\MachineCredential;
    use App\Models\AuditLog;
    function insist(bool $ok, string $why): void {
        if (!$ok) throw new \RuntimeException('INTEGRATION_FAILED:' . $why);
    }
    $config = [
        'driver'=>'mysql','host'=>'127.0.0.1','port'=>3306,
        'database'=>'cc_honartik_isolated','username'=>'ci_user',
        'password'=>getenv('HONARTIK_TEST_DB_PASSWORD') ?: '',
        'charset'=>'utf8mb4','collation'=>'utf8mb4_unicode_ci',
        'prefix'=>'','strict'=>true,
    ];
    $db = new Capsule();
    $db->addConnection($config);
    $db->addConnection($config, 'secondary');
    $db->setAsGlobal();
    $db->bootEloquent();
    class_alias(\Illuminate\Support\Facades\DB::class, 'DB');
    class_alias(\App\Models\Site::class, 'Site');
    class_alias(\App\Models\MachineCredential::class, 'MachineCredential');
    class_alias(\App\Models\AuditLog::class, 'AuditLog');
    const CREDENTIAL_NAME = 'Honartik Backend Readonly Production 20261012';
    const AUDIT_ACTOR = 'honartik-backend-readonly-enrollment-20261012';

    $source = file_get_contents(__DIR__ . '/../scripts/honartik-config-center-prod-enroll-20261012.php');
    insist(is_string($source), 'reviewed_source_present');
    insist(preg_match('/function auditAction\(Site \$site, MachineCredential \$credential, string \$action\): void\s*\{.*?(?=function checkHttp\()/s', $source, $definitions) === 1, 'verbatim_revocation_extract');
    insist(substr_count($definitions[0], 'function revokeBoundToken(') === 1, 'revocation_defined_once');
    eval($definitions[0]);
    insist(preg_match('/DB::transaction\(static function \(\) use \(\$site, \$token\): void \{.*?\n    \}, 3\);/s', $source, $issuance) === 1, 'verbatim_issuance_extract');
    $issueFromSource = static function (Site $site, string $token) use ($issuance): void {
        eval($issuance[0]);
    };

    // The CI service is disposable, with a database user limited to the test DB.
    $schema = $db->schema();
    foreach (['audit_logs','machine_credentials','sites'] as $table) $schema->dropIfExists($table);
    $schema->create('sites', static function (Blueprint $t): void {
        $t->bigIncrements('id'); $t->string('slug'); $t->string('status'); $t->integer('config_revision');
    });
    $schema->create('machine_credentials', static function (Blueprint $t): void {
        $t->bigIncrements('id'); $t->unsignedBigInteger('site_id'); $t->string('name');
        $t->string('token_hash',64); $t->json('scopes'); $t->timestamp('revoked_at')->nullable();
    });
    $createAudit = static function () use ($schema): void {
        $schema->create('audit_logs', static function (Blueprint $t): void {
            $t->bigIncrements('id'); $t->unsignedBigInteger('site_id');
            $t->string('actor_type'); $t->string('actor_id'); $t->string('action');
            $t->string('subject_type'); $t->string('subject_id');
            $t->json('after_json')->nullable(); $t->timestamp('created_at')->nullable();
        });
    };
    $createAudit();
    $site = Site::query()->create(['id'=>3,'slug'=>'honartik','status'=>'active','config_revision'=>1]);
    $foreignSite = Site::query()->create(['id'=>4,'slug'=>'unrelated','status'=>'active','config_revision'=>1]);
    $make = static function (Site $s, string $token, array $scopes): MachineCredential {
        return MachineCredential::query()->create([
            'site_id'=>$s->id,'name'=>CREDENTIAL_NAME,
            'token_hash'=>hash('sha256',$token),'scopes'=>$scopes,
        ]);
    };
    $token = 'ccm_' . str_repeat('a',64);
    $foreignToken = 'ccm_' . str_repeat('b',64);
    $issueFromSource($site,$token);
    $issued = MachineCredential::query()->where('site_id',$site->id)->firstOrFail();
    insist($issued->scopes === ['config:read'] && $issued->token_hash === hash('sha256',$token),'actual_issuance_hash_scope');
    insist(AuditLog::query()->where('action','machine_credential.created')->count() === 1,'issuance_audit');
    $duplicate = false;
    try {$issueFromSource($site,'ccm_'.str_repeat('e',64));}
    catch (\RuntimeException $e) {$duplicate = $e->getMessage() === 'concurrent_credential_detected';}
    insist($duplicate && MachineCredential::query()->where('site_id',$site->id)->count() === 1,'duplicate_issuance_denied');
    $foreign = $make($foreignSite,$foreignToken,['config:read']);
    insist(revokeBoundToken($site,$foreignToken) === 0,'foreign_token_not_revokeable');
    insist(revokeBoundToken($site,$token) === 1,'actual_source_revokes_bound_token');
    insist($issued->fresh()->revoked_at !== null && $foreign->fresh()->revoked_at === null,'foreign_credential_preserved');
    insist(revokeBoundToken($site,$token) === 0,'repeated_revoke_idempotent');
    insist(AuditLog::query()->where('action','machine_credential.revoked')->count() === 1,'revocation_audit');
    $elevatedToken = 'ccm_'.str_repeat('c',64);
    $elevated = $make($site,$elevatedToken,['config:read','secrets:read']);
    $blocked = false;
    try {revokeBoundToken($site,$elevatedToken);}
    catch (\RuntimeException $e) {$blocked = $e->getMessage() === 'unexpected_scopes';}
    insist($blocked && $elevated->fresh()->revoked_at === null,'unexpected_scopes_denied');
    $auditToken = 'ccm_'.str_repeat('d',64);
    $auditCase = $make($site,$auditToken,['config:read']);
    $schema->drop('audit_logs');
    $failed = false;
    try {revokeBoundToken($site,$auditToken);} catch (\Throwable $e) {$failed = true;}
    insist($failed && $auditCase->fresh()->revoked_at === null,'failed_audit_rolls_back_db');
    $createAudit();
    $primary = $db->getConnection(); $secondary = $db->getConnection('secondary');
    $secondary->statement('SET SESSION innodb_lock_wait_timeout = 1');
    $primary->beginTransaction();
    try {
        insist(count($primary->select('SELECT id FROM sites WHERE id = ? FOR UPDATE',[$site->id])) === 1,'first_connection_site_lock');
        $contended = false;
        try {$secondary->select('SELECT id FROM sites WHERE id = ? FOR UPDATE',[$site->id]);}
        catch (\Illuminate\Database\QueryException $e) {$contended = true;}
        insist($contended,'second_connection_must_not_bypass_innodb_lock');
    } finally {$primary->rollBack();}
    echo "MARIADB_LARAVEL_INTEGRATION_PASS issuance=1 duplicate_denied=1 revocation=1 foreign_preserved=1 rollback=1 lock_contention=1\n";
}
