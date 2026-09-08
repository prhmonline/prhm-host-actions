'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mod = require('./imotion-directadmin-account-v1.js');

const FIXED_DOMAINS = [
  'imotion.ir',
  'admin.imotion.ir',
  'gym.imotion.ir',
  'sale.imotion.ir',
  'i-motion.ir',
  'admin.i-motion.ir',
  'test.i-motion.ir',
  'imotion-iran.ir',
];

function evidence(overrides = {}) {
  return {
    target: '10.71.0.10',
    host_key_fingerprint: 'SHA256:fixture-directadmin-ed25519',
    directadmin_version: 'DirectAdmin v1.fixture',
    admin_user: 'admin',
    service_active: true,
    port_2222_listening: true,
    api_url_capable: true,
    login_url_capable: true,
    taskq_capable: true,
    db_client: 'mariadb',
    user_imotion_absent: true,
    domain_owners: Object.fromEntries(FIXED_DOMAINS.map(d => [d, null])),
    ...overrides,
  };
}

function makeAdapter(options = {}) {
  const bound = evidence(options.evidence || {});
  const calls = [];
  let users = [...(options.users || [])];
  let owners = { ...bound.domain_owners, ...(options.owners || {}) };
  let config = null;
  let journal = null;

  return {
    calls,
    get journal() { return journal; },
    async revalidateTarget() {
      calls.push(['revalidateTarget']);
      return evidence(options.revalidate || {});
    },
    async listUsers() {
      calls.push(['listUsers']);
      return [...users];
    },
    async domainOwners(domains) {
      calls.push(['domainOwners', [...domains]]);
      return Object.fromEntries(domains.map(d => [d, owners[d] ?? null]));
    },
    async resolveCreateIp() {
      calls.push(['resolveCreateIp']);
      return options.createIp || '203.0.113.10';
    },
    async createUser(request) {
      calls.push(['createUser', structuredClone(request)]);
      if (options.createError) throw new Error(options.createError);
      users.push('imotion');
      owners['imotion.ir'] = 'imotion';
      config = {
        username: 'imotion',
        domain: 'imotion.ir',
        creator: bound.admin_user,
        ip: options.createIp || '203.0.113.10',
        ...(options.postConfig || {}),
      };
      return { ok: true };
    },
    async showUserConfig(username) {
      calls.push(['showUserConfig', username]);
      return config;
    },
    async persistJournal(value) {
      calls.push(['persistJournal', structuredClone(value)]);
      journal = structuredClone(value);
    },
    async deleteUser(username) {
      calls.push(['deleteUser', username]);
      if (options.deleteError) throw new Error(options.deleteError);
      users = users.filter(x => x !== username);
      if (owners['imotion.ir'] === username) owners['imotion.ir'] = null;
      config = null;
      return { ok: true };
    },
  };
}

test('buildBoundSpec exposes no runtime input surface and fixes target/user/domain', () => {
  const spec = mod.buildBoundSpec(evidence());
  assert.equal(spec.target, '10.71.0.10');
  assert.equal(spec.username, 'imotion');
  assert.equal(spec.primary_domain, 'imotion.ir');
  assert.deepEqual(spec.runtime_inputs, []);
  assert.deepEqual(spec.fixed_domains, FIXED_DOMAINS);
  assert.equal(Object.isFrozen(spec), true);
});

for (const [label, patch, code] of [
  ['wrong target', { target: '10.71.0.117' }, 'target_mismatch'],
  ['missing fingerprint', { host_key_fingerprint: '' }, 'host_key_fingerprint_missing'],
  ['inactive DirectAdmin', { service_active: false }, 'directadmin_service_inactive'],
  ['closed 2222', { port_2222_listening: false }, 'directadmin_port_2222_not_listening'],
  ['api-url unavailable', { api_url_capable: false }, 'directadmin_api_url_unavailable'],
  ['login-url unavailable', { login_url_capable: false }, 'directadmin_login_url_unavailable'],
  ['taskq unavailable', { taskq_capable: false }, 'directadmin_taskq_unavailable'],
  ['imotion already exists', { user_imotion_absent: false }, 'imotion_user_preexists'],
]) {
  test('buildBoundSpec rejects ' + label, () => {
    assert.throws(() => mod.buildBoundSpec(evidence(patch)), new RegExp(code));
  });
}

test('buildBoundSpec rejects any pre-owned fixed iMotion domain', () => {
  const e = evidence();
  e.domain_owners['admin.imotion.ir'] = 'someone';
  assert.throws(() => mod.buildBoundSpec(e), /fixed_domain_preowned:admin\.imotion\.ir/);
});

test('preflight revalidation rejects fingerprint drift before mutation', async () => {
  const spec = mod.buildBoundSpec(evidence());
  const a = makeAdapter({ revalidate: { host_key_fingerprint: 'SHA256:changed' } });
  await assert.rejects(() => mod.preflightWithAdapter(spec, a), /host_key_fingerprint_drift/);
  assert.equal(a.calls.some(c => c[0] === 'createUser'), false);
});

test('preflight revalidation rejects admin/version drift before mutation', async () => {
  const spec = mod.buildBoundSpec(evidence());
  const a1 = makeAdapter({ revalidate: { admin_user: 'otheradmin' } });
  await assert.rejects(() => mod.preflightWithAdapter(spec, a1), /directadmin_admin_drift/);
  const a2 = makeAdapter({ revalidate: { directadmin_version: 'DirectAdmin changed' } });
  await assert.rejects(() => mod.preflightWithAdapter(spec, a2), /directadmin_version_drift/);
});

test('preflight rejects user/domain ownership drift before mutation', async () => {
  const spec = mod.buildBoundSpec(evidence());
  const a1 = makeAdapter({ users: ['imotion'] });
  await assert.rejects(() => mod.preflightWithAdapter(spec, a1), /imotion_user_now_exists/);
  const a2 = makeAdapter({ owners: { 'imotion.ir': 'someone' } });
  await assert.rejects(() => mod.preflightWithAdapter(spec, a2), /fixed_domain_owner_drift:imotion\.ir/);
});

test('apply performs exactly one fixed create and exact readback verification', async () => {
  const spec = mod.buildBoundSpec(evidence());
  const a = makeAdapter();
  const out = await mod.applyWithAdapter(spec, a, { invocation_id: 'inv-1' });
  assert.equal(out.ok, true);
  const creates = a.calls.filter(c => c[0] === 'createUser');
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0][1], {
    username: 'imotion',
    domain: 'imotion.ir',
    ip: '203.0.113.10',
    notify: 'no',
  });
  assert.equal(JSON.stringify(out).includes('passwd'), false);
  assert.equal(JSON.stringify(a.journal).includes('passwd'), false);
  assert.equal(JSON.stringify(a.journal).includes('api-url'), false);
});

test('post-create mismatch triggers guarded rollback of only imotion', async () => {
  const spec = mod.buildBoundSpec(evidence());
  const a = makeAdapter({ postConfig: { domain: 'wrong.example' } });
  const out = await mod.applyWithAdapter(spec, a, { invocation_id: 'inv-2' });
  assert.equal(out.ok, false);
  assert.equal(out.rollback_performed, true);
  assert.deepEqual(a.calls.filter(c => c[0] === 'deleteUser'), [['deleteUser', 'imotion']]);
});

test('rollback is denied if current state drifted after create', async () => {
  const spec = mod.buildBoundSpec(evidence());
  const a = makeAdapter({ postConfig: { domain: 'wrong.example' } });
  const originalShow = a.showUserConfig;
  let reads = 0;
  a.showUserConfig = async username => {
    reads++;
    if (reads >= 2) return { username: 'imotion', domain: 'foreign.example', creator: 'admin', ip: '203.0.113.10' };
    return originalShow(username);
  };
  const out = await mod.applyWithAdapter(spec, a, { invocation_id: 'inv-3' });
  assert.equal(out.ok, false);
  assert.equal(out.rollback_failed, true);
  assert.equal(a.calls.some(c => c[0] === 'deleteUser'), false);
});

test('rollback deletion failure is surfaced as critical incomplete', async () => {
  const spec = mod.buildBoundSpec(evidence());
  const a = makeAdapter({ postConfig: { domain: 'wrong.example' }, deleteError: 'delete failed' });
  const out = await mod.applyWithAdapter(spec, a, { invocation_id: 'inv-4' });
  assert.equal(out.ok, false);
  assert.equal(out.rollback_failed, true);
  assert.equal(out.critical_failure, true);
});

test('module source contains no old target and no caller credential fields', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('./imotion-directadmin-account-v1.js'), 'utf8');
  assert.equal(src.includes('10.71.0.117'), false);
  for (const forbidden of ['admin_password', 'caller_password', 'arbitrary_command', 'arbitrary_path']) {
    assert.equal(src.includes(forbidden), false, forbidden);
  }
});
