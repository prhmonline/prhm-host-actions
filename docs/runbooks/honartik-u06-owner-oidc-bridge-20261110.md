# U06 Honartik: مالک → GitHub OIDC → مجری محدود Native Backup (بدون Provider)

تاریخ: ۱۰ نوامبر ۲۰۲۶. **وضعیت: ماژول احراز هویت و جلوگیری از Replay آماده و تست‌شده است؛ مجری Root هنوز نصب نشده است.**

## زنجیره جدید مالک‌محور

در این طراحی **Provider هیچ نقش تأییدی ندارد**. مسیر صریح:

1. **سرور هنرتیک** با یک فرایند مورداعتماد و Root-owned، یک Nonce تصادفی ۶۴ کاراکتری Hex و کلید موقت X25519 می‌سازد؛ کلید خصوصی از سرور خارج نمی‌شود. درخواست فقط عملیات ثابت `honartik_back.production.native_backup` را با SHA256 موجود پروفایل `79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698` و آداپتور `d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3` می‌پذیرد.
2. مالک از حساب GitHub با شناسه تثبیت‌شده `193396069`، Workflow اختصاصی `.github/workflows/honartik-u06-owner-approval-oidc-v1.yml` را روی `main` فراخوانی می‌کند. **هیچ بازبین دوم یا Protected Environment برای همین جریان U06 لازم نیست**؛ کنترل امضای GitHub OIDC و SHA دقیق Workflow، Nonce سرور و محدودیت Scope همچنان اجباری‌اند.
3. مدرک مستقیم مالک از GitHub فقط **هویت و نیت همین عملیات** را ثابت می‌کند. این مدرک مجوز Root، نصب کنترل‌پلین، انتشار Backend یا نوشتن دیتابیس نیست؛ نصب مجری محدود و مجوز جداگانه عملیات حساس مطابق محدودیت‌های فعال سرور باقی می‌ماند.
4. GitHub فقط JWT امضاشده RSA را با Audience مربوط به **همین U06، Nonce یک‌بارمصرف و SHA256 قرارداد دقیق عملیات** تولید می‌کند و با X25519/HKDF/AES-256-GCM برای کلید عمومی سرور رمزنگاری می‌کند. خروجی GitHub فقط فایل رمزنگاری‌شده، با نگهداری یک‌روزه، است.
5. **سرور** پس از دریافت Artifact، آن را با کلید خصوصی خودش باز می‌کند. ماژول `honartik-u06-owner-oidc-identity-gate-v1.cjs` امضای RSA را با JWKS رسمی GitHub، issuer، SHA دقیق Workflow، Repository ID، Owner ID، actor، protected Environment، Run ID، Workflow Path، Branch `main`، تاریخ اعتبار و `jti` را بررسی می‌کند. بازبین دوم بررسی نمی‌شود. **OIDC عملیات عمومی Universal یا هر عملیات دیگر مجوز U06 نیست.**
6. ماژول `honartik-u06-owner-oidc-once-fence-v1.cjs` فقط مدرکی را می‌پذیرد که *در همان فرایند* واقعاً از اعتبارسنج امضای RSA عبور کرده باشد؛ بایت JSON یا `verified=true` ساختگی پذیرفته نیست. رکورد مصرف یک‌بارمصرف را با `O_EXCL`، فایل `0600`، دایرکتوری `0700` و `fsync` ثبت می‌کند. Receipt هنگام شکست و Rollback **هرگز حذف نمی‌شود**.
7. پس از این مراحل، **مجری ثابت و محدود U06** که هنوز باید جداگانه به‌صورت مجاز نصب شود، می‌تواند عملیات تعیین‌شده Native Backup را اجرا کند. خود Workflow، JWT و این سه ماژول **اجازه اجرای Root ندارند** و هیچ MySQL یا سرویس Production را تغییر نمی‌دهند.

## محدوده مجری ثابت U06 (هنوز نصب نشده)

پیش از اجرای نوشتنی باید SHA واقعی فایل‌ها، هویت `prhm-production.prhm.ir`، کاربر و دیتابیس MySQL و آخرین بکاپ بازیابی‌شده از Node1 را دوباره بررسی کند. فقط با تأیید اختصاصی تازه و مصرف‌شده مالک، قابلیت‌های زیر مجازند:

- ایجاد یک حساب backup-only `honartik_universal_backup`@`127.0.0.1` با `SELECT, SHOW VIEW, TRIGGER, EVENT` فقط روی `honartik_db.*`؛ بدون مجوز DML، DDL، GRANT یا SUPER.
- تولید رمز قوی در حافظه مجری مورداعتماد و ذخیره اتمیک آن در `/etc/deploy-control/secrets/honartik_back/mysql.cnf` با مالک درست و `0600`، بدون انتقال رمز به Chat/Git/لاگ.
- اجرای واقعی `backup_database()` از روی دیتابیس Production به صورت read-only، بازیابی `verify_database_restore()` فقط در کانتینر بدون شبکه، `mysqlcheck` کامل و کنترل مجموع مالی، کیف پول و رزروها.
- تغییر کنترل‌شده پروفایل به `backup.offsite_required=true` با ثبت پیش‌تصویر، قفل، ژورنال `fsync`، آزمون crash/rollback و اعتبارسنجی ماندگاری پس از Restart.
- استفاده از گواه بازیابی مستقل Restic Node1؛ **هیچ `yii migrate/up`، انتشار Backend، تغییر Apache یا استفاده از رمز ادمین عمومی** مجاز نیست.

## فهرست پذیرش فنی

- [x] مسیر بدون Provider در Git/main پذیرفته شده
- [x] قرارداد Scope عملیات U06 و SHAهای پیش‌تصویر ثابت شده
- [x] Workflow مخصوص U06 با محیط GitHub و Audience اختصاصی اضافه شده
- [x] اعتبارسنج RSA/JWKS، SHA، actor، expiry، audience و official run پیاده‌سازی شده؛ بازبین دوم حذف شد
- [x] جابه‌جایی امن JWT به سرور با X25519 و AES-GCM پیاده‌سازی شده
- [x] مصرف یک‌بارمصرف با ledger خصوصی، `O_EXCL`، `fsync`، امتناع از Replay و مدرک جعلی تست شده
- [ ] تغییر owner-only پس از تست‌ها در main ادغام و GitHub OIDC امضاشده با حساب مالک واقعی بررسی شود
- [ ] یک **اجرای واقعی OIDC مستقیم مالک، بدون تأیید دوم** با artifact رمزنگاری‌شده روی سرور کامل شود
- [ ] **مجری محدود Native U06** و عملیات rollback‌دار روی سرور با مسیر نصب مستقیم مالک و ممیزی مستقل راه‌اندازی شود
- [ ] پیش‌تصویر SHA و دفتر ثبت replay در همان مجری مالک‌محور، با آزمون crash/restart واقعی تأیید شود
- [ ] پس از تأیید تازه مالک، credential محدود و `offsite_required=true` و Native Backup واقعی با آزمون مالی اجرا شود

## هشدار امنیتی و وضعیت U03/U05

GitHub OIDC **مدرک امضاشده هویت و تأیید مالک است، نه امضای Level-4 صادرشده توسط کنترل‌پلین قدیمی**. طراحی جدید نیاز به Provider ندارد؛ اما قبل از نصب مجاز و صحیح مجری محدود، گیت‌های محافظت‌شده فعلی **نباید دور زده شوند**. هیچ کد منتشرشده در این PR نباید توکن را به فرمان آزاد Shell/SQL تبدیل کند. U06 تا اثبات بکاپ بومی زنده باز می‌ماند؛ U03 انتشار PHP/Apache و U05 Migration نیز مستقل‌اند.

## آزمون‌ها

`node --test test-honartik-u06-owner-oidc-identity-gate-v1.cjs test-honartik-u06-owner-oidc-sealed-v1.cjs`

شامل جعل امضا، تغییر Audience، actor اشتباه، تغییر SHA، token منقضی، تغییر Branch، UID/Mode نادرست ledger، JSON جعلی و تکرار مصرف. CI GitHub-hosted بدون دسترسی به Production اجرا می‌شود.
