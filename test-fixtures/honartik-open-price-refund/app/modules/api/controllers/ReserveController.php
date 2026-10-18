<?php

namespace app\modules\api\controllers;

use app\components\external\base;
use app\modules\api\models\Faq;
use app\modules\api\models\News;
use app\modules\api\models\Place;
use app\modules\api\models\Reserve;
use app\modules\finance\addons\WalletGateway;
use app\modules\finance\models\FinanceTransactions;
use app\modules\finance\services\CouponService;
use app\modules\finance\services\OpenPriceAmount;
use app\modules\finance\services\OpenPriceCancellationService;
use app\modules\finance\services\PaymentStartIdempotencyService;
use app\modules\finance\models\FinanceWallet;
use common\models\Event;
use common\models\Schedule;
use common\models\ScheduleSeat;
use http\Url;
use yii\data\Pagination;
use Yii;
use yii\db\Exception;
use yii\db\Transaction;
use yii\filters\VerbFilter;
use yii\helpers\ArrayHelper;
use yii\web\BadRequestHttpException;
use yii\web\ForbiddenHttpException;
use yii\web\NotFoundHttpException;

/**
 * Default controller for the `api` module
 */
class ReserveController extends ApiPrivateController
{
    /**
     * Configures controller behaviors.
     *
     * @return array
     */
    //    public function behaviors()
//    {
//        $behaviors = parent::behaviors();
//
//        // Verb filter to limit HTTP methods for specific actions
//        $behaviors['verbs'] = [
//            'class' => VerbFilter::class,
//            'actions' => [
//                'index' => ['GET'],
//                'view' => ['GET'],
//                'set-failed' => ['POST'],
//                'new' => ['POST'],
//                'check-coupon' => ['POST'],
//                'pay' => ['POST'],
//                'confirm' => ['GET'],
//                'cancel' => ['POST'],
//            ],
//        ];
//
//        return $behaviors;
//    }

    /**
     * Renders the index view for the module
     * @return string
     */
    public function actionIndex()
    {
        $query = Reserve::find()->where(['user_id' => Yii::$app->user->id, "status" => [Reserve::STATUS_PUBLISH, Reserve::STATUS_CANCEL]]);
        $countQuery = clone $query;
        $pages = new Pagination(['totalCount' => $countQuery->count()]);
        $models = $query->offset($pages->offset)
            ->orderBy(['id' => SORT_DESC])
            ->limit($pages->limit)
            ->all();
        return [
            'models' => $models,
            'pages' => $pages,
        ];
    }

    public function actionPrintPageNew($id)
    {
        $model = Reserve::findOne($id);
        $this->layout = false;
        return $this->render("print-ticket-new", ["reserve" => $model]);
    }

    public function actionView($id)
    {
        $model = Reserve::findOne($id);
        if ($model && $model->user_id == Yii::$app->user->id) {
            return Reserve::findOne($id);
        }
        return false;
    }


    public function actionSetFailed($reserve_id)
    {
        $reserve = Reserve::findOne([
            'id' => (int)$reserve_id,
            'user_id' => Yii::$app->user->id,
        ]);

        if (empty($reserve)) {
            Yii::$app->response->statusCode = 404;
            return [
                'success' => false,
                'message' => 'رزرو پیدا نشد.',
            ];
        }

        if ($reserve->gid) {
            base::factory()->fail($reserve->gid);
        }

        if (!empty($reserve->transaction) && (int)$reserve->transaction->status !== (int)FinanceTransactions::TRANSACTION_COMPLETED) {
            $failedConstant = FinanceTransactions::class . '::TRANSACTION_FAILED';
            $reserve->transaction->status = defined($failedConstant) ? constant($failedConstant) : -1;
            $reserve->transaction->save(false);
        }

        CouponService::releaseCurrentByReserve((int)$reserve->id, 'user_abandoned_reserve');

        if (!in_array((int)$reserve->status, [
            (int)Reserve::STATUS_PUBLISH,
            (int)Reserve::STATUS_CANCEL,
            (int)Reserve::STATUS_FAILED,
        ], true)) {
            $reserve->status = Reserve::STATUS_FAILED;
            $reserve->save(false);
        }

        return [
            'success' => true,
            'message' => 'رزرو ناموفق شد و صندلی‌های موقت آزاد شدند.',
            'reserve_id' => (int)$reserve->id,
        ];
    }

    public function actionNew()
    {
        $post = Yii::$app->request->post();
        $mobile = Yii::$app->user->identity->username;
        $scheduleModel = Schedule::findOne(["id" => $post['schedule_id'], 'status' => Schedule::STATUS_PUBLISH]);
        if (empty($scheduleModel)) {
            Yii::$app->response->statusCode = 400;
            return ["message" => "این سانس قابل خرید نیست."];
        }
        if ($scheduleModel->event->kind != Event::KIND_WORKSHOP) {
            $ScheduleSeat = ScheduleSeat::find()->where([
                "schedule_id" => $scheduleModel->id,
                "seat_id" => json_decode($post['seat_ids'], true)
            ])->all();
            $seatnumber = [];

            foreach ($ScheduleSeat as $seat) {
                if ($seat->status != ScheduleSeat::STATUS_SELECTABLE) {
                    array_push($seatnumber, ['number' => $seat->seat->number, 'row' => $seat->seat->row]);
                }
            }
            if (!empty($seatnumber)) {
                Yii::$app->response->statusCode = 400;
                return ["message" => "این صندلی توسط شخص دیگری رزرو شده است لطفا صفحه را دوباره باز کنید."];
            }
        }

        $ids = [];
        if ($scheduleModel->event->kind == Event::KIND_WORKSHOP) {
            $Seats = ScheduleSeat::findOne([
                "schedule_id" => $scheduleModel->id,
                "status" => ScheduleSeat::STATUS_SELECTABLE
            ]);
            $ids = [$Seats->id];
        } else {
            $seatIds = json_decode($post['seat_ids'], true);
            $Seats = ScheduleSeat::find()->where([
                "schedule_id" => $scheduleModel->id,
                "seat_id" => $seatIds
            ])->all();
            $ids = ArrayHelper::getColumn($Seats, 'id');

        }

        $reserveModel = Reserve::setReserve($ids);
        // }

        $payWays = [];

        foreach (FinanceTransactions::paymentGateways() as $key => $gateway) {
            if (!in_array($key, [])) {
                if ($gateway['title'] != "کیف پول") {
                    $payWays[] = ["id" => (new $gateway['class'])->code, "title" => $gateway['title'], "image" => $gateway['image']];
                }
            }
        }
        if ($reserveModel == false) {
            Yii::$app->response->statusCode = 400;
            return $result = [
                'success' => false,
                "message" => "رزرو سانس ایجاد نشد"
            ];
        }
        return [
            'success' => true,
            'reserve' => $reserveModel,
            'pay_ways' => $payWays,
            'default_pay_way_id' => 7,
            'amountPayable' => $payablePrice
            //'credit' => (int)$user->identity->wallet_credit
        ];


    }

    public function actionCheckCoupon()
    {
        if (!Yii::$app->request->isPost) {
            Yii::$app->response->statusCode = 405;
            return [
                'status' => false,
                'message' => 'درخواست اعمال کد تخفیف باید به‌صورت امن ارسال شود.',
                'data' => null,
            ];
        }

        $reserveId = (int)Yii::$app->request->post('reserve_id', 0);
        $couponCode = (string)Yii::$app->request->post('coupon_code', '');

        return (new CouponService())->applyToReserve(
            $reserveId,
            (int)Yii::$app->user->id,
            $couponCode
        );
    }

    public function actionPay($reserve_id, $gateway)
    {
        if (!Yii::$app->request->isPost) {
            Yii::$app->response->headers->set('Allow', 'POST');
            Yii::$app->response->statusCode = 405;
            return [
                'success' => false,
                'message' => 'شروع پرداخت فقط با درخواست POST مجاز است.',
            ];
        }

        $reserveId = (int)$reserve_id;
        $gateway = (int)$gateway;
        $userId = (int)Yii::$app->user->id;

        $model = Reserve::findOne([
            'id' => $reserveId,
            'user_id' => $userId,
        ]);

        if ($model === null || empty($model->transaction)) {
            Yii::error(
                "Reserve or transaction not found for reserve_id: {$reserveId}",
                __METHOD__
            );
            throw new NotFoundHttpException('The requested page does not exist.');
        }

        if ((int)$model->transaction->transactioner !== $userId) {
            Yii::warning(
                "User ID {$userId} attempted to pay for a transaction not belonging to them",
                __METHOD__
            );
            throw new ForbiddenHttpException('این فاکتور مربوط به شما نیست!');
        }

        // The amount used for replay protection must be validated before the
        // single-flight service can return an existing bank redirect. New starts
        // are still checked against the ticket minimum inside CouponService.
        $requestedOpenPriceAmount = null;
        if ((int)$model->free_price_enabled_snapshot === 1) {
            $rawProposed = Yii::$app->request->post('proposed_amount', null);
            if ($rawProposed !== null) {
                $proposed = OpenPriceAmount::validate($rawProposed, 0);
                if (!$proposed['ok']) {
                    Yii::$app->response->statusCode = 400;
                    return [
                        'success' => false,
                        'message' => $proposed['message'],
                    ];
                }
                $requestedOpenPriceAmount = (int)$proposed['amount'];
            }
        }

        // Wallet balancingPay currently rewrites ledger rows to the full amount;
        // reject wallet for charity open-price sessions until split-ledger support
        // is explicitly designed and tested. All ordinary checkout is unchanged.
        if ((int)$model->free_price_enabled_snapshot === 1 && $gateway === 1) {
            Yii::$app->response->statusCode = 400;
            return [
                'success' => false,
                'message' => 'پرداخت قیمت آزاد فعلاً فقط از طریق درگاه بانکی امکان‌پذیر است.',
            ];
        }

        if ($gateway === 1) {
            $selectedGateway = WalletGateway::class;
        } else {
            $configuredGateways = FinanceTransactions::paymentGateways();
            if (!isset($configuredGateways[$gateway])) {
                Yii::$app->response->statusCode = 400;
                return [
                    'success' => false,
                    'message' => 'درگاه پرداخت انتخاب‌شده معتبر نیست.',
                ];
            }
            $selectedGateway = $configuredGateways[$gateway]['class'];
        }

        // Preserve the seat-integrity guard before payment state is frozen or
        // any external gateway is contacted.
        $htdSeatGuard = $this->htdPaymentSeatGuardForReserve(
            $reserveId,
            'production_action_pay_before_gateway'
        );
        if (empty($htdSeatGuard['ok'])) {
            $this->htdPaymentSeatMarkFailed($reserveId, $htdSeatGuard);
            Yii::warning([
                'reserve_id' => $reserveId,
                'gateway' => $gateway,
                'guard' => $htdSeatGuard,
                'result' => 'blocked_before_gateway_start',
            ], 'honartik.payment_seat_guard');

            return $this->htdPaymentSeatFailRedirect(
                $htdSeatGuard['reason'] ?? 'seat_unavailable'
            );
        }

        Yii::warning(
            "Pay action accepted for single-flight reserve_id: {$reserveId}, gateway: {$gateway}",
            __METHOD__
        );

        $idempotency = new PaymentStartIdempotencyService();

        return $idempotency->run(
            $model->transaction,
            $reserveId,
            $userId,
            $gateway,
            function () use ($reserveId, $userId, $gateway, $selectedGateway) {
                $couponService = new CouponService();
                $paymentPreparation = $couponService->prepareForPayment(
                    $reserveId,
                    $userId,
                    $gateway,
                    Yii::$app->request->post('proposed_amount', null)
                );

                if (empty($paymentPreparation['status'])) {
                    Yii::$app->response->statusCode = 409;
                    return [
                        'success' => false,
                        'retry_safe' => true,
                        'ambiguous' => false,
                        'reason' => 'payment_preparation_rejected',
                        'message' => (string)(
                            $paymentPreparation['message']
                            ?? 'مبلغ پرداخت قابل تأیید نیست.'
                        ),
                        'data' => $paymentPreparation['data'] ?? null,
                    ];
                }

                $preparedData = (array)($paymentPreparation['data'] ?? []);
                $transactionId = (int)($preparedData['transaction_id'] ?? 0);
                $amount = (int)($preparedData['amount'] ?? -1);

                if ($transactionId <= 0 || $amount < 0) {
                    if ($transactionId > 0) {
                        $couponService->resetPaymentStart(
                            $transactionId,
                            'invalid_prepared_payment_snapshot'
                        );
                    }

                    Yii::$app->response->statusCode = 409;
                    return [
                        'success' => false,
                        'retry_safe' => true,
                        'ambiguous' => false,
                        'reason' => 'invalid_prepared_payment_snapshot',
                        'message' => 'اطلاعات مبلغ پرداخت معتبر نیست.',
                    ];
                }

                if (!empty($preparedData['zero_amount'])) {
                    $zeroResult = $couponService->finalizeZeroPayment(
                        $reserveId,
                        $userId
                    );

                    if (empty($zeroResult['status'])) {
                        Yii::$app->response->statusCode = 409;
                        return [
                            'success' => false,
                            'retry_safe' => false,
                            'ambiguous' => true,
                            'reason' => 'zero_payment_finalization_failed',
                            'message' => (string)(
                                $zeroResult['message']
                                ?? 'رزرو رایگان نهایی نشد.'
                            ),
                            'data' => $zeroResult['data'] ?? null,
                        ];
                    }

                    $returnUrl = trim((string)($preparedData['return_url'] ?? ''));
                    $frontBase = 'https://honartik.ir';

                    if ($returnUrl === '') {
                        $successUrl = $frontBase
                            . '/reserve/success?id=' . $reserveId
                            . '&token=' . md5((string)$reserveId . 'fun');
                    } elseif (preg_match('~^https?://~i', $returnUrl)) {
                        $parts = parse_url($returnUrl);
                        $host = strtolower((string)($parts['host'] ?? ''));
                        if (in_array($host, ['honartik.ir', 'www.honartik.ir'], true)) {
                            $successUrl = $returnUrl;
                        } else {
                            $path = (string)($parts['path'] ?? '/reserve/success');
                            $query = isset($parts['query']) ? '?' . $parts['query'] : '';
                            $successUrl = $frontBase . '/' . ltrim($path, '/') . $query;
                        }
                    } else {
                        $successUrl = $frontBase . '/' . ltrim($returnUrl, '/');
                    }

                    return [
                        'success' => true,
                        'message' => 'رزرو با کد تخفیف کامل و بدون اتصال به بانک نهایی شد.',
                        'method' => 'GET',
                        'url' => $successUrl,
                        'redirect_url' => $successUrl,
                        'data' => [
                            'success' => true,
                            'zero_amount' => true,
                            'reserve_id' => $reserveId,
                            'transaction_id' => $transactionId,
                            'url' => $successUrl,
                            'redirect_url' => $successUrl,
                        ],
                    ];
                }

                $transaction = FinanceTransactions::findOne($transactionId);
                if (!$transaction) {
                    $couponService->resetPaymentStart(
                        $transactionId,
                        'prepared_transaction_missing'
                    );
                    throw new NotFoundHttpException(
                        'The requested transaction does not exist.'
                    );
                }

                $gatewayClass = new $selectedGateway;
                $callbackUrl = 'https://dashboard.honartik.ir/api/transaction/afterpay'
                    . '?tid=' . $transactionId
                    . '&token=' . rawurlencode((string)$transaction->token);

                Yii::warning(
                    "Initiating single-flight payment with server amount: {$amount}, transaction_id: {$transactionId}",
                    __METHOD__
                );

                // Exceptions are intentionally not reset here. They may happen
                // after the bank received the request, so the service marks the
                // attempt ambiguous and blocks a second token.
                $startResult = $gatewayClass->startPay(
                    $transactionId,
                    $amount,
                    $callbackUrl,
                    true
                );

                $hasRedirect = is_array($startResult)
                    && (
                        !empty($startResult['url'])
                        || !empty($startResult['redirect_url'])
                        || !empty($startResult['data']['url'])
                        || !empty($startResult['data']['redirect_url'])
                    );

                if (!$hasRedirect) {
                    $ambiguous = is_array($startResult)
                        ? (bool)($startResult['ambiguous'] ?? true)
                        : true;
                    $retrySafe = is_array($startResult)
                        && (bool)($startResult['retry_safe'] ?? false);

                    if (!$ambiguous && $retrySafe) {
                        $couponService->resetPaymentStart(
                            $transactionId,
                            'gateway_start_failed_safely'
                        );
                    }
                }

                return $startResult;
            },
            $requestedOpenPriceAmount
        );
    }

    public function actionConfirm($id, $token)
    {
        // Log the start of the action with the provided id and token
        Yii::warning("Confirm action started for id: $id, token: $token", __METHOD__);

        // Check if the token is valid
        if (md5($id . "fun") !== $token) {
            Yii::warning("Invalid token for id: $id, provided token: $token", __METHOD__);
            return false;
        }

        // Log the successful token validation
        Yii::warning("Token validated successfully for id: $id", __METHOD__);

        // Retrieve the reserve model
        $reserve = Reserve::findOne($id);
        if ($reserve === null) {
            Yii::error("Reserve model not found for id: $id", __METHOD__);
            throw new NotFoundHttpException('The requested page does not exist.');
        } elseif ($reserve->code == null) {
            if ((int)$reserve->free_price_enabled_snapshot === 1) {
                // The legacy no-ticket fallback only credits one buyer wallet
                // row; it cannot reverse the separate open-price base/extra
                // financial liabilities. Do not mark FAILED or credit an
                // unbalanced refund outside the atomic reconciliation path.
                Yii::warning([
                    'reserve_id' => (int)$reserve->id,
                    'transaction_id' => (int)$reserve->transaction_id,
                ], 'open_price.confirm.ticket_missing_review');
                return [
                    'status' => false,
                    'message' => 'تأیید بلیت نیازمند بررسی مالی است؛ هیچ استرداد تکراری ثبت نشده است.',
                    'data' => null,
                ];
            }
            if ($reserve->transaction->status == FinanceTransactions::TRANSACTION_COMPLETED) {
                if ($reserve->status == Reserve::STATUS_FAILED) {


                } else {
                    $reserve->status = Reserve::STATUS_FAILED;
                    if ($reserve->save(false)) {
                        $model = $reserve->transaction;
                        $incRes = FinanceWallet::inc(
                            $model->transactioner,
                            $model->paying_amount ?? $model->amount,
                            $model->transactioner,
                            $model->transactioner_ip,
                            'شارژ حساب کاربر برای کنسل کردن بلیت پرداخت شماره: ' . $model->id,
                            ['transaction_id' => $model->id],
                            $model->id . "_cancel"
                        );
                        return [
                            'status' => false,
                            'message' => Yii::t('app', 'The reservation code was not received from the external server! The deducted amount has been added to your wallet.'),
                            'data' => null
                        ];
                    }
                }
                return [
                    'status' => false,
                    'message' => Yii::t('app', 'The reservation code was not received from the external server! Charging the wallet encountered an error!'),
                    'data' => null
                ];
            }
            return [
                'status' => false,
                'message' => Yii::t('app', 'The reservation code was not received from the external server! The transaction status was unsuccessful!'),
                'data' => null
            ];
        }

        // Log the found reserve model
        Yii::warning("Reserve model found for id: $id", __METHOD__);

        // Set the scenario to 'confirm'
        $reserve->setScenario(Reserve::SCENARIO_CONFIRM);
        Yii::warning("Scenario set to SCENARIO_CONFIRM for reserve_id: $id", __METHOD__);


        CouponService::markUsedByTransaction(
            (int)$reserve->transaction_id
        );

        // Return the reserve model
        return $reserve;
    }


    public function actionCancel($reserve_id)
    {
        $reserve = Reserve::findOne($reserve_id);
        if (!$reserve || $reserve->user_id != Yii::$app->user->id ||
            $reserve->status != Reserve::STATUS_PUBLISH) {
            return false;
        }
        if ((int)$reserve->free_price_enabled_snapshot === 1) {
            // Atomic wallet refund of BOTH ticket base and voluntary excess.
            // Legacy cancellations below remain completely unchanged.
            return (new OpenPriceCancellationService())->cancelPublished(
                (int)$reserve->id,
                (int)Yii::$app->user->id
            );
        }
        if ($reserve->gid) {
            $res = base::factory()->cancel($reserve->gid);
            if (!$res->success)
                return $res->message;
        } else {
            $date = $reserve->schedule->date;
            $clock = $reserve->schedule->start_at;
            $timestamp = strtotime($date . " " . $clock);
            if ((time() + (60 * 30)) > $timestamp) {
                return ["message" => "زمان کنسل کردن بلیت گذشته است."];
            }
            if ($reserve->schedule->is_cancel_able == 0) {
                return ["message" => " کنسل کردن بلیت ممکن نیست ."];

            }

        }

        $reserve->status = Reserve::STATUS_CANCEL;
        if ($reserve->save()) {
            $model = $reserve->transaction;
            $incRes = FinanceWallet::inc(
                $model->transactioner,
                $model->paying_amount ?? $model->amount,
                $model->transactioner,
                $model->transactioner_ip,
                'شارژ حساب کاربر برای کنسل کردن بلیت پرداخت شماره: ' . $model->id,
                ['transaction_id' => $model->id],
                $model->id . "_cancel"
            );
        } else {
            return ["message" => "خطایی رخ داده است."];
        }

        return $incRes;
    }





    // HONARTIK_PAYMENT_SEAT_GUARD_V1_START
    /**
     * Final payment safety guard:
     * - If payment returns after reservation timeout, seats are re-checked under DB lock.
     * - If seats are still free or still owned/locked by this reserve user, they are re-locked.
     * - If any seat is already bought/reserved/locked by another active reserve, payment finalization is blocked.
     */
    private function htdPaymentSeatGuardForReserve($reserveId, $context = 'payment')
    {
        $reserveId = (int)$reserveId;
        $db = \Yii::$app->db;
        $now = time();
        $lockTtl = 600;

        $tx = $db->beginTransaction();
        try {
            $reserve = $db->createCommand(
                'SELECT * FROM {{%reserve}} WHERE id=:rid LIMIT 1 FOR UPDATE',
                [':rid' => $reserveId]
            )->queryOne();

            if (!$reserve) {
                $tx->rollBack();
                return ['ok' => false, 'reason' => 'reserve_not_found', 'reserve_id' => $reserveId];
            }

            $reserveStatus = (int)($reserve['status'] ?? 0);
            $reserveUserId = (int)($reserve['user_id'] ?? 0);

            if ($reserveStatus === 2) {
                $tx->commit();
                return ['ok' => true, 'reason' => 'already_completed', 'reserve_id' => $reserveId];
            }

            $items = $db->createCommand(
                'SELECT
                    ri.id AS reserve_item_id,
                    ri.schedule_seats_id,
                    ri.user_id AS item_user_id,
                    ss.id AS schedule_seat_id,
                    ss.status AS seat_status,
                    ss.user_lock,
                    ss.last_lock_time,
                    ss.schedule_id
                 FROM {{%reserve_item}} ri
                 INNER JOIN {{%schedule_seat}} ss ON ss.id = ri.schedule_seats_id
                 WHERE ri.reserve_id=:rid
                 FOR UPDATE',
                [':rid' => $reserveId]
            )->queryAll();

            if (empty($items)) {
                $tx->rollBack();
                return ['ok' => false, 'reason' => 'reserve_has_no_seats', 'reserve_id' => $reserveId];
            }

            $seatIds = [];
            foreach ($items as $item) {
                $sid = (int)($item['schedule_seats_id'] ?? 0);
                $status = (int)($item['seat_status'] ?? 0);
                $userLock = (int)($item['user_lock'] ?? 0);
                $lastLock = (int)($item['last_lock_time'] ?? 0);
                $lockExpired = ($lastLock <= 0 || $lastLock < ($now - $lockTtl));
                $isOwnLock = ($reserveUserId > 0 && $userLock === $reserveUserId);

                /*
                 * V2I rule:
                 * - status=3 is sold and must not be reused unless the same reserve is already completed.
                 * - status=0 is free and can be re-locked for this paid reserve.
                 * - status=1/other temporary lock can be re-claimed only when the lock is expired
                 *   and no other active/completed reserve exists for the same seat.
                 */
                if ($status === 3) {
                    $tx->rollBack();
                    return [
                        'ok' => false,
                        'reason' => 'seat_already_sold_status',
                        'reserve_id' => $reserveId,
                        'schedule_seats_id' => $sid,
                        'seat_status' => $status,
                        'user_lock' => $userLock,
                        'reserve_user_id' => $reserveUserId,
                    ];
                }

                if ($status !== 0 && !$isOwnLock && !$lockExpired) {
                    $tx->rollBack();
                    return [
                        'ok' => false,
                        'reason' => 'seat_locked_by_other_unexpired_user',
                        'reserve_id' => $reserveId,
                        'schedule_seats_id' => $sid,
                        'seat_status' => $status,
                        'user_lock' => $userLock,
                        'last_lock_time' => $lastLock,
                        'reserve_user_id' => $reserveUserId,
                    ];
                }
            }

            /*
             * Re-lock free/expired seats for this user before payment verification/final settle.
             * The existing settle code can then mark them as sold/completed.
             */
            $relockExpectedCount = count($seatIds);

            $db->createCommand(
                'UPDATE {{%schedule_seat}} ss
                 INNER JOIN {{%reserve_item}} ri ON ri.schedule_seats_id = ss.id
                 SET ss.status=1, ss.user_lock=:uid, ss.last_lock_time=:now, ss.updated_at=:now
                 WHERE ri.reserve_id=:rid
                   AND COALESCE(ss.status,0) <> 3
                   AND (
                        COALESCE(ss.status,0)=0
                        OR ss.user_lock=:uid
                        OR ss.last_lock_time IS NULL
                        OR ss.last_lock_time < :cutoff
                   )',
                [
                    ':rid' => $reserveId,
                    ':uid' => $reserveUserId,
                    ':now' => $now,
                    ':cutoff' => $now - $lockTtl,
                ]
            )->execute();

            $relockActualCount = (int)$db->createCommand(
                'SELECT COUNT(DISTINCT ss.id)
                 FROM {{%schedule_seat}} ss
                 INNER JOIN {{%reserve_item}} ri ON ri.schedule_seats_id = ss.id
                 WHERE ri.reserve_id=:rid
                   AND COALESCE(ss.status,0)=1
                   AND ss.user_lock=:uid',
                [
                    ':rid' => $reserveId,
                    ':uid' => $reserveUserId,
                ]
            )->queryScalar();

            if ($relockActualCount < $relockExpectedCount) {
                $tx->rollBack();
                return [
                    'ok' => false,
                    'reason' => 'seat_relock_failed',
                    'reserve_id' => $reserveId,
                    'expected' => $relockExpectedCount,
                    'actual' => $relockActualCount,
                ];
            }

            \Yii::warning([
                'context' => $context,
                'reserve_id' => $reserveId,
                'seat_ids' => array_values($seatIds),
                'result' => 'ok_relocked_before_payment_finalize',
            ], 'honartik.payment_seat_guard');

            $tx->commit();

            return [
                'ok' => true,
                'reason' => 'ok_relocked',
                'reserve_id' => $reserveId,
                'seat_ids' => array_values($seatIds),
            ];
        } catch (\Throwable $e) {
            if ($tx->isActive) {
                $tx->rollBack();
            }

            \Yii::error([
                'context' => $context,
                'reserve_id' => $reserveId,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ], 'honartik.payment_seat_guard');

            return [
                'ok' => false,
                'reason' => 'guard_exception',
                'reserve_id' => $reserveId,
                'error' => $e->getMessage(),
            ];
        }
    }

    private function htdPaymentSeatMarkFailed($reserveId, array $guard = [])
    {
        $reserveId = (int)$reserveId;
        $db = \Yii::$app->db;
        $now = time();
        $meta = json_encode([
            'payment_seat_guard' => $guard,
            'failed_at' => $now,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        try {
            $reserve = $db->createCommand(
                'SELECT id, user_id, transaction_id FROM {{%reserve}} WHERE id=:rid LIMIT 1',
                [':rid' => $reserveId]
            )->queryOne();

            if (!$reserve) {
                return;
            }

            $db->createCommand(
                'UPDATE {{%reserve}}
                 SET status=3, updated_at=:now
                 WHERE id=:rid AND status<>2',
                [':now' => $now, ':rid' => $reserveId]
            )->execute();

            if (!empty($reserve['transaction_id'])) {
                $db->createCommand(
                    'UPDATE {{%finance_transactions}}
                     SET status=-1, gateway_meta=:meta
                     WHERE id=:tid AND status<>3',
                    [':meta' => $meta, ':tid' => (int)$reserve['transaction_id']]
                )->execute();
            }

            /*
             * Release only seats that are still locked by this same user.
             * This will not touch seats already taken by someone else.
             */
            $db->createCommand(
                'UPDATE {{%schedule_seat}} ss
                 INNER JOIN {{%reserve_item}} ri ON ri.schedule_seats_id = ss.id
                 SET ss.status=0, ss.user_lock=NULL, ss.last_lock_time=NULL, ss.updated_at=:now
                 WHERE ri.reserve_id=:rid
                   AND ss.user_lock=:uid
                   AND COALESCE(ss.status,0) <> 3',
                [
                    ':now' => $now,
                    ':rid' => $reserveId,
                    ':uid' => (int)($reserve['user_id'] ?? 0),
                ]
            )->execute();

            \Yii::warning([
                'reserve_id' => $reserveId,
                'guard' => $guard,
                'result' => 'reserve_and_transaction_marked_failed',
            ], 'honartik.payment_seat_guard');
        } catch (\Throwable $e) {
            \Yii::error([
                'reserve_id' => $reserveId,
                'guard' => $guard,
                'error' => $e->getMessage(),
            ], 'honartik.payment_seat_guard');
        }
    }

    private function htdPaymentSeatFailRedirect($reason = 'seat_unavailable')
    {
        $front = '';
        try {
            $front = (string)config('front_url');
        } catch (\Throwable $e) {
            $front = '';
        }

        if (!$front) {
            $front = 'https://honartik.ir';
        }

        return \Yii::$app->response->redirect(rtrim($front, '/') . '/reserve/fail?reason=' . rawurlencode((string)$reason));
    }
    // HONARTIK_PAYMENT_SEAT_GUARD_V1_END




}
