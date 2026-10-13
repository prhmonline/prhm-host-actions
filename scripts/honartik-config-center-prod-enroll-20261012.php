<?php
declare(strict_types=1);
/**
 * One-time, tenant-bound Honartik read-only credential enrollment.
 * Plaintext credential stays only in RAM and 0600 file owned by honartik.
 * No command arguments, STDOUT, exceptions, audit logs or Git store secrets.
 */
use App\Models\AuditLog;
use App\Models\MachineCredential;
use App\Models\Site;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
const BACKEND_SHA = '7ae8b99677ec13b3498b4a5425267a49fc87806e';
const CC_ROOT = '/srv/prhm-config-center/releases/git-9b41e4534382';
const APP_ROOT = CC_ROOT . '/apps/api';
const FOLDER = '/home/honartik/.config/prhm/config-center';
const TOKEN_FILE = FOLDER . '/readonly-machine-token';
const CREDENTIAL_NAME = 'Honartik Backend Readonly Production 20261012';
const AUDIT_ACTOR = 'honartik-backend-readonly-enrollment-20261012';
ini_set('display_errors', '0');
error_reporting(0);
$mode = $argv[1] ?? '';
if (PHP_SAPI !== 'cli' || !in_array($mode, ['preflight', 'apply', 'rollback'], true)) {
    fwrite(STDERR, "INVALID_OPERATION\n");
    exit(2);
}
if (posix_geteuid() !== 0 || realpath('/srv/prhm-config-center/current') !== CC_ROOT) {
    fwrite(STDERR, "RUNTIME_IDENTITY_OR_RELEASE_MISMATCH\n");
    exit(2);
}
function safePath(string $path, bool $mustBeDirectory): bool
{
    $data = @lstat($path);
    if (!is_array($data)) {
        return false;
    }
    $kind = $data['mode'] & 0170000;
    if ($kind !== ($mustBeDirectory ? 0040000 : 0100000)) {
        throw new RuntimeException('path_type_mismatch');
    }
    return true;
}
function validateSource(): void
{
    $p = '/home/honartik/domains/dashboard.honartik.ir/public_html';
    $out = [];
    $exit = 0;
    exec('git -C ' . escapeshellarg($p) . ' rev-parse HEAD 2>/dev/null', $out, $exit);
    if ($exit !== 0 || ($out[0] ?? '') !== BACKEND_SHA) {
        throw new RuntimeException('backend_sha_mismatch');
    }
    if (!is_file($p . '/console/controllers/ConfigCenterController.php')
        || !is_file($p . '/common/services/configcenter/ConfigCenterTokenFile.php')) {
        throw new RuntimeException('consumer_missing');
    }
}
function secureDirectories(bool $create): void
{
    $p = '/home/honartik/.config';
    if (!safePath($p, true)) {
        throw new RuntimeException('home_config_missing');
    }
    $uid = posix_getpwnam('honartik')['uid'] ?? -1;
    $gid = posix_getpwnam('honartik')['gid'] ?? -1;
    foreach ([$p . '/prhm', FOLDER] as $dir) {
        if (!safePath($dir, true)) {
            if (!$create) {
                continue;
            }
            if (!@mkdir($dir, 0700)) {
                throw new RuntimeException('private_dir_create_failed');
            }
            if (!@chown($dir, (int) $uid) || !@chgrp($dir, (int) $gid)) {
                throw new RuntimeException('private_dir_owner_failed');
            }
            @chmod($dir, 0700);
        }
        $stat = lstat($dir);
        if ($stat['uid'] !== $uid || $stat['gid'] !== $gid
            || ($stat['mode'] & 0077) !== 0) {
            throw new RuntimeException('private_dir_permissions');
        }
    }
}
require APP_ROOT . '/vendor/autoload.php';
$app = require APP_ROOT . '/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
function honartikSite(): Site
{
    $site = Site::query()->where('slug', 'honartik')->firstOrFail();
    if ((int) $site->id !== 3 || $site->status !== 'active'
        || (int) $site->config_revision !== 1
        || ! $site->revisions()->where('revision', 1)->exists()) {
        throw new RuntimeException('tenant_revision_mismatch');
    }
    return $site;
}
function auditAction(Site $site, MachineCredential $credential, string $action): void
{
    AuditLog::query()->create([
        'site_id' => $site->id,
        'actor_type' => 'system',
        'actor_id' => AUDIT_ACTOR,
        'action' => $action,
        'subject_type' => 'machine_credential',
        'subject_id' => (string) $credential->id,
        'after_json' => [
            'id' => (int) $credential->id,
            'name' => CREDENTIAL_NAME,
            'scopes' => ['config:read'],
            'revoked' => $action === 'machine_credential.revoked',
        ],
        'created_at' => now(),
    ]);
}
function revokeByName(Site $site): int
{
    return DB::transaction(static function () use ($site): int {
        $items = MachineCredential::query()->where('site_id', $site->id)
            ->where('name', CREDENTIAL_NAME)->whereNull('revoked_at')
            ->lockForUpdate()->get();
        foreach ($items as $item) {
            if ($item->scopes !== ['config:read']) {
                throw new RuntimeException('unexpected_scopes');
            }
            $item->forceFill(['revoked_at' => now()])->save();
            auditAction($site, $item, 'machine_credential.revoked');
        }
        return count($items);
    }, 3);
}
function checkHttp(string $path, string $token): array
{
    $handle = curl_init('https://config.prhm.ir' . $path);
    if ($handle === false) {
        throw new RuntimeException('curl_init_failed');
    }
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $token],
    ]);
    try {
        $body = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        if (!is_string($body) || $status < 100) {
            throw new RuntimeException('config_center_transport');
        }
        return [$status, $path === '/api/v1/config' ? json_decode($body, true) : null];
    } finally {
        curl_close($handle);
    }
}
function saveSecret(string $token): void
{
    $uid = posix_getpwnam('honartik')['uid'];
    $gid = posix_getpwnam('honartik')['gid'];
    if (safePath(TOKEN_FILE, false)) {
        throw new RuntimeException('credential_file_already_present');
    }
    $tmp = FOLDER . '/.enrollment-' . bin2hex(random_bytes(12));
    $handle = @fopen($tmp, 'xb');
    if ($handle === false) {
        throw new RuntimeException('temp_open_failed');
    }
    try {
        try {
            if (fwrite($handle, $token) !== strlen($token) || !fflush($handle)) {
                throw new RuntimeException('temp_write_failed');
            }
        } finally {
            fclose($handle);
        }
        if (!chmod($tmp, 0600) || !chown($tmp, $uid)
            || !chgrp($tmp, $gid) || !rename($tmp, TOKEN_FILE)) {
            throw new RuntimeException('credential_install_failed');
        }
    } finally {
        // Even a partial write may contain a sensitive token prefix.
        if (is_file($tmp)) {
            @unlink($tmp);
        }
    }
    $s = lstat(TOKEN_FILE);
    if (($s['mode'] & 0170000) !== 0100000
        || ($s['mode'] & 0077) !== 0
        || $s['uid'] !== $uid
        || $s['gid'] !== $gid
        || $s['size'] !== strlen($token)) {
        throw new RuntimeException('credential_file_permissions');
    }
}
function removeSecretOwned(string $candidate): void
{
    // Never unlink a preexisting/rotated credential or an unsafe path.
    if (!safePath(TOKEN_FILE, false)) {
        return;
    }
    $current = @file_get_contents(TOKEN_FILE);
    if (!is_string($current) || !hash_equals($candidate, $current)) {
        throw new RuntimeException('private_file_ownership_mismatch');
    }
    if (!@unlink(TOKEN_FILE)) {
        throw new RuntimeException('private_file_cleanup_failed');
    }
}
function boundRollbackToken(Site $site): ?string
{
    if (!safePath(TOKEN_FILE, false)) {
        return null;
    }
    $value = @file_get_contents(TOKEN_FILE);
    if (!is_string($value) || !preg_match('/^ccm_[a-f0-9]{64}$/D', $value)) {
        throw new RuntimeException('private_file_invalid');
    }
    $matching = MachineCredential::query()
        ->where('site_id', $site->id)
        ->where('name', CREDENTIAL_NAME)
        ->where('token_hash', hash('sha256', $value))
        ->whereNull('revoked_at')
        ->first();
    if (!$matching || $matching->scopes !== ['config:read']) {
        throw new RuntimeException('private_file_credential_binding_mismatch');
    }
    return $value;
}
$site = null;
$created = false;
$fileCreated = false;
$token = null;
try {
    validateSource();
    secureDirectories(false);
    $site = honartikSite();
    $existing = MachineCredential::query()->where('site_id', $site->id)
        ->whereNull('revoked_at')->count();
    if ($mode === 'preflight') {
        if ($existing !== 0 || safePath(TOKEN_FILE, false)) {
            throw new RuntimeException('existing_credential');
        }
        echo "PREFLIGHT_PASS=YES SITE=honartik REVISION=1 ACTIVE=0\n";
        exit(0);
    }
    if ($mode === 'rollback') {
        $boundToken = boundRollbackToken($site);
        $revoked = revokeByName($site);
        if ($boundToken !== null) {
            removeSecretOwned($boundToken);
        }
        $boundToken = null;
        echo 'ROLLBACK_PASS=YES REVOKED=' . $revoked . "\n";
        exit(0);
    }
    if ($existing !== 0 || safePath(TOKEN_FILE, false)) {
        throw new RuntimeException('existing_credential');
    }
    secureDirectories(true);
    $token = 'ccm_' . bin2hex(random_bytes(32));
    saveSecret($token);
    $fileCreated = true;
    DB::transaction(static function () use ($site, $token): void {
        // Serialize tenant issuance with all other callers respecting the
        // Site row lock and re-check the active credential precondition.
        Site::query()->whereKey($site->id)->lockForUpdate()->firstOrFail();
        if (MachineCredential::query()->where('site_id', $site->id)
            ->whereNull('revoked_at')->exists()) {
            throw new RuntimeException('concurrent_credential_detected');
        }
        $credential = MachineCredential::query()->create([
            'site_id' => $site->id,
            'name' => CREDENTIAL_NAME,
            'token_hash' => hash('sha256', $token),
            'scopes' => ['config:read'],
        ]);
        auditAction($site, $credential, 'machine_credential.created');
    }, 3);
    $created = true;
    [$configStatus, $payload] = checkHttp('/api/v1/config', $token);
    [$secretsStatus, ] = checkHttp('/api/v1/secrets', $token);
    $valid = $configStatus === 200 && $secretsStatus === 403
        && is_array($payload)
        && ($payload['site'] ?? null) === 'honartik'
        && ($payload['revision'] ?? null) === 1
        && ($payload['config']['site']['slug'] ?? null) === 'honartik';
    if (!$valid) {
        throw new RuntimeException('api_contract_failed');
    }
    echo "CREDENTIAL_ISSUED=YES SITE=honartik SCOPES=config:read\n";
    echo "CONFIG_HTTP=200 SECRETS_HTTP=403 REVISION=1 FILE_SECURE=YES\n";
} catch (Throwable $e) {
    if ($created && $site !== null) {
        try { revokeByName($site); } catch (Throwable $ignored) { }
    }
    if ($mode === 'apply' && $fileCreated && is_string($token)) {
        try { removeSecretOwned($token); } catch (Throwable $ignored) { }
    }
    echo "CREDENTIAL_OPERATION=FAIL\n";
    exit(1);
} finally {
    $token = null;
}