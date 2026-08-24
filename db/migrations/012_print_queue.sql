-- صف چاپ سمت سرور برای پرینت‌ایجنت (ESC/POS 80mm) + زمان‌بندی سفارش‌گیری
-- ------------------------------------------------------------------

-- صف کارهای چاپ؛ ایجنت کنار پرینتر این‌ها را می‌گیرد و چاپ می‌کند
CREATE TABLE IF NOT EXISTS print_jobs (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  branch_id   BIGINT NULL,
  kind        ENUM('waybill','receipt','test') NOT NULL,
  ref_type    ENUM('order','receipt','none') NOT NULL DEFAULT 'none',
  ref_id      BIGINT NULL,
  copies      INT NOT NULL DEFAULT 1,
  payload     JSON NOT NULL,                 -- عکس‌برداری کاملِ سند (برای چاپ پایدار)
  status      ENUM('queued','printing','done','error') NOT NULL DEFAULT 'queued',
  attempts    INT NOT NULL DEFAULT 0,
  error       VARCHAR(255) NULL,
  agent_id    VARCHAR(64) NULL,              -- کدام ایجنت این کار را برداشت
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  picked_at   TIMESTAMP NULL,
  printed_at  TIMESTAMP NULL,
  INDEX idx_status (status),
  INDEX idx_branch (branch_id),
  INDEX idx_ref (ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- وضعیت «در صف چاپ/تحویل» برای سفارش‌های تحویلی راننده
ALTER TABLE orders
  MODIFY status ENUM('draft','queued','confirmed','delivered','settled','canceled')
  NOT NULL DEFAULT 'confirmed';

-- علامت‌گذاری اینکه بارنامهٔ سفارش به صف چاپ رفته (برای جلوگیری از چاپ تکراری در تیک بعدی)
ALTER TABLE orders
  ADD COLUMN waybill_queued_at TIMESTAMP NULL AFTER status;

-- حذف تنظیمات تکراری قدیمی و افزودن یکتایی برای صحت upsert
DELETE s1 FROM settings s1
  JOIN settings s2
    ON s1.scope = s2.scope AND s1.`key` = s2.`key`
   AND (s1.scope_id <=> s2.scope_id) AND s1.id > s2.id;

-- تنظیمات پیش‌فرض سفارش‌گیری/چاپ (فقط اگر نبودند)
INSERT INTO settings (scope, scope_id, `key`, value_json)
SELECT * FROM (
  SELECT 'global' sc, NULL sid, 'order_window_open'  k, JSON_QUOTE('08:00') v UNION ALL
  SELECT 'global', NULL, 'order_window_close',        JSON_QUOTE('14:00') UNION ALL
  SELECT 'global', NULL, 'print_mode',                JSON_QUOTE('on_close') UNION ALL   -- on_close | every_n | both
  SELECT 'global', NULL, 'print_interval_min',        CAST(10 AS JSON) UNION ALL
  SELECT 'global', NULL, 'accept_orders_outside_window', CAST(FALSE AS JSON)
) d
WHERE NOT EXISTS (
  SELECT 1 FROM settings s WHERE s.scope='global' AND s.`key`=d.k
);
