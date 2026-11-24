<?php
declare(strict_types=1);

/**
 * Fixed, synthetic, offline MoeinShow QR/PDF artifact smoke.
 * This file is installed only into the SHA-pinned QA checkout.
 * No Yii bootstrap, DB, SMS, gateway, HTTP, or real ticket is accessed.
 */
$root = dirname(__DIR__, 3);
$out = $root . '/qa-output';
if (!is_dir($out) || is_link($out) || realpath($out) !== $out) {
    throw new RuntimeException('QA output directory unavailable or unsafe');
}
require $root . '/vendor/autoload.php';

$code = 'MOEINSHOW-QA-TICKET-0001';
$qr = (new \Da\QrCode\QrCode($code))->setSize(250)->setMargin(5);
$uri = $qr->writeDataUri();
if (!preg_match('~^data:image/png;base64,([A-Za-z0-9+/=]+)$~D', $uri, $m)) {
    throw new RuntimeException('QR encoder returned invalid PNG URI');
}
$png = base64_decode($m[1], true);
if ($png === false || substr($png, 0, 8) !== "\x89PNG\r\n\x1a\n" || strlen($png) < 100) {
    throw new RuntimeException('QR image failed PNG validation');
}
$info = getimagesizefromstring($png);
if (!is_array($info) || ($info[2] ?? null) !== IMAGETYPE_PNG) {
    throw new RuntimeException('QR image has invalid MIME/dimensions');
}
$pngPath = $out . '/moeinshow-qa-qr.png';
if (file_put_contents($pngPath, $png, LOCK_EX) !== strlen($png)) {
    throw new RuntimeException('Could not persist QA PNG');
}
chmod($pngPath, 0600);

if (!class_exists(\Zxing\QrReader::class)) {
    throw new RuntimeException('QR decoder dependency is not installed');
}
$decoded = (new \Zxing\QrReader($pngPath))->text();
if ($decoded !== $code) {
    throw new RuntimeException('QR scan mismatch');
}
echo "QR_SCAN_PASS\n";

$pdfEngine = new \Mpdf\Mpdf([
    'format' => 'A4',
    'tempDir' => sys_get_temp_dir(),
]);
$html = '<html><body><h2>MoeinShow QA - synthetic, not a valid ticket</h2>'
    . '<p>' . htmlspecialchars($code, ENT_QUOTES, 'UTF-8') . '</p>'
    . '<img width="110" height="110" src="' . $uri . '"></body></html>';
$pdfEngine->WriteHTML($html);
$pdf = $pdfEngine->Output('', \Mpdf\Output\Destination::STRING_RETURN);
if (!is_string($pdf) || substr($pdf, 0, 5) !== '%PDF-' || strlen($pdf) < 1000) {
    throw new RuntimeException('QR PDF render invalid');
}
$pdfPath = $out . '/moeinshow-qa-ticket.pdf';
if (file_put_contents($pdfPath, $pdf, LOCK_EX) !== strlen($pdf)) {
    throw new RuntimeException('Could not persist QA PDF');
}
chmod($pdfPath, 0600);
echo "QR_PNG_PASS\n";
echo "PDF_RENDER_PASS\n";
echo 'QA_TOKEN=' . $code . "\n";
echo 'QR_PNG_SHA256=' . hash('sha256', $png) . "\n";
echo 'QR_PDF_SHA256=' . hash('sha256', $pdf) . "\n";
