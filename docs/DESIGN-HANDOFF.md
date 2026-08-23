# Milk-Wear — UI/UX Design Handoff

Dairy supply-chain management system (سامانه یکپارچه مدیریت زنجیره لبنیات).
Single-page web app, **Persian / RTL**, mobile-first. This document describes every screen, component, state, printed document, user role, and the API behind them — everything a UI/UX designer needs to redesign the interface without reading the code.

> UI strings are shown in Persian exactly as they appear in the product. Keep them as-is when redesigning.

---

## 1. Product in one paragraph

A dairy company buys **raw milk from farmers (دامدار)**, **processes it into products (تولید)**, keeps **inventory (انبار)**, and **sells to customers (مشتری)** via a store (فروشگاه) and distribution (پخش). Every financial event is a **transaction**; each person has a **live running account (دفتر حساب زنده)**. Staff run the back office; farmers and customers get a **personal panel** (accessible as a Bale mini-app with automatic login).

**The single most important screen is the person's account ledger** — the number "قابل پرداخت تا این لحظه" (payable right now) must always be one tap away.

---

## 2. Users, roles & authentication

### Two account kinds
| Kind | Who | Sees |
|---|---|---|
| **staff** (کارمند) | admin/مدیر, accountant/حسابداری, station/متصدی سایت, distribution/مدیر پخش, store/فروشگاه | Back-office (dashboard, operations, inventory, production, and — for admin — sites/users/logs) |
| **person** (شخص) | farmer/دامدار, customer/مشتری | Only their **own** personal panel (پنل شخصی) |

### Role → visible navigation
- **admin (مدیر اصلی):** داشبورد · عملیات · تولید · انبار · سایت‌ها · کاربران · لاگ‌ها
- **accountant / station / other staff:** داشبورد · عملیات · تولید · انبار (no سایت‌ها/کاربران/لاگ‌ها)
- **Payment/settlement actions** (پرداخت، دریافت، تسویه) show **only for admin + accountant**.
- **person (دامدار/مشتری):** no top nav — lands directly on their personal panel.

### Authentication surfaces
1. **Login page** — username + password (session cookie, 12h, rolling).
2. **Bale mini-app auto-login** — when opened inside Bale, the user is signed in automatically (no form). Unknown Bale users are auto-created as a **customer**. A deep-link `?startapp=receipt_<id>` opens a specific invoice after login.
3. Session persists across server restarts. On any `401` the app returns to the login screen with a message.

**Design note:** the login screen is currently minimal (a card with two fields). It is the first impression on mobile and in Bale — a good redesign target.

---

## 3. Global shell

- **Header** (sticky, brand green): title `🥛 سامانه یکپارچه مدیریت لبنیات`, horizontally-scrollable **nav tabs** (staff only), and user chip `نام — نقش @ سایت` + `خروج`.
- **Direction:** RTL everywhere. **Language:** Persian. **Digits:** Persian (۱۲۳). **Currency:** ریال (Rial). **Dates:** Jalali/Shamsi (e.g., ۱۴۰۵/۰۶/۰۱).
- **Content width:** centered, max ~1100px; cards on a light gray canvas.
- **Mobile behavior today:** nav scrolls horizontally; two-column screens collapse to one column; wide tables scroll inside their card; modals slide up as a bottom-sheet; 44px touch targets; 16px base font.

---

## 4. Screen-by-screen specification

Each SPA "view" is a full section swapped in the same page. IDs in parentheses map to the code.

### 4.1 Login (`#login`)
- **Fields:** `نام کاربری`, `رمز عبور` (password), button `ورود`.
- **States:** error line in red (e.g., «نام کاربری یا رمز اشتباه است», «نشست شما منقضی شده؛ دوباره وارد شوید»).
- Shown whenever there is no active session.

### 4.2 Management Dashboard (`#view-dashboard`) — staff default landing
Header row: `📊 داشبورد مدیریت` + `امروز: <Jalali date>`.
**Six section cards** (responsive grid, each a label→value list):
| Card | Metrics (label → value) |
|---|---|
| 🥛 ایستگاه شیر | دریافت امروز (kg) · ارزش امروز (ریال) · دامدار امروز (count) |
| 🏭 سالن تولید | شیر مصرفی امروز (kg) · بَچ امروز (count) · list of today's products |
| 🏪 فروشگاه | فروش امروز (ریال) · تعداد فاکتور |
| 🚚 پخش | سفارش امروز · تحویل‌شده (green) · باقیمانده (red) |
| 💰 حساب‌ها | طلب از مشتریان (red) · بدهی به دامداران (green) |
| 💵 نقدینگی امروز | علی‌الحساب پرداختی · دریافت از مشتری · کالای تحویلی |

Then two blocks:
- **🧀 روند فراوری شیر به محصولات (این ماه):** «شیر ورودی این ماه» + table `محصول تولیدشده | مقدار این ماه | نسبت از شیر (%)`.
- **شیر امروز به تفکیک دامدار:** table `دامدار | شیر امروز (kg) | ارزش شیر`.
- **Empty states:** «امروز تولیدی ثبت نشده», «این ماه تولیدی ثبت نشده», «امروز شیری ثبت نشده».

### 4.3 Operations (`#view-ops`) — the daily workhorse
Two columns (collapse to one on mobile):
- **Left — Persons list:** search input (`جستجو...`), `+` add-person button, list rows = `نام / کد` + colored balance (green = creditor, red = debtor). Empty: «موردی نیست».
- **Right — Person detail** (hidden until a person is selected; placeholder card «یک شخص را انتخاب کنید»):
  - **Header:** name, code, **status pill** (بستانکار / بدهکار / تسویه).
  - **Stat grid (6 tiles):** «قابل پرداخت تا این لحظه» (highlighted green tile) · شیر این ماه (کیلو) · ارزش شیر این ماه · مجموع خرید · برداشت نقدی · مجموع پرداخت‌ها.
  - **Quick actions:** `🧾 فاکتور تحویل شیر و خرید` (opens modal) · `💵 پرداخت به دامدار` · `📥 دریافت از مشتری` · `تسویهٔ کامل` (red). Last three are admin/accountant-only.
  - **گردش حساب (دفتر):** ledger table `تاریخ | شرح | بدهکار | بستانکار | مانده` (running balance). This is the bank-statement view.
  - **فاکتورهای این شخص:** table `شماره | شیر | خرید | خالص | [پرینت]`.

### 4.4 Invoice modal (`#invoiceModal`) — "فاکتور تحویل شیر و خرید"
Bottom-sheet on mobile. Combines milk delivery + goods purchase into one document.
- Target person line; **سایت** select (defaults to operator's site).
- **Section 🥛 تحویل شیر (اختیاری):** shift select (`— بدون شیر —` / صبح / شب), وزن (کیلو), قیمت (auto-filled from month price).
- **Section 🛒 خرید کالا / خوراک (اختیاری):** repeatable rows (کالا select, تعداد, قیمت), `+ افزودن قلم`.
- **توضیحات** free text.
- **Live summary bar:** «بستانکار شیر · بدهکار خرید · خالص فاکتور».
- Buttons: `انصراف`, `ثبت و پرینت فاکتور` → creates the receipt and opens the print page.
- **Validation:** at least milk OR one item required.

### 4.5 Production (`#view-production`) — staff
- **Form 🏭 ثبت تولید:** شیر خام مصرفی (kg) · انبار select · repeatable output rows (محصول, مقدار) · `+ افزودن محصول` · `ثبت بَچ تولید`. Outputs auto-enter inventory.
- **Table:** بَچ‌های اخیر → `کد بَچ | تاریخ | شیر مصرفی | محصولات`. Empty: «بَچی ثبت نشده».

### 4.6 Inventory (`#view-inventory`) — staff
- **Form ثبت ورود کالا (چیا اومده):** انبار select · کالا select · مقدار · بهای واحد (optional) · `ثبت ورود`.
- **Table موجودی انبار:** `کالا | دسته | واحد | وارد شده (green) | فروش/خروج (red) | موجودی فعلی`. Empty: «کالایی نیست».

### 4.7 Sites (`#view-sites`) — admin only
- **Form تعریف سایت جمع‌آوری شیر جدید:** کد سایت · نام · نوع (ایستگاه جمع‌آوری شیر / فروشگاه / مرکز پخش) · تلفن · `افزودن سایت` (auto-creates a warehouse).
- **Table سایت‌های تعریف‌شده:** `# | کد | نام | نوع | تلفن | انبار (count) | کاربر (count) | وضعیت (pill) | [+ متصدی]`. The `+ متصدی` button creates a site operator (station user) bound to that site.

### 4.8 Users (`#view-users`) — admin only
- **Form افزودن کاربر برای سایت:** نام کامل · نام کاربری · رمز عبور · نقش select · سایت select · شناسه بله (optional) · `افزودن کاربر`.
- **Table کاربران سیستم:** `# | نام | نام کاربری | نقش | سایت | وضعیت (pill) | بله (لاگین خودکار)`. Last column shows the linked Bale id or an `اتصال بله` / `تغییر` button.

### 4.9 Audit log (`#view-audit`) — admin only
- Title `📋 لاگ تغییرات سیستم` + search box. Helper: «هر عملیات هر کاربری ... اینجا ثبت می‌شود».
- **Table:** `زمان | کاربر | عملیات (ثبت/ویرایش/حذف) | بخش | مسیر | وضعیت (green<400 / red≥400) | IP`. Empty: «لاگی نیست».

### 4.10 Personal panel (`#view-me`) — farmer / customer
No top nav. Sections:
- **Account card:** name+code, status pill, stat grid — «قابل دریافت از شرکت» **or** «بدهی شما به شرکت» (label flips by sign) · شیر این ماه (کیلو) · ارزش شیر این ماه · مجموع خرید · مجموع پرداخت‌ها.
- **🛒 ثبت سفارش جدید:** repeatable item rows (محصول, تعداد, price shown disabled) · `+ افزودن قلم` · آدرس/محل تحویل · live «جمع سفارش» · `ثبت سفارش و ساخت فاکتور/بارنامه` (creates order → opens invoice + waybill to print). Error line for empty order.
- **سفارش‌های من:** table `شماره | مبلغ | وضعیت | [فاکتور] | [بارنامه]`.
- **گردش حساب من:** ledger table `تاریخ | شرح | بدهکار | بستانکار | مانده`.

---

## 5. Printed documents (thermal/A5 friendly, auto-print)

Both open in a new tab, render, then call `window.print()`. They must look good on **narrow thermal paper (~80mm)** and on A5. Print CSS hides toolbar buttons and the page background.

### 5.1 Receipt / فاکتور (`receipt.html?id=<receiptId>`)
Represents a combined milk-delivery + purchase document.
- **Header (centered):** site/branch name · phone + address · subtitle «فاکتور تحویل شیر و خرید».
- **Meta rows:** شماره فاکتور · تاریخ (Jalali) · طرف حساب (name + code).
- **Line table:** `شرح | مقدار | قیمت واحد | مبلغ`
  - Milk row (if any): «شیر صبح/شب» + kg + price → amount (green/credit).
  - Item rows: product × qty → amount (red/debit).
- **Totals:** «جمع بستانکار (شیر)» (green) · «جمع بدهکار (خرید)» (red) · «خالص این فاکتور» (large).
- **Account line:** «مانده کل حساب پس از فاکتور» with (بستانکار)/(بدهکار) tag.
- **Footer:** thank-you note + two signature lines (تحویل‌دهنده / تحویل‌گیرنده).
- **Buttons (screen only):** 🖨 پرینت · بستن.

### 5.2 Waybill / بارنامه (`waybill.html?id=<orderId>`)
Shipping/delivery document for an order.
- **Header (centered):** branch name · subtitle «بارنامه / حواله تحویل کالا».
- **Meta rows:** شماره بارنامه · شماره سفارش · تحویل‌گیرنده (name+code) · تلفن · مقصد تحویل.
- **Bordered table:** `# | کالا | مقدار | قیمت واحد | مبلغ`.
- **Total:** «جمع کل» (ریال).
- **Footer:** two signature lines (راننده/تحویل‌دهنده · تحویل‌گیرنده).

**Designer opportunity:** these are the customer-facing artifacts. A clean, brandable, printer-safe layout (logo slot, QR to open the mini-app, consistent number alignment) would add a lot of value.

---

## 6. Component inventory (current baseline)

| Component | Where | Notes for redesign |
|---|---|---|
| **Card** | everywhere | white, 1px border, radius 12, padding 16 |
| **Stat tile** | dashboards | label (muted, 12px) + value (bold, ~19px); a highlighted "payable" variant is green |
| **Status pill** | persons, sites, users | `creditor` (green) / `debtor` (red) / `settled` (gray) |
| **Data table** | most screens | header muted on light gray; rows separated by hairlines; debit red / credit green; scrolls horizontally inside card on mobile |
| **Nav tabs** | header | pill buttons; active = white on green; horizontal scroll on mobile |
| **Modal / bottom-sheet** | invoice | centered on desktop, slides from bottom on mobile |
| **Repeatable line row** | invoice, order, production | grid of select + qty + price + remove (×) |
| **Quick-action buttons** | operations | primary green, `ghost` (light), and `red` variants |
| **Search input** | persons, audit | inline, filters on input |
| **Empty state** | tables | single muted centered row with a short sentence |

---

## 7. Design tokens in use today (baseline to evolve)

```
--pri  #0d7a5f  (brand green, header, primary buttons)
--pri2 #0a6350  (hover)
--bg   #f4f6f8  (app canvas)
--card #ffffff
--line #e3e8ee  (borders/hairlines)
--txt  #1a2027  (primary text)
--muted#6b7683  (secondary text)
--green#1e8449  (credit / positive)
--red  #c0392b  (debit / negative)
Font: Tahoma / Segoe UI (system). Base 15–16px, line-height 1.6.
Radius: 8px (controls) – 12px (cards). Touch target: 44px.
```
No dark mode yet. No custom icon set (emoji used as section glyphs — a real icon set is a good upgrade). No logo asset yet.

---

## 8. Formatting & localization rules (must keep)
- **RTL** layout; numbers rendered with Persian digits via `fa-IR` locale.
- **Currency:** ریال (values are whole numbers, no decimals). Consider a تومان toggle (÷10) — not implemented.
- **Dates:** Jalali; month key format `YYYY-MM` (e.g., `1405-06`) drives milk pricing and month-close.
- **Balance sign convention:** `+` = company owes the person (payable, e.g. farmer credit); `−` = person owes company (receivable, e.g. customer debt).

---

## 9. Key user flows (for prototyping)
1. **Morning check (staff):** open app → Dashboard → glance at today's milk/sales/accounts.
2. **Milk intake + feed sale (staff):** Operations → pick farmer → «فاکتور تحویل شیر و خرید» → fill milk + items → ثبت و پرینت → receipt prints, Bale message sent to farmer.
3. **"Pay me now" (staff):** Operations → pick farmer → read «قابل پرداخت تا این لحظه» → «تسویهٔ کامل» or «پرداخت به دامدار».
4. **Customer order (person):** open mini-app (auto-login) → «ثبت سفارش جدید» → items + address → submit → invoice + waybill ready to print; order appears in «سفارش‌های من».
5. **Production (staff):** Production → raw milk in + products out → inventory updates → dashboard "روند فراوری" reflects it.
6. **Admin governance:** Sites (define sites + operators) · Users (accounts + Bale link) · Logs (who did what).

---

## 10. API reference (context for engineering)

Base path `/api`. Auth via session cookie. `staff` = staff-only; `admin` = admin-only; `person` = personal-panel; `any` = any signed-in user.

| Method & path | Access | Purpose |
|---|---|---|
| POST `/auth/login` | public | username/password login |
| POST `/auth/bale` | public | Bale mini-app auto-login (validates initData) |
| GET `/auth/me` | any | current session user |
| POST `/auth/logout` | any | end session |
| GET `/dashboard` | staff | management dashboard aggregates |
| GET `/persons` | staff | list/search persons (+balance) |
| POST `/persons` | staff | create person |
| GET `/persons/:id/dashboard` | staff | person summary card |
| GET `/persons/:id/ledger` | staff | person running ledger |
| POST `/milk/deliveries` · GET `/milk/deliveries` | staff | record / list milk deliveries |
| GET `/milk/price` · POST `/milk/price` | staff | monthly milk price |
| POST `/receipts` | staff | create combined milk+purchase invoice (+ Bale notify) |
| GET `/receipts/:id` | staff or owner | full invoice for print |
| GET `/receipts` | staff | list invoices |
| POST `/receipts/:id/printed` | any | mark printed |
| POST `/orders` | staff | staff sale |
| GET `/orders/:id` | staff or owner | order for waybill/invoice |
| GET `/products` | any | product catalog |
| POST `/payments` · POST `/payments/settle` · POST `/payments/void/:txId` | staff | payments / settle / void |
| GET `/inventory` · GET `/inventory/warehouses` · POST `/inventory/receive` | staff | stock summary / warehouses / stock-in |
| POST `/production` · GET `/production` | staff | record / list production batches |
| GET `/branches` · POST `/branches` · PUT `/branches/:id` · GET `/branches/:id/warehouses` | staff (writes admin) | sites |
| GET `/users` · GET `/users/roles` · POST `/users` · PUT `/users/:id/bale` | admin | users & Bale linking |
| GET `/audit` | admin | change log |
| GET `/me/dashboard` · `/me/ledger` · `/me/receipts` · `/me/orders` · POST `/me/orders` | person | personal panel |

**Print pages (not JSON):** `/receipt.html?id=` , `/waybill.html?id=`. SPA served at `/`, `/login`, `/app`.

---

## 11. Known UX gaps / redesign opportunities
- Login & personal panel deserve a polished, on-brand, mobile-first treatment (first impression + Bale surface).
- Replace emoji glyphs with a consistent icon set; add a logo.
- Add loading skeletons and clearer success toasts (some actions use `alert()`/`prompt()` today — the item pickers and payment prompts should become proper inputs/modals).
- Dashboard could use charts (milk trend, processing ratios) — data is available.
- Dark mode and a تومان/ریال unit toggle.
- Print documents: brandable header, logo slot, QR deep-link, tighter thermal layout.
- Empty/error/loading states exist as plain text — ripe for friendlier illustrations/microcopy.

---

*Generated as a design handoff for the Milk-Wear system. UI strings are authoritative; keep Persian labels intact and RTL.*
