'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const TARGET = '/home/honartik/domains/dashboard.honartik.ir/public_html/app/modules/finance/services/PaymentNotificationOutbox.php';
const EXPECTED_SHA256 = '7fcd626c30bb37dcd5706572a578d63d8bf76e205dbf0b48150a647b1270e928';
const BACKUP_DIR = '/var/backups/prhm-honartik-sms-pattern';

const SEARCH = `        $sent = Yii::$app->notify->send(
            (int)$reserve->user_id,
            json_encode([
                'sms_pattern' => 'pgf779iwzjekabl',
                'sms_variables' => [
                    'code' => (string)$reserve->code,
                    'place' => $place,
                    'event' => $event,
                    'time' => $time,
                ],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            '',
            ['priority' => Notification::MEDIA_SMS]
        );
`;

const REPLACEMENT = `        $isWorkshop = $reserve->event
            && (int)$reserve->event->kind === \\common\\models\\Event::KIND_WORKSHOP;

        if ($isWorkshop) {
            $smsPattern = 'insdsj91rpctljh';
            $smsVariables = [
                'event' => $event,
                'code' => (string)$reserve->code,
            ];
        } else {
            $smsPattern = 'pgf779iwzjekabl';
            $smsVariables = [
                'code' => (string)$reserve->code,
                'place' => $place,
                'event' => $event,
                'time' => $time,
            ];
        }

        $sent = Yii::$app->notify->send(
            (int)$reserve->user_id,
            json_encode([
                'sms_pattern' => $smsPattern,
                'sms_variables' => $smsVariables,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            '',
            ['priority' => Notification::MEDIA_SMS]
        );
`;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) !== -1) {
    count += 1;
    at += needle.length;
  }
  return count;
}

function phpLint(file) {
  const result = cp.spawnSync('/usr/bin/php', ['-l', file], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    output: String(result.stdout || result.stderr || '').trim(),
  };
}

function preflight() {
  if (!fs.existsSync(TARGET) || !fs.statSync(TARGET).isFile()) {
    throw new Error('target_missing');
  }

  const current = fs.readFileSync(TARGET);
  const currentSha = sha256(current);
  if (currentSha !== EXPECTED_SHA256) {
    throw new Error(`expected_sha256_mismatch:${currentSha}`);
  }

  const text = current.toString('utf8');
  const occurrences = countOccurrences(text, SEARCH);
  if (occurrences !== 1) {
    throw new Error(`expected_occurrences_mismatch:${occurrences}`);
  }
  if (countOccurrences(text, "'insdsj91rpctljh'") !== 0) {
    throw new Error('new_pattern_already_present_unexpectedly');
  }
  if (countOccurrences(text, "'pgf779iwzjekabl'") !== 1) {
    throw new Error('existing_pattern_count_mismatch');
  }

  const next = Buffer.from(text.replace(SEARCH, REPLACEMENT), 'utf8');
  return {
    current,
    next,
    currentSha,
    nextSha: sha256(next),
    occurrences,
  };
}

function apply() {
  const check = preflight();
  const st = fs.statSync(TARGET);
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(BACKUP_DIR, 0o700); } catch {}

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const backup = path.join(BACKUP_DIR, `PaymentNotificationOutbox.php.${stamp}.${check.currentSha}.bak`);
  fs.writeFileSync(backup, check.current, { flag: 'wx', mode: 0o600 });

  const temp = `${TARGET}.deployhq-${process.pid}-${Date.now()}.tmp`;
  let mutated = false;

  try {
    fs.writeFileSync(temp, check.next, { flag: 'wx', mode: st.mode & 0o777 });
    fs.chownSync(temp, st.uid, st.gid);
    const fd = fs.openSync(temp, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(temp, TARGET);
    mutated = true;

    const lint = phpLint(TARGET);
    if (!lint.ok) throw new Error(`php_lint_failed:${lint.output}`);

    const verify = fs.readFileSync(TARGET);
    const verifySha = sha256(verify);
    if (verifySha !== check.nextSha) {
      throw new Error(`postwrite_sha_mismatch:${verifySha}:${check.nextSha}`);
    }

    const verifyText = verify.toString('utf8');
    if (countOccurrences(verifyText, "'insdsj91rpctljh'") !== 1) throw new Error('new_pattern_verify_failed');
    if (countOccurrences(verifyText, "'pgf779iwzjekabl'") !== 1) throw new Error('theater_pattern_verify_failed');
    if (!verifyText.includes('Event::KIND_WORKSHOP')) throw new Error('workshop_branch_verify_failed');

    console.log('HONARTIK_SMS_WORKSHOP_PATCH=SUCCESS');
    console.log(`OLD_SHA256=${check.currentSha}`);
    console.log(`NEW_SHA256=${verifySha}`);
    console.log(`BACKUP=${backup}`);
    console.log(`PHP_LINT=${lint.output}`);
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    if (mutated) {
      const rb = `${TARGET}.rollback-${process.pid}-${Date.now()}.tmp`;
      fs.writeFileSync(rb, check.current, { flag: 'wx', mode: st.mode & 0o777 });
      fs.chownSync(rb, st.uid, st.gid);
      fs.renameSync(rb, TARGET);
      const rollbackLint = phpLint(TARGET);
      console.error(`ROLLBACK_PERFORMED=YES`);
      console.error(`ROLLBACK_LINT=${rollbackLint.output}`);
    }
    throw error;
  }
}

try {
  const preflightOnly = process.argv.includes('--preflight-only');
  const check = preflight();
  console.log('HONARTIK_SMS_WORKSHOP_PREFLIGHT=PASS');
  console.log(`CURRENT_SHA256=${check.currentSha}`);
  console.log(`CANDIDATE_SHA256=${check.nextSha}`);
  console.log(`EXPECTED_OCCURRENCES=${check.occurrences}`);

  if (!preflightOnly) {
    apply();
  }
} catch (error) {
  console.error(`HONARTIK_SMS_WORKSHOP_PATCH=FAIL:${error.message}`);
  process.exit(1);
}
