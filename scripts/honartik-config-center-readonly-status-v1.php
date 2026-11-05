<?php
declare(strict_types=1);
/**
 * Fixed, read-only, metadata-only Honartik Config Center credential verifier.
 * Delivers no tokens, HTTP bodies, SQL, server internals or private diagnostics.
 * No command other than `status` and no user-supplied tenant/path.
 */
use App\Models\MachineCredential;
use App\Models\Site;
use Illuminate\Contracts\Console\Kernel;
const VERIFY_RELEASE = '/srv/prhm-config-center/releases/git-9b41e4534382';
const VERIFY_TOKEN = '/home/honartik/.config/prhm/config-center/readonly-machine-token';
const VERIFY_NAME = 'Honartik Backend Readonly Production 20261012';
ini_set('display_errors', '0');
error_reporting(0);
if (PHP_SAPI !== 'cli' || $argc !== 2 || $argv[1] !== 'status') {
    fwrite(STDERR, "VERIFY_INVALID_ARGUMENT\n");
    exit(2);
}
function fetchCode(string $path, string $token): int
{
    $h = curl_init('https://config.prhm.ir' . $path);
    if ($h === false) {
        throw new RuntimeException('verify_http_init');
    }
    curl_setopt_array($h, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Authorization: Bearer ' . $token,
        ],
    ]);
    try {
        $result = curl_exec($h);
        $status = (int) curl_getinfo($h, CURLINFO_HTTP_CODE);
        if (!is_string($result) || $status < 100) {
            throw new RuntimeException('verify_http_transport');
        }
        return $status;
    } finally {
        curl_close($h);
    }
}
try {
    if (posix_geteuid() !== 0 || realpath('/srv/prhm-config-center/current') !== VERIFY_RELEASE) {
        throw new RuntimeException('verify_release');
    }
    require VERIFY_RELEASE . '/apps/api/vendor/autoload.php';
    $app = require VERIFY_RELEASE . '/apps/api/bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
    $site = Site::query()->where('slug', 'honartik')->firstOrFail();
    if ((int) $site->id !== 3 || $site->status !== 'active'
        || (int) $site->config_revision !== 1
        || ! $site->revisions()->where('revision', 1)->exists()) {
        throw new RuntimeException('verify_site');
    }
    $credentials = MachineCredential::query()->where('site_id', $site->id)
        ->whereNull('revoked_at')->get();
    // Refuse ambiguous credentials: never infer another user's ownership.
    if ($credentials->count() > 1) {
        throw new RuntimeException('verify_ambiguous_credentials');
    }
    $tokenPresent = false;
    $mode = null;
    $owner = null;
    $configCode = null;
    $secretCode = null;
    $name = null;
    $scopes = [];
    if (file_exists(VERIFY_TOKEN) || is_link(VERIFY_TOKEN)) {
        $st = lstat(VERIFY_TOKEN);
        if (!is_array($st) || ($st['mode'] & 0170000) !== 0100000
            || ($st['mode'] & 0077) !== 0 || ($st['mode'] & 00700) !== 00600) {
            throw new RuntimeException('verify_file_mode');
        }
        $pw = posix_getpwnam('honartik');
        if (!is_array($pw) || $st['uid'] !== $pw['uid'] || $st['gid'] !== $pw['gid']) {
            throw new RuntimeException('verify_file_owner');
        }
        $token = file_get_contents(VERIFY_TOKEN);
        if (!is_string($token) || !preg_match('/^ccm_[a-f0-9]{64}$/D', $token)) {
            throw new RuntimeException('verify_file_token');
        }
        $tokenPresent = true;
        if ($credentials->count() !== 1) {
            throw new RuntimeException('verify_token_without_credential');
        }
        $credential = $credentials->first();
        if ($credential->name !== VERIFY_NAME || $credential->scopes !== ['config:read']
            || !hash_equals((string) $credential->token_hash, hash('sha256', $token))) {
            throw new RuntimeException('verify_credential_binding');
        }
        $configCode = fetchCode('/api/v1/config', $token);
        $secretCode = fetchCode('/api/v1/secrets', $token);
        $mode = sprintf('%04o', $st['mode'] & 00777);
        $owner = 'honartik';
        $name = VERIFY_NAME;
        $scopes = ['config:read'];
        $token = null;
    } elseif ($credentials->count() !== 0) {
        throw new RuntimeException('verify_credential_without_file');
    }
    echo json_encode([
        'site' => 'honartik',
        'revision' => 1,
        'activeCredentialCount' => $credentials->count(),
        'credentialFileExists' => $tokenPresent,
        'fileMode' => $mode,
        'fileOwner' => $owner,
        'credentialName' => $name,
        'scopes' => $scopes,
        'configHttp' => $configCode,
        'secretsHttp' => $secretCode,
    ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) {
    // No leaked path, token, SQL, response body or exception contents.
    echo "VERIFY_STATUS_FAIL\n";
    exit(1);
}
