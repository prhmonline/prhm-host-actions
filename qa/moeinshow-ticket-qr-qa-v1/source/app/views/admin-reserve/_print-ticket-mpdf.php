<?php
use common\models\Event;

/** @var $reserve \common\models\Reserve */
/** @var array $data */
/** @var array $seatGroups */
/** @var bool $isFerdowsiVenue */
/** @var string $qrDataUri */
/** @var string $posterUrl */
/** @var int $ticketCount */
/** @var string $mobile */
/** @var Closure $toPersianDigits */

$logoUrl = 'file://' . Yii::getAlias('@webroot/img/logo.png');
?>
<!doctype html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="utf-8">
    <style>
        body {
            direction: rtl;
            font-family: vazirmatn, sans-serif;
            color: #171923;
            font-size: 10pt;
            line-height: 1.55;
            margin: 0;
            padding: 0;
        }
        table { border-collapse: collapse; }
        .ticket { width: 100%; border: 0.35mm solid #dde1ea; background: #ffffff; }
        .header { width: 100%; background: #5136bd; color: #ffffff; }
        .header td { padding: 5mm 6mm; vertical-align: middle; }
        .logo-cell { width: 55%; text-align: right; }
        .code-cell { width: 45%; text-align: left; }
        .logo { width: 38mm; height: 18.5mm; }
        .code-label { font-size: 8.5pt; color: #e4ddff; }
        .code-value { font-size: 17pt; font-weight: bold; color: #ffffff; }
        .body { padding: 5mm; }
        .hero { width: 100%; }
        .poster-cell { width: 32%; padding-left: 5mm; vertical-align: top; }
        .info-cell { width: 68%; vertical-align: top; }
        .poster-frame { border: 0.3mm solid #e5e8ef; background: #f6f7fa; padding: 1.5mm; text-align: center; }
        .poster { width: 54mm; height: 88mm; }
        .event-card { border: 0.3mm solid #e5e8ef; padding: 4.5mm; background: #ffffff; }
        .event-title { color: #211943; font-size: 21pt; font-weight: bold; margin: 0 0 4mm 0; }
        .meta { width: 100%; }
        .meta td { width: 50%; padding: 1.3mm; vertical-align: top; }
        .meta-box { border: 0.25mm solid #e5e8ef; padding: 2.8mm 3mm; background: #ffffff; }
        .meta-label { display: block; color: #687086; font-size: 8.5pt; }
        .meta-value { display: block; color: #171923; font-size: 10pt; font-weight: bold; }
        .address-box { margin-top: 1.5mm; }
        .section { width: 100%; border: 0.3mm solid #e5e8ef; margin-top: 4mm; }
        .section-title { background: #f6f7fa; color: #2d254b; font-size: 11pt; font-weight: bold; padding: 2.8mm 3.5mm; border-bottom: 0.3mm solid #e5e8ef; }
        .section-body { padding: 3.2mm 3.5mm; }
        .payment { width: 100%; }
        .payment-info { width: 80%; padding-left: 4mm; vertical-align: middle; }
        .payment-qr { width: 20%; padding-right: 4mm; border-right: 0.25mm dashed #d8dce6; text-align: center; vertical-align: middle; }
        .summary { width: 100%; }
        .summary td { padding: 1.8mm 0; border-bottom: 0.25mm dashed #e5e8ef; }
        .summary-label { color: #687086; text-align: right; }
        .summary-value { text-align: left; font-weight: bold; }
        .summary-total { color: #4e35c7; font-size: 14pt; }
        .tax-note { color: #7a6840; background: #fff3d8; padding: 2mm 2.5mm; margin-top: 2mm; font-size: 8pt; }
        .qr { width: 29mm; height: 29mm; }
        .qr-label { color: #687086; font-size: 8pt; }
        .seats { width: 100%; margin-top: 2.5mm; border: 0.25mm solid #e5e8ef; }
        .seats th, .seats td { padding: 2mm 2.5mm; border-bottom: 0.25mm solid #e5e8ef; text-align: right; }
        .seats th { background: #f7f7fb; color: #687086; font-size: 8pt; }
        .seats td { font-size: 9.5pt; font-weight: bold; }
        .crew { width: 100%; }
        .crew td { width: 50%; padding: 0 1mm; vertical-align: top; }
        .crew-box { background: #f6f7fa; padding: 2.8mm 3mm; }
        .crew-label { display: block; color: #687086; font-size: 8.5pt; }
        .crew-value { display: block; font-size: 9.5pt; font-weight: bold; }
        .rules { width: 100%; }
        .rules td { width: 50%; padding: 1.5mm 2.5mm; vertical-align: top; color: #4f566b; font-size: 8.2pt; }
        .dot { color: #7257e8; font-weight: bold; }
    </style>
</head>
<body>
<table class="ticket">
    <tr>
        <td style="padding:0;">
            <table class="header">
                <tr>
                    <td class="logo-cell"><img class="logo" src="<?= $logoUrl ?>" alt="معین‌شو"></td>
                    <td class="code-cell"><div class="code-label">کد خرید</div><div class="code-value"><?= $toPersianDigits($reserve->code) ?></div></td>
                </tr>
            </table>

            <div class="body">
                <table class="hero">
                    <tr>
                        <td class="poster-cell"><div class="poster-frame"><img class="poster" width="204" height="333" src="<?= $posterUrl ?>" alt="پوستر نمایش"></div></td>
                        <td class="info-cell">
                            <div class="event-card">
                                <div class="event-title"><?= $toPersianDigits($data[0]['event']) ?></div>
                                <table class="meta">
                                    <tr>
                                        <td><div class="meta-box"><span class="meta-label">تاریخ</span><span class="meta-value"><?= $toPersianDigits($data[0]['date']) ?></span></div></td>
                                        <td><div class="meta-box"><span class="meta-label">ساعت</span><span class="meta-value"><?= $toPersianDigits($data[0]['time']) ?></span></div></td>
                                    </tr>
                                    <tr>
                                        <td><div class="meta-box"><span class="meta-label">مکان</span><span class="meta-value"><?= $toPersianDigits($data[0]['cinema']) ?></span></div></td>
                                        <td><div class="meta-box"><span class="meta-label">موبایل</span><span class="meta-value"><?= $mobile ?></span></div></td>
                                    </tr>
                                </table>
                                <div class="meta-box address-box"><span class="meta-label">آدرس</span><span class="meta-value"><?= $toPersianDigits($data[0]['address']) ?></span></div>
                            </div>
                        </td>
                    </tr>
                </table>

                <table class="section">
                    <tr><td class="section-title">اطلاعات پرداخت</td></tr>
                    <tr><td class="section-body">
                        <table class="payment"><tr>
                            <td class="payment-info">
                                <table class="summary">
                                    <tr><td class="summary-label">تعداد بلیت</td><td class="summary-value"><?= $toPersianDigits($ticketCount) ?> عدد</td></tr>
                                    <tr><td class="summary-label">جمع کل</td><td class="summary-value summary-total"><?= $toPersianDigits(number_format($reserve->transaction->amount)) ?> تومان</td></tr>
                                </table>
                                <div class="tax-note">مبلغ فوق شامل ۱۰٪ مالیات بر ارزش افزوده است.</div>
                                <?php if ($reserve->event->kind != Event::KIND_WORKSHOP): ?>
                                    <table class="seats">
                                        <thead>
                                        <tr>
                                            <th>شماره صندلی</th>
                                            <th>شماره ردیف</th>
                                            <?php if ($isFerdowsiVenue): ?><th>جایگاه</th><?php endif; ?>
                                            <th>قیمت (تومان)</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        <?php foreach ($seatGroups as $row):
                                            $rawRow = (int)$row['row_number'];
                                            $rowName = trim((string)($row['row_name'] ?? ''));
                                            $seatSection = null;

                                            if ($isFerdowsiVenue) {
                                                if ($rawRow >= 101 && $rawRow <= 109) {
                                                    $seatSection = 'بالکن';
                                                    $rowLabel = $rowName !== '' ? $rowName : (string)($rawRow - 100);
                                                } else {
                                                    $seatSection = 'همکف';
                                                    $rowLabel = $rowName !== '' ? $rowName : (string)$rawRow;
                                                }
                                            } else {
                                                $rowLabel = $rowName !== ''
                                                    ? $rowName . ' - ' . $row['row_number']
                                                    : (string)$row['row_number'];
                                            }
                                            ?>
                                            <tr>
                                                <td><?= $toPersianDigits(implode('، ', $row['numbers'])) ?></td>
                                                <td><?= $toPersianDigits($rowLabel) ?></td>
                                                <?php if ($isFerdowsiVenue): ?><td><?= $seatSection ?></td><?php endif; ?>
                                                <td><?= $toPersianDigits(number_format($row['price'] * count($row['numbers']))) ?></td>
                                            </tr>
                                        <?php endforeach; ?>
                                        </tbody>
                                    </table>
                                <?php endif; ?>
                            </td>
                            <td class="payment-qr"><img class="qr" width="110" height="110" src="<?= $qrDataUri ?>" alt="بارکد بلیت"><div class="qr-label">بارکد بلیت</div></td>
                        </tr></table>
                    </td></tr>
                </table>

                <table class="section">
                    <tr><td class="section-title">عوامل برنامه</td></tr>
                    <tr><td class="section-body"><table class="crew"><tr>
                        <td><div class="crew-box"><span class="crew-label">کارگردان</span><span class="crew-value"><?= $toPersianDigits($reserve->event->directors) ?></span></div></td>
                        <td><div class="crew-box"><span class="crew-label">تهیه‌کننده</span><span class="crew-value"><?= $toPersianDigits($reserve->event->producers) ?></span></div></td>
                    </tr></table></td></tr>
                </table>

                <table class="section">
                    <tr><td class="section-title">قوانین مهم</td></tr>
                    <tr><td class="section-body"><table class="rules">
                        <tr><td><span class="dot">●</span> بلیت فقط از طریق وب‌سایت moeinshow.com معتبر است.</td><td><span class="dot">●</span> آوردن تنقلات ممنوع، رعایت حجاب اسلامی الزامی است.</td></tr>
                        <tr><td><span class="dot">●</span> ورود کودکان زیر ۱۵ سال ممنوع می‌باشد.</td><td><span class="dot">●</span> مبلغ فوق شامل ۱۰٪ مالیات بر ارزش افزوده می‌باشد.</td></tr>
                    </table></td></tr>
                </table>
            </div>
        </td>
    </tr>
</table>
</body>
</html>
