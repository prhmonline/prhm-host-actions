<?php
namespace app\modules\finance\services;

/** Strict financial input validation: integer toman. */
final class OpenPriceAmount
{
    public const MAX_TOMAN = 9999999999999;

    public static function validate($input, int $minimum): array
    {
        if ($minimum < 0 || $minimum > self::MAX_TOMAN
            || (!is_string($input) && !is_int($input))) {
            return ['ok' => false, 'message' => 'مبلغ پیشنهادی معتبر نیست.'];
        }
        $digits = strtr(trim((string)$input), [
            '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4',
            '۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9',
            '٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4',
            '٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
        ]);
        if (!preg_match('/^(?:0|[1-9][0-9]{0,12})$/D', $digits)) {
            return ['ok' => false, 'message' => 'مبلغ پیشنهادی معتبر نیست.'];
        }
        $amount = (int)$digits;
        if ($amount < $minimum) {
            return ['ok' => false, 'message' => 'مبلغ پیشنهادی نمی‌تواند کمتر از مجموع قیمت بلیت‌های انتخاب‌شده باشد.'];
        }
        return ['ok' => true, 'amount' => $amount, 'extra' => $amount - $minimum];
    }
}
