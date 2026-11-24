<?php

use common\models\Event;
use rabint\helpers\locality;
use rabint\attachment\models\Attachment;
use Da\QrCode\QrCode;

/** @var $reserve \common\models\Reserve */
/** @var bool|null $pdfMode */

$pdfMode = !empty($pdfMode);

$toPersianDigits = static function ($value): string {
    return strtr((string)$value, [
        '0' => '۰', '1' => '۱', '2' => '۲', '3' => '۳', '4' => '۴',
        '5' => '۵', '6' => '۶', '7' => '۷', '8' => '۸', '9' => '۹',
    ]);
};

$normalizeMobile = static function ($value): string {
    $original = trim((string)$value);
    $digits = preg_replace('/\D+/u', '', $original);

    if ($digits === '') {
        return $original;
    }

    if (strpos($digits, '0098') === 0) {
        $digits = substr($digits, 4);
    } elseif (strpos($digits, '98') === 0) {
        $digits = substr($digits, 2);
    }

    if (strpos($digits, '9') === 0) {
        $digits = '0' . $digits;
    }

    return $digits;
};

$data = [];
foreach ($reserve->reserveItems as $reserveItem) {
    $data[] = [
        'cinema' => $reserve->place->title,
        'salon' => $reserve->venue->title,
        'date' => Locality::jdate('Y/m/d', strtotime($reserve->schedule->date)),
        'time' => date('H:i', strtotime($reserve->start_at)),
        'event' => $reserve->event->title,
        'address' => $reserve->place->address,
        'code' => $reserve->code,
        'bench_number' => $reserveItem->scheduleSeat->seat->number,
        'row_number' => $reserveItem->scheduleSeat->seat->row,
        'price' => $reserveItem->scheduleSeat->price,
        'row_name' => $reserveItem->scheduleSeat->seat->row_name,
    ];
}

$seatGroups = [];
foreach ($data as $item) {
    $rowKey = $item['row_number'];
    if (!isset($seatGroups[$rowKey])) {
        $seatGroups[$rowKey] = [
            'row_number' => $rowKey,
            'numbers' => [],
            'price' => $item['price'],
            'row_name' => $item['row_name'],
        ];
    }
    $seatGroups[$rowKey]['numbers'][] = $item['bench_number'];
}
$seatGroups = array_values($seatGroups);
$isFerdowsiVenue = (int)($reserve->venue_id ?? 0) === 32;

$qrCode = (new QrCode((string)$reserve->code))->setSize(250)->setMargin(5);
$qrDataUri = $qrCode->writeDataUri();
$posterUrl = Attachment::getUrlById($reserve->event->image_url);
$ticketCount = count($reserve->reserveItems);
$mobile = $toPersianDigits($normalizeMobile($reserve->user->username));
$logoUrl = '/img/logo.png';

if ($pdfMode) {
    echo $this->renderFile(Yii::getAlias('@app/views/admin-reserve/_print-ticket-mpdf.php'), [
        'reserve' => $reserve,
        'data' => $data,
        'seatGroups' => $seatGroups,
        'isFerdowsiVenue' => $isFerdowsiVenue,
        'qrDataUri' => $qrDataUri,
        'posterUrl' => $posterUrl,
        'ticketCount' => $ticketCount,
        'mobile' => $mobile,
        'toPersianDigits' => $toPersianDigits,
    ]);
    return;
}
?>
<!doctype html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= $toPersianDigits($data[0]['event']) ?> | بلیت معین‌شو</title>
    <style>
        <?php if (!$pdfMode): ?>
        @font-face {
            font-family: 'Vazirmatn';
            src: url('/fonts/vazirmatn/Vazirmatn-Variable.woff2') format('woff2');
            font-weight: 100 900;
            font-style: normal;
            font-display: swap;
        }
        <?php endif; ?>

        * { box-sizing: border-box; }
        html, body { margin: 0; min-height: 100%; }
        body {
            direction: rtl;
            background: #eef0f5;
            color: #171923;
            font-family: 'Vazirmatn', Tahoma, sans-serif;
            font-size: 13px;
            line-height: 1.7;
            padding: 24px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .print-toolbar {
            width: 190mm;
            max-width: 100%;
            margin: 0 auto 14px;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
        }
        .print-button,
        .back-button {
            min-height: 42px;
            border-radius: 12px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-family: 'Vazirmatn', Tahoma, sans-serif;
            font-size: 13px;
            font-weight: 700;
            line-height: 1;
            padding: 10px 20px;
            text-decoration: none;
            white-space: nowrap;
        }
        .print-button {
            border: 0;
            background: #7257e8;
            color: #fff;
            box-shadow: 0 8px 20px rgba(78, 53, 199, .2);
        }
        .back-button {
            border: 1px solid #d8d1f6;
            background: #fff;
            color: #5136bd;
            box-shadow: 0 6px 18px rgba(35, 39, 54, .08);
        }
        .ticket {
            width: 190mm;
            max-width: 100%;
            margin: 0 auto;
            background: #fff;
            border: 1px solid #dde1ea;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 18px 55px rgba(35, 39, 54, .12);
        }
        .head-table,
        .hero-table,
        .meta-table,
        .payment-table,
        .crew-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }
        .ticket-head {
            padding: 14px 20px;
            background: #5136bd;
            background: linear-gradient(135deg, #2a214e 0%, #5136bd 62%, #795fea 100%);
            color: #fff;
        }
        .head-logo-cell { width: 55%; text-align: right; vertical-align: middle; }
        .head-code-cell { width: 45%; text-align: left; vertical-align: middle; }
        .brand-logo {
            width: 118px;
            max-height: 54px;
            object-fit: contain;
            filter: brightness(0) invert(1);
        }
        .purchase-code span { display: block; font-size: 10px; opacity: .78; }
        .purchase-code strong { display: block; font-size: 20px; letter-spacing: .3px; line-height: 1.35; }
        .ticket-body { padding: 18px; }
        .hero-poster-cell { width: 31%; padding-left: 16px; vertical-align: top; }
        .hero-info-cell { width: 69%; vertical-align: top; }
        .poster-wrap {
            height: 286px;
            overflow: hidden;
            border-radius: 18px;
            background: #f6f7fa;
            border: 1px solid #e5e8ef;
        }
        .poster {
            display: block;
            width: 100%;
            height: 286px;
            object-fit: cover;
            border-radius: 18px;
        }
        .event-card {
            min-height: 286px;
            border: 1px solid #e5e8ef;
            border-radius: 18px;
            padding: 17px;
            background: #fff;
        }
        .event-title {
            margin: 0 0 14px;
            font-size: 25px;
            line-height: 1.45;
            font-weight: 800;
            color: #211943;
        }
        .meta-table td { width: 50%; padding: 4px; vertical-align: top; }
        .meta-table td:first-child { padding-right: 0; }
        .meta-table td:last-child { padding-left: 0; }
        .meta-box {
            min-height: 55px;
            padding: 8px 10px;
            border: 1px solid #e5e8ef;
            border-radius: 12px;
            background: #fff;
        }
        .meta-address { margin-top: 4px; }
        .meta-label { display: block; color: #687086; font-size: 10px; margin-bottom: 1px; }
        .meta-value { display: block; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
        .section {
            margin-top: 14px;
            border: 1px solid #e5e8ef;
            border-radius: 18px;
            overflow: hidden;
            page-break-inside: avoid;
        }
        .section-heading {
            margin: 0;
            padding: 9px 14px;
            background: #f6f7fa;
            border-bottom: 1px solid #e5e8ef;
            font-size: 13px;
            font-weight: 800;
            color: #2d254b;
        }
        .section-content { padding: 12px 14px; }
        .payment-info-cell { width: 82%; padding-left: 14px; vertical-align: middle; }
        .payment-qr-cell { width: 18%; padding-right: 14px; border-right: 1px dashed #e5e8ef; vertical-align: middle; text-align: center; }
        .summary-table { width: 100%; border-collapse: collapse; }
        .summary-table td { padding: 6px 0; border-bottom: 1px dashed #e5e8ef; }
        .summary-label { color: #687086; text-align: right; }
        .summary-value { text-align: left; font-size: 14px; font-weight: 700; }
        .summary-total .summary-value { color: #4e35c7; font-size: 18px; }
        .tax-note {
            margin: 8px 0 0;
            color: #7a6840;
            background: #fff3d8;
            border-radius: 9px;
            padding: 6px 9px;
            font-size: 10px;
        }
        .qr-box img { display: block; width: 94px; height: 94px; margin: 0 auto; }
        .qr-box span { display: block; color: #687086; font-size: 9px; margin-top: 4px; }
        .seat-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            border: 1px solid #e5e8ef;
        }
        .seat-table th,
        .seat-table td { padding: 8px 10px; text-align: right; border-bottom: 1px solid #e5e8ef; }
        .seat-table th { background: #f7f7fb; color: #687086; font-size: 10px; font-weight: 700; }
        .seat-table td { font-size: 12px; font-weight: 700; }
        .seat-table tr:last-child td { border-bottom: 0; }
        .crew-table td { width: 50%; padding: 0 5px; vertical-align: top; }
        .crew-table td:first-child { padding-right: 0; }
        .crew-table td:last-child { padding-left: 0; }
        .crew-box { padding: 8px 10px; border-radius: 11px; background: #f6f7fa; }
        .crew-box span { display: block; color: #687086; font-size: 10px; }
        .crew-box strong { display: block; font-size: 12px; }
        .rules-table { width: 100%; border-collapse: collapse; }
        .rules-table td { width: 50%; padding: 3px 12px; vertical-align: top; color: #4f566b; font-size: 11px; }
        .rule-dot { color: #7257e8; font-weight: 900; padding-left: 5px; }

        @media (max-width: 720px) {
            body { padding: 10px; }
            .hero-poster-cell,
            .hero-info-cell { display: block; width: 100%; padding: 0; }
            .hero-poster-cell { padding-bottom: 12px; }
            .poster-wrap, .poster { height: 380px; }
            .payment-info-cell,
            .payment-qr-cell { display: block; width: 100%; padding: 0; border: 0; }
            .payment-qr-cell { padding-top: 14px; border-top: 1px dashed #e5e8ef; }
            .rules-table td { display: block; width: 100%; }
        }

        @page { size: A4 portrait; margin: 8mm; }

        @media print {
            body { background: #fff; padding: 0; font-size: 11px; zoom: 0.82; }
            .print-toolbar { display: none !important; }
            .ticket { width: 100%; max-width: none; border-radius: 14px; box-shadow: none; }
            .ticket-head { padding: 10px 15px; }
            .brand-logo { width: 96px; max-height: 42px; }
            .purchase-code strong { font-size: 16px; }
            .ticket-body { padding: 12px; }
            .hero-poster-cell { width: 29%; padding-left: 11px; }
            .hero-info-cell { width: 71%; }
            .poster-wrap, .poster { height: 240px; }
            .event-card { min-height: 240px; padding: 12px; }
            .event-title { font-size: 20px; margin-bottom: 9px; }
            .meta-table td { padding: 3px; }
            .meta-box { min-height: 44px; padding: 5px 7px; }
            .section { margin-top: 9px; border-radius: 12px; }
            .section-heading { padding: 6px 10px; }
            .section-content { padding: 8px 10px; }
            .summary-table td { padding: 3px 0; }
            .seat-table { margin-top: 7px; }
            .seat-table th, .seat-table td { padding: 5px 7px; }
            .rules-table td { font-size: 9px; line-height: 1.6; padding: 2px 8px; }
        }
    </style>
</head>
<body>
<?php if (!$pdfMode): ?>
<div class="print-toolbar">
    <button class="print-button" type="button" onclick="window.print()">چاپ بلیت</button>
    <a class="back-button" href="https://moeinshow.com/dashboard/tickets">بازگشت به بلیت‌های من</a>
</div>
<?php endif; ?>

<div class="ticket">
    <div class="ticket-head">
        <table class="head-table">
            <tr>
                <td class="head-logo-cell"><img class="brand-logo" src="<?= $logoUrl ?>" alt="معین‌شو"></td>
                <td class="head-code-cell">
                    <div class="purchase-code">
                        <span>کد خرید</span>
                        <strong><?= $toPersianDigits($reserve->code) ?></strong>
                    </div>
                </td>
            </tr>
        </table>
    </div>

    <div class="ticket-body">
        <table class="hero-table">
            <tr>
                <td class="hero-poster-cell">
                    <div class="poster-wrap"><img class="poster" src="<?= $posterUrl ?>" alt="پوستر نمایش"></div>
                </td>
                <td class="hero-info-cell">
                    <div class="event-card">
                        <h1 class="event-title"><?= $toPersianDigits($data[0]['event']) ?></h1>
                        <table class="meta-table">
                            <tr>
                                <td><div class="meta-box"><span class="meta-label">تاریخ</span><strong class="meta-value"><?= $toPersianDigits($data[0]['date']) ?></strong></div></td>
                                <td><div class="meta-box"><span class="meta-label">ساعت</span><strong class="meta-value"><?= $toPersianDigits($data[0]['time']) ?></strong></div></td>
                            </tr>
                            <tr>
                                <td><div class="meta-box"><span class="meta-label">مکان</span><strong class="meta-value"><?= $toPersianDigits($data[0]['cinema']) ?></strong></div></td>
                                <td><div class="meta-box"><span class="meta-label">موبایل</span><strong class="meta-value"><?= $mobile ?></strong></div></td>
                            </tr>
                        </table>
                        <div class="meta-box meta-address"><span class="meta-label">آدرس</span><strong class="meta-value"><?= $toPersianDigits($data[0]['address']) ?></strong></div>
                    </div>
                </td>
            </tr>
        </table>

        <div class="section">
            <h2 class="section-heading">اطلاعات پرداخت</h2>
            <div class="section-content">
                <table class="payment-table">
                    <tr>
                        <td class="payment-info-cell">
                            <table class="summary-table">
                                <tr><td class="summary-label">تعداد بلیت</td><td class="summary-value"><?= $toPersianDigits($ticketCount) ?> عدد</td></tr>
                                <tr class="summary-total"><td class="summary-label">جمع کل</td><td class="summary-value"><?= $toPersianDigits(number_format($reserve->transaction->amount)) ?> تومان</td></tr>
                            </table>
                            <p class="tax-note">مبلغ فوق شامل ۱۰٪ مالیات بر ارزش افزوده است.</p>

                            <?php if ($reserve->event->kind != Event::KIND_WORKSHOP): ?>
                                <table class="seat-table">
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
                        <td class="payment-qr-cell">
                            <div class="qr-box"><img src="<?= $qrDataUri ?>" alt="بارکد بلیت"><span>بارکد بلیت</span></div>
                        </td>
                    </tr>
                </table>
            </div>
        </div>

        <div class="section">
            <h2 class="section-heading">عوامل برنامه</h2>
            <div class="section-content">
                <table class="crew-table"><tr>
                    <td><div class="crew-box"><span>کارگردان</span><strong><?= $toPersianDigits($reserve->event->directors) ?></strong></div></td>
                    <td><div class="crew-box"><span>تهیه‌کننده</span><strong><?= $toPersianDigits($reserve->event->producers) ?></strong></div></td>
                </tr></table>
            </div>
        </div>

        <div class="section">
            <h2 class="section-heading">قوانین مهم</h2>
            <div class="section-content">
                <table class="rules-table">
                    <tr>
                        <td><span class="rule-dot">●</span>بلیت فقط از طریق وب‌سایت moeinshow.com معتبر است.</td>
                        <td><span class="rule-dot">●</span>آوردن تنقلات ممنوع، رعایت حجاب اسلامی الزامی است.</td>
                    </tr>
                    <tr>
                        <td><span class="rule-dot">●</span>ورود کودکان زیر ۱۵ سال ممنوع می‌باشد.</td>
                        <td><span class="rule-dot">●</span>مبلغ فوق شامل ۱۰٪ مالیات بر ارزش افزوده می‌باشد.</td>
                    </tr>
                </table>
            </div>
        </div>
    </div>
</div>
</body>
</html>
