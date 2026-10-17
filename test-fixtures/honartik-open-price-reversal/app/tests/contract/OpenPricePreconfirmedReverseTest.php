<?php
declare(strict_types=1);

/**
 * Source-bound, pure contract of SEP reversal handling. No DB or bank access.
 * Verifies the real ReservePaymentFinalizer decision function by reflection.
 */
require_once __DIR__ . '/../../modules/finance/services/ReservePaymentFinalizer.php';

use app\modules\finance\services\ReservePaymentFinalizer;

$method = new ReflectionMethod(ReservePaymentFinalizer::class, 'isConfirmedPriorSamanReversal');
$base = [
    'status' => -10,
    'reversed' => true,
    'ambiguous' => false,
    'manual_review' => false,
    'gateway_reciept' => 'synthetic-ref-10',
    'reason' => 'verified_amount_mismatch_reversed',
];
$success = 0;
$cases = [
    ['confirmed_amount_mismatch', $base, true, true],
    ['confirmed_transport_reverse', array_replace($base, [
        'status' => 1004, 'reason' => 'verify_no_response_reversed',
    ]), true, true],
    ['not_saman', $base, false, false],
    ['not_reversed', array_replace($base, ['reversed' => false]), true, false],
    ['ambiguous', array_replace($base, ['ambiguous' => true]), true, false],
    ['manual_review', array_replace($base, ['manual_review' => true]), true, false],
    ['missing_ref', array_replace($base, ['gateway_reciept' => '']), true, false],
    ['missing_reason', array_replace($base, ['reason' => '']), true, false],
    ['unrecognized_reason', array_replace($base, ['reason' => 'reversal_pending']), true, false],
    ['bank_success', array_replace($base, ['status' => $success]), true, false],
    ['missing_status', array_diff_key($base, ['status' => true]), true, false],
    ['missing_marker', array_diff_key($base, ['reversed' => true]), true, false],
];
$passed = 0;
foreach ($cases as [$name, $payload, $saman, $expect]) {
    $actual = $method->invoke(null, $payload, $saman, $success);
    if ($actual !== $expect) {
        fwrite(STDERR, 'FAIL ' . $name . ' expected ' . (int)$expect .
            ' got ' . (int)$actual . "\n");
        exit(1);
    }
    $passed++;
}

// A confirmed bank reversal can be recorded even after the deadline for
// STARTING a new reversal. Unconfirmed requests still obey the 50-minute limit.
$window = new ReflectionMethod(ReservePaymentFinalizer::class, 'automaticReverseWindowExpired');
$now = 2000000000;
$timeCases = [
    ['new_reverse_expired', $now - 3001, false, true],
    ['new_reverse_boundary', $now - 3000, false, false],
    ['new_reverse_in_window', $now - 2999, false, false],
    ['new_reverse_without_date', 0, false, false],
    ['bank_already_reversed_expired', $now - 100000, true, false],
    ['bank_already_reversed_in_window', $now - 10, true, false],
];
foreach ($timeCases as [$name, $createdAt, $preconfirmed, $expected]) {
    $actual = $window->invoke(null, $createdAt, $now, $preconfirmed);
    if ($actual !== $expected) {
        fwrite(STDERR, 'FAIL reverse time window: ' . $name . "\n");
        exit(1);
    }
    $passed++;
}

// Source-level fail-closed regression: the only bank call in this method
// must be in the explicit non-preconfirmed branch. The full DB behavior
// is deliberately NOT claimed by this static structural assertion.
$filename = (new ReflectionClass(ReservePaymentFinalizer::class))->getFileName();
$source = file_get_contents($filename);
$start = strpos($source, 'private function reverseSafely(');
$end = strpos($source, 'private function prepareReverseState(', $start);
$body = substr($source, $start, $end - $start);
$conditional = strpos($body, 'if ($alreadyReversedByGateway) {');
$otherBranch = strpos($body, '} else {', $conditional);
$bankCall = strpos($body, '$gateway->rollBack(', $conditional);
if ($start === false || $end === false || $conditional === false ||
    $otherBranch === false || $bankCall === false ||
    !($conditional < $otherBranch && $otherBranch < $bankCall) ||
    substr_count($body, '$gateway->rollBack(') !== 1) {
    fwrite(STDERR, "FAIL structural second-reverse guard\n");
    exit(1);
}
$passed++;

echo "PRECONFIRMED_SEP_REVERSAL_DECISIONS={$passed}/{$passed} PASS\n";
echo "SECOND_BANK_REVERSAL_GUARD=PASS\n";
