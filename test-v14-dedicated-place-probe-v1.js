'use strict';

const assert=require('assert');
const fs=require('fs');

const ARTIFACT=
  'artifacts/honartik-iticket-v14-dedicated-place-probe-v1/opsExecutorRoutes.js';

assert.ok(
  fs.existsSync(ARTIFACT),
  'canonical artifact must exist'
);

const s=fs.readFileSync(ARTIFACT,'utf8');

assert.match(
  s,
  /app\.post\('\/honartik\/iticket\/v14\/place-probe',ctx\.auth/
);

assert.match(
  s,
  /type:'honartik-iticket-place-probe-v1'/
);

for(const marker of [
  'read_only:true',
  'database_mutation:false',
  'application_mutation:false',
  'token_exposed:false',
  'raw_response_exposed:false'
]){
  assert.ok(s.includes(marker),`missing ${marker}`);
}

const endpoint=s.match(
  /app\.post\('\/honartik\/iticket\/v14\/place-probe'[\s\S]*?raw_response_exposed:false\}\)\}\}\);/
);

assert.ok(endpoint,'dedicated endpoint block missing');

for(const forbidden of [
  'writeFileSync',
  'renameSync',
  'unlinkSync',
  'spawnSync',
  'execFile',
  'runSSH(',
  'opsSelfmaintBridge',
  'approved-risky',
  'CONFIRM_LEVEL_'
]){
  assert.ok(
    !endpoint[0].includes(forbidden),
    `forbidden mutation surface: ${forbidden}`
  );
}

assert.ok(
  s.includes("app.post('/honartik/iticket/v14/preflight',ctx.auth"),
  'existing preflight must remain'
);

assert.ok(
  s.includes("hostname:'console.iticket.ir'"),
  'fixed iTicket hostname must remain'
);

assert.ok(
  s.includes("'X-Api-Access-Token':token"),
  'fixed token header must remain'
);

assert.ok(
  s.includes('rejectUnauthorized:true'),
  'TLS validation must remain enabled'
);

console.log('ITICKET_DEDICATED_PLACE_PROBE_TEST=PASS');
