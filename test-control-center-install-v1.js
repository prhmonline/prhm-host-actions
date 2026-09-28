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
  assert.match(patched,/CONTROL_CENTER_SSO_ADMIN_LOGIN/);
  assert.match(patched,/admin\.control_center_sso/);
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
