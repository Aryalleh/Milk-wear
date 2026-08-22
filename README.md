# 🥛 سامانه یکپارچه مدیریت زنجیره لبنیات

MVP تراکنش‌محور و آنلاین برای مدیریت خرید شیر از دامداران، فروش، و **دفتر حساب زندهٔ** هر شخص.

> قلب سیستم: هیچ ماندهٔ دستی ذخیره نمی‌شود. همه‌چیز از جدول `transactions` محاسبه می‌شود و در `account_balances` برای سرعت کَش می‌شود. عدد «قابل پرداخت» هر دامدار همیشه در لحظه آماده است.

سند طراحی کامل: [docs/system-design.md](docs/system-design.md)

## پیش‌نیازها
- Node.js 18+
- MySQL 8 (دیتابیس `milk_wear` و کاربر با دسترسی کامل روی آن)

## راه‌اندازی
```bash
npm install
cp .env.example .env        # مقادیر دیتابیس را تنظیم کنید
npm run db:reset            # ساخت جدول‌ها + داده‌های پایه
npm run db:seed             # کاربر مدیر + دادهٔ نمونه
npm start                   # http://localhost:3000
```
ورود: `admin` / `admin123`

## معماری
- `db/schema.sql` — اسکیمای کامل (اشخاص، شیر، سفارش، پرداخت، تراکنش، مانده، انبار، ...)
- `src/ledger.js` — **موتور مالی**: `postTransaction` تراکنش می‌سازد و مانده را اتمیک بازمحاسبه می‌کند
- `src/routes/` — API: auth · persons · milk · products · orders · payments
- `public/index.html` — رابط کاربری تک‌صفحه‌ای (RTL)

## نکات مالی کلیدی
- **علامت مانده:** `SUM(credit) − SUM(debit)`. مثبت = شرکت به شخص بدهکار (قابل پرداخت به دامدار)؛ منفی = شخص بدهکار.
- **قیمت شیر:** بر مبنای ماه (`milk_price_history` با `person_id=NULL`)؛ ساختار آمادهٔ قیمت اختصاصی هر دامدار در آینده است.
- **حذف ممنوع:** اصلاح تراکنش فقط با ابطال (`VOID`) و ثبت در `audit_logs`.
- **بستن ماه:** ثبت تراکنش در ماه بسته‌شده مسدود می‌شود.

## API (خلاصه)
```
POST /api/auth/login
GET  /api/persons            POST /api/persons
GET  /api/persons/:id/dashboard      ← کارت خلاصه (قابل پرداخت و ...)
GET  /api/persons/:id/ledger         ← گردش حساب با مانده رونده
POST /api/milk/deliveries    GET /api/milk/deliveries   POST/GET /api/milk/price
GET  /api/products
POST /api/orders             ← فروش/خوراک (تراکنش بدهکار + خروج انبار)
POST /api/payments           POST /api/payments/settle   POST /api/payments/void/:txId
```

## وضعیت
فاز MVP: اشخاص، دریافت شیر، فروش/خوراک، پرداخت/تسویه، دفتر حساب زنده، ابطال تراکنش، انبار پایه.
مراحل بعد: تولید (شیر→محصول)، پخش و رانندگان، گزارش‌های پیشرفته، داشبورد مدیریتی، پنل دامدار/مشتری.
