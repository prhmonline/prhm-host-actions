#!/usr/local/bin/prhm-node
'use strict';

const constants = Object.freeze({
  ACTION: 'control_center_install_v1',
  PORT: 18140,
  BASE_PATH: '/control-center',
  PUBLIC_URL: 'https://agent.prhm.ir/control-center/',
  SNAPSHOT: '/var/lib/prhm-company-os-dashboard/snapshot.json',
  CONFIG_API_ROUTES: '/srv/prhm-config-center/current/apps/api/routes/api.php',
  CONFIG_AUTH_CONTROLLER: '/srv/prhm-config-center/current/apps/api/app/Http/Controllers/Api/Admin/AuthController.php',
  CONFIG_ADMIN_LOGIN_ROUTE: '/srv/prhm-config-center/current/apps/admin/src/app/api/session/login/route.ts',
  CONFIG_NEXT_CONFIG: '/srv/prhm-config-center/current/apps/admin/next.config.ts',
});

function fail(message) { throw new Error(message); }
function exactlyOnce(source, needle, label) {
  const count = String(source).split(needle).length - 1;
  if (count !== 1) fail(`${label}_anchor_${count}`);
}

function patchApiRoutes(source) {
  source = String(source);
  if (source.includes("'/control-center-sso'")) return source;
  const anchor = '    Route::middleware([';
  exactlyOnce(source, anchor, 'api_routes');
  const block = [
    "    Route::post(",
    "        '/control-center-sso',",
    "        [AuthController::class, 'controlCenterSso']",
    "    )->middleware('throttle:20,1');",
    '',
  ].join('\n');
  return source.replace(anchor, block + anchor);
}

function patchAuthController(source) {
  source = String(source);
  if (source.includes('public function controlCenterSso(')) return source;
  const hashUse = 'use Illuminate\\Support\\Facades\\Hash;';
  exactlyOnce(source, hashUse, 'auth_hash_use');
  source = source.replace(hashUse, hashUse + '\nuse Illuminate\\Support\\Facades\\Cache;');
  const anchor = '    public function login(Request $request): JsonResponse';
  exactlyOnce(source, anchor, 'auth_login');
  const method = `    public function controlCenterSso(Request $request): JsonResponse
    {
        if (! in_array($request->ip(), ['127.0.0.1', '::1'], true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $assertion = (string) $request->input('assertion', '');
        $secret = (string) env('CONTROL_CENTER_CONFIG_SSO_SECRET', '');
        $adminLogin = Str::lower(trim((string) env('CONTROL_CENTER_SSO_ADMIN_LOGIN', '')));
        if (strlen($secret) < 32 || $adminLogin === '' || substr_count($assertion, '.') !== 1) {
            return response()->json(['message' => 'Invalid SSO configuration.'], 503);
        }

        [$payload, $signature] = explode('.', $assertion, 2);
        $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, $secret, true)), '+/', '-_'), '=');
        if (! hash_equals($expected, $signature)) {
            return response()->json(['message' => 'Invalid assertion.'], 401);
        }

        $decoded = base64_decode(strtr($payload, '-_', '+/'), true);
        $data = is_string($decoded) ? json_decode($decoded, true) : null;
        $now = time();
        $iat = is_array($data) ? ($data['iat'] ?? null) : null;
        $exp = is_array($data) ? ($data['exp'] ?? null) : null;
        $nonce = is_array($data) ? (string) ($data['n'] ?? '') : '';
        if (! is_int($iat) || ! is_int($exp) || $exp <= $now || $iat > $now + 5 || ($exp - $iat) > 60 || strlen($nonce) < 8) {
            return response()->json(['message' => 'Expired assertion.'], 401);
        }
        if (! Cache::add('admin.control_center_sso.' . hash('sha256', $nonce), true, 60)) {
            return response()->json(['message' => 'Assertion already used.'], 409);
        }

        $user = User::query()
            ->whereRaw('LOWER(email) = ?', [$adminLogin])
            ->orWhereRaw('LOWER(name) = ?', [$adminLogin])
            ->first();
        if (! $user || $user->email_verified_at === null) {
            return response()->json(['message' => 'SSO admin unavailable.'], 403);
        }

        $expiresAt = now()->addHours(8);
        $token = $user->createToken('config-center-control-center-sso', ['config-admin'], $expiresAt);
        return response()->json([
            'token' => $token->plainTextToken,
            'token_type' => 'Bearer',
            'expires_at' => $expiresAt->toIso8601String(),
            'user' => $this->userPayload($user),
        ]);
    }

`;
  return source.replace(anchor, method + anchor);
}

function patchAdminLoginRoute(source) {
  source = String(source);
  if (source.includes('control_center_assertion')) return source;
  const anchor = '  const body = await request.text();';
  exactlyOnce(source, anchor, 'admin_login_body');
  const block = `  const body = await request.text();

  const form = new URLSearchParams(body);
  const controlCenterAssertion = form.get("control_center_assertion");
  if (controlCenterAssertion) {
    const embedOrigin = process.env.CONTROL_CENTER_EMBED_ORIGIN ?? "https://agent.prhm.ir";
    const origin = request.headers.get("origin") ?? "";
    if (origin !== embedOrigin) {
      return NextResponse.json({ message: "Invalid Control Center origin." }, { status: 403 });
    }
    let ssoUpstream: Response;
    try {
      ssoUpstream = await fetch(
        \`${'${apiBaseUrl()}'}/api/admin/control-center-sso\`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ assertion: controlCenterAssertion }),
          cache: "no-store",
        },
      );
    } catch {
      return NextResponse.json({ message: "Config Center API is unavailable." }, { status: 502 });
    }
    const ssoPayload = (await ssoUpstream.json().catch(() => ({ message: "Invalid response from API." }))) as LoginPayload;
    if (!ssoUpstream.ok || typeof ssoPayload.token !== "string") {
      return NextResponse.json(ssoPayload, { status: ssoUpstream.ok ? 502 : ssoUpstream.status });
    }
    const token = ssoPayload.token;
    const safePayload = { ...ssoPayload };
    delete safePayload.token;
    const response = NextResponse.redirect(new URL(form.get("return_to") || "/", request.url), 303);
    response.cookies.set("cc_admin_token", token, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  }`;
  return source.replace(anchor, block);
}

function patchNextConfig(source) {
  source = String(source);
  source = source.replace(/\n\s*\{ key: "X-Frame-Options", value: "DENY" \},/, '');
  if (source.includes("frame-ancestors https://agent.prhm.ir https://control.prhm.ir")) return source;
  const anchor = '"frame-ancestors \'none\'"';
  exactlyOnce(source, anchor, 'next_frame_ancestors');
  return source.replace(anchor, '"frame-ancestors https://agent.prhm.ir https://control.prhm.ir"');
}

module.exports = {
  constants,
  patchApiRoutes,
  patchAuthController,
  patchAdminLoginRoute,
  patchNextConfig,
};
