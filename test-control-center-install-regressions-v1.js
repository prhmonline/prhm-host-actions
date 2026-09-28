'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const action=require('./control-center-install-runtime-v1.js');

test('Control Center SSO origin bypass is evaluated before the normal CSRF rejection',()=>{
  const source=`export async function POST(request: Request) {\n  if (!isSafeMutationOrigin(request)) {\n    return NextResponse.json(\n      { message: "Invalid request origin." },\n      { status: 403 },\n    );\n  }\n\n  const body = await request.text();\n\n  let upstream: Response;`;
  const patched=action.patchAdminLoginRoute(source);
  assert.match(patched,/const controlCenterEmbedOrigin = process\.env\.CONTROL_CENTER_EMBED_ORIGIN/);
  assert.match(patched,/const isControlCenterOrigin = request\.headers\.get\("origin"\) === controlCenterEmbedOrigin/);
  assert.match(patched,/if \(!isSafeMutationOrigin\(request\) && !isControlCenterOrigin\)/);
  assert.ok(patched.indexOf('isControlCenterOrigin') < patched.indexOf('const body = await request.text()'));
});

test('atomic replacement preserves existing file mode while replacing contents',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-install-'));
  const file=path.join(dir,'owned.txt');
  fs.writeFileSync(file,'before',{mode:0o644});
  fs.chmodSync(file,0o640);
  action.atomicReplacePreservingMetadata(file,Buffer.from('after'));
  assert.equal(fs.readFileSync(file,'utf8'),'after');
  assert.equal(fs.statSync(file).mode & 0o777,0o640);
  fs.rmSync(dir,{recursive:true,force:true});
});
