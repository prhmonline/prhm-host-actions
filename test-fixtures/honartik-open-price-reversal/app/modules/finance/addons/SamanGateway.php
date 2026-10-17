<?php

namespace app\modules\finance\addons;

use app\modules\finance\models\FinanceTransactions;
use Exception;
use SoapClient;
use Yii;

class SamanGateway extends GatewayAbstract
{
    const amountFactor = 0.1;
    const TOMAN_TO_RIAL = 10;

    private const VERIFY_MAX_ATTEMPTS = 3;
    private const VERIFY_RETRY_DELAYS_USEC = [5000000, 5000000];
    private const DEFAULT_VERIFY_WSDL = 'https://verify.sep.ir/Payments/ReferencePayment.asmx?wsdl';
    private const DEFAULT_REVERSE_REST_URL = 'https://sep.shaparak.ir/verifyTxnRandomSessionkey/ipg/ReverseTransaction';
    private const DEFAULT_SECURE_CONFIG_FILE = '/home/honartik/.config/honartik/sep-payment.php';

    public function __construct()
    {
        $this->code = 7;
        $this->slug = 'saman';
        $this->title = Yii::t('rabint', 'بانک سامان');
        $secure = $this->loadSecureConfig();
        $this->config = [
            'url' => $this->resolveConfigValue('SERVICE.finance.saman.url', $secure['url'] ?? null, 'https://sep.shaparak.ir/OnlinePG/OnlinePG'),
            'url3' => $this->resolveConfigValue('SERVICE.finance.saman.url3', $secure['url3'] ?? null, 'https://acquirer.samanepay.com/payments/referencepayment.asmx?WSDL'),
            'url2' => $this->resolveConfigValue('SERVICE.finance.saman.url2', $secure['url2'] ?? null, 'https://sep.shaparak.ir/payments/referencepayment.asmx?WSDL'),
            'mid' => $this->resolveConfigValue('SERVICE.finance.saman.mid', $secure['mid'] ?? null, ''),
            'gateway_url' => $this->resolveConfigValue('SERVICE.finance.saman.gateway_url', $secure['gateway_url'] ?? null, 'https://sep.shaparak.ir/OnlinePG/SendToken?token='),
            'reference_wsdl' => $this->resolveConfigValue('SERVICE.finance.saman.reference_wsdl', $secure['reference_wsdl'] ?? null, self::DEFAULT_VERIFY_WSDL),
            'reverse_rest_url' => $this->resolveConfigValue('SERVICE.finance.saman.reverse_rest_url', $secure['reverse_rest_url'] ?? null, self::DEFAULT_REVERSE_REST_URL),
            'reverse_mode' => $this->resolveConfigValue('SERVICE.finance.saman.reverse_mode', $secure['reverse_mode'] ?? null, 'rest_v36'),
            'reverse_username' => $this->resolveConfigValue('SERVICE.finance.saman.reverse_username', $secure['reverse_username'] ?? null, ''),
            'reverse_password' => $this->resolveConfigValue('SERVICE.finance.saman.reverse_password', $secure['reverse_password'] ?? null, ''),
        ];

        $this->gatewaySuccessStatus = 0;
        $this->messages = [8 => 'آدرس سرور پذیرنده نامعتبر است'];

        require_once __DIR__ . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'nusoap.php';
    }

    public function startPay($orderId, $amount, $callbackUrl, $api = true)
    {
        $cell = 0;
        try {
            $cell = Yii::$app->user->identity->profie->cell;
        } catch (Exception $e) {
        }

        $curl = curl_init();
        if ($curl === false) {
            Yii::error(['order_id' => $orderId], 'payment.saman.token.curl_init_failed');
            return $this->startFailure(
                'curl_init_failed',
                1007,
                false,
                true
            );
        }

        curl_setopt_array($curl, [
            CURLOPT_URL => 'https://sep.shaparak.ir/MobilePG/MobilePayment',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_ENCODING => '',
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
            CURLOPT_CUSTOMREQUEST => 'POST',
            CURLOPT_POSTFIELDS => [
                'action' => 'token',
                'TerminalId' => $this->config['mid'],
                'RedirectUrl' => $callbackUrl,
                'ResNum' => $orderId,
                'Amount' => (int)round(((float)$amount) * self::TOMAN_TO_RIAL),
                'CellNumber' => $cell,
                'ResNum1' => 'Order_id : ' . $orderId,
            ],
        ]);

        $response = curl_exec($curl);
        $curlError = curl_error($curl);
        $httpCode = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);

        if ($response === false || $curlError !== '' || $httpCode < 200 || $httpCode >= 300) {
            Yii::error([
                'order_id' => (int)$orderId,
                'http_code' => $httpCode,
                'curl_error' => $curlError,
            ], 'payment.saman.token.transport_failed');
            return $this->startFailure(
                'token_transport_failed',
                1007,
                true,
                false
            );
        }

        $res = json_decode((string)$response, true);
        if (!is_array($res) || empty($res['token'])) {
            Yii::error([
                'order_id' => (int)$orderId,
                'http_code' => $httpCode,
                'response_keys' => is_array($res) ? array_keys($res) : [],
                'json_error' => json_last_error_msg(),
            ], 'payment.saman.token.invalid_response');

            if (is_array($res) && !empty($res['errorCode'])) {
                return $this->startFailure(
                    'gateway_rejected_token_request',
                    (int)$res['errorCode'],
                    false,
                    true
                );
            }

            return $this->startFailure(
                'invalid_token_response',
                1007,
                true,
                false
            );
        }

        $token = (string)$res['token'];
        $this->persistPrePaymentTokenHash((int)$orderId, $token);

        $gatewayUrl = $this->config['gateway_url'] . rawurlencode($token);

        if ($api) {
            return ['method' => 'GET', 'url' => $gatewayUrl, 'data' => []];
        }

        echo '<form id="myForm" action="https://sep.shaparak.ir/OnlinePG/OnlinePG" method="post">'
            . '<input type="hidden" name="Token" value="' . htmlspecialchars($token, ENT_QUOTES, 'UTF-8') . '" />'
            . '<input type="hidden" name="GetMethod" value="true">'
            . '</form><script>window.onload=function(){document.getElementById("myForm").submit();}</script>';
        die();
    }

    public function payStatus($orderId, $gatewayData = [])
    {
        $callback = [];
        if (is_array($gatewayData) && isset($gatewayData['callback']) && is_array($gatewayData['callback'])) {
            $callback = $gatewayData['callback'];
        } else {
            $callback = $_POST;
        }

        $return = [
            'status' => 1004,
            'gateway_reciept' => null,
            'gateway_meta' => null,
            'bank_verified' => false,
            'ambiguous' => false,
            'reason' => 'unknown',
            'verify_attempts' => 0,
        ];

        $model = FinanceTransactions::findOne($orderId);
        if ($model === null) {
            $return['reason'] = 'transaction_not_found';
            return $return;
        }

        $state = trim((string)($callback['State'] ?? $callback['state'] ?? ''));
        $refNum = trim((string)($callback['RefNum'] ?? ''));
        $callbackToken = trim((string)($callback['Token'] ?? ''));
        $resNum = trim((string)($callback['ResNum'] ?? $callback['ResNUM'] ?? ''));

        $prePaymentMeta = $this->decodeMeta($model->gateway_meta);
        $expectedTokenHash = trim((string)($prePaymentMeta['sep_token_hash'] ?? ''));
        $callbackTokenHash = $callbackToken !== '' ? hash('sha256', $callbackToken) : '';

        $tokenValidation = 'not_available';
        if ($expectedTokenHash !== '') {
            $tokenValidation = ($callbackTokenHash !== '' && hash_equals($expectedTokenHash, $callbackTokenHash))
                ? 'matched'
                : 'mismatch';
        }

        $return['gateway_reciept'] = $refNum !== '' ? $refNum : null;
        $return['gateway_meta'] = $this->encodeSafeGatewayMeta([
            'state' => $state,
            'ref_num' => $refNum,
            'res_num' => $resNum,
            'token_hash' => $callbackTokenHash !== '' ? $callbackTokenHash : null,
            'token_validation' => $tokenValidation,
        ]);

        if ($state !== 'OK' || $refNum === '') {
            $return['reason'] = 'callback_cancelled_or_invalid';
            return $return;
        }

        if ($resNum === '' || !hash_equals((string)(int)$orderId, (string)$resNum)) {
            $return['ambiguous'] = true;
            $return['reason'] = 'callback_resnum_mismatch';
            return $return;
        }

        if ($expectedTokenHash !== '' && $tokenValidation !== 'matched') {
            $return['ambiguous'] = true;
            $return['reason'] = 'callback_token_mismatch';
            return $return;
        }

        $duplicate = FinanceTransactions::find()
            ->where(['gateway_reciept' => $refNum])
            ->andWhere(['<>', 'id', (int)$orderId])
            ->exists();

        if ($duplicate) {
            $return['ambiguous'] = true;
            $return['reason'] = 'duplicate_gateway_ref';
            return $return;
        }

        $verifiedAmount = null;
        $lastTransportError = null;
        $previousSocketTimeout = ini_get('default_socket_timeout');
        @ini_set('default_socket_timeout', '4');

        for ($attempt = 1; $attempt <= self::VERIFY_MAX_ATTEMPTS; $attempt++) {
            $return['verify_attempts'] = $attempt;

            try {
                $client = new SoapClient((string)$this->config['reference_wsdl'], [
                    'connection_timeout' => 4,
                    'cache_wsdl' => WSDL_CACHE_BOTH,
                    'exceptions' => true,
                    'trace' => false,
                ]);

                $verifiedAmount = $client->__soapCall('VerifyTransaction', [
                    'RefNum' => $refNum,
                    'MerchantID' => $this->config['mid'],
                ]);

                if (is_numeric($verifiedAmount)) {
                    $lastTransportError = null;
                    break;
                }

                $lastTransportError = 'verify_non_numeric_response';
            } catch (\Throwable $e) {
                $lastTransportError = get_class($e) . ':' . $e->getMessage();
                Yii::warning([
                    'order_id' => (int)$orderId,
                    'gateway_ref' => $refNum,
                    'attempt' => $attempt,
                    'exception_class' => get_class($e),
                    'exception_message' => $e->getMessage(),
                ], 'payment.saman.verify_transport');
            }

            if ($attempt < self::VERIFY_MAX_ATTEMPTS) {
                $delayIndex = min($attempt - 1, count(self::VERIFY_RETRY_DELAYS_USEC) - 1);
                usleep(self::VERIFY_RETRY_DELAYS_USEC[$delayIndex]);
            }
        }

        if ($previousSocketTimeout !== false) {
            @ini_set('default_socket_timeout', (string)$previousSocketTimeout);
        }

        if (!is_numeric($verifiedAmount)) {
            $reverse = $this->rollBack((int)$orderId, ['gateway_ref' => $refNum]);
            $reverseConfirmed = is_array($reverse) && !empty($reverse['ok']);

            $return['reversed'] = $reverseConfirmed;
            $return['manual_review'] = !$reverseConfirmed;
            $return['ambiguous'] = !$reverseConfirmed;
            $return['reason'] = $reverseConfirmed
                ? 'verify_no_response_reversed'
                : 'verify_no_response_reverse_unconfirmed';
            $return['gateway_meta'] = $this->encodeSafeGatewayMeta([
                'state' => $state,
                'ref_num' => $refNum,
                'res_num' => $resNum,
                'token_hash' => $callbackTokenHash !== '' ? $callbackTokenHash : null,
                'token_validation' => $tokenValidation,
                'verify_attempts' => $return['verify_attempts'],
                'verify_error' => $lastTransportError,
                'reverse_reason' => is_array($reverse) ? ($reverse['reason'] ?? null) : 'invalid_reverse_result',
                'reverse_result' => is_array($reverse) ? ($reverse['raw_result'] ?? null) : null,
            ]);
            return $return;
        }

        $verifiedAmount = (int)$verifiedAmount;

        if ($verifiedAmount < 0) {
            $return['status'] = $verifiedAmount;
            $return['ambiguous'] = false;
            $return['reason'] = 'verify_negative_status';
            $return['gateway_meta'] = $this->encodeSafeGatewayMeta([
                'state' => $state,
                'ref_num' => $refNum,
                'res_num' => $resNum,
                'token_hash' => $callbackTokenHash !== '' ? $callbackTokenHash : null,
                'token_validation' => $tokenValidation,
                'verify_attempts' => $return['verify_attempts'],
                'verify_result' => $verifiedAmount,
            ]);
            return $return;
        }

        $return['bank_verified'] = true;
        $expectedAmountRial = (int)round(((float)($model->paying_amount ?? $model->amount)) * self::TOMAN_TO_RIAL);
        $return['gateway_meta'] = $this->encodeSafeGatewayMeta([
            'state' => $state,
            'ref_num' => $refNum,
            'res_num' => $resNum,
            'token_hash' => $callbackTokenHash !== '' ? $callbackTokenHash : null,
            'token_validation' => $tokenValidation,
            'verify_attempts' => $return['verify_attempts'],
            'verified_amount_rial' => $verifiedAmount,
            'expected_amount_rial' => $expectedAmountRial,
        ]);

        if ($verifiedAmount !== $expectedAmountRial) {
            $reverse = $this->rollBack((int)$orderId, ['gateway_ref' => $refNum]);
            $reverseConfirmed = is_array($reverse) && !empty($reverse['ok']);

            $return['status'] = -10;
            $return['reversed'] = $reverseConfirmed;
            $return['manual_review'] = !$reverseConfirmed;
            $return['ambiguous'] = !$reverseConfirmed;
            $return['reason'] = $reverseConfirmed
                ? 'verified_amount_mismatch_reversed'
                : 'verified_amount_mismatch_reverse_unconfirmed';
            $return['gateway_meta'] = $this->encodeSafeGatewayMeta([
                'state' => $state,
                'ref_num' => $refNum,
                'res_num' => $resNum,
                'token_hash' => $callbackTokenHash !== '' ? $callbackTokenHash : null,
                'token_validation' => $tokenValidation,
                'verify_attempts' => $return['verify_attempts'],
                'verified_amount_rial' => $verifiedAmount,
                'expected_amount_rial' => $expectedAmountRial,
                'reverse_reason' => is_array($reverse) ? ($reverse['reason'] ?? null) : 'invalid_reverse_result',
                'reverse_result' => is_array($reverse) ? ($reverse['raw_result'] ?? null) : null,
            ]);
            return $return;
        }

        $return['status'] = $this->gatewaySuccessStatus;
        $return['reason'] = 'verified';
        return $return;
    }

    public function verifyPay($orderId, $gatewayMeta = [])
    {
        return $this->gatewaySuccessStatus;
    }

    public function rollBack($orderId, $gatewayMeta = [])
    {
        $model = FinanceTransactions::findOne($orderId);
        $refNum = trim((string)($gatewayMeta['gateway_ref'] ?? ($model->gateway_reciept ?? '')));

        if ($model === null || $refNum === '') {
            return [
                'ok' => false,
                'ambiguous' => false,
                'reason' => 'transaction_or_gateway_ref_missing',
                'raw_result' => null,
            ];
        }

        if (empty($this->config['mid'])) {
            return [
                'ok' => false,
                'ambiguous' => true,
                'reason' => 'terminal_number_missing',
                'raw_result' => null,
                'gateway_ref' => $refNum,
            ];
        }

        $mode = strtolower(trim((string)$this->config['reverse_mode']));
        if ($mode === 'soap_legacy') {
            return $this->reverseByLegacySoap((int)$orderId, $refNum);
        }

        return $this->reverseByRestV36((int)$orderId, $refNum);
    }

    private function reverseByRestV36(int $orderId, string $refNum): array
    {
        $terminalNumber = preg_replace('/\D+/', '', (string)$this->config['mid']);
        if ($terminalNumber === '') {
            return [
                'ok' => false,
                'ambiguous' => true,
                'reason' => 'terminal_number_invalid',
                'raw_result' => null,
                'gateway_ref' => $refNum,
                'method' => 'rest_v36',
            ];
        }

        $payload = json_encode([
            'RefNum' => $refNum,
            'TerminalNumber' => (int)$terminalNumber,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($payload === false) {
            return [
                'ok' => false,
                'ambiguous' => false,
                'reason' => 'reverse_request_json_encode_failed',
                'raw_result' => null,
                'gateway_ref' => $refNum,
                'method' => 'rest_v36',
            ];
        }

        $curl = curl_init();
        if ($curl === false) {
            return [
                'ok' => false,
                'ambiguous' => true,
                'reason' => 'reverse_curl_init_failed',
                'raw_result' => null,
                'gateway_ref' => $refNum,
                'method' => 'rest_v36',
            ];
        }

        curl_setopt_array($curl, [
            CURLOPT_URL => (string)$this->config['reverse_rest_url'],
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);

        $body = curl_exec($curl);
        $curlError = curl_error($curl);
        $httpCode = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);

        if ($body === false || $curlError !== '') {
            Yii::error([
                'order_id' => $orderId,
                'gateway_ref' => $refNum,
                'curl_error' => $curlError,
            ], 'payment.saman.reverse.transport');

            return [
                'ok' => false,
                'ambiguous' => true,
                'reason' => 'reverse_transport_exception',
                'raw_result' => null,
                'gateway_ref' => $refNum,
                'method' => 'rest_v36',
                'http_code' => $httpCode,
            ];
        }

        $decoded = json_decode((string)$body, true);
        if (!is_array($decoded)) {
            return [
                'ok' => false,
                'ambiguous' => true,
                'reason' => 'reverse_non_json_response',
                'raw_result' => $this->truncate((string)$body),
                'gateway_ref' => $refNum,
                'method' => 'rest_v36',
                'http_code' => $httpCode,
            ];
        }

        $resultCode = isset($decoded['ResultCode']) && is_numeric($decoded['ResultCode'])
            ? (int)$decoded['ResultCode']
            : null;
        $success = filter_var($decoded['Success'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $safeResult = [
            'ResultCode' => $resultCode,
            'ResultDescription' => $this->truncate((string)($decoded['ResultDescription'] ?? '')),
            'Success' => $success,
            'TransactionDetail' => $this->sanitizeTransactionDetail($decoded['TransactionDetail'] ?? null),
        ];

        if ($httpCode >= 200 && $httpCode < 300 && $success === true && $resultCode === 0) {
            return [
                'ok' => true,
                'ambiguous' => false,
                'reason' => 'reverse_confirmed_rest_v36',
                'raw_result' => $safeResult,
                'gateway_ref' => $refNum,
                'method' => 'rest_v36',
                'http_code' => $httpCode,
            ];
        }

        if ($resultCode === 2) {
            return [
                'ok' => false,
                'ambiguous' => true,
                'reason' => 'reverse_duplicate_request_manual_review',
                'raw_result' => $safeResult,
                'gateway_ref' => $refNum,
                'method' => 'rest_v36',
                'http_code' => $httpCode,
            ];
        }

        $deterministicCodes = [-105, -104, -106];
        $deterministic = $resultCode !== null && in_array($resultCode, $deterministicCodes, true);

        return [
            'ok' => false,
            'ambiguous' => !$deterministic,
            'reason' => $deterministic ? 'reverse_rejected_by_sep' : 'reverse_unrecognized_response',
            'raw_result' => $safeResult,
            'gateway_ref' => $refNum,
            'method' => 'rest_v36',
            'http_code' => $httpCode,
        ];
    }

    private function reverseByLegacySoap(int $orderId, string $refNum): array
    {
        if (empty($this->config['reverse_username']) || empty($this->config['reverse_password'])) {
            return [
                'ok' => false,
                'ambiguous' => true,
                'reason' => 'reverse_credentials_missing',
                'raw_result' => null,
                'gateway_ref' => $refNum,
                'method' => 'soap_legacy',
            ];
        }

        try {
            $client = new SoapClient((string)$this->config['reference_wsdl'], [
                'connection_timeout' => 15,
                'cache_wsdl' => WSDL_CACHE_BOTH,
                'exceptions' => true,
                'trace' => false,
            ]);

            $raw = $client->__soapCall('reverseTransaction', [
                'RefNum' => $refNum,
                'MerchantID' => $this->config['mid'],
                'Username' => $this->config['reverse_username'],
                'Password' => $this->config['reverse_password'],
            ]);

            $numeric = is_numeric($raw) ? (float)$raw : null;
            $ok = $numeric !== null && abs($numeric - 1.0) < 0.000001;

            return [
                'ok' => $ok,
                'ambiguous' => !$ok,
                'reason' => $ok ? 'reverse_confirmed_soap_legacy' : 'reverse_unrecognized_soap_response',
                'raw_result' => $numeric,
                'gateway_ref' => $refNum,
                'method' => 'soap_legacy',
            ];
        } catch (\Throwable $e) {
            Yii::error([
                'order_id' => $orderId,
                'gateway_ref' => $refNum,
                'exception_class' => get_class($e),
                'exception_message' => $e->getMessage(),
            ], 'payment.saman.reverse.soap_transport');

            return [
                'ok' => false,
                'ambiguous' => true,
                'reason' => 'reverse_transport_exception',
                'raw_result' => null,
                'gateway_ref' => $refNum,
                'method' => 'soap_legacy',
            ];
        }
    }


    private function startFailure(
        string $reason,
        int $code,
        bool $ambiguous,
        bool $retrySafe
    ): array {
        return [
            'success' => false,
            'payment_start_failed' => true,
            'reason' => $reason,
            'code' => $code,
            'ambiguous' => $ambiguous,
            'retry_safe' => $retrySafe,
            'message' => $ambiguous
                ? 'پاسخ شروع پرداخت از بانک قطعی نبود؛ برای جلوگیری از پرداخت تکراری درخواست جدید مسدود شد.'
                : 'دریافت توکن پرداخت از بانک ناموفق بود. دوباره تلاش کنید.',
        ];
    }

    private function persistPrePaymentTokenHash(int $orderId, string $token): void
    {
        try {
            $model = FinanceTransactions::findOne($orderId);
            if ($model === null) {
                return;
            }

            $meta = $this->decodeMeta($model->gateway_meta);
            $meta['sep_token_hash'] = hash('sha256', $token);
            $meta['sep_res_num'] = (string)$orderId;
            $meta['sep_token_issued_at'] = time();

            $model->gateway_meta = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if (!$model->save(false, ['gateway_meta'])) {
                Yii::warning(['order_id' => $orderId], 'payment.saman.token_hash_not_saved');
            }
        } catch (\Throwable $e) {
            Yii::warning([
                'order_id' => $orderId,
                'exception_class' => get_class($e),
                'exception_message' => $e->getMessage(),
            ], 'payment.saman.token_hash_exception');
        }
    }

    private function decodeMeta($meta): array
    {
        if (is_array($meta)) {
            return $meta;
        }

        if (!is_string($meta) || trim($meta) === '') {
            return [];
        }

        $decoded = json_decode($meta, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function encodeSafeGatewayMeta(array $meta): string
    {
        return (string)json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function sanitizeTransactionDetail($detail)
    {
        if (!is_array($detail)) {
            return null;
        }

        return [
            'RRN' => isset($detail['RRN']) ? $this->truncate((string)$detail['RRN']) : null,
            'RefNum' => isset($detail['RefNum']) ? $this->truncate((string)$detail['RefNum']) : null,
            'MaskedPan' => isset($detail['MaskedPan']) ? $this->truncate((string)$detail['MaskedPan']) : null,
            'HashedPan' => isset($detail['HashedPan']) ? $this->truncate((string)$detail['HashedPan']) : null,
            'TerminalNumber' => isset($detail['TerminalNumber']) ? (int)$detail['TerminalNumber'] : null,
            'OrginalAmount' => isset($detail['OrginalAmount']) ? (int)$detail['OrginalAmount'] : null,
            'AffectiveAmount' => isset($detail['AffectiveAmount']) ? (int)$detail['AffectiveAmount'] : null,
            'StraceDate' => isset($detail['StraceDate']) ? $this->truncate((string)$detail['StraceDate']) : null,
            'StraceNo' => isset($detail['StraceNo']) ? $this->truncate((string)$detail['StraceNo']) : null,
        ];
    }

    private function resolveConfigValue(string $key, $secureValue, $default)
    {
        try {
            $configured = config($key, null);
        } catch (\Throwable $e) {
            $configured = null;
        }

        if ($configured !== null && $configured !== '') {
            return $configured;
        }

        if ($secureValue !== null && $secureValue !== '') {
            return $secureValue;
        }

        return $default;
    }

    private function loadSecureConfig(): array
    {
        $path = getenv('HONARTIK_SEP_CONFIG_FILE');
        if (!is_string($path) || trim($path) === '') {
            $path = self::DEFAULT_SECURE_CONFIG_FILE;
        }

        if (!is_readable($path)) {
            Yii::error([
                'config_file' => $path,
            ], 'payment.saman.secure_config_missing');

            return [];
        }

        try {
            $config = require $path;
            if (!is_array($config)) {
                throw new \RuntimeException('SEP secure configuration must return an array.');
            }

            return $config;
        } catch (\Throwable $e) {
            Yii::error([
                'config_file' => $path,
                'exception_class' => get_class($e),
                'exception_message' => $e->getMessage(),
            ], 'payment.saman.secure_config_invalid');

            return [];
        }
    }

    private function truncate(string $value, int $limit = 1000): string
    {
        if (mb_strlen($value, 'UTF-8') <= $limit) {
            return $value;
        }

        return mb_substr($value, 0, $limit, 'UTF-8');
    }
}
