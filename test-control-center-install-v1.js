'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const action=require('./control-center-install-v1.js');

test('Config Center API patch preserves normal login and adds bounded internal SSO route',()=>{
  const routes=`Route::prefix('admin')->group(function (): void {\n    Route::post(\n        '/login',\n        [AuthController::class, 'login']\n    )->middleware('throttle:5,1');\n\n    Route::middleware([`;
  const patched=action.patchApiRoutes(routes);
  assert.match(patched,/\/login/);
  assert.match(patched,/\/control-center-sso/);
  assert.match(patched,/controlCenterSso/);
  assert.match(patched,/throttle:20,1/);
});

test('AuthController SSO patch is loopback-only, HMAC validated, short-lived and replay protected',()=>{
  const source=`use Illuminate\\Support\\Facades\\Hash;\nuse Illuminate\\Support\\Str;\nuse Illuminate\\Validation\\Rule;\n\nfinal class AuthController extends Controller\n{\n    public function login(Request $request): JsonResponse`;
  const patched=action.patchAuthController(source);
  assert.match(patched,/Cache::add/);
  assert.match(patched,/hash_hmac\('sha256'/);
  assert.match(patched,/127\.0\.0\.1/);
  assert.match(patched,/::1/);
  assert.match(patched,/exp.*iat.*60/s);
  assert.match(patched,/config\('services\.control_center\.admin_login'/);
  assert.match(patched,/config\('services\.control_center\.secret'/);
  assert.doesNotMatch(patched,/env\('CONTROL_CENTER_CONFIG_SSO_SECRET'/);
  assert.match(patched,/admin\.control_center_sso/);
});

test('Laravel services config exposes Control Center SSO through config cache safely',()=>{
  const source=`    'slack' => [\n        'notifications' => [\n            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),\n            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),\n        ],\n    ],\n\n];\n`;
  const patched=action.patchServicesConfig(source);
  assert.match(patched,/'control_center'\s*=>\s*\[/);
  assert.match(patched,/'secret'\s*=>\s*env\('CONTROL_CENTER_CONFIG_SSO_SECRET'/);
  assert.match(patched,/'admin_login'\s*=>\s*env\('CONTROL_CENTER_SSO_ADMIN_LOGIN'/);
});

test('Next login patch accepts only trusted Control Center origin for assertion exchange and leaves normal login path intact',()=>{
  const source=`export async function POST(request: Request) {\n  if (!isSafeMutationOrigin(request)) {\n    return NextResponse.json(\n      { message: "Invalid request origin." },\n      { status: 403 },\n    );\n  }\n\n  const body = await request.text();\n\n  let upstream: Response;`;
  const patched=action.patchAdminLoginRoute(source);
  assert.match(patched,/control_center_assertion/);
  assert.match(patched,/CONTROL_CENTER_EMBED_ORIGIN/);
  assert.match(patched,/api\/admin\/control-center-sso/);
  assert.match(patched,/cc_admin_token/);
  assert.match(patched,/isSafeMutationOrigin/);
});

test('Next security patch limits framing to trusted management origins and drops DENY only for the integrated build',()=>{
  const source=`const securityHeaders = [\n  { key: "X-Content-Type-Options", value: "nosniff" },\n  { key: "X-Frame-Options", value: "DENY" },\n  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },\n  {\n    key: "Content-Security-Policy",\n    value: [\n      "default-src 'self'",\n      "base-uri 'self'",\n      "frame-ancestors 'none'",`;
  const patched=action.patchNextConfig(source);
  assert.doesNotMatch(patched,/X-Frame-Options.*DENY/);
  assert.match(patched,/frame-ancestors https:\/\/agent\.prhm\.ir https:\/\/control\.prhm\.ir/);
});

test('installer constants keep acceptance route isolated and preserve old dashboards',()=>{
  assert.equal(action.constants.PORT,18140);
  assert.equal(action.constants.BASE_PATH,'/control-center');
  assert.equal(action.constants.PUBLIC_URL,'https://agent.prhm.ir/control-center/');
  assert.notEqual(action.constants.PORT,18135);
  assert.match(action.constants.SNAPSHOT,/prhm-company-os-dashboard\/snapshot\.json$/);
});

test('installer is bound to the reviewed Control Center commit and versioned release root',()=>{
  assert.equal(action.constants.CONTROL_PLANE_SHA,'ce40ec5a14e6a6b29e8e9fc555cc16a7621a4757');
  assert.equal(action.constants.RELEASE_ROOT,'/var/lib/prhm-control-center/releases');
  assert.equal(action.releaseDir(),`/var/lib/prhm-control-center/releases/${action.constants.CONTROL_PLANE_SHA}`);
});

test('runtime env contains only derived hashes/secrets and never the plaintext test password',()=>{
  const env=action.buildRuntimeEnv({
    username:'cc-test',
    password:'plain-password-must-not-leak',
    passwordHash:'scrypt$aa$bb',
    sessionSecret:'s'.repeat(48),
    ssoSecret:'k'.repeat(48),
    ssoAdminLogin:'Mohammad',
  });
  assert.match(env,/CONTROL_CENTER_TEST_USER=cc-test/);
  assert.match(env,/CONTROL_CENTER_TEST_PASSWORD_HASH=scrypt\$aa\$bb/);
  assert.match(env,/CONTROL_CENTER_SESSION_SECRET=s{48}/);
  assert.match(env,/CONTROL_CENTER_CONFIG_SSO_SECRET=k{48}/);
  assert.match(env,/CONTROL_CENTER_SSO_ADMIN_LOGIN=Mohammad/);
  assert.doesNotMatch(env,/plain-password-must-not-leak/);
  assert.match(env,/COMPANY_OS_URL=http:\/\/127\.0\.0\.1:18135/);
  assert.match(env,/CONFIG_CENTER_URL=http:\/\/127\.0\.0\.1:3005/);
});

test('Apache acceptance route patch adds only control-center proxy and preserves company-os',()=>{
  const source=`<VirtualHost *:443>\n  ServerName agent.prhm.ir\n  ProxyPass /company-os http://127.0.0.1:18135/company-os\n  ProxyPassReverse /company-os http://127.0.0.1:18135/company-os\n</VirtualHost>\n`;
  const patched=action.patchApacheHttps(source);
  assert.match(patched,/ProxyPass \/company-os http:\/\/127\.0\.0\.1:18135\/company-os/);
  assert.match(patched,/ProxyPass \/control-center http:\/\/127\.0\.0\.1:18140\/control-center/);
  assert.match(patched,/ProxyPassReverse \/control-center http:\/\/127\.0\.0\.1:18140\/control-center/);
  assert.equal((patched.match(/ProxyPass \/control-center/g)||[]).length,1);
});

test('rollback plan is scoped to Control Center artifacts and Config Center files only',()=>{
  const plan=action.rollbackTargets();
  assert.ok(plan.includes('/var/lib/prhm-control-center/current'));
  assert.ok(plan.includes('/etc/prhm-control-center/control-center.env'));
  assert.ok(plan.includes(action.constants.CONFIG_API_ROUTES));
  assert.ok(plan.includes(action.constants.CONFIG_AUTH_CONTROLLER));
  assert.ok(plan.includes(action.constants.CONFIG_SERVICES));
  assert.ok(plan.includes(action.constants.CONFIG_ADMIN_LOGIN_ROUTE));
  assert.ok(plan.includes(action.constants.CONFIG_NEXT_CONFIG));
  assert.ok(!plan.some(x=>x.includes('/var/lib/prhm-company-os-dashboard/app')));
});
