'use strict';
/**
 * U06 expired owner-OIDC challenge reconciliation — SOURCE ONLY.
 *
 * This module does not export a production entrypoint, a host action, an
 * approval issuer, or a privileged CLI. The only executable constructor is
 * restricted to unprivileged /tmp fixtures for real filesystem/crash tests.
 * A separate reviewed, SHA-pinned, owner-authorized Root adapter must apply
 * the same transaction before the installed challenge bridge is changed.
 *
 * Security contract: never reset an active challenge, a consumed owner proof,
 * an in-flight native transaction, or an ambiguous/tampered state. Archive
 * nonsecret metadata durably, irreversibly retire the expired ephemeral key,
 * keep a durable pending journal across crashes, and fail closed on drift.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const LIVE = Object.freeze({
  host: 'prhm-production.prhm.ir',
  directory: '/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root/owner-oidc',
  nativeParent: '/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root',
  consumed: '/var/lib/prhm-u06-owner-approvals/consumed',
  workflowRef: 'prhmonline/prhm-host-actions/.github/workflows/honartik-u06-owner-approval-oidc-v1.yml@refs/heads/main'
});
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const SHA = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const deny = key => { throw new Error('u06_expired_oidc_reconcile_' + key); };
const need = (truth, key) => { if (!truth) deny(key); };
const ABSENT = file => {
  try { fs.lstatSync(file); return false; }
  catch (e) { if (e.code === 'ENOENT') return true; throw e; }
};
function dirSync(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function ownedDir(directory, uid) {
  const st = fs.lstatSync(directory);
  need(st.isDirectory() && !st.isSymbolicLink() && st.uid === uid &&
    (st.mode & 0o777) === 0o700, 'directory_untrusted');
}
function ownedFile(file, uid, max) {
  const pre = fs.lstatSync(file);
  need(pre.isFile() && !pre.isSymbolicLink() && pre.nlink === 1 &&
    pre.uid === uid && (pre.mode & 0o777) === 0o600 &&
    pre.size > 0 && pre.size <= max, 'file_untrusted');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const post = fs.fstatSync(fd);
    need(post.isFile() && post.nlink === 1 && post.uid === uid &&
      post.dev === pre.dev && post.ino === pre.ino &&
      post.size === pre.size && post.mode === pre.mode, 'file_changed_during_read');
    const buf = fs.readFileSync(fd);
    need(buf.length === post.size, 'file_truncated');
    return buf;
  } finally { fs.closeSync(fd); }
}
function exclusiveFile(file, bytes, uid) {
  const fd = fs.openSync(file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    fs.constants.O_NOFOLLOW, 0o600);
  try {
    const st = fs.fstatSync(fd);
    need(st.isFile() && st.uid === uid && st.nlink === 1 &&
      (st.mode & 0o777) === 0o600, 'new_file_untrusted');
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  dirSync(path.dirname(file));
}
function parseJson(bytes, key) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { deny(key); }
}
function ensureNoActiveOrConsumed(cfg, challengeHash) {
  ownedDir(cfg.nativeParent, cfg.uid);
  ownedDir(cfg.consumed, cfg.uid);
  for (const name of ['u06-exclusive.lease', 'u06-rollback.json']) {
    need(ABSENT(path.join(cfg.nativeParent, name)), 'native_transaction_or_recovery_active');
  }
  // Fail closed if ANY matching consumed record exists, including a symlink.
  for (const name of fs.readdirSync(cfg.consumed)) {
    need(!name.endsWith('.' + challengeHash + '.used'), 'already_consumed');
    need(/^[a-z0-9.\-_]{1,160}$/.test(name), 'consumed_ledger_unknown_entry');
  }
  need(ABSENT(path.join(cfg.directory, 'encrypted-gh-evidence.json')),
    'encrypted_evidence_requires_independent_review');
}
function assessChallenge(cfg, now) {
  ownedDir(cfg.directory, cfg.uid);
  const bytes = ownedFile(path.join(cfg.directory, 'challenge.json'), cfg.uid, 8192);
  const c = parseJson(bytes, 'challenge_invalid_json');
  need(c && c.schema === 'prhm.u06.root-owner-identity-challenge.v1' &&
    HEX64.test(c.challenge || '') && HEX40.test(c.expectedRunSha || '') &&
    c.workflow_ref === LIVE.workflowRef &&
    typeof c.public_key_spki_b64 === 'string' &&
    Number.isSafeInteger(c.issued_at_ms) &&
    Number.isSafeInteger(c.expires_at_ms) &&
    c.issued_at_ms > 0 && c.expires_at_ms - c.issued_at_ms === 480000 &&
    now >= c.expires_at_ms + 30000, 'challenge_not_expired_or_scope_drift');
  let expectedPublic;
  try {
    const pub = crypto.createPublicKey({key: Buffer.from(c.public_key_spki_b64, 'base64'),
      type: 'spki', format: 'der'});
    need(pub.asymmetricKeyType === 'x25519', 'public_key_not_x25519');
    expectedPublic = pub.export({type: 'spki', format: 'der'}).toString('base64');
  } catch { deny('invalid_public_key'); }
  need(expectedPublic === c.public_key_spki_b64, 'public_key_not_canonical');
  const privateBytes = ownedFile(path.join(cfg.directory, 'host-private.pem'), cfg.uid, 8192);
  let privateKey;
  try { privateKey = crypto.createPrivateKey(privateBytes); }
  catch { deny('private_key_invalid'); }
  need(privateKey.asymmetricKeyType === 'x25519' &&
    crypto.createPublicKey(privateKey).export({type: 'spki', format: 'der'}).toString('base64') === expectedPublic,
    'private_key_mismatched');
  const challengeHash = SHA(Buffer.from(c.challenge));
  ensureNoActiveOrConsumed(cfg, challengeHash);
  return Object.freeze({
    challenge_sha256: challengeHash,
    challenge_file_sha256: SHA(bytes), private_file_sha256: SHA(privateBytes),
    issued_at_ms: c.issued_at_ms, expires_at_ms: c.expires_at_ms,
    expected_run_sha: c.expectedRunSha
  });
}
function journalRead(cfg, now) {
  const j = parseJson(ownedFile(path.join(cfg.directory, 'reconciliation.journal.json'),cfg.uid,8192),
    'journal_invalid_json');
  need(j && j.schema === 'prhm.u06.expired-oidc-reconciliation-journal.v1' &&
    j.state === 'PREPARED' && HEX64.test(j.challenge_sha256 || '') &&
    HEX64.test(j.challenge_file_sha256 || '') && HEX64.test(j.private_file_sha256 || '') &&
    Number.isSafeInteger(j.expires_at_ms) && now >= j.expires_at_ms + 30000 &&
    j.owner_uid === cfg.uid, 'journal_scope_or_state_drift');
  ensureNoActiveOrConsumed(cfg, j.challenge_sha256);
  return j;
}
function onePresent(cfg, name, archive, expectedHash) {
  const source = path.join(cfg.directory, name);
  const target = path.join(archive, name);
  const src = !ABSENT(source), dst = !ABSENT(target);
  need(src !== dst, 'file_absent_or_duplicated_' + name);
  const current = src ? source : target;
  need(SHA(ownedFile(current, cfg.uid, 8192)) === expectedHash,
    'file_sha_drift_' + name);
  if (src) {
    fs.renameSync(source, target);
    dirSync(cfg.directory);
    dirSync(archive);
    need(SHA(ownedFile(target, cfg.uid, 8192)) === expectedHash,
      'file_postmove_sha_drift_' + name);
  }
}
function complete(cfg, j, hook) {
  ownedDir(cfg.directory, cfg.uid);
  // A native transaction or owner-proof consumption can appear between
  // inspect() and durable PREPARED creation. Re-attest before any rename.
  // A production binding MUST additionally hold the trusted exclusive lock.
  ensureNoActiveOrConsumed(cfg, j.challenge_sha256);
  const archivedRoot = path.join(cfg.directory, 'abandoned');
  if (ABSENT(archivedRoot)) {
    fs.mkdirSync(archivedRoot, {mode: 0o700});
    dirSync(cfg.directory);
  }
  ownedDir(archivedRoot, cfg.uid);
  const archived = path.join(archivedRoot, j.challenge_sha256);
  if (ABSENT(archived)) {
    fs.mkdirSync(archived, {mode: 0o700});
    dirSync(archivedRoot);
  }
  ownedDir(archived, cfg.uid);
  const receipt = path.join(archived, 'reconciled.json');
  if (!ABSENT(receipt)) {
    const d = parseJson(ownedFile(receipt,cfg.uid,8192), 'receipt_invalid_json');
    need(d.challenge_sha256 === j.challenge_sha256 && d.state === 'RECONCILED' &&
      d.private_key_retired === true, 'receipt_drift');
    const archivedChallenge=ownedFile(path.join(archived,'challenge.json'),cfg.uid,8192);
    need(SHA(archivedChallenge)===j.challenge_file_sha256 &&
      d.source_challenge_sha256===j.challenge_file_sha256,
      'receipt_challenge_digest_drift');
    const marker=parseJson(ownedFile(path.join(archived,'private-retirement.intent.json'),cfg.uid,8192),
      'receipt_retirement_intent_invalid');
    need(marker.schema==='prhm.u06.expired-oidc-key-retirement-intent.v1' &&
      marker.challenge_sha256===j.challenge_sha256 &&
      marker.private_file_sha256===j.private_file_sha256,
      'receipt_retirement_intent_drift');
    need(ABSENT(path.join(archived, 'host-private.pem')) &&
      ABSENT(path.join(cfg.directory, 'host-private.pem')) &&
      ABSENT(path.join(cfg.directory, 'challenge.json')),
      'receipt_inconsistent_with_files');
  } else {
    onePresent(cfg, 'challenge.json', archived, j.challenge_file_sha256);
    hook?.('challenge_archived');
    // When an interruption happened after retiring the private key, continue
    // only if the challenge has already been durably archived.
    const sourceKey = path.join(cfg.directory, 'host-private.pem');
    const archiveKey = path.join(archived, 'host-private.pem');
    const retirementMarker = path.join(archived, 'private-retirement.intent.json');
    if (!ABSENT(sourceKey) || !ABSENT(archiveKey)) {
      onePresent(cfg, 'host-private.pem', archived, j.private_file_sha256);
      hook?.('private_archived');
      need(SHA(ownedFile(archiveKey,cfg.uid,8192)) === j.private_file_sha256,
        'private_postarchive_drift');
      // Durable intent BEFORE unlink: a crash after key retirement cannot be
      // confused with malicious deletion of the only private key.
      if (ABSENT(retirementMarker)) {
        exclusiveFile(retirementMarker, Buffer.from(JSON.stringify({
          schema:'prhm.u06.expired-oidc-key-retirement-intent.v1',
          challenge_sha256:j.challenge_sha256,
          private_file_sha256:j.private_file_sha256
        })+'\n'),cfg.uid);
        hook?.('retirement_intent_durable');
      } else {
        const marker = parseJson(ownedFile(retirementMarker,cfg.uid,8192),
          'retirement_intent_invalid');
        need(marker.schema === 'prhm.u06.expired-oidc-key-retirement-intent.v1' &&
          marker.challenge_sha256 === j.challenge_sha256 &&
          marker.private_file_sha256 === j.private_file_sha256, 'retirement_intent_drift');
      }
      // Re-attest immediately before irreversible key retirement. This
      // closes a source-level journal/crash hook window, but only the future
      // trusted Root exclusive lock can eliminate real concurrent races.
      ensureNoActiveOrConsumed(cfg, j.challenge_sha256);
      fs.unlinkSync(archiveKey); // ephemeral key retired; no secret in the receipt
      dirSync(archived);
      hook?.('private_retired');
    } else {
      const marker = parseJson(ownedFile(retirementMarker,cfg.uid,8192),
        'retirement_intent_missing');
      need(marker.schema === 'prhm.u06.expired-oidc-key-retirement-intent.v1' &&
        marker.challenge_sha256 === j.challenge_sha256 &&
        marker.private_file_sha256 === j.private_file_sha256,
        'retirement_intent_drift');
    }
    const redacted = Object.freeze({
      schema: 'prhm.u06.expired-oidc-reconciliation-receipt.v1',
      state: 'RECONCILED', challenge_sha256: j.challenge_sha256,
      source_challenge_sha256: j.challenge_file_sha256,
      expired_at_ms: j.expires_at_ms, private_key_retired: true,
      production_backup_authorized: false, level4_issued: false
    });
    exclusiveFile(receipt, Buffer.from(JSON.stringify(redacted) + '\n'),cfg.uid);
    hook?.('receipt_committed');
  }
  need(ABSENT(path.join(cfg.directory, 'challenge.json')) &&
    ABSENT(path.join(cfg.directory, 'host-private.pem')) &&
    ABSENT(path.join(cfg.directory, 'encrypted-gh-evidence.json')) &&
    ABSENT(path.join(archived, 'host-private.pem')),
    'final_state_not_clean');
  fs.unlinkSync(path.join(cfg.directory, 'reconciliation.journal.json'));
  dirSync(cfg.directory);
  hook?.('journal_retired');
  return Object.freeze({status:'RECONCILED',challenge_sha256:j.challenge_sha256,
    journal_retired:true,private_key_retired:true,challenge_reissue_eligible:true,
    owner_oidc_verified:false,level4_issued:false,production_mutated:false});
}
class FixtureReconciler {
  constructor(cfg, now, hook) { this.cfg=cfg;this.now=now;this.hook=hook; }
  inspect() {
    need(ABSENT(path.join(this.cfg.directory,'reconciliation.journal.json')),
      'pending_journal_requires_resume');
    return assessChallenge(this.cfg,this.now());
  }
  start() {
    need(ABSENT(path.join(this.cfg.directory,'reconciliation.journal.json')),
      'pending_journal_requires_resume');
    const a=assessChallenge(this.cfg,this.now());
    const j=Object.freeze({schema:'prhm.u06.expired-oidc-reconciliation-journal.v1',
      state:'PREPARED',...a,owner_uid:this.cfg.uid});
    exclusiveFile(path.join(this.cfg.directory,'reconciliation.journal.json'),
      Buffer.from(JSON.stringify(j)+'\n'),this.cfg.uid);
    this.hook?.('journal_prepared');
    return complete(this.cfg,j,this.hook);
  }
  resume() {
    const j=journalRead(this.cfg,this.now());
    return complete(this.cfg,j,this.hook);
  }
}
function createDisposableFixtureReconciler(root,{clock=()=>Date.now(),failureHook=null}={}) {
  need(process.platform==='linux' && typeof process.getuid==='function' &&
    process.getuid()!==0, 'fixture_requires_unprivileged_linux');
  need(typeof root==='string' && /^\/tmp\/u06-owner-reconcile-test-[a-z0-9-]+$/.test(root),
    'fixture_path_rejected');
  need(fs.realpathSync(root)===root, 'fixture_symlink_root');
  need(typeof clock==='function' &&
    (failureHook===null || typeof failureHook==='function'), 'fixture_options_invalid');
  const uid=process.getuid();
  ownedDir(root,uid);
  const cfg=Object.freeze({uid, directory:path.join(root,'owner-oidc'),
    nativeParent:root,consumed:path.join(root,'consumed')});
  ownedDir(cfg.directory,uid); ownedDir(cfg.consumed,uid);
  return new FixtureReconciler(cfg,clock,failureHook);
}
module.exports=Object.freeze({
  LIVE,createDisposableFixtureReconciler,
  ROOT_HANDLER_REGISTERED:false,LIVE_RECONCILIATION_EXPORTED:false,
  PRODUCTION_MUTATION_AUTHORIZED:false,LEVEL4_ISSUER:false
});
if(require.main===module){
  process.stderr.write('U06 reconciliation is source-only; no live Root CLI or Host Action.\n');
  process.exitCode=64;
}
