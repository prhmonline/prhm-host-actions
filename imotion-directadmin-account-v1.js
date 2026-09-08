'use strict';

const TARGET = '10.71.0.10';
const USERNAME = 'imotion';
const PRIMARY_DOMAIN = 'imotion.ir';
const FIXED_DOMAINS = Object.freeze([
  'imotion.ir',
  'admin.imotion.ir',
  'gym.imotion.ir',
  'sale.imotion.ir',
  'i-motion.ir',
  'admin.i-motion.ir',
  'test.i-motion.ir',
  'imotion-iran.ir',
]);
const RUNTIME_INPUTS = Object.freeze([]);
const ACTION = 'imotion_directadmin_account_v1';

function fail(code) { throw new Error(code); }
function presentString(v) { return typeof v === 'string' && v.trim().length > 0; }
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = stable(v[k]);
    return out;
  }
  return v;
}
function same(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
function ownerValue(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function freezeDeep(v) {
  if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v;
  for (const x of Object.values(v)) freezeDeep(x);
  return Object.freeze(v);
}

function validateEvidence(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) fail('preflight_evidence_invalid');
  if (e.target !== TARGET) fail('target_mismatch');
  if (!presentString(e.host_key_fingerprint)) fail('host_key_fingerprint_missing');
  if (!presentString(e.directadmin_version)) fail('directadmin_version_missing');
  if (!presentString(e.admin_user)) fail('directadmin_admin_missing');
  if (e.service_active !== true) fail('directadmin_service_inactive');
  if (e.port_2222_listening !== true) fail('directadmin_port_2222_not_listening');
  if (e.api_url_capable !== true) fail('directadmin_api_url_unavailable');
  if (e.login_url_capable !== true) fail('directadmin_login_url_unavailable');
  if (e.taskq_capable !== true) fail('directadmin_taskq_unavailable');
  if (!presentString(e.db_client)) fail('directadmin_db_client_missing');
  if (e.user_imotion_absent !== true) fail('imotion_user_preexists');
  if (!e.domain_owners || typeof e.domain_owners !== 'object' || Array.isArray(e.domain_owners)) fail('domain_owners_missing');
  const owners = {};
  for (const domain of FIXED_DOMAINS) {
    if (!Object.prototype.hasOwnProperty.call(e.domain_owners, domain)) fail('fixed_domain_owner_missing:' + domain);
    owners[domain] = ownerValue(e.domain_owners[domain]);
    if (owners[domain] !== null) fail('fixed_domain_preowned:' + domain);
  }
  return owners;
}

function buildBoundSpec(evidence) {
  const owners = validateEvidence(evidence);
  return freezeDeep({
    action: ACTION,
    target: TARGET,
    username: USERNAME,
    primary_domain: PRIMARY_DOMAIN,
    fixed_domains: [...FIXED_DOMAINS],
    runtime_inputs: [],
    host_key_fingerprint: String(evidence.host_key_fingerprint),
    directadmin_version: String(evidence.directadmin_version),
    admin_user: String(evidence.admin_user),
    db_client: String(evidence.db_client),
    domain_owners_preimage: owners,
  });
}

function validateFreshIdentity(spec, fresh) {
  if (!fresh || typeof fresh !== 'object') fail('fresh_preflight_invalid');
  if (fresh.target !== spec.target) fail('target_drift');
  if (fresh.host_key_fingerprint !== spec.host_key_fingerprint) fail('host_key_fingerprint_drift');
  if (fresh.admin_user !== spec.admin_user) fail('directadmin_admin_drift');
  if (fresh.directadmin_version !== spec.directadmin_version) fail('directadmin_version_drift');
  if (fresh.db_client !== spec.db_client) fail('directadmin_db_client_drift');
  if (fresh.service_active !== true) fail('directadmin_service_inactive');
  if (fresh.port_2222_listening !== true) fail('directadmin_port_2222_not_listening');
  if (fresh.api_url_capable !== true) fail('directadmin_api_url_unavailable');
  if (fresh.login_url_capable !== true) fail('directadmin_login_url_unavailable');
  if (fresh.taskq_capable !== true) fail('directadmin_taskq_unavailable');
}

function requireAdapter(adapter, names) {
  if (!adapter || typeof adapter !== 'object') fail('adapter_missing');
  for (const name of names) if (typeof adapter[name] !== 'function') fail('adapter_method_missing:' + name);
}

async function preflightWithAdapter(spec, adapter) {
  requireAdapter(adapter, ['revalidateTarget', 'listUsers', 'domainOwners']);
  const fresh = await adapter.revalidateTarget();
  validateFreshIdentity(spec, fresh);
  const users = await adapter.listUsers();
  if (!Array.isArray(users)) fail('directadmin_user_list_invalid');
  if (users.filter(x => x === USERNAME).length !== 0) fail('imotion_user_now_exists');
  const owners = await adapter.domainOwners(spec.fixed_domains);
  if (!owners || typeof owners !== 'object') fail('domain_owner_readback_invalid');
  for (const domain of spec.fixed_domains) {
    const actual = ownerValue(owners[domain]);
    const expected = ownerValue(spec.domain_owners_preimage[domain]);
    if (actual !== expected) fail('fixed_domain_owner_drift:' + domain);
  }
  return {
    ok: true,
    action: ACTION,
    target: spec.target,
    host_key_fingerprint: spec.host_key_fingerprint,
    directadmin_version: spec.directadmin_version,
    admin_user: spec.admin_user,
    production_mutation: false,
  };
}

function validIp(v) {
  return typeof v === 'string' && v.length >= 3 && v.length <= 80 && /^[0-9A-Fa-f:.]+$/.test(v);
}

function makeJournal(spec, invocationId, ip, created) {
  return {
    schema_version: 'prhm.imotion-directadmin-account-journal.v1',
    action: ACTION,
    invocation_id: invocationId,
    target: spec.target,
    username: USERNAME,
    primary_domain: PRIMARY_DOMAIN,
    host_key_fingerprint: spec.host_key_fingerprint,
    directadmin_version: spec.directadmin_version,
    admin_user: spec.admin_user,
    create_ip: ip,
    created: created === true,
    rollback_eligible: created === true,
  };
}

async function readPostState(spec, adapter) {
  const users = await adapter.listUsers();
  const config = await adapter.showUserConfig(USERNAME);
  const owners = await adapter.domainOwners(spec.fixed_domains);
  return { users, config, owners };
}

function postCreateError(spec, state, ip) {
  if (!Array.isArray(state.users) || state.users.filter(x => x === USERNAME).length !== 1) return 'post_create_user_count_mismatch';
  const c = state.config;
  if (!c || typeof c !== 'object') return 'post_create_user_config_missing';
  if (c.username !== USERNAME) return 'post_create_username_mismatch';
  if (c.domain !== PRIMARY_DOMAIN) return 'post_create_primary_domain_mismatch';
  if (c.creator !== spec.admin_user) return 'post_create_creator_mismatch';
  if (c.ip !== ip) return 'post_create_ip_mismatch';
  if (!state.owners || ownerValue(state.owners[PRIMARY_DOMAIN]) !== USERNAME) return 'post_create_primary_owner_mismatch';
  for (const domain of spec.fixed_domains) {
    if (domain === PRIMARY_DOMAIN) continue;
    if (ownerValue(state.owners[domain]) !== ownerValue(spec.domain_owners_preimage[domain])) return 'post_create_other_domain_owner_changed:' + domain;
  }
  return null;
}

function rollbackIdentityMatches(spec, state, journal) {
  if (!Array.isArray(state.users) || state.users.filter(x => x === USERNAME).length !== 1) return false;
  const c = state.config;
  if (!c || c.username !== USERNAME || c.creator !== spec.admin_user || c.ip !== journal.create_ip) return false;
  if (!state.owners || ownerValue(state.owners[PRIMARY_DOMAIN]) !== USERNAME) return false;
  for (const domain of spec.fixed_domains) {
    if (domain === PRIMARY_DOMAIN) continue;
    if (ownerValue(state.owners[domain]) !== ownerValue(spec.domain_owners_preimage[domain])) return false;
  }
  return true;
}

async function rollbackCreated(spec, adapter, journal, failedSnapshot) {
  if (!journal || journal.created !== true || journal.rollback_eligible !== true || journal.username !== USERNAME || journal.primary_domain !== PRIMARY_DOMAIN) {
    fail('rollback_journal_not_eligible');
  }
  const fresh = await adapter.revalidateTarget();
  validateFreshIdentity(spec, fresh);
  const current = await readPostState(spec, adapter);
  if (failedSnapshot && !same(current, failedSnapshot)) fail('rollback_state_drift');
  if (!rollbackIdentityMatches(spec, current, journal)) fail('rollback_identity_mismatch');
  await adapter.deleteUser(USERNAME);
  const usersAfter = await adapter.listUsers();
  const ownersAfter = await adapter.domainOwners(spec.fixed_domains);
  if (!Array.isArray(usersAfter) || usersAfter.includes(USERNAME)) fail('rollback_user_still_present');
  for (const domain of spec.fixed_domains) {
    if (ownerValue(ownersAfter[domain]) !== ownerValue(spec.domain_owners_preimage[domain])) fail('rollback_domain_owner_not_restored:' + domain);
  }
  return true;
}

async function applyWithAdapter(spec, adapter, options = {}) {
  requireAdapter(adapter, ['revalidateTarget', 'listUsers', 'domainOwners', 'resolveCreateIp', 'createUser', 'showUserConfig', 'persistJournal', 'deleteUser']);
  if (!options || typeof options !== 'object' || !presentString(options.invocation_id)) fail('invocation_id_required');
  const invocationId = options.invocation_id;
  await preflightWithAdapter(spec, adapter);
  const ip = await adapter.resolveCreateIp();
  if (!validIp(ip)) fail('directadmin_create_ip_invalid');
  let journal = makeJournal(spec, invocationId, ip, false);
  await adapter.persistJournal(journal);
  let created = false;
  let failedSnapshot = null;
  try {
    await adapter.createUser({ username: USERNAME, domain: PRIMARY_DOMAIN, ip, notify: 'no' });
    created = true;
    journal = makeJournal(spec, invocationId, ip, true);
    await adapter.persistJournal(journal);
    const state = await readPostState(spec, adapter);
    failedSnapshot = state;
    const verificationError = postCreateError(spec, state, ip);
    if (verificationError) fail(verificationError);
    return {
      ok: true,
      action: ACTION,
      target: spec.target,
      username: USERNAME,
      primary_domain: PRIMARY_DOMAIN,
      verified: true,
      rollback_performed: false,
      rollback_failed: false,
    };
  } catch (error) {
    if (!created) {
      return {
        ok: false,
        action: ACTION,
        error: String(error && error.message || error),
        rollback_performed: false,
        rollback_failed: false,
        critical_failure: false,
      };
    }
    try {
      await rollbackCreated(spec, adapter, journal, failedSnapshot);
      return {
        ok: false,
        action: ACTION,
        error: String(error && error.message || error),
        rollback_performed: true,
        rollback_failed: false,
        critical_failure: false,
      };
    } catch (rollbackError) {
      return {
        ok: false,
        action: ACTION,
        error: String(error && error.message || error),
        rollback_error: String(rollbackError && rollbackError.message || rollbackError),
        rollback_performed: false,
        rollback_failed: true,
        critical_failure: true,
      };
    }
  }
}

module.exports = {
  ACTION,
  TARGET,
  USERNAME,
  PRIMARY_DOMAIN,
  FIXED_DOMAINS,
  RUNTIME_INPUTS,
  buildBoundSpec,
  preflightWithAdapter,
  applyWithAdapter,
  rollbackCreated,
};
