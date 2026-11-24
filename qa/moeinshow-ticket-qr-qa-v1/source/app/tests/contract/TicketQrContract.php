<?php
declare(strict_types=1);

/**
 * Offline contract for MoeinShow ticket QR rendering.
 *
 * Default mode reads source/Composer metadata only. No database, SMS, payment,
 * HTTP, or live reservation is accessed. Pass --runtime in an isolated
 * environment with installed vendor packages to render a synthetic PDF.
 */
$root = dirname(__DIR__, 3);
$composer = json_decode((string) file_get_contents($root . '/composer.json'), true, 512, JSON_THROW_ON_ERROR);
$ticketView = (string) file_get_contents($root . '/app/views/admin-reserve/print-ticket-new.php');
$pdfView = (string) file_get_contents($root . '/app/views/admin-reserve/_print-ticket-mpdf.php');
$publicView = (string) file_get_contents($root . '/app/modules/api/views/public/print-ticket-new.php');

$checks = [
    'Composer declares the already-installed 2amigos QR library' =>
        isset($composer['require']['2amigos/qrcode-library']),
    'ticket view uses the supported Da QrCode class' =>
        strpos($ticketView, 'use Da\\QrCode\\QrCode;') !== false,
    'ticket view does not depend on absent Mpdf QR classes' =>
        strpos($ticketView, 'Mpdf\\QrCode\\') === false,
    'QR content is the existing reservation purchase code' =>
        strpos($ticketView, 'new QrCode((string)$reserve->code)') !== false,
    'QR has stable size and quiet margin' =>
        strpos($ticketView, '->setSize(250)->setMargin(5)') !== false,
    'QR is generated using the supported data URI writer' =>
        strpos($ticketView, '$qrDataUri = $qrCode->writeDataUri();') !== false,
    'HTML ticket embeds its data URI' =>
        strpos($ticketView, 'src="<?= $qrDataUri ?>"') !== false,
    'PDF mode passes QR data URI to the print partial' =>
        strpos($ticketView, "'qrDataUri' => \$qrDataUri") !== false,
    'PDF ticket embeds the same QR data URI' =>
        strpos($pdfView, 'src="<?= $qrDataUri ?>"') !== false,
    'public ticket wrapper routes through canonical print view' =>
        strpos($publicView, 'admin-reserve/print-ticket-new.php') !== false,
];

$failures = 0;
foreach ($checks as $description => $ok) {
    echo ($ok ? 'PASS: ' : 'FAIL: ') . $description . PHP_EOL;
    if (!$ok) {
        $failures++;
    }
}
if ($failures !== 0) {
    fwrite(STDERR, "TICKET_QR_CONTRACT_FAIL={$failures}" . PHP_EOL);
    exit(1);
}
echo 'TICKET_QR_CONTRACT_PASS=' . count($checks) . PHP_EOL;

if (!in_array('--runtime', $argv ?? [], true)) {
    exit(0);
}

// Run only in an isolated test environment with Composer dependencies present.
// Synthetic ticket token only; no real reservation or production database.
require $root . '/vendor/autoload.php';
$fakeTicketCode = 'MOEINSHOW-QA-TICKET-0001';
$qr = (new \Da\QrCode\QrCode($fakeTicketCode))->setSize(250)->setMargin(5);
$dataUri = $qr->writeDataUri();
if (!preg_match('~^data:image/png;base64,([A-Za-z0-9+/=]+)$~D', $dataUri, $match)) {
    throw new RuntimeException('QR renderer did not produce a PNG data URI');
}
$image = base64_decode($match[1], true);
if ($image === false || strncmp($image, "\x89PNG\r\n\x1a\n", 8) !== 0) {
    throw new RuntimeException('QR output is not a valid PNG signature');
}
$mpdf = new \Mpdf\Mpdf(['tempDir' => sys_get_temp_dir()]);
$mpdf->WriteHTML('<html><body><img width="110" height="110" src="' . $dataUri . '"></body></html>');
$pdf = $mpdf->Output('', \Mpdf\Output\Destination::STRING_RETURN);
if (!is_string($pdf) || strncmp($pdf, '%PDF-', 5) !== 0) {
    throw new RuntimeException('Synthetic QR PDF render failed');
}
echo 'TICKET_QR_RUNTIME_PNG_PDF_PASS' . PHP_EOL;
