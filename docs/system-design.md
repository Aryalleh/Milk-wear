# سند طراحی سامانه یکپارچه مدیریت زنجیره لبنیات

نسخه: 2.0 — طراحی فنی (Technical Design / ERD / Data Dictionary)
وضعیت: مبنای ساخت دیتابیس و شروع برنامه‌نویسی
تاریخ: ۱۴۰۵/۰۵/۳۱

> این سند ادامهٔ «سند تحلیل کسب‌وکار» است. تحلیل به ما گفت **چه چیزی** بسازیم؛ این سند می‌گوید **دقیقاً چگونه**: هر جدول، هر فیلد، هر رابطه، هر ایندکس، منطق مالی، و قوانین سیستم به‌صورت اجرایی.

---

## فهرست

1. اصول معماری (تثبیت‌شده)
2. نمای کلان لایه‌ها
3. قراردادهای عمومی همهٔ جدول‌ها
4. نقشهٔ کامل داده (ERD)
5. دیکشنری داده — تشریح تک‌تک جدول‌ها و فیلدها
6. موتور مالی: دفتر حساب زنده (Ledger) — قلب سیستم
7. منطق قیمت شیر و محاسبهٔ اعتبار
8. انبار و تولید
9. جریان‌های کاری کلیدی (Sequence)
10. آفلاین و همگام‌سازی (Offline-First / Sync)
11. نقش‌ها و ماتریس دسترسی
12. طرح API
13. بستن ماه و تسویه
14. تصمیمات باز و ریسک‌ها

---

## ۱. اصول معماری (تثبیت‌شده)

| اصل | معنای عملی در دیتابیس |
|---|---|
| **Transaction-Driven** | هیچ رویداد مالی مستقیم روی جدول‌ها نوشته نمی‌شود؛ هر رویداد ابتدا یک ردیف در `transactions` می‌سازد. |
| **Single Source of Truth** | هیچ «مانده» یا «جمع»ی به‌عنوان حقیقتِ اصلی ذخیره نمی‌شود. اعداد نمایشی (`account_balances`, `stock_balances`) صرفاً **کَش/عکس فوری** هستند و هر لحظه از روی جدول‌های پایه قابل بازسازی‌اند. |
| **Offline-First** | هر رکورد `uuid` تولیدشده در کلاینت دارد؛ همه‌چیز اول محلی ثبت و بعد Sync می‌شود. |
| **Auditable & Immutable** | تراکنش مالی حذف نمی‌شود؛ فقط ابطال (`VOID`) یا اصلاح (`ADJUSTMENT`) با تاریخچه. همه‌چیز در `audit_logs`. |
| **Multi-Branch** | همه‌چیز از ابتدا چندشعبه‌ای؛ `branch_id` روی جدول‌های عملیاتی. |

**دو تصمیم کلیدی که کل طراحی را شکل می‌دهند (برگرفته از پاسخ‌های شما):**

- **دفتر حساب زندهٔ دامدار:** جمع وزن و ارزش شیر، منهای خریدها و برداشت‌ها، باید در هر لحظه آماده باشد (تماس ساعت ۱۰ صبح → عدد «قابل پرداخت» حاضر است). این با `transactions` + کَش `account_balances` حل می‌شود.
- **قیمت شیر بر مبنای ماه، اما قابل‌توسعه به «قیمت اختصاصی شخص»:** جدول `milk_price_history` از همین حالا ستون `person_id` (nullable) دارد؛ امروز `NULL` (قیمت عمومی ماه)، فردا مقداردار (قیمت اختصاصی) — بدون تغییر ساختار.

---

## ۲. نمای کلان لایه‌ها

```
┌──────────────────────────────────────────────────────────────┐
│  کلاینت‌ها: پنل مدیر · ایستگاه · فروشگاه · اپ راننده ·        │
│            پنل دامدار · پنل مشتری                              │
│  ذخیرهٔ محلی: IndexedDB  ←  صف عملیات (Outbox)                 │
└───────────────┬──────────────────────────────────────────────┘
                │  REST/JSON + JWT  (فقط هنگام آنلاین)
┌───────────────▼──────────────────────────────────────────────┐
│  API Layer  ·  Auth/RBAC  ·  Sync Engine  ·  Conflict Resolver │
├──────────────────────────────────────────────────────────────┤
│  Domain Services:                                             │
│   Ledger Engine · Pricing · Inventory · Production · Orders   │
│   · Distribution · Reporting · Notification                   │
├──────────────────────────────────────────────────────────────┤
│  Data:  جدول‌های پایه (منبع حقیقت)  +  جدول‌های کَش (مانده‌ها) │
│  Audit: audit_logs · sync_queue                              │
└──────────────────────────────────────────────────────────────┘
```

**لایهٔ آبستراکشن سخت‌افزار (آیندهٔ نزدیک):** یک واسط `DeviceAdapter` پیش‌بینی می‌شود (باسکول، کارت‌خوان، چاپگر حرارتی، بارکد) که فعلاً پیاده‌سازی نمی‌شود ولی نقطهٔ اتصالش در معماری رزرو است. جدول `devices` از همین حالا هست.

---

## ۳. قراردادهای عمومی همهٔ جدول‌ها

هر جدول عملیاتی این ستون‌های استاندارد را دارد (در دیکشنری تکرار نمی‌شوند مگر نکتهٔ خاصی باشد):

| ستون | نوع | توضیح |
|---|---|---|
| `id` | BIGINT PK, auto | کلید داخلی سرور. |
| `uuid` | UUID, UNIQUE, NOT NULL | کلید سراسری تولیدشده در کلاینت. **ضدِ ثبت تکراری** و مبنای Sync. |
| `branch_id` | BIGINT FK → branches | شعبه (روی جدول‌های عملیاتی). |
| `created_at` | TIMESTAMPTZ | زمان ایجاد. |
| `updated_at` | TIMESTAMPTZ | زمان آخرین تغییر. |
| `created_by` | BIGINT FK → users | ثبت‌کننده. |
| `updated_by` | BIGINT FK → users | آخرین ویرایش‌کننده. |
| `deleted_at` | TIMESTAMPTZ NULL | **Soft-delete**؛ حذف فیزیکی نداریم. |
| `version` | INT, default 1 | نسخهٔ رکورد برای حل تعارض Sync (optimistic lock). |
| `sync_status` | ENUM(`local`,`pending`,`synced`,`conflict`) | وضعیت همگام‌سازی. |

**قرارداد تاریخ:** همه‌جا `TIMESTAMPTZ` (UTC) ذخیره می‌شود؛ برای نمایش و «ماهِ قیمت شیر» معادل **شمسی** هم نگه داشته می‌شود (`year_month_jalali` مثل `1405-05`). ماه مالی = ماه شمسی.

**قرارداد پول و مقدار:** پول `DECIMAL(18,0)` (ریال، بدون اعشار). وزن/مقدار `DECIMAL(14,3)` (تا گرم). هرگز `float` برای پول.

---

## ۴. نقشهٔ کامل داده (ERD)

```mermaid
erDiagram
    branches ||--o{ users : has
    roles ||--o{ users : assigns
    roles ||--o{ role_permissions : has
    permissions ||--o{ role_permissions : in
    users ||--o{ sessions : opens
    users ||--o{ devices : registers

    persons ||--o{ person_roles : is
    person_types ||--o{ person_roles : classifies
    persons ||--o{ person_delivery_locations : has
    persons ||--o| users : "may login as"

    product_categories ||--o{ products : groups
    units ||--o{ products : measures
    warehouses ||--o{ stock_movements : holds
    products ||--o{ stock_movements : moves

    persons ||--o{ milk_deliveries : delivers
    milk_price_history }o--o| persons : "price for (nullable)"

    production_batches ||--o{ production_inputs : consumes
    production_batches ||--o{ production_outputs : produces
    products ||--o{ production_outputs : yields

    persons ||--o{ orders : places
    orders ||--o{ order_items : contains
    products ||--o{ order_items : lists
    orders ||--o| deliveries : "distributed via"
    delivery_routes ||--o{ deliveries : routes
    persons ||--o{ deliveries : "driver"

    orders ||--o| invoices : bills
    invoices ||--o{ invoice_items : lines

    persons ||--o{ transactions : "account of"
    transactions }o--o| payments : settles
    transactions }o--o| milk_deliveries : "sourced from"
    transactions }o--o| orders : "sourced from"

    persons ||--|| account_balances : "cached ledger"
    products ||--o{ stock_balances : "cached stock"

    persons ||--o{ attachments : has
    month_closings }o--|| branches : closes

    audit_logs }o--o| users : by
    sync_queue }o--o| devices : from
    notifications }o--o| users : to
```

> جدول‌های کَش (`account_balances`, `stock_balances`) عمداً در ERD به‌عنوان مشتقات نمایش داده شده‌اند؛ در سطح منطق، حقیقت در `transactions` و `stock_movements` است.

---

## ۵. دیکشنری داده — تشریح تک‌تک جدول‌ها

### گروه الف) هویت و دسترسی

#### `branches` — شعب
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid | | |
| code | VARCHAR(20) UNIQUE | کد شعبه. |
| name | VARCHAR(120) | نام شعبه. |
| type | ENUM(`station`,`store`,`distribution`,`head`) | نوع شعبه (ایستگاه شیر/فروشگاه/مرکز پخش/دفتر مرکزی). |
| address, phone | VARCHAR | اطلاعات تماس. |
| is_active | BOOLEAN | فعال بودن. |

#### `users` — کاربران ورود به سیستم
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid, branch_id | | شعبهٔ پیش‌فرض کاربر. |
| person_id | BIGINT FK → persons NULL | اگر کاربر یک «شخص» هم باشد (دامدار/مشتری با پنل، یا راننده). |
| fullname | VARCHAR(120) | |
| username | VARCHAR(60) UNIQUE | |
| password_hash | VARCHAR(255) | bcrypt/argon2. |
| role_id | BIGINT FK → roles | نقش اصلی. |
| mobile | VARCHAR(15) | برای OTP. |
| is_active | BOOLEAN | |
| last_login_at | TIMESTAMPTZ | |

> **نکته:** «کاربر» و «شخص» جدا هستند. هر کاربر می‌تواند به یک شخص وصل باشد (`person_id`)، ولی همهٔ اشخاص کاربر نیستند (اکثر دامدارها فقط شخص‌اند و توسط اپراتور ثبت می‌شوند).

#### `roles` — نقش‌ها
`id, uuid, name` (مدیر، مسئول ایستگاه، فروشگاه، راننده، حسابداری، مدیر پخش، دامدار، مشتری), `is_system` (نقش‌های سیستمی غیرقابل‌حذف).

#### `permissions` — مجوزها
`id, uuid, key` (مثل `order.create`, `order.delete`, `milk.edit`, `month.close`, `report.view`, `price.manage`, `payment.create`, `transaction.void`), `group` (دسته‌بندی نمایشی), `description`.

#### `role_permissions` — اتصال نقش↔مجوز
`role_id`, `permission_id` (PK مرکب). ماتریس دسترسی در بخش ۱۱.

#### `sessions` — نشست‌ها
`id, uuid, user_id, device_id, token_hash, ip, user_agent, issued_at, expires_at, revoked_at`. مبنای JWT + امکان ابطال دستی.

#### `devices` — دستگاه‌های ثبت‌شده
`id, uuid, user_id, device_name, platform, push_token, hardware_caps (JSON: scale/printer/cardreader...), last_seen_at`. ستون `hardware_caps` جای اتصال سخت‌افزار آینده را باز می‌گذارد.

---

### گروه ب) اشخاص (Business Parties)

#### `persons` — طرف‌حساب‌ها (منبع واحد همهٔ افراد)
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid | | |
| person_code | VARCHAR(20) UNIQUE | کد داخلی (روی کارت/QR چاپ می‌شود). |
| fullname | VARCHAR(120) | |
| national_code | VARCHAR(10) UNIQUE NULL | کد ملی. |
| mobile | VARCHAR(15) | |
| address | TEXT | |
| credit_limit | DECIMAL(18,0) NULL | سقف اعتبار (اختیاری؛ برای هشدار). |
| qr_token, nfc_uid, barcode | VARCHAR NULL | شناسه‌های احراز فیزیکی. |
| is_active | BOOLEAN | |

> یک شخص = یک رکورد، صرف‌نظر از تعداد نقش‌ها. دامدار و مشتری و راننده همه در همین جدول‌اند.

#### `person_types` — انواع نقش شخص (لوکاپ)
`id, uuid, key` (`farmer`, `customer`, `supplier`, `sales_rep`, `driver`, `other`), `title`.

#### `person_roles` — شخص ↔ نوع (چند‌به‌چند)
`person_id`, `person_type_id`, `since` (PK مرکب). یک شخص می‌تواند هم‌زمان دامدار و مشتری باشد.

#### `person_delivery_locations` — محل‌های تحویل شخص
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid, person_id | | |
| title | VARCHAR(80) | «دامداری بالا»، «مغازه». |
| branch_id | FK → branches | شعبهٔ مرتبط. |
| address, geo_lat, geo_lng | | مختصات برای مسیریابی پخش. |
| is_default | BOOLEAN | |

> پاسخ سؤال ۳ = بله: هر شخص می‌تواند چند محل تحویل/شعبه داشته باشد.

---

### گروه ج) کالا، انبار، تولید

#### `product_categories`
`id, uuid, name` (لبنیات، خوراک دام، سوپرمارکت، سایر), `parent_id NULL` (دسته‌بندی درختی).

#### `units` — واحدها
`id, uuid, name` (کیلوگرم، عدد، لیتر، بسته), `symbol, decimal_places`.

#### `products` — کالاها
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid | | |
| code | VARCHAR(20) UNIQUE | |
| name | VARCHAR(120) | |
| category_id | FK | |
| unit_id | FK | |
| base_price | DECIMAL(18,0) | قیمت پایهٔ فروش (قیمت لحظهٔ فروش در `order_items` قفل می‌شود). |
| is_raw_milk | BOOLEAN | آیا «شیر خام» است (ورودی تولید). |
| is_produced | BOOLEAN | آیا محصول تولیدی است. |
| track_stock | BOOLEAN | آیا موجودی ردیابی شود. |
| is_active | BOOLEAN | |

#### `warehouses` — انبارها
`id, uuid, branch_id, name, type` (ایستگاه شیر/فروشگاه/مرکز پخش), `is_active`. جدا از `branches` چون یک شعبه می‌تواند چند انبار داشته باشد.

#### `stock_movements` — حرکات موجودی (منبع حقیقتِ انبار)
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid, branch_id | | |
| warehouse_id | FK | |
| product_id | FK | |
| direction | ENUM(`in`,`out`) | ورود/خروج. |
| quantity | DECIMAL(14,3) | مقدار (همیشه مثبت؛ جهت با `direction`). |
| unit_cost | DECIMAL(18,0) NULL | بهای تمام‌شده (برای گزارش ارزش موجودی). |
| source_type | ENUM(`purchase`,`sale`,`production_in`,`production_out`,`adjustment`,`transfer`,`return`) | منشأ. |
| source_id | BIGINT | ارجاع پلی‌مورفیک به سند منشأ. |
| occurred_at | TIMESTAMPTZ | |

> موجودی هر کالا = `SUM(in) - SUM(out)`. هیچ عدد موجودیِ دستی ذخیره نمی‌شود.

#### `stock_balances` — **کَش** موجودی
`warehouse_id, product_id, quantity, value, last_movement_at` (PK: warehouse+product). صرفاً برای سرعت؛ از `stock_movements` بازسازی‌پذیر.

#### `production_batches` — بَچ‌های تولید
`id, uuid, branch_id, batch_code, started_at, finished_at, status(planned/running/done), note`.

#### `production_inputs` — ورودی تولید (شیر/مواد مصرفی)
`id, uuid, batch_id, product_id, warehouse_id, quantity`. هنگام ثبت، یک `stock_movements(out, production_in)` می‌سازد.

#### `production_outputs` — خروجی تولید (محصولات)
`id, uuid, batch_id, product_id, warehouse_id, quantity`. هنگام ثبت، `stock_movements(in, production_out)` می‌سازد.

> مثال شما: ۲۰۰۰ کیلو شیر (input) → ۱۲۰۰ ماست + ۳۰۰ پنیر + ۱۸۰ خامه (outputs). ورود این‌ها به انبار خودکار است.

---

### گروه د) شیر و قیمت‌گذاری

#### `milk_deliveries` — تحویل شیر (رویداد پایه)
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid, branch_id | | |
| person_id | FK → persons | دامدار. |
| delivery_location_id | FK NULL | محل تحویل. |
| shift | ENUM(`morning`,`evening`) | صبح/شب. |
| delivered_at | TIMESTAMPTZ | |
| year_month_jalali | CHAR(7) | `1405-05` — کلید تعیین قیمت ماه. |
| weight_kg | DECIMAL(14,3) | وزن (بعداً از باسکول). |
| price_per_kg | DECIMAL(18,0) | قیمت **قفل‌شده** لحظهٔ ثبت (از `milk_price_history`). |
| amount | DECIMAL(18,0) | = weight × price (ذخیرهٔ محاسبه‌شده برای تغییرناپذیری تاریخی). |
| quality_json | JSONB NULL | چربی/دما... (فاز آینده؛ ستونش حالا هست). |
| note | TEXT | |

> با ثبت هر `milk_delivery`، سیستم یک `transactions(type=MILK_DELIVERY, direction=credit)` به‌نام دامدار می‌سازد → دامدار **بستانکار** می‌شود.

#### `milk_price_history` — تاریخچهٔ قیمت شیر
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid, branch_id | | |
| year_month_jalali | CHAR(7) | ماه اعمال. |
| person_id | FK → persons **NULL** | **کلید توسعه‌پذیری:** `NULL` = قیمت عمومی ماه؛ مقداردار = قیمت اختصاصی آن دامدار. |
| price_per_kg | DECIMAL(18,0) | |
| effective_from | DATE | |

**منطق انتخاب قیمت (Pricing rule):** برای دامدار X در ماه M →
`قیمتِ اختصاصی (person_id=X, month=M)` اگر وجود داشت، وگرنه `قیمت عمومی (person_id NULL, month=M)`. امروز همیشه شاخهٔ دوم؛ فردا بدون تغییر ساختار، شاخهٔ اول فعال می‌شود.

---

### گروه ه) سفارش، فروش، پخش

#### `orders` — سفارش (دامدار / فروشگاه / پخش)
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid, branch_id | | |
| order_no | VARCHAR(20) UNIQUE | شمارهٔ خوانا. |
| person_id | FK | مشتری/دامدار. |
| channel | ENUM(`farmer`,`store`,`distribution`) | کانال سفارش. |
| status | ENUM(`draft`,`confirmed`,`allocated`,`loaded`,`delivered`,`settled`,`canceled`) | چرخهٔ وضعیت. |
| warehouse_id | FK | انبار تأمین. |
| driver_id | FK → persons NULL | راننده (نقش driver). |
| route_id | FK → delivery_routes NULL | |
| ordered_at, delivered_at | TIMESTAMPTZ | |
| total_amount | DECIMAL(18,0) | جمع خطوط (کَش خطوط؛ حقیقت در `order_items`). |
| note | TEXT | |

#### `order_items` — اقلام سفارش
`id, uuid, order_id, product_id, quantity, unit_price` (قفل‌شده در لحظهٔ سفارش), `amount` (=qty×price), `note`.

#### `invoices` / `invoice_items` — فاکتور
فاکتور از روی سفارش/فروش صادر می‌شود: `id, uuid, order_id NULL, person_id, invoice_no, issued_at, total, discount, tax, payable`. خطوط در `invoice_items`. (در فروشگاه، فاکتور می‌تواند مستقیم بدون order باشد.)

#### `delivery_routes` — مسیرهای پخش
`id, uuid, branch_id, name, driver_id NULL, planned_date, status`.

#### `deliveries` — تحویل پخش
`id, uuid, order_id, route_id, driver_id, delivered_at, status(pending/delivered/failed), receiver_name, geo_lat, geo_lng, signature_attachment_id`.

---

### گروه و) مالی — قلب سیستم

#### `transactions` — دفتر کل تراکنش‌ها (اصلی‌ترین جدول)
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid, branch_id | | |
| person_id | FK → persons | صاحب حساب (همیشه بین **شرکت** و **یک شخص**؛ هرگز شخص‌به‌شخص). |
| tx_type | ENUM | نوع معنایی — جدول زیر. |
| direction | ENUM(`credit`,`debit`) | بستانکار/بدهکار **نسبت به شخص**. |
| amount | DECIMAL(18,0) | مبلغ مثبت. |
| tx_date | TIMESTAMPTZ | تاریخ سند. |
| year_month_jalali | CHAR(7) | برای بستن ماه. |
| source_type | ENUM(`milk_delivery`,`order`,`invoice`,`payment`,`production`,`manual`) | منشأ. |
| source_id | BIGINT NULL | ارجاع پلی‌مورفیک. |
| description | VARCHAR(200) | شرح خوانا برای دفتر حساب. |
| reverses_tx_id | BIGINT FK → transactions NULL | اگر این تراکنش، ابطال/اصلاح تراکنش دیگری است. |
| status | ENUM(`active`,`voided`) | ابطال‌شده یا نه. |
| is_locked | BOOLEAN | اگر ماهش بسته شده. |

**قرارداد علامت (حیاتی):** مانده = `SUM(credit) − SUM(debit)`.
ماندهٔ مثبت = شرکت به شخص **بدهکار** است (قابل پرداخت به دامدار).
ماندهٔ منفی = شخص به شرکت **بدهکار** است (مشتری باید بپردازد).

**انواع تراکنش و جهت پیش‌فرض:**
| tx_type | direction | مثال |
|---|---|---|
| `MILK_DELIVERY` | credit | تحویل شیر دامدار |
| `PRODUCT_SALE` / `FEED_SALE` | debit | خرید خوراک/محصول |
| `CASH_WITHDRAWAL` | debit | برداشت نقدی دامدار |
| `PAYMENT_OUT` | debit | پرداخت پول به دامدار (تسویه) |
| `PAYMENT_IN` | credit | دریافت پول از مشتری |
| `ADJUSTMENT` | credit/debit | اصلاح |
| `REFUND` | credit/debit | برگشت |
| `OPENING_BALANCE` | credit/debit | مانده اول دوره |
| `VOID` | معکوس | ابطال (تراکنش خنثی‌کننده) |

> **حذف ممنوع.** برای اصلاح: یک تراکنش `VOID` معکوسِ اصلی + (در صورت نیاز) تراکنش صحیح جدید. تاریخچه در `audit_logs`.

#### `payments` — پرداخت‌ها
| فیلد | نوع | توضیح |
|---|---|---|
| id, uuid, branch_id, person_id | | |
| direction | ENUM(`in`,`out`) | دریافت از مشتری / پرداخت به دامدار. |
| method | ENUM(`cash`,`card`,`transfer`,`credit`,`mixed`) | روش. |
| amount | DECIMAL(18,0) | |
| method_breakdown | JSONB NULL | برای پرداخت ترکیبی: `[{method,amount}]`. |
| ref_no | VARCHAR(60) | شمارهٔ پیگیری/کارت. |
| paid_at | TIMESTAMPTZ | |
| attachment_id | FK NULL | عکس رسید. |

> هر `payment` یک `transaction` متناظر می‌سازد (`PAYMENT_IN`=credit / `PAYMENT_OUT`=debit).

#### `account_balances` — **کَش** دفتر حساب زندهٔ هر شخص (صفحهٔ کلیدی سیستم)
| فیلد | نوع | توضیح |
|---|---|---|
| person_id | PK FK | |
| current_balance | DECIMAL(18,0) | مانده لحظه‌ای = SUM(credit)−SUM(debit). |
| milk_kg_month | DECIMAL(14,3) | مجموع کیلو شیر ماه جاری. |
| milk_value_month | DECIMAL(18,0) | ارزش شیر ماه جاری. |
| milk_kg_total, milk_value_total | | مجموع کل (تسویه‌نشده). |
| purchases_total | DECIMAL(18,0) | مجموع خرید کالا (بدهی). |
| cash_withdrawal_total | DECIMAL(18,0) | مجموع برداشت نقدی. |
| payments_total | DECIMAL(18,0) | مجموع پرداخت‌های انجام‌شده. |
| payable_now | DECIMAL(18,0) | **قابل پرداخت تا این لحظه** (عددی که پای تلفن می‌خوانید). |
| last_payment_at, last_order_at, last_settlement_at | TIMESTAMPTZ | |
| days_since_settlement | INT | تعداد روز از آخرین تسویه. |
| status | ENUM(`settled`,`debtor`,`creditor`) | وضعیت حساب. |

> این جدول با هر تراکنش به‌روزرسانی می‌شود (idempotent، بر پایهٔ uuid). هر شب یک job صحت‌سنجی می‌کند: کَش == بازمحاسبه از `transactions`؟ اگر نه، اصلاح + هشدار.

---

### گروه ز) سیستمی

#### `attachments`
`id, uuid, owner_type, owner_id, file_path, mime, size, kind(invoice/receipt/doc/signature), uploaded_at`. پلی‌مورفیک.

#### `audit_logs` — تاریخچهٔ همهٔ تغییرات
`id, uuid, entity_type, entity_id, action(create/update/void/delete), old_json, new_json, user_id, ip, device_id, reason, created_at`. برای هر تغییر روی جدول‌های حساس (مالی، قیمت، سفارش) اجباری.

#### `sync_queue` — صف همگام‌سازی (Outbox)
`id, uuid, device_id, entity_type, entity_uuid, operation(insert/update/void), payload_json, client_ts, server_ts, status(pending/applied/conflict), conflict_reason`.

#### `notifications`
`id, uuid, user_id, type(order/payment/debt/settlement/error/sync), title, body, data_json, is_read, created_at`.

#### `settings` — تنظیمات (key-value با scope)
`id, uuid, scope(global/branch/user), scope_id, key, value_json`. برای قیمت‌ها، واحدها، روش‌های پرداخت، تنظیمات چاپ و Sync.

#### `month_closings` — بستن ماه
`id, uuid, branch_id, year_month_jalali, closed_by, closed_at, reopened_by NULL, reopened_at NULL, status(open/closed)`. یکتا بر (branch, year_month).

---

## ۶. موتور مالی: دفتر حساب زنده (Ledger)

این مهم‌ترین بخش سیستم است. هدف: صفحهٔ گردش‌حساب هر شخص، دقیقاً مثل صورت‌حساب بانکی، با مانده رونده.

**کوئری مرجع (مانده رونده) — منبع حقیقت، بدون کَش:**

```sql
SELECT
  t.tx_date,
  t.description,
  CASE WHEN t.direction='debit'  THEN t.amount ELSE 0 END AS debit,
  CASE WHEN t.direction='credit' THEN t.amount ELSE 0 END AS credit,
  SUM(CASE WHEN t.direction='credit' THEN t.amount ELSE -t.amount END)
      OVER (PARTITION BY t.person_id ORDER BY t.tx_date, t.id) AS running_balance
FROM transactions t
WHERE t.person_id = :personId
  AND t.status = 'active'
ORDER BY t.tx_date, t.id;
```

خروجی دقیقاً همان جدولی است که در سند دادید:

| تاریخ | شرح | بدهکار | بستانکار | مانده |
|---|---|---|---|---|
| ۱ مرداد | شیر صبح | — | ۳٬۸۰۰٬۰۰۰ | ۳٬۸۰۰٬۰۰۰ |
| ۱ مرداد | خوراک دام | ۱٬۲۰۰٬۰۰۰ | — | ۲٬۶۰۰٬۰۰۰ |
| ۳ مرداد | شیر شب | — | ۲٬۹۰۰٬۰۰۰ | ۵٬۵۰۰٬۰۰۰ |
| ۵ مرداد | برداشت نقدی | ۲٬۰۰۰٬۰۰۰ | — | ۳٬۵۰۰٬۰۰۰ |

**داشبورد خلاصهٔ شخص** (از `account_balances`): مانده قابل پرداخت/دریافت · شیر این ماه (کیلو/ارزش) · خرید این ماه · آخرین پرداخت · آخرین سفارش · روز از آخرین تسویه · سقف اعتبار · وضعیت (تسویه/بدهکار/بستانکار).

**سناریوی «پول من را بده» (وسط ماه یا هر ۱۵ روز):**
۱. باز کردن صفحهٔ شخص → `payable_now` آماده.
۲. ثبت `payment(out)` به مبلغ کل یا علی‌الحساب.
۳. سیستم `transaction(PAYMENT_OUT, debit)` می‌سازد → مانده کم می‌شود.
۴. `account_balances` به‌روز، `last_payment_at` ثبت.
۵. چاپ «رسید پرداخت». تسویهٔ سر ماه هم همین است با دکمهٔ «تسویهٔ کامل».

---

## ۷. منطق قیمت شیر و اعتبار

- قیمت ماهانه در `milk_price_history` با `person_id=NULL` ثبت می‌شود.
- هنگام ثبت `milk_delivery`، قیمت **در همان لحظه قفل** و در خود رکورد ذخیره می‌شود (`price_per_kg`, `amount`). تغییر بعدی قیمت ماه، رکوردهای گذشته را دست‌کاری نمی‌کند (تغییرناپذیری).
- اعتبار دامدار = جمع `amount` تحویل‌های تسویه‌نشده = مجموع تراکنش‌های `MILK_DELIVERY(credit)`.
- توسعهٔ آینده: افزودن ردیف با `person_id` مقداردار → قیمت اختصاصی، بدون مهاجرت ساختار.

---

## ۸. انبار و تولید (فاز اول، طبق پاسخ شما)

- **ورود:** خرید / خروجی تولید → `stock_movements(in)`.
- **خروج:** فروش / ورودی تولید / برگشتی → `stock_movements(out)`.
- **موجودی:** همیشه محاسبه‌ای؛ `stock_balances` فقط کَش.
- **تولید:** `production_batch` با چند `input` (شیر خام) و چند `output` (محصول)، که هر کدام خودکار حرکت انبار می‌سازند. اختلاف ارزش input/output مبنای بهای تمام‌شده در گزارش.

---

## ۹. جریان‌های کاری کلیدی

**چرخهٔ دامدار:**
```
شناسایی (QR/NFC/کارت/موبایل/نام) → ثبت شیر (صبح/شب، وزن)
   → tx(MILK_DELIVERY, credit)  → [سفارش کالا] → تحویل کالا
   → tx(FEED_SALE, debit) + stock_movement(out)
   → مانده زنده به‌روز → تسویه/علی‌الحساب → tx(PAYMENT_OUT, debit) → رسید
```

**چرخهٔ فروشگاه:**
```
انتخاب مشتری → افزودن اقلام → پرداخت (نقد/کارت/نسیه/ترکیبی)
   → invoice + order_items + stock_movement(out)
   → tx(PRODUCT_SALE, debit) + (اگر پرداخت شد) tx(PAYMENT_IN, credit) → چاپ فاکتور
```

**چرخهٔ پخش:**
```
ثبت سفارش → تأیید مدیر → تخصیص راننده/مسیر → بارگیری (stock out)
   → چاپ بارنامه → تحویل (delivery) → ثبت پرداخت → ثبت مانده → بستن سفارش
```

---

## ۱۰. آفلاین و همگام‌سازی

```
عملیات کاربر → نوشتن در IndexedDB با uuid → افزودن به Outbox (sync_queue محلی)
   → هنگام اتصال: ارسال دسته‌ای → سرور بر پایهٔ uuid تشخیص تکرار (idempotent)
   → حل تعارض → تأیید server_ts → علامت‌گذاری synced
```

- **ضدتکرار:** `uuid` یکتا؛ ارسال دوباره = no-op.
- **حل تعارض:** پیش‌فرض Last-Write-Wins بر پایهٔ `version` + `updated_at`؛ برای تراکنش مالی، **هرگز overwrite**، بلکه append (تراکنش‌ها فقط اضافه می‌شوند، پس تعارض معنا ندارد). تعارض واقعی فقط روی جدول‌های وضعیت‌دار (orders/persons) رخ می‌دهد و در صف `conflict` برای بازبینی می‌ماند.
- **مانده در حالت آفلاین:** `account_balances` محلی از روی تراکنش‌های محلی محاسبه می‌شود؛ پس از Sync دوباره تطبیق داده می‌شود.

---

## ۱۱. ماتریس دسترسی (خلاصه)

| مجوز \ نقش | مدیر | حسابداری | مسئول ایستگاه | فروشگاه | مدیر پخش | راننده | دامدار | مشتری |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| ثبت شیر | ✓ | | ✓ | | | | | |
| ثبت سفارش | ✓ | | ✓ | ✓ | ✓ | | ✓* | ✓* |
| فروش فروشگاهی | ✓ | | | ✓ | | | | |
| تخصیص راننده/بار | ✓ | | | | ✓ | | | |
| ثبت تحویل پخش | ✓ | | | | ✓ | ✓ | | |
| ثبت پرداخت | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| مدیریت قیمت | ✓ | ✓ | | | | | | |
| بستن/بازکردن ماه | ✓(باز) | ✓(بستن) | | | | | | |
| ابطال تراکنش | ✓ | ✓ | | | | | | |
| مشاهدهٔ گزارش کامل | ✓ | ✓ | جزئی | جزئی | جزئی | — | حساب خود | حساب خود |

`*` سفارش از پنل خودشان (draft) که نیاز به تأیید اپراتور/مدیر دارد. **فقط مدیر می‌تواند ماه بسته را باز کند.**

---

## ۱۲. طرح API (خلاصه)

REST + JWT. الگوی منابع:

```
POST /auth/login            POST /auth/logout        POST /auth/refresh
GET/POST /persons           GET /persons/{id}/ledger        ← گردش حساب
GET /persons/{id}/dashboard ← داشبورد خلاصه (account_balances)
POST /milk-deliveries       GET /milk-deliveries?person=&month=
GET/POST /milk-prices
GET/POST /products  /warehouses  /stock-movements  /stock-balances
POST /production-batches   POST /production-batches/{id}/inputs|outputs
GET/POST /orders           POST /orders/{id}/confirm|allocate|deliver
POST /invoices
POST /payments             ← می‌سازد transaction خودکار
POST /transactions/{id}/void      ← ابطال با reason (نه حذف)
POST /month-closings       POST /month-closings/{id}/reopen (فقط مدیر)
POST /sync/push            GET /sync/pull?since=      ← موتور آفلاین
GET /reports/{type}
```

اصل کلیدی: کلاینت‌ها **پرداخت/فروش/شیر** را می‌فرستند؛ ساخت `transactions` و به‌روزرسانی مانده **سمت سرویس Ledger** و به‌صورت اتمیک انجام می‌شود، نه سمت کلاینت.

---

## ۱۳. بستن ماه و تسویه

- بستن ماه: `month_closings(status=closed)` برای (شعبه، ماه). سپس تراکنش‌های آن ماه `is_locked=true` می‌شوند و ثبت جدید در آن دوره ممنوع.
- بازگشایی: فقط مدیر، با ثبت در `audit_logs`.
- تسویهٔ کامل شخص: تراکنش‌های تسویه‌نشده جمع، یک `payment` نهایی، `last_settlement_at` و `days_since_settlement=0`، وضعیت → `settled`.

---

## ۱۴. تصمیمات باز و ریسک‌ها

قبل از شروع کدنویسی، این چند مورد را نهایی کنیم:

1. **پایگاه‌داده:** پیشنهاد من **PostgreSQL** (به‌خاطر JSONB، window functions برای مانده، و قدرت گزارش). موافقید؟
2. **بهای تمام‌شدهٔ تولید:** روش ارزش‌گذاری خروجی تولید (نسبت وزنی؟ قیمت فروش؟) — چون بر گزارش سود اثر دارد.
3. **پرداخت ترکیبی و نسیه در فروشگاه:** آیا نسیهٔ مشتری فروشگاهی هم وارد همان `account_balances` می‌شود؟ (پیش‌فرض من: بله، یکپارچه.)
4. **شماره‌گذاری اسناد در آفلاین:** `order_no`/`invoice_no` سرور-محور صادر شود یا پیشوند دستگاه + شمارهٔ محلی تا بعد از Sync؟ (پیشنهاد: پیشوند دستگاه.)
5. **تقویم:** تأیید اینکه ماه مالی = ماه **شمسی** و مبنای بستن ماه و قیمت شیر همان است.
6. **چند محل تحویل ↔ مانده:** مانده برای **کل شخص** است یا تفکیک بر محل تحویل؟ (پیش‌فرض: کل شخص، یک حساب.)

---

*پایان سند طراحی — گام بعد پس از تأیید موارد بالا: نوشتن مهاجرت‌های واقعی دیتابیس (DDL) + seed داده‌های پایه (نقش‌ها، مجوزها، واحدها، دسته‌ها).*
