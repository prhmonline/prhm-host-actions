<?php
declare(strict_types=1);

namespace rabint\helpers;

/**
 * Test-only date formatting adapter. Real Schedule::afterFind() and its
 * actual AR relations run against the isolated SQL fixture. Only Jalali UI
 * formatting, which is irrelevant to seat/reversal money, is replaced.
 */
final class locality
{
    public static function anyToJalali($date, $format = 'Y-m-d')
    {
        return (string)$date;
    }
}
